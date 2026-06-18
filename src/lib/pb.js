import PocketBase from "pocketbase";
import { normalizeWord } from "./words.js";

// La URL y el token son OBLIGATORIOS: ambos deben estar en .env.
// ADVERTENCIA: cualquier variable VITE_* queda visible en el bundle del navegador.
const PB_URL = (import.meta.env.VITE_PB_URL || "").trim();
const COLLECTION = (import.meta.env.VITE_PB_COLLECTION || "participants").trim();
const PB_TOKEN = (import.meta.env.VITE_PB_TOKEN || "").trim();

export { PB_URL, COLLECTION as PB_COLLECTION, PB_TOKEN };

export const pb = new PocketBase(PB_URL);
pb.autoCancellation(false);

export const PB_READY = Boolean(PB_URL && PB_TOKEN);
if (PB_READY) {
  pb.authStore.save(PB_TOKEN, null);
}

function assertReady() {
  // Sin valores sensibles: solo se indica que falta configuracion requerida.
  if (!PB_URL || !PB_TOKEN) {
    throw new Error("CONFIG: faltan variables de entorno requeridas.");
  }
}

// ===========================================================================
// MODELO (una sola coleccion, dos tipos de registro distinguidos por `text`):
//   - VOTO : { email: correo, json: string[] (palabras),            text: "" }
//   - TAG  : { email: creador, json: [{id,author,body,ts,edited}],  text: TAG }
// `text` vacio -> registro de voto;  `text` con valor -> el record del tag,
// que contiene TODO su chat dentro de `json`. Un solo record por tag.
// ===========================================================================

