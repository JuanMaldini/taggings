import { useEffect, useRef, useState } from "react";
import {
  getMessages,
  postMessage,
  editMessage,
  deleteMessage,
  subscribeMessages,
} from "../lib/pb.js";
import { formatPbError } from "../lib/errors.js";

// Canal publico de un tag. Conversacion arriba, escribir abajo. Sin titulo ni
// boton de cerrar: se cierra al hacer clic fuera o con Escape. Los mensajes se
// muestran ANONIMOS; solo puedes editar/borrar los tuyos (author === tu correo).
// Todo el chat vive dentro de un unico record del tag.
export default function TagChat({ tag, email, onClose }) {
  const [messages, setMessages] = useState([]);
  const [value, setValue] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [editValue, setEditValue] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const logRef = useRef(null);

  // Carga inicial + suscripcion en tiempo real (entrega el array completo).
  useEffect(() => {
    let alive = true;
    let unsub = () => {};
    (async () => {
      try {
        const msgs = await getMessages(tag);
        if (alive) setMessages(msgs);
      } catch (err) {
        const f = formatPbError(err, { where: "TagChat.getMessages" });
        if (alive) setError(f.hint);
      }
      try {
        unsub = await subscribeMessages(tag, (msgs) => {
          setMessages(Array.isArray(msgs) ? msgs : []);
        });
      } catch {
        /* sin tiempo real: el chat sigue con la carga inicial y los envios */
      }
    })();
    return () => {
      alive = false;
      try {
        if (typeof unsub === "function") unsub();
      } catch {
        /* noop */
      }
    };
  }, [tag]);

  // Autoscroll al fondo cuando llegan mensajes.
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  // Escape cierra.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose && onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function send(e) {
    e.preventDefault();
    const body = value.trim();
    if (!body || sending) return;
    setSending(true);
    setError("");
    try {
      const res = await postMessage(tag, email, body);
      if (!res.ok) setError(res.error || "No se pudo enviar.");
      else {
        setValue("");
        setMessages(res.messages);
      }
    } catch (err) {
      const f = formatPbError(err, { where: "TagChat.postMessage" });
      setError(f.hint);
    } finally {
      setSending(false);
    }
  }

  function startEdit(m) {
    setEditingId(m.id);
    setEditValue(m.body);
  }

  async function saveEdit(id) {
    const body = editValue.trim();
    if (!body) return;
    try {
      const res = await editMessage(tag, id, email, body);
      if (!res.ok) setError(res.error || "No se pudo editar.");
      else {
        setMessages(res.messages);
        setEditingId(null);
        setEditValue("");
      }
    } catch (err) {
      const f = formatPbError(err, { where: "TagChat.editMessage" });
      setError(f.hint);
    }
  }

  async function removeMine(id) {
    setError("");
    try {
      const res = await deleteMessage(tag, id, email);
      if (!res.ok) setError(res.error || "No se pudo borrar.");
      else {
        setMessages(res.messages);
        if (editingId === id) {
          setEditingId(null);
          setEditValue("");
        }
      }
    } catch (err) {
      const f = formatPbError(err, { where: "TagChat.deleteMessage" });
      setError(f.hint);
    }
  }

  return (
    <div className="chat-backdrop" onMouseDown={onClose}>
      <div className="chat" onMouseDown={(e) => e.stopPropagation()}>
        <div className="chat__log" ref={logRef}>
          {messages.length === 0 ? (
            <div className="chat__empty">Detalles · {tag}</div>
          ) : (
            messages.map((m) => {
              const isMine =
                email && m.author && m.author.toLowerCase() === email.toLowerCase();
              const editing = editingId === m.id;
              return (
                <div
                  key={m.id}
                  className={"chat__msg" + (isMine ? " chat__msg--mine" : "")}
                >
                  {editing ? (
                    <div className="chat__edit">
                      <input
                        className="input"
                        value={editValue}
                        maxLength={1000}
                        autoFocus
                        onChange={(e) => setEditValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            saveEdit(m.id);
                          } else if (e.key === "Escape") {
                            e.stopPropagation();
                            setEditingId(null);
                          }
                        }}
                      />
                      <button
                        type="button"
                        className="btn btn--ghost"
                        onClick={() => saveEdit(m.id)}
                      >
                        Guardar
                      </button>
                    </div>
                  ) : (
                    <>
                      <span className="chat__body">{m.body}</span>
                      {m.edited && <span className="chat__edited">(editado)</span>}
                      {isMine && (
                        <span className="chat__actions">
                          <button
                            type="button"
                            className="chat__editbtn"
                            onClick={() => startEdit(m)}
                          >
                            editar
                          </button>
                          <button
                            type="button"
                            className="chat__editbtn chat__delbtn"
                            onClick={() => removeMine(m.id)}
                          >
                            borrar
                          </button>
                        </span>
                      )}
                    </>
                  )}
                </div>
              );
            })
          )}
        </div>
        {error && <p className="chat__error">{error}</p>}
        <form className="chat__compose" onSubmit={send}>
          <input
            className="input chat__input"
            placeholder="Escribe un mensaje…"
            value={value}
            maxLength={1000}
            autoFocus
            disabled={sending}
            onChange={(e) => setValue(e.target.value)}
          />
          <button className="btn chat__send" type="submit" disabled={sending}>
            Enviar
          </button>
        </form>
      </div>
    </div>
  );
}
