import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useRef, useState } from 'react'
import { saveLookup, termKey } from '../db/repo'
import { db, STATUS_IGNORED } from '../db/schema'
import { normalizeWord } from '../nlp/sentence'
import { href } from '../router'
import { useSettings } from '../settings/settings'
import { translateInContext } from '../translate/deepl'
import { Highlighted } from '../util/Highlighted'
import { canSpeak, speak } from '../util/speech'
import { lookupDictionary, plainSense, type DictResult, type LookupTarget } from './lookupService'

type DeeplState =
  | { state: 'loading' }
  | { state: 'ok'; text: string; cached?: boolean }
  | { state: 'error'; message: string }

type SavedState = null | 'new' | 'context' | 'exists' | 'ignored'

const POS_DE: Record<string, string> = {
  verb: 'Verb',
  noun: 'Nomen',
  adj: 'Adjektiv',
  adv: 'Adverb',
  prep: 'Präposition',
  conj: 'Konjunktion',
  pron: 'Pronomen',
}

export function LookupSheet({
  target,
  book,
  onClose,
}: {
  target: LookupTarget
  book: { id: string; title: string }
  onClose: () => void
}) {
  const settings = useSettings()
  const [dict, setDict] = useState<DictResult | null>(null)
  const [deepl, setDeepl] = useState<DeeplState>({ state: 'loading' })
  const [translation, setTranslation] = useState('')
  const [edited, setEdited] = useState(false)
  const [saved, setSaved] = useState<SavedState>(null)
  const autoSaved = useRef(false)
  const termId = dict ? termKey(dict.lemma) : ''
  const existing = useLiveQuery(() => (termId ? db.terms.get(termId) : undefined), [termId])

  useEffect(() => {
    let cancelled = false
    setDict(null)
    setDeepl({ state: 'loading' })
    setSaved(null)
    setEdited(false)
    autoSaved.current = false
    lookupDictionary(target)
      .then(r => !cancelled && setDict(r))
      .catch(() => !cancelled && setDict({ lemma: normalizeWord(target.surface).toLowerCase(), senses: [] }))
    translateInContext(target.surface, target.sentence)
      .then(r => !cancelled && setDeepl({ state: 'ok', text: r.translation, cached: r.cached }))
      .catch((e: Error) => !cancelled && setDeepl({ state: 'error', message: e.message }))
    return () => {
      cancelled = true
    }
  }, [target.surface, target.sentence])

  useEffect(() => {
    if (edited) return
    if (deepl.state === 'ok') setTranslation(deepl.text)
    else if (dict?.senses[0]) setTranslation(plainSense(dict.senses[0].de))
    else setTranslation('')
  }, [deepl, dict, edited])

  const ready = dict !== null && deepl.state !== 'loading'

  async function save(status?: number) {
    if (!dict) return
    const res = await saveLookup({
      lemma: dict.lemma,
      surface: target.surface,
      sentence: target.sentence,
      translation: translation.trim() || undefined,
      dictSenses: dict.senses,
      pos: dict.pos,
      book,
      cfi: target.cfi,
      cardTypes: settings.cardTypes,
      status,
    })
    setSaved(status === STATUS_IGNORED ? 'ignored' : res.isNew ? 'new' : res.contextAdded ? 'context' : 'exists')
  }

  useEffect(() => {
    if (!settings.autoSave || !ready || autoSaved.current || !dict) return
    autoSaved.current = true
    void db.terms.get(termKey(dict.lemma)).then(t => {
      if (t?.status !== STATUS_IGNORED) void save()
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, settings.autoSave])

  const savedLabel: Record<Exclude<SavedState, null>, string> = {
    new: '✓ Neu in deinen Vokabeln',
    context: '✓ Neuer Kontext gespeichert',
    exists: '✓ Schon gespeichert',
    ignored: 'Wird künftig ignoriert',
  }

  return (
    <aside className="sheet" role="dialog" aria-label="Nachschlagen" data-testid="lookup-sheet">
      <div className="sheet-head">
        <div>
          <span className="sheet-word">{target.surface}</span>
          {canSpeak() && (
            <button className="icon" title="Vorlesen" onClick={() => speak(target.surface)}>
              🔊
            </button>
          )}
          {dict && dict.lemma !== target.surface.toLowerCase() && (
            <span className="muted"> · Grundform: {dict.lemma}</span>
          )}
          {dict?.pos && <span className="muted"> · {POS_DE[dict.pos] ?? dict.pos}</span>}
        </div>
        <button className="icon" title="Schließen (Esc)" onClick={onClose}>
          ✕
        </button>
      </div>

      <div className="sheet-body">
        <label className="translation">
          <span className="label">
            Übersetzung im Kontext
            {deepl.state === 'ok' && <span className="muted"> (DeepL{deepl.cached ? ', aus dem Cache' : ''})</span>}
          </span>
          {deepl.state === 'loading' && !edited && <span className="muted">DeepL übersetzt …</span>}
          <input
            value={translation}
            data-testid="translation-input"
            onChange={e => {
              setEdited(true)
              setTranslation(e.target.value)
            }}
            placeholder="Übersetzung"
          />
          {deepl.state === 'error' && <span className="warn">{deepl.message}</span>}
        </label>

        {existing && existing.translation && existing.translation !== translation && (
          <p className="muted">
            In deinen Vokabeln: <b>{existing.translation}</b>
          </p>
        )}

        {target.sentence && (
          <p className="context">
            <Highlighted text={target.sentence} word={target.surface} />
          </p>
        )}

        {dict === null && <p className="muted">Wörterbuch …</p>}
        {dict && dict.senses.length > 0 && (
          <div className="senses">
            <span className="label">Wörterbuch{dict.matchedKey ? ` („${dict.matchedKey}“)` : ''}</span>
            <ul>
              {dict.senses.slice(0, 8).map((s, i) => (
                <li key={i}>
                  <button
                    className="link"
                    title="Als Übersetzung übernehmen"
                    onClick={() => {
                      setEdited(true)
                      setTranslation(plainSense(s.de))
                    }}
                  >
                    {s.de}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {dict && dict.senses.length === 0 && <p className="muted">Kein Eintrag im Offline-Wörterbuch.</p>}
      </div>

      <div className="sheet-actions">
        {saved ? (
          <span className="ok">
            {savedLabel[saved]} · <a href={href({ name: 'vocab', termId })}>ansehen</a>
          </span>
        ) : (
          <>
            <button className="primary" disabled={!dict} onClick={() => void save()} data-testid="save-term">
              {existing && existing.status !== STATUS_IGNORED ? 'Kontext speichern' : 'Speichern'}
            </button>
            <button disabled={!dict} onClick={() => void save(STATUS_IGNORED)} title="z. B. Eigennamen">
              Ignorieren
            </button>
          </>
        )}
      </div>
    </aside>
  )
}
