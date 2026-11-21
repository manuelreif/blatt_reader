import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo, useState } from 'react'
import { deleteTerm, setTermStatus, updateTerm } from '../db/repo'
import { db, STATUS_IGNORED, STATUS_KNOWN, type Term } from '../db/schema'
import { href, navigate } from '../router'
import { useSettings } from '../settings/settings'
import { Highlighted } from '../util/Highlighted'
import { canSpeak, speak } from '../util/speech'
import { STATUS_OPTIONS, statusLabel } from './status'

type Filter = 'all' | 'learning' | 'known' | 'ignored' | 'unenriched'

const FILTERS: { id: Filter; label: string; test: (t: Term) => boolean }[] = [
  { id: 'all', label: 'Alle', test: t => t.status !== STATUS_IGNORED },
  { id: 'learning', label: 'Lernend', test: t => t.status >= 1 && t.status < STATUS_KNOWN },
  { id: 'known', label: 'Bekannt', test: t => t.status === STATUS_KNOWN },
  { id: 'unenriched', label: 'Nicht angereichert', test: t => !t.enrichedAt && t.status !== STATUS_IGNORED },
  { id: 'ignored', label: 'Ignoriert', test: t => t.status === STATUS_IGNORED },
]

function EditableField({
  label,
  value,
  multiline,
  onSave,
}: {
  label: string
  value: string
  multiline?: boolean
  onSave: (v: string) => void
}) {
  const [draft, setDraft] = useState(value)
  const [prev, setPrev] = useState(value)
  if (value !== prev) {
    setPrev(value)
    setDraft(value)
  }
  const commit = () => draft !== value && onSave(draft.trim())
  return (
    <label className="field">
      <span className="label">{label}</span>
      {multiline ? (
        <textarea value={draft} rows={2} onChange={e => setDraft(e.target.value)} onBlur={commit} />
      ) : (
        <input value={draft} onChange={e => setDraft(e.target.value)} onBlur={commit} />
      )}
    </label>
  )
}

function TermDetail({ id }: { id: string }) {
  const term = useLiveQuery(() => db.terms.get(id), [id])
  const contexts = useLiveQuery(() => db.contexts.where('termId').equals(id).reverse().sortBy('createdAt'), [id])
  const cards = useLiveQuery(() => db.cards.where('termId').equals(id).toArray(), [id])
  const settings = useSettings()
  if (term === undefined) return <p className="muted">Lade …</p>
  if (term === null) return <p className="muted">Wort nicht gefunden.</p>
  const nextDue = cards?.filter(c => !c.suspended).sort((a, b) => a.due - b.due)[0]
  return (
    <article className="term-detail" data-testid="term-detail">
      <header>
        <h2>
          {term.lemma}
          {canSpeak() && (
            <button className="icon" onClick={() => speak(term.lemma)} title="Vorlesen">
              🔊
            </button>
          )}
        </h2>
        {term.ipa && <span className="muted">{term.ipa}</span>}
        <button className="icon" onClick={() => navigate({ name: 'vocab' })} title="Schließen">
          ✕
        </button>
      </header>
      <EditableField label="Übersetzung" value={term.translation} onSave={v => void updateTerm(id, { translation: v })} />
      <EditableField
        label="Erklärung"
        value={term.explanationDe ?? ''}
        multiline
        onSave={v => void updateTerm(id, { explanationDe: v || undefined })}
      />
      <EditableField
        label="Beispielsatz"
        value={term.exampleEn ?? ''}
        multiline
        onSave={v => void updateTerm(id, { exampleEn: v || undefined })}
      />
      <EditableField
        label="Eselsbrücke"
        value={term.mnemonic ?? ''}
        onSave={v => void updateTerm(id, { mnemonic: v || undefined })}
      />
      {term.confusables?.length ? <p className="muted">Verwechslungsgefahr: {term.confusables.join(', ')}</p> : null}
      <label className="field">
        <span className="label">Status</span>
        <select value={term.status} onChange={e => void setTermStatus(id, Number(e.target.value), settings.cardTypes)}>
          {STATUS_OPTIONS.map(s => (
            <option key={s} value={s}>
              {statusLabel(s)}
            </option>
          ))}
        </select>
      </label>
      {nextDue && (
        <p className="muted">
          Nächste Abfrage: {new Date(nextDue.due).toLocaleString('de-AT', { dateStyle: 'medium', timeStyle: 'short' })}
        </p>
      )}
      {term.dictSenses.length > 0 && (
        <details>
          <summary>Wörterbuch ({term.dictSenses.length})</summary>
          <ul>
            {term.dictSenses.map((s, i) => (
              <li key={i}>{s.de}</li>
            ))}
          </ul>
        </details>
      )}
      <h3>Gelesen in ({contexts?.length ?? 0})</h3>
      <ul className="contexts">
        {contexts?.map(c => (
          <li key={c.id}>
            <p>
              <Highlighted text={c.sentence} word={c.surface} />
            </p>
            <span className="muted">
              {c.bookTitle}
              {c.translation ? ` · DeepL: ${c.translation}` : ''} ·{' '}
              <a href={href({ name: 'read', bookId: c.bookId, cfi: c.cfi })}>im Buch zeigen</a> ·{' '}
              <button className="link danger" onClick={() => c.id !== undefined && void db.contexts.delete(c.id)}>
                entfernen
              </button>
            </span>
          </li>
        ))}
      </ul>
      <button
        className="danger"
        onClick={() => {
          if (confirm(`„${term.lemma}“ mit allen Kontexten und Lernständen löschen?`)) {
            void deleteTerm(id)
            navigate({ name: 'vocab' })
          }
        }}
      >
        Wort löschen
      </button>
    </article>
  )
}

