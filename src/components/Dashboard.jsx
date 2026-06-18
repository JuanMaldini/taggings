import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import {
  addWord,
  removeWord,
  deleteTagChat,
  getWordCounts,
  getMyWords,
} from "../lib/pb.js";
import { formatPbError } from "../lib/errors.js";
import { normalizeWord } from "../lib/words.js";
import WordCloud from "./WordCloud.jsx";
import Analytics from "./Analytics.jsx";
import TagChat from "./TagChat.jsx";

const MAX_SUGGESTIONS = 8; // autocompletado

export default function Dashboard({ email, onLogout, onOpenLogin }) {
  const [items, setItems] = useState([]);
  const [mine, setMine] = useState(() => new Set()); // palabras que voto este usuario
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const [errorDetail, setErrorDetail] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1); // sugerencia resaltada
  const [open, setOpen] = useState(false); // mostrar desplegable
  const [pendingWord, setPendingWord] = useState(""); // palabra escrita sin sesion
  const [chatTag, setChatTag] = useState(null); // tag con el chat abierto
  const [confirmTag, setConfirmTag] = useState(null); // tag a punto de eliminarse
  const blurTimer = useRef(null);

  const refresh = useCallback(async () => {
    try {
      // La nube se carga siempre (con o sin sesion); los votos propios solo si hay login.
      const counts = await getWordCounts();
      setItems(counts);
      setMine(new Set(email ? await getMyWords(email) : []));
      setError("");
      setErrorDetail("");
    } catch (err) {
      const f = formatPbError(err, { where: "Dashboard.refresh / getWordCounts" });
      setError("No se pudo conectar con el servidor.");
      setErrorDetail(f.hint);
    } finally {
      setLoading(false);
    }
  }, [email]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Si el usuario escribio una palabra sin sesion, al loguearse se envia sola.
  useEffect(() => {
    if (email && pendingWord) {
      const w = pendingWord;
      setPendingWord("");
      submitWord(w);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [email, pendingWord]);

  // Sugerencias: filtra TODAS las palabras existentes contra lo que se escribe.
  const suggestions = useMemo(() => {
    const q = normalizeWord(value);
    if (!q.ok) return [];
    const term = q.word;
    const starts = [];
    const contains = [];
    for (const it of items) {
      if (it.word === term) continue;
      if (it.word.startsWith(term)) starts.push(it);
      else if (it.word.includes(term)) contains.push(it);
    }
    return [...starts, ...contains].slice(0, MAX_SUGGESTIONS);
  }, [value, items]);

  const showList = open && suggestions.length > 0;

  async function submitWord(rawWord) {
    const word = String(rawWord || "").trim();
    if (!word || sending) return;
    if (!email) {
      setOpen(false);
      setPendingWord(word);
      onOpenLogin && onOpenLogin();
      return;
    }
    setSending(true);
    setError("");
    setErrorDetail("");
    setOpen(false);
    setActiveIndex(-1);
    try {
      const res = await addWord(email, word);
      if (!res.ok) {
        setError(res.error);
      } else {
        setValue("");
        await refresh();
      }
    } catch (err) {
      const f = formatPbError(err, { where: "Dashboard.submitWord / addWord" });
      setError("No se pudo guardar la palabra.");
      setErrorDetail(f.hint);
    } finally {
      setSending(false);
    }
  }

  // Suma o quita el voto del usuario actual sobre una palabra.
  async function doVote(word) {
    setSending(true);
    setError("");
    setErrorDetail("");
    try {
      const res = mine.has(word) ? await removeWord(email, word) : await addWord(email, word);
      if (!res.ok) setError(res.error || "No se pudo registrar tu voto.");
      else await refresh();
    } catch (err) {
      const f = formatPbError(err, { where: "Dashboard.doVote" });
      setError("No se pudo registrar tu voto.");
      setErrorDetail(f.hint);
    } finally {
      setSending(false);
    }
  }

  // Clic en una palabra (con sesion). Si tu voto es el ULTIMO, confirmar antes
  // porque quitarlo elimina el tag y su chat.
  async function handleWordClick(word) {
    if (sending) return;
    if (!email) {
      onOpenLogin && onOpenLogin();
      return;
    }
    if (mine.has(word)) {
      const it = items.find((x) => x.word === word);
      if (it && it.count <= 1) {
        setConfirmTag(word);
        return;
      }
    }
    await doVote(word);
  }

  // Confirmado: quita el ultimo voto y borra el chat del tag.
  async function confirmDelete() {
    const word = confirmTag;
    setConfirmTag(null);
    if (!word) return;
    setSending(true);
    setError("");
    setErrorDetail("");
    try {
      await removeWord(email, word);
      await deleteTagChat(word);
      if (chatTag === word) setChatTag(null);
      await refresh();
    } catch (err) {
      const f = formatPbError(err, { where: "Dashboard.confirmDelete" });
      setError("No se pudo eliminar el tag.");
      setErrorDetail(f.hint);
    } finally {
      setSending(false);
    }
  }

  // Abrir el chat de un tag. Requiere sesion (sin login no se ve ni se abre).
  function handleOpenChat(word) {
    if (!email) {
      onOpenLogin && onOpenLogin();
      return;
    }
    setChatTag(word);
  }

  function handleSubmit(e) {
    e.preventDefault();
    if (activeIndex >= 0 && suggestions[activeIndex]) {
      submitWord(suggestions[activeIndex].word);
    } else {
      submitWord(value);
    }
  }

  function handleKeyDown(e) {
    if (!showList) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % suggestions.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
    } else if (e.key === "Escape") {
      setOpen(false);
      setActiveIndex(-1);
    }
  }

  return (
    <div className="screen">
      <section className="dash-page">
        <div className="authbar">
          {email ? (
            <>
              <span className="muted topbar__email">{email.split("@")[0]}</span>
              <button className="btn btn--ghost" onClick={onLogout}>
                Salir
              </button>
            </>
          ) : (
            <button className="btn btn--ghost" onClick={onOpenLogin}>
              Login
            </button>
          )}
        </div>

        <form className="composer" onSubmit={handleSubmit}>
          <div className="composer__field">
            <input
              className="input input--big"
              placeholder="Escribe una palabra y presiona Enter"
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                setOpen(true);
                setActiveIndex(-1);
              }}
              onFocus={() => setOpen(true)}
              onBlur={() => {
                blurTimer.current = setTimeout(() => setOpen(false), 120);
              }}
              onKeyDown={handleKeyDown}
              maxLength={40}
              autoFocus
              disabled={sending}
              role="combobox"
              aria-expanded={showList}
              aria-autocomplete="list"
            />
            {showList && (
              <ul className="suggestions" role="listbox">
                {suggestions.map((s, i) => (
                  <li
                    key={s.word}
                    role="option"
                    aria-selected={i === activeIndex}
                    className={
                      "suggestions__item" + (i === activeIndex ? " suggestions__item--active" : "")
                    }
                    onMouseEnter={() => setActiveIndex(i)}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      if (blurTimer.current) clearTimeout(blurTimer.current);
                      submitWord(s.word);
                    }}
                  >
                    <span className="suggestions__word">{s.word}</span>
                    <span className="suggestions__count">{s.count}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </form>
        {error && <p className="error error--center">{error}</p>}
        {errorDetail && <p className="error-detail error--center">{errorDetail}</p>}

        {loading ? (
          <div className="cloud cloud--empty">
            <p className="muted">Cargando…</p>
          </div>
        ) : (
          <WordCloud
            items={items}
            mine={mine}
            onWordClick={handleWordClick}
            onOpenChat={handleOpenChat}
            canVote={Boolean(email)}
          />
        )}
      </section>

      <Analytics items={items} />

      {chatTag && (
        <TagChat tag={chatTag} email={email} onClose={() => setChatTag(null)} />
      )}

      {confirmTag && (
        <div className="modal-backdrop" onMouseDown={() => setConfirmTag(null)}>
          <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
            <div className="card confirm">
              <p className="confirm__title">¿Eliminar “{confirmTag}”?</p>
              <p className="confirm__text">
                Eres el último voto. Si lo quitas, el tag y toda su conversación se
                eliminarán para todos. Esta acción no se puede deshacer.
              </p>
              <div className="confirm__actions">
                <button className="btn btn--ghost" onClick={() => setConfirmTag(null)}>
                  Cancelar
                </button>
                <button className="btn btn--danger" onClick={confirmDelete} disabled={sending}>
                  Eliminar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
