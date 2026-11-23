import { useLiveQuery } from 'dexie-react-hooks'
import { useRef, useState } from 'react'
import { db, STATUS_IGNORED, type Term } from '../db/schema'
import { setSetting, useSettings } from '../settings/settings'
import { applyEnrichment, translationFromDictionary } from './apply'
import { ParseError, parseEnrichResponse, type ImportResult } from './importResponse'
import { buildEnrichPrompt, buildFixPrompt, toEnrichInput } from './templates'

interface Batch {
  ids: string[]
  prompt: string
  createdAt: number
}

const BATCH_KEY = 'enrichBatch'

async function copyText(text: string, fallback?: HTMLTextAreaElement | null): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    if (!fallback) return false
    fallback.focus()
    fallback.select()
    return document.execCommand('copy')
  }
}

async function createBatch(size: number): Promise<Batch | null> {
  const terms = await db.terms
    .orderBy('createdAt')
    .filter(t => !t.enrichedAt && t.status !== STATUS_IGNORED)
    .limit(size)
    .toArray()
  if (!terms.length) return null
  const inputs = []
  for (const t of terms) {
    const contexts = await db.contexts.where('termId').equals(t.id).sortBy('createdAt')
    inputs.push(toEnrichInput(t, contexts[contexts.length - 1]))
  }
  const batch: Batch = { ids: terms.map(t => t.id), prompt: buildEnrichPrompt(inputs), createdAt: Date.now() }
  await db.settings.put({ key: BATCH_KEY, value: batch })
  return batch
}