// Escapa comillas para usar un valor dentro de un filtro de PocketBase.
function q(value) {
  return String(value).replace(/"/g, '\\"');
}

// Filtro que selecciona SOLO registros de voto (text vacio o nulo).
const VOTE_FILTER = '(text="" || text=null)';

// Lee el array de palabras de un record de voto.
function wordsOf(record) {
  return Array.isArray(record?.json) ? record.json : [];
}

// Busca el record de VOTO del usuario por email. Devuelve null si no existe.
async function findUserRecord(email) {
  try {
    return await pb
      .collection(COLLECTION)
      .getFirstListItem(`email="${q(email)}" && ${VOTE_FILTER}`);
  } catch (err) {
    if (err && err.status === 404) return null;
    throw err;
  }
}

// Garantiza que exista el record de voto del usuario. Lo crea (json: []) si no existe.
export async function ensureUser(email) {
  assertReady();
  const existing = await findUserRecord(email);
  if (existing) return existing;
  try {
    return await pb.collection(COLLECTION).create({ email, json: [], text: "" });
  } catch (err) {
    const again = await findUserRecord(email);
    if (again) return again;
    throw err;
  }
}

// Agrega una palabra al record del usuario.
export async function addWord(email, rawWord) {
  assertReady();
  const norm = normalizeWord(rawWord);
  if (!norm.ok) return norm;
  const word = norm.word;

  const record = await ensureUser(email);
  const words = wordsOf(record);
  if (words.includes(word)) {
    return { ok: false, error: "Ya enviaste esa palabra." };
  }
  await pb.collection(COLLECTION).update(record.id, { json: [...words, word] });
  return { ok: true, word };
}

// Devuelve el array de palabras (votos) del usuario actual.
export async function getMyWords(email) {
  assertReady();
  const record = await findUserRecord(email);
  return record ? wordsOf(record) : [];
}

// Quita una palabra (el voto del usuario) de su record.
export async function removeWord(email, rawWord) {
  assertReady();
  const norm = normalizeWord(rawWord);
  if (!norm.ok) return norm;
  const word = norm.word;

  const record = await findUserRecord(email);
  if (!record) return { ok: true, removed: false };
  const words = wordsOf(record);
  if (!words.includes(word)) return { ok: true, removed: false };

  await pb
    .collection(COLLECTION)
    .update(record.id, { json: words.filter((w) => w !== word) });
  return { ok: true, removed: true, word };
}

// Cuenta en cuantos usuarios aparece cada palabra -> relevancia.
export async function getWordCounts() {
  assertReady();
  const records = await pb.collection(COLLECTION).getFullList({
    fields: "json",
    filter: VOTE_FILTER, // solo registros de voto, nunca records de tag
    batch: 500,
  });
  const counts = new Map();
  for (const rec of records) {
    for (const w of new Set(wordsOf(rec))) {
      counts.set(w, (counts.get(w) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([word, count]) => ({ word, count }))
    .sort((a, b) => b.count - a.count || a.word.localeCompare(b.word));
}

// ===========================================================================
// CHAT POR TAG: UN SOLO record por tag contiene todo el chat dentro de `json`.
//   { text: TAG, email: creador, json: [ {id, author, body, ts, edited} ] }
// ===========================================================================

const MAX_MSG_LEN = 1000;

function tagKey(rawWord) {
  const n = normalizeWord(rawWord);
  return n.ok ? n.word : null;
}

// Lee el array de mensajes de un record de tag.
function messagesOf(rec) {
  return Array.isArray(rec?.json) ? rec.json : [];
}

function newId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// Busca el record del tag por su nombre. null si no existe.
async function findTagRecord(tag) {
  try {
    return await pb.collection(COLLECTION).getFirstListItem(`text="${q(tag)}"`);
  } catch (err) {
    if (err && err.status === 404) return null;
    throw err;
  }
}

// Garantiza el record del tag (lo crea con chat vacio si no existe).
async function ensureTagRecord(tag, creator) {
  const existing = await findTagRecord(tag);
  if (existing) return existing;
  try {
    return await pb
      .collection(COLLECTION)
      .create({ text: tag, email: creator || "", json: [] });
  } catch (err) {
    const again = await findTagRecord(tag);
    if (again) return again;
    throw err;
  }
}

// Devuelve los mensajes del chat de un tag (array; [] si no hay record).
export async function getMessages(rawWord) {
  assertReady();
  const tag = tagKey(rawWord);
  if (!tag) return [];
  const rec = await findTagRecord(tag);
  return rec ? messagesOf(rec) : [];
}

// Publica un mensaje (lo agrega al array del record del tag).
// author = correo del usuario (se guarda, no se muestra en el dashboard).
export async function postMessage(rawWord, author, rawBody) {
  assertReady();
  const tag = tagKey(rawWord);
  if (!tag) return { ok: false, error: "Tag no valido." };
  const body = String(rawBody || "").trim();
  if (!body) return { ok: false, error: "Escribe un mensaje." };
  if (body.length > MAX_MSG_LEN) return { ok: false, error: `Maximo ${MAX_MSG_LEN} caracteres.` };
  const rec = await ensureTagRecord(tag, author);
  const msg = { id: newId(), author: author || "", body, ts: Date.now(), edited: false };
  const updated = await pb
    .collection(COLLECTION)
    .update(rec.id, { json: [...messagesOf(rec), msg] });
  return { ok: true, messages: messagesOf(updated) };
}

// Edita un mensaje propio dentro del record del tag (match por id + autor).
export async function editMessage(rawWord, msgId, author, rawBody) {
  assertReady();
  const tag = tagKey(rawWord);
  if (!tag) return { ok: false, error: "Tag no valido." };
  const body = String(rawBody || "").trim();
  if (!body) return { ok: false, error: "Escribe un mensaje." };
  if (body.length > MAX_MSG_LEN) return { ok: false, error: `Maximo ${MAX_MSG_LEN} caracteres.` };
  const rec = await findTagRecord(tag);
  if (!rec) return { ok: false, error: "No existe el chat." };
  const a = (author || "").toLowerCase();
  const next = messagesOf(rec).map((m) =>
    m.id === msgId && (m.author || "").toLowerCase() === a
      ? { ...m, body, edited: true }
      : m
  );
  const updated = await pb.collection(COLLECTION).update(rec.id, { json: next });
  return { ok: true, messages: messagesOf(updated) };
}

// Suscripcion en tiempo real al record del tag. Entrega el array completo de
// mensajes en cada cambio. Devuelve una funcion para cancelar.
export async function subscribeMessages(rawWord, onMessages) {
  const tag = tagKey(rawWord);
  if (!tag) return () => {};
  return await pb.collection(COLLECTION).subscribe("*", (e) => {
    if (!e?.record) return;
    if ((e.record.text || "") !== tag) return;
    onMessages(e.action === "delete" ? [] : messagesOf(e.record));
  });
}

// Borra el chat completo de un tag (su unico record). Se usa cuando el tag
// pierde su ultimo voto y desaparece.
export async function deleteTagChat(rawWord) {
  assertReady();
  const tag = tagKey(rawWord);
  if (!tag) return { ok: false, removed: 0 };
  const rec = await findTagRecord(tag);
  if (!rec) return { ok: true, removed: 0 };
  await pb.collection(COLLECTION).delete(rec.id);
  return { ok: true, removed: 1 };
}

// Borra un mensaje propio del record del tag (match por id + autor).
export async function deleteMessage(rawWord, msgId, author) {
  assertReady();
  const tag = tagKey(rawWord);
  if (!tag) return { ok: false, error: "Tag no valido." };
  const rec = await findTagRecord(tag);
  if (!rec) return { ok: false, error: "No existe el chat." };
  const a = (author || "").toLowerCase();
  const msgs = messagesOf(rec);
  const next = msgs.filter(
    (m) => !(m.id === msgId && (m.author || "").toLowerCase() === a)
  );
  if (next.length === msgs.length) return { ok: true, messages: msgs }; // no es tuyo
  const updated = await pb.collection(COLLECTION).update(rec.id, { json: next });
  return { ok: true, messages: messagesOf(updated) };
}
