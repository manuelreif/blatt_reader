import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useRef, useState } from 'react'
import { applyContextTranslation, saveLookup, termKey } from '../db/repo'
import { db, STATUS_IGNORED } from '../db/schema'
import { normalizeWord } from '../nlp/sentence'
import { href } from '../router'
import { getSettings, useSettings } from '../settings/settings'
import { cachedTranslation, translateInContext, type TranslateError } from '../translate/deepl'
import { retryPendingTranslations } from '../translate/pending'
import { Highlighted } from '../util/Highlighted'
import { canSpeak, speak } from '../util/speech'
import { lookupDictionary, plainSense, type DictResult, type LookupTarget } from './lookupService'

type DeeplState =
  /** looking into the translation cache and the setting */
  | { state: 'checking' }
  | { state: 'idle' }
  | { state: 'loading' }
  | { state: 'ok'; text: string; cached?: boolean }
  | { state: 'error'; message: string; login?: boolean }

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
  const [deepl, setDeepl] = useState<DeeplState>({ state: 'checking' })
  const [translation, setTranslation] = useState('')
  const [edited, setEdited] = useState(false)
  const [saved, setSaved] = useState<SavedState>(null)
  const autoSaved = useRef(false)
  /** what was saved for this lookup, so a DeepL answer arriving later can follow */
  const savedWith = useRef<{ termId: string; sentence: string; translation: string } | null>(null)
  /** the current lookup; answers for an earlier one are dropped */
  const generation = useRef(0)
  const termId = dict ? termKey(dict.lemma) : ''
  const existing = useLiveQuery(() => (termId ? db.terms.get(termId) : undefined), [termId])

  function requestDeepl() {
    const gen = generation.current
    setDeepl({ state: 'loading' })
    translateInContext(target.surface, target.sentence)
      .then(r => {
        if (gen === generation.current) setDeepl({ state: 'ok', text: r.translation, cached: r.cached })
        // DeepL is reachable again: catch up on words saved while it was not
        if (!r.cached) void retryPendingTranslations()
      })
      .catch((e: TranslateError) => {
        if (gen === generation.current) setDeepl({ state: 'error', message: e.message, login: e.login })
      })
  }

  useEffect(() => {
    const gen = ++generation.current
    const current = () => gen === generation.current
    setDict(null)
    setDeepl({ state: 'checking' })
    setSaved(null)
    setEdited(false)
    autoSaved.current = false
    savedWith.current = null
    const dictDone = lookupDictionary(target)
      .catch((): DictResult => ({ lemma: normalizeWord(target.surface).toLowerCase(), senses: [] }))
      .then(r => {
        if (current()) setDict(r)
        return r
      })
    // a translation paid for before shows at once; otherwise DeepL only as the setting says
    // (read here, useSettings() may still hold the defaults right after mounting)
    void (async () => {
      const [cached, { deeplMode }] = await Promise.all([
        cachedTranslation(target.surface, target.sentence).catch(() => null),
        getSettings(),
      ])
      if (!current()) return
      if (cached !== null) return setDeepl({ state: 'ok', text: cached, cached: true })
      const ask = deeplMode === 'always' || (deeplMode === 'fallback' && (await dictDone).senses.length === 0)
      if (!current()) return
      if (ask) requestDeepl()
      else setDeepl({ state: 'idle' })
    })()
    return () => {
      generation.current++
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target.surface, target.sentence])

  useEffect(() => {
    if (edited) return
    if (deepl.state === 'ok') setTranslation(deepl.text)
    else if (dict?.senses[0]) setTranslation(plainSense(dict.senses[0].de))
    else setTranslation('')
  }, [deepl, dict, edited])

  const ready = dict !== null && deepl.state !== 'checking' && deepl.state !== 'loading'

  // DeepL was asked, failed, and the user kept the dictionary fallback: fetch DeepL later
  const deeplPending = deepl.state === 'error' && !edited

  // a DeepL answer after saving (auto-save, then "+ DeepL"): the saved word follows
  useEffect(() => {
    const where = savedWith.current
    if (deepl.state !== 'ok' || edited || !where || !where.sentence || where.translation === deepl.text) return
    where.translation = deepl.text
    void applyContextTranslation(where, deepl.text)
  }, [deepl, edited, saved])

  async function save(status?: number) {
    if (!dict) return
    const res = await saveLookup({
      lemma: dict.lemma,
      surface: target.surface,
      sentence: target.sentence,
      translation: translation.trim() || undefined,
      deeplPending: deeplPending && status !== STATUS_IGNORED,
      dictSenses: dict.senses,
      pos: dict.pos,
      book,
      cfi: target.cfi,
      cardTypes: settings.cardTypes,
      status,
    })
    if (status !== STATUS_IGNORED && (res.isNew || res.contextAdded))
      savedWith.current = { termId: res.term.id, sentence: target.sentence, translation: translation.trim() }
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
        <div className="translation">
          <div className="translation-head">
            <label className="label" htmlFor="lookup-translation">
              Übersetzung
              {deepl.state === 'ok' ? (
                <span className="muted"> (DeepL{deepl.cached ? ', aus dem Cache' : ''})</span>
              ) : (
                !edited && translation && <span className="muted"> (Wörterbuch)</span>
              )}
            </label>
            {(deepl.state === 'idle' || deepl.state === 'error') && (
              <button
                className="deepl-button"
                onClick={requestDeepl}
                title="Im Satzkontext mit DeepL übersetzen"
                data-testid="deepl-request"
              >
                {deepl.state === 'error' ? '↻ DeepL' : '+ DeepL'}
              </button>
            )}
            {deepl.state === 'loading' && <span className="muted">DeepL übersetzt …</span>}
          </div>
          <input
            id="lookup-translation"
            value={translation}
            data-testid="translation-input"
            onChange={e => {
              setEdited(true)
              setTranslation(e.target.value)
            }}
            placeholder="Übersetzung"
          />
          {deepl.state === 'error' && (
            <span className="warn">
              {deepl.message}
              {deepl.login && (
                <>
                  {' '}
                  · <a href="/login">Anmelden</a>
                </>
              )}
            </span>
          )}
        </div>

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
        {dict && dict.senses.length === 0 &&
          (dict.unavailable ? (
            <p className="warn" data-testid="dict-unavailable">
              Dieser Teil des Wörterbuchs ist noch nicht offline gespeichert.{' '}
              <a href={href({ name: 'settings' })}>Ganzes Wörterbuch speichern</a>
            </p>
          ) : (
            <p className="muted">Kein Eintrag im Offline-Wörterbuch.</p>
          ))}
      </div>

      <div className="sheet-actions">
        {saved ? (
          <span className="ok">
            {savedLabel[saved]} · <a href={href({ name: 'vocab', termId })}>ansehen</a>
            {deeplPending && saved !== 'ignored' && saved !== 'exists' && (
              <span className="muted" data-testid="deepl-pending">
                {' '}
                · DeepL wird nachgeholt, sobald es wieder erreichbar ist
              </span>
            )}
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
