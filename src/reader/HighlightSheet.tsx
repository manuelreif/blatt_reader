import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useRef, useState } from 'react'
import { db, HIGHLIGHT_COLORS, type HighlightColor } from '../db/schema'
import { cleanText } from '../nlp/sentence'
import { deleteHighlight, updateHighlight } from './highlights'

export const COLOR_LABEL: Record<HighlightColor, string> = { yellow: 'Gelb', green: 'Grün', blue: 'Blau', pink: 'Rosa' }

export function ColorSwatches({
  value,
  onPick,
}: {
  value?: HighlightColor
  onPick: (c: HighlightColor) => void
}) {
  return (
    <div className="swatches" role="group" aria-label="Farbe">
      {HIGHLIGHT_COLORS.map(c => (
        <button
          key={c}
          className={`swatch swatch-${c}`}
          aria-label={COLOR_LABEL[c]}
          aria-pressed={value === c}
          title={COLOR_LABEL[c]}
          onClick={() => onPick(c)}
        />
      ))}
    </div>
  )
}

const MAX_LOOKUP_WORDS = 6

/**
 * Sheet for a mark: either a pending selection (picking a color saves it) or a saved mark
 * (change color, note, delete, look up).
 */
export function HighlightSheet({
  id,
  pendingText,
  onPickPending,
  onLookup,
  onClose,
}: {
  /** saved mark */
  id?: string
  /** selection that is not marked yet */
  pendingText?: string
  onPickPending?: (c: HighlightColor) => void
  onLookup?: () => void
  onClose: () => void
}) {
  const h = useLiveQuery(() => (id ? db.highlights.get(id) : undefined), [id])
  const [note, setNote] = useState<string | null>(null)
  const noteRef = useRef<{ id?: string; note: string | null; saved?: string }>({ note: null })
  noteRef.current = { id: h?.id, note, saved: h?.note }

  useEffect(() => setNote(null), [id])
  // save an edited note when the sheet closes or switches to another mark
  useEffect(
    () => () => {
      const { id: hid, note: n, saved } = noteRef.current
      if (hid && n !== null && n !== (saved ?? ''))
        void db.highlights.get(hid).then(cur => {
          if (cur && !cur.deleted) void updateHighlight(hid, { note: n.trim() || undefined })
        })
    },
    [id],
  )

  const text = cleanText(h?.text ?? pendingText ?? '')
  const words = text.split(/\s+/).filter(Boolean).length
  const saveNote = () => {
    if (h && note !== null && note !== (h.note ?? '')) void updateHighlight(h.id, { note: note.trim() || undefined })
  }

  return (
    <aside className="sheet mark-sheet" role="dialog" aria-label="Markierung" data-testid="mark-sheet">
      <div className="sheet-head">
        <span className="mark-quote">„{text.length > 160 ? `${text.slice(0, 160)} …` : text}“</span>
        <button className="icon" title="Schließen (Esc)" onClick={onClose}>
          ✕
        </button>
      </div>
      <div className="sheet-body">
        {!id ? (
          <p className="muted">Farbe antippen zum Markieren:</p>
        ) : !h || h.deleted ? (
          <p className="muted">Markierung gelöscht.</p>
        ) : (
          <label className="mark-note">
            <span className="label">Notiz</span>
            <textarea
              rows={2}
              value={note ?? h.note ?? ''}
              placeholder="eigene Notiz (optional)"
              onChange={e => setNote(e.target.value)}
              onBlur={saveNote}
              data-testid="mark-note"
            />
          </label>
        )}
      </div>
      <div className="sheet-actions">
        {!id ? (
          <ColorSwatches onPick={c => onPickPending?.(c)} />
        ) : (
          h &&
          !h.deleted && (
            <>
              <ColorSwatches value={h.color} onPick={c => void updateHighlight(h.id, { color: c })} />
              <button
                className="danger"
                onClick={() => {
                  setNote(null)
                  void deleteHighlight(h.id).then(onClose)
                }}
              >
                Löschen
              </button>
            </>
          )
        )}
        {onLookup && words > 0 && words <= MAX_LOOKUP_WORDS && (
          <button onClick={onLookup} title="Im Wörterbuch nachschlagen">
            Nachschlagen
          </button>
        )}
      </div>
    </aside>
  )
}
