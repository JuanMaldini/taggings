// Nube radial centrada: la palabra mas relevante va al centro y crece;
// las demas se reparten en espiral alrededor. Colorida y en MAYUSCULAS.

// ===========================================================================
// MULTIPLICADOR DEL TAMANO DE LAS PALABRAS  (ajustalo aqui, NO en .env)
const SIZE_MULTIPLIER = 0.25;
// ===========================================================================

const MIN_FONT = 16; // px de la palabra menos votada
const MAX_GROWTH = (64 - MIN_FONT) * SIZE_MULTIPLIER; // px extra para la mas votada

// Tamaño de fuente en funcion de la relevancia (count).
function fontSizeFor(count, max) {
  if (max <= 1) return Math.round(MIN_FONT + MAX_GROWTH * 0.3);
  const t = (count - 1) / (max - 1); // 0..1
  return Math.round(MIN_FONT + t * MAX_GROWTH);
}

// Color estable por palabra (HSL).
function colorFor(word) {
  let h = 0;
  for (let i = 0; i < word.length; i++) {
    h = (h * 31 + word.charCodeAt(i)) % 360;
  }
  return `hsl(${h} 70% 60%)`;
}

// Posiciones en espiral (Vogel / phyllotaxis) para repartir de forma radial.
function spiralPositions(n) {
  const golden = Math.PI * (3 - Math.sqrt(5));
  const pts = [];
  for (let i = 0; i < n; i++) {
    const r = i === 0 ? 0 : Math.sqrt(i) * 13; // % desde el centro
    const a = i * golden;
    pts.push({
      x: 50 + r * Math.cos(a),
      y: 50 + r * Math.sin(a),
    });
  }
  return pts;
}

export default function WordCloud({ items, mine, onWordClick, onOpenChat, canVote }) {
  if (!items.length) {
    return (
      <div className="cloud cloud--empty">
        <p className="muted">Aun no hay palabras. Escribe la primera.</p>
      </div>
    );
  }

  const max = items[0].count; // items viene ordenado desc
  const pos = spiralPositions(items.length);
  const owns = (word) => Boolean(mine && mine.has(word));

  return (
    <div className="cloud" role="list" aria-label="Nube de palabras">
      {items.map((item, i) => {
        const size = fontSizeFor(item.count, max);
        const isMine = owns(item.word);
        const style = {
          left: `${pos[i].x}%`,
          top: `${pos[i].y}%`,
          color: colorFor(item.word),
          fontSize: `${size}px`,
        };

        // Con sesion: tarjeta con 3 zonas -> nombre (vota al click) · ×multiplicador
        // (chico) · boton de chat. Sin sesion: solo se muestra el texto y el conteo.
        if (canVote) {
          return (
            <div
              key={item.word}
              className={"cloud__word cloud__card " + (isMine ? "is-mine" : "is-votable")}
              style={style}
            >
              <button
                type="button"
                className="cloud__vote"
                title={isMine ? "quitar mi voto" : "votar"}
                onClick={() => onWordClick && onWordClick(item.word)}
              >
                {item.word}
              </button>
              <div className="cloud__meta">
                <span className="cloud__count">×{item.count}</span>
                <button
                  type="button"
                  className="cloud__chat"
                  aria-label={`Abrir chat de ${item.word}`}
                  title="Abrir chat"
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpenChat && onOpenChat(item.word);
                  }}
                >
                  <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">
                    <path
                      fill="currentColor"
                      d="M4 4h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9l-5 4V6a2 2 0 0 1 2-2Z"
                    />
                  </svg>
                </button>
              </div>
            </div>
          );
        }

        return (
          <div
            key={item.word}
            role="listitem"
            className="cloud__word"
            style={style}
            title={`${item.word} · ${item.count}`}
          >
            <span className="cloud__text">{item.word}</span>
            <span className="cloud__count">×{item.count}</span>
          </div>
        );
      })}
    </div>
  );
}
