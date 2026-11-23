import { useEffect, useRef, useState } from 'react'
import { getSettings } from '../settings/settings'
import { cachedTranslation, translateInContext, type TranslateError } from '../translate/deepl'
import { canSpeak, speak } from '../util/speech'

/** the limit of /api/translate (server/translate.ts, MAX_TEXT) */
const MAX_TEXT = 1500

type State =
  | { state: 'checking' }
  | { state: 'idle' }
  | { state: 'loading' }
  | { state: 'ok'; text: string; cached?: boolean }
  | { state: 'error'; message: string; login?: boolean }

/**
 * Translate mode, a selection too long to look up (a sentence or more): DeepL translates
 * it as a whole. Nothing goes into the vocabulary; "Markieren" keeps the translation as
 * the note of a mark.
 */
export function PassageSheet({
  text,
  context,
  onMark,
  onClose,
}: {
  text: string
  /** text around the passage, sent as DeepL context (not billed) */
  context: string
  onMark: (note?: string) => void
  onClose: () => void
}) {
  const [deepl, setDeepl] = useState<State>({ state: 'checking' })
  const [copied, setCopied] = useState(false)
  const generation = useRef(0)
  const tooLong = text.length > MAX_TEXT

  function request() {
    const gen = generation.current
    setDeepl({ state: 'loading' })
    translateInContext(text, context)
      .then(r => gen === generation.current && setDeepl({ state: 'ok', text: r.translation, cached: r.cached }))
      .catch((e: TranslateError) => gen === generation.current && setDeepl({ state: 'error', message: e.message, login: e.login }))
  }

  useEffect(() => {
    const gen = ++generation.current
    setDeepl({ state: 'checking' })
    setCopied(false)
    void (async () => {
      const [cached, { deeplMode }] = await Promise.all([cachedTranslation(text, context).catch(() => null), getSettings()])
      if (gen !== generation.current) return
      if (cached !== null) setDeepl({ state: 'ok', text: cached, cached: true })
      else if (deeplMode === 'always' && !tooLong) request()
      else setDeepl({ state: 'idle' })
    })()
    return () => {
      generation.current++
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, context])

  const translation = deepl.state === 'ok' ? deepl.text : ''

  return (
    <aside className="sheet passage-sheet" role="dialog" aria-label="Satz übersetzen" data-testid="passage-sheet">
      <div className="sheet-head">
        <span className="mark-quote">
          „{text.length > 160 ? `${text.slice(0, 160)} …` : text}“
          {canSpeak() && (
            <button className="icon" title="Vorlesen" onClick={() => speak(text)}>
              🔊
            </button>
          )}
        </span>
        <button className="icon" title="Schließen (Esc)" onClick={onClose}>
          ✕
        </button>
      </div>

      <div className="sheet-body">
        {tooLong && deepl.state !== 'ok' ? (
          <p className="warn">
            Auswahl zu lang für DeepL ({text.length} Zeichen, höchstens {MAX_TEXT}). Bitte weniger markieren.
          </p>
        ) : deepl.state === 'ok' ? (
          <>
            <span className="label">Übersetzung (DeepL{deepl.cached ? ', aus dem Cache' : ''})</span>
            <p className="passage-translation" data-testid="passage-translation">
              {deepl.text}
            </p>
          </>
        ) : deepl.state === 'loading' ? (
          <p className="muted">DeepL übersetzt …</p>
        ) : deepl.state === 'checking' ? null : (
          <>
            <button className="primary passage-deepl" onClick={request} data-testid="passage-deepl">
              {deepl.state === 'error' ? '↻ Nochmal mit DeepL übersetzen' : '+ Mit DeepL übersetzen'}
            </button>
            {deepl.state === 'error' ? (
              <p className="warn">
                {deepl.message}
                {deepl.login && (
                  <>
                    {' '}
                    · <a href="/login">Anmelden</a>
                  </>
                )}
              </p>
            ) : (
              <p className="muted">Der ganze Text wird an DeepL geschickt und zählt voll zum Kontingent.</p>
            )}
          </>
        )}
      </div>

      <div className="sheet-actions">
        <button onClick={() => onMark(translation || undefined)} data-testid="passage-mark">
          {translation ? 'Markieren mit Übersetzung als Notiz' : 'Markieren'}
        </button>
        {translation && navigator.clipboard && (
          <button
            onClick={() =>
              void navigator.clipboard
                .writeText(translation)
                .then(() => setCopied(true))
                .catch(() => setCopied(false))
            }
          >
            {copied ? '✓ Kopiert' : 'Kopieren'}
          </button>
        )}
      </div>
    </aside>
  )
}