export function VocabView({ termId }: { termId?: string }) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const terms = useLiveQuery(() => db.terms.orderBy('createdAt').reverse().toArray(), [])
  const contextCounts = useLiveQuery(async () => {
    const counts = new Map<string, number>()
    await db.contexts.each(c => counts.set(c.termId, (counts.get(c.termId) ?? 0) + 1))
    return counts
  }, [])
  const list = useMemo(() => {
    const f = FILTERS.find(x => x.id === filter)!
    const q = query.trim().toLowerCase()
    return (terms ?? []).filter(
      t => f.test(t) && (!q || t.id.includes(q) || t.translation.toLowerCase().includes(q) || t.forms.some(x => x.includes(q))),
    )
  }, [terms, filter, query])

  return (
    <section className={`vocab ${termId ? 'has-detail' : ''}`}>
      <div className="vocab-list">
        <header className="page-head">
          <h1>Vokabeln</h1>
          <span className="muted">{terms?.filter(t => t.status !== STATUS_IGNORED).length ?? 0} Wörter</span>
        </header>
        <div className="toolbar">
          <input type="search" placeholder="Suchen (EN oder DE) …" value={query} onChange={e => setQuery(e.target.value)} />
          <select value={filter} onChange={e => setFilter(e.target.value as Filter)} aria-label="Filter">
            {FILTERS.map(f => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </select>
        </div>
        {terms && terms.length === 0 && (
          <p className="empty">Noch keine Vokabeln. Öffne ein Buch und tippe ein Wort an.</p>
        )}
        <ul className="term-list" data-testid="term-list">
          {list.map(t => (
            <li key={t.id} className={t.id === termId ? 'selected' : ''}>
              <a href={href({ name: 'vocab', termId: t.id })}>
                <span className="term-lemma">{t.lemma}</span>
                <span className="term-translation">{t.translation}</span>
                <span className="term-meta">
                  <span className={`status s${t.status}`}>{statusLabel(t.status)}</span>
                  {t.enrichedAt ? <span title="Mit Claude angereichert">✨</span> : null}
                  <span className="muted">{contextCounts?.get(t.id) ?? 0}×</span>
                </span>
              </a>
            </li>
          ))}
        </ul>
      </div>
      {termId && (
        <div className="vocab-detail">
          <TermDetail id={termId} />
        </div>
      )}
    </section>
  )
}
