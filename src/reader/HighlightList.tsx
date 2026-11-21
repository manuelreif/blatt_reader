import type { Highlight } from '../db/schema'
import { displayText } from './highlights'

/** All marks of the open book in reading order; a tap jumps there. */
export function HighlightList({
  list,
  onPick,
  onClose,
}: {
  list: Highlight[]
  onPick: (h: Highlight) => void
  onClose: () => void
}) {
  return (
    <aside className="sheet mark-list" role="dialog" aria-label="Markierungen" data-testid="mark-list">
      <div className="sheet-head">
        <span className="sheet-word">Markierungen</span>
        <button className="icon" title="Schließen (Esc)" onClick={onClose}>
          ✕
        </button>
      </div>
      <div className="sheet-body">
        {list.length === 0 ? (
          <p className="muted">
            Noch keine Markierungen in diesem Buch. Im Modus „🖍 Markieren“ ein Wort antippen oder Text auswählen.
          </p>
        ) : (
          <ul className="mark-items">
            {list.map(h => {
              const text = displayText(h)
              return (
                <li key={h.id}>
                  <button className="mark-item" onClick={() => onPick(h)}>
                    <span className={`swatch swatch-${h.color}`} aria-hidden />
                    <span>
                      <span className="mark-text">{text.length > 200 ? `${text.slice(0, 200)} …` : text}</span>
                      {h.note && <span className="mark-item-note">{h.note}</span>}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </aside>
  )
}