export function EnrichView() {
  const settings = useSettings()
  const batch = useLiveQuery(async () => ((await db.settings.get(BATCH_KEY))?.value as Batch | undefined) ?? null, [])
  const pending = useLiveQuery(() => db.terms.filter(t => !t.enrichedAt && t.status !== STATUS_IGNORED).count(), [], 0)
  const [answer, setAnswer] = useState('')
  const [result, setResult] = useState<ImportResult | null>(null)
  const [parseError, setParseError] = useState('')
  const [overwrite, setOverwrite] = useState(false)
  const [message, setMessage] = useState('')
  const promptBox = useRef<HTMLTextAreaElement>(null)
  // current translations of the checked words, to show which ones Claude replaces
  const current = useLiveQuery(async () => {
    const terms = result ? await db.terms.bulkGet(result.valid.map(v => v.id)) : []
    return new Map(terms.filter((t): t is Term => !!t).map(t => [t.id, t]))
  }, [result])
  const fixBox = useRef<HTMLTextAreaElement>(null)

  async function start(openUrl?: string) {
    setMessage('')
    const b = await createBatch(settings.enrichBatchSize)
    if (!b) return setMessage('Alle Wörter sind schon angereichert.')
    const ok = await copyText(b.prompt, promptBox.current)
    setMessage(ok ? `Prompt mit ${b.ids.length} Wörtern kopiert.` : 'Kopieren hat nicht geklappt, bitte den Prompt unten markieren und kopieren.')
    if (openUrl) window.open(openUrl, '_blank', 'noopener')
  }

  function check() {
    if (!batch) return
    setParseError('')
    try {
      setResult(parseEnrichResponse(answer, batch.ids))
    } catch (e) {
      setResult(null)
      setParseError(e instanceof ParseError ? e.message : 'Antwort konnte nicht gelesen werden')
    }
  }

  async function apply() {
    if (!batch || !result) return
    await applyEnrichment(result.valid, { overwriteTranslation: overwrite })
    const done = new Set(result.valid.map(v => v.id))
    const rest = batch.ids.filter(id => !done.has(id))
    if (rest.length) await db.settings.put({ key: BATCH_KEY, value: { ...batch, ids: rest } })
    else await db.settings.delete(BATCH_KEY)
    setMessage(
      `${result.valid.length} Wörter angereichert.` +
        (rest.length ? ` ${rest.length} fehlen noch: Korrektur-Prompt kopieren und die Antwort erneut einfügen.` : ''),
    )
    setAnswer('')
    setResult(null)
  }

  async function discard() {
    await db.settings.delete(BATCH_KEY)
    setAnswer('')
    setResult(null)
    setMessage('')
  }

  const problems = result
    ? [...result.invalid, ...result.missingIds.map(id => ({ index: -1, id, error: 'fehlt in der Antwort' }))]
    : []

  return (
    <section className="enrich">
      <header className="page-head">
        <h1>Mit Claude anreichern</h1>
        <span className="muted">{pending} Wörter ohne Erklärung</span>
      </header>
      <p className="muted">
        Ohne API und ohne Zusatzkosten: Die App erstellt einen Prompt mit deinen neuen Wörtern samt Satz. Du fügst ihn in
        Claude (oder ChatGPT) ein und kopierst die JSON-Antwort hierher zurück. Claude ergänzt Erklärung, Beispielsatz,
        Aussprache, Eselsbrücke und falsche Antworten fürs Quiz.
      </p>
      {message && <p className="ok">{message}</p>}

      {!batch ? (
        <div className="enrich-start">
          <label className="field inline">
            <span className="label">Wörter pro Durchgang</span>
            <input
              type="number"
              min={5}
              max={80}
              value={settings.enrichBatchSize}
              onChange={e => void setSetting('enrichBatchSize', Math.max(5, Math.min(80, Number(e.target.value) || 30)))}
            />
          </label>
          <div className="row">
            <button className="primary" disabled={!pending} onClick={() => void start('https://claude.ai/new')}>
              Prompt kopieren & Claude öffnen
            </button>
            <button disabled={!pending} onClick={() => void start('https://chatgpt.com/')}>
              … & ChatGPT öffnen
            </button>
            <button disabled={!pending} onClick={() => void start()} data-testid="enrich-copy">
              Nur kopieren
            </button>
          </div>
        </div>
      ) : (
        <div className="enrich-batch">
          <h2>1. Prompt ({batch.ids.length} Wörter)</h2>
          <textarea ref={promptBox} readOnly value={batch.prompt} rows={6} className="mono" data-testid="enrich-prompt" />
          <div className="row">
            <button onClick={() => void copyText(batch.prompt, promptBox.current).then(ok => ok && setMessage('Prompt kopiert.'))}>
              Erneut kopieren
            </button>
            <a className="button" href="https://claude.ai/new" target="_blank" rel="noopener">
              claude.ai öffnen
            </a>
            <button className="danger" onClick={() => void discard()}>
              Durchgang verwerfen
            </button>
          </div>

          <h2>2. Antwort einfügen</h2>
          <textarea
            value={answer}
            onChange={e => {
              setAnswer(e.target.value)
              setResult(null)
            }}
            rows={8}
            className="mono"
            placeholder="Claudes Antwort (der ```json-Block) hier einfügen"
            data-testid="enrich-answer"
          />
          <div className="row">
            {'readText' in (navigator.clipboard ?? {}) && (
              <button
                onClick={() =>
                  void navigator.clipboard
                    .readText()
                    .then(t => {
                      setAnswer(t)
                      setResult(null)
                    })
                    .catch(() => setParseError('Zugriff auf die Zwischenablage nicht erlaubt, bitte manuell einfügen.'))
                }
              >
                Aus Zwischenablage einfügen
              </button>
            )}
            <button className="primary" disabled={!answer.trim()} onClick={check} data-testid="enrich-check">
              Prüfen
            </button>
          </div>
          {parseError && <p className="error">{parseError}</p>}

          {result && (
            <div className="enrich-result" data-testid="enrich-result">
              <p>
                <b>{result.valid.length}</b> gültig
                {problems.length > 0 && (
                  <>
                    , <b className="warn">{problems.length}</b> fehlerhaft oder fehlend
                  </>
                )}
                {result.unknownIds.length > 0 && `, ${result.unknownIds.length} unbekannte ids ignoriert`}
                {result.truncated && ' (Antwort war abgeschnitten, vollständige Einträge wurden übernommen)'}
              </p>
              <ul className="enrich-preview">
                {result.valid.map(v => {
                  const t = current?.get(v.id)
                  const old = t?.translation.trim() ?? ''
                  const differs = !!t && old !== v.translation_de.trim()
                  const replaces = differs && (overwrite || translationFromDictionary(t))
                  return (
                    <li key={v.id}>
                      <b>{v.id}</b> →{' '}
                      {differs && !replaces ? (
                        <>
                          {old} <span className="muted">(bleibt, Claude: {v.translation_de})</span>
                        </>
                      ) : (
                        <>
                          {v.translation_de}
                          {replaces && old && <span className="muted"> (statt „{old}“)</span>}
                        </>
                      )}
                      <span className="muted"> · {v.explanation_de}</span>
                    </li>
                  )
                })}
              </ul>
              {problems.length > 0 && (
                <>
                  <ul className="enrich-problems">
                    {problems.map((p, i) => (
                      <li key={i} className="warn">
                        {p.id ?? `Eintrag ${p.index + 1}`}: {p.error}
                      </li>
                    ))}
                  </ul>
                  <textarea ref={fixBox} readOnly hidden value={buildFixPrompt(problems)} />
                  <button
                    onClick={() =>
                      void copyText(buildFixPrompt(problems), fixBox.current).then(
                        ok => ok && setMessage('Korrektur-Prompt kopiert. Antwort danach hier einfügen.'),
                      )
                    }
                  >
                    Korrektur-Prompt kopieren
                  </button>
                </>
              )}
              <label className="check">
                <input type="checkbox" checked={overwrite} onChange={e => setOverwrite(e.target.checked)} />
                Claudes Übersetzung auch übernehmen, wo DeepL oder du übersetzt habt
              </label>
              <p className="muted">Übersetzungen, die nur aus dem Wörterbuch stammen, ersetzt Claude ohnehin.</p>
              <button className="primary" disabled={!result.valid.length} onClick={() => void apply()} data-testid="enrich-apply">
                {result.valid.length} übernehmen
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
