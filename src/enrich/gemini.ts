// Optional live AI: Google's Gemini API on the free tier, called straight from the browser
// with this device's own key (settings `geminiKey`, never in a backup or on the server).
// The Gemini API allows CORS, so unlike DeepL no proxy is needed. Without a billing account
// on the key's Google Cloud project nothing can cost money: an exhausted quota returns 429.

export const GEMINI_ORIGIN = 'https://generativelanguage.googleapis.com'
export const DEFAULT_GEMINI_MODEL = 'gemini-flash-lite-latest'

export class GeminiError extends Error {}

interface GeminiResponse {
  candidates?: {
    content?: { parts?: { text?: string; thought?: boolean }[] }
    finishReason?: string
  }[]
  promptFeedback?: { blockReason?: string }
  error?: { message?: string; status?: string }
}

/** "models/gemini-x" and "gemini-x" both work; anything odd falls back to the default. */
export function normalizeModel(model: string): string {
  const m = model.trim().replace(/^models\//, '')
  return /^[A-Za-z0-9._-]+$/.test(m) ? m : DEFAULT_GEMINI_MODEL
}

export interface AskGeminiOptions {
  key: string
  model?: string
  /** ask for a bare JSON answer (no code fence, no remarks) */
  json?: boolean
  signal?: AbortSignal
  fetchImpl?: typeof fetch
}

/** Sends one prompt, returns the answer text. Errors come as GeminiError with a German message. */
export async function askGemini(prompt: string, opts: AskGeminiOptions): Promise<string> {
  const { key, model = DEFAULT_GEMINI_MODEL, json = false, signal, fetchImpl = fetch } = opts
  const apiKey = key.trim()
  if (!apiKey) throw new GeminiError('Kein Gemini-Key eingetragen (Einstellungen → Live-KI)')
  const url = `${GEMINI_ORIGIN}/v1beta/models/${encodeURIComponent(normalizeModel(model))}:generateContent`
  let res: Response
  try {
    res = await fetchImpl(url, {
      method: 'POST',
      // key as header, not as ?key=, so it does not end up in URLs and logs
      headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.3, ...(json ? { responseMimeType: 'application/json' } : {}) },
      }),
      signal,
    })
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw new GeminiError('Abgebrochen')
    throw new GeminiError('Gemini ist nicht erreichbar (offline?)')
  }
  const data = (await res.json().catch(() => ({}))) as GeminiResponse
  if (!res.ok) throw new GeminiError(errorMessage(res.status, data))
  if (data.promptFeedback?.blockReason)
    throw new GeminiError(`Gemini hat die Anfrage abgelehnt (${data.promptFeedback.blockReason})`)
  const candidate = data.candidates?.[0]
  const text = (candidate?.content?.parts ?? [])
    .filter(p => !p.thought && typeof p.text === 'string')
    .map(p => p.text)
    .join('')
    .trim()
  if (!text) {
    const reason = candidate?.finishReason
    throw new GeminiError(
      reason === 'SAFETY' || reason === 'RECITATION' || reason === 'PROHIBITED_CONTENT'
        ? `Gemini hat die Antwort zurückgehalten (${reason}), bitte per Copy-Paste anreichern`
        : 'Leere Antwort von Gemini',
    )
  }
  return text
}

function errorMessage(status: number, data: GeminiResponse): string {
  const detail = data.error?.message ?? ''
  if (status === 429)
    return 'Kontingent von Gemini erreicht (pro Minute oder pro Tag). Später erneut versuchen oder per Copy-Paste anreichern.'
  if (status === 400 && /api key/i.test(detail)) return 'Gemini-Key ungültig (Einstellungen prüfen)'
  if (status === 401 || status === 403) return 'Gemini-Key ungültig oder ohne Zugriff auf dieses Modell'
  if (status === 404) return 'Gemini-Modell nicht gefunden (Einstellungen → Live-KI → Modell prüfen)'
  if (status === 400 && /location|region|country/i.test(detail)) return 'Gemini ist in dieser Region nicht verfügbar'
  if (status >= 500) return `Gemini ist gerade gestört (${status}), später erneut versuchen`
  return `Gemini-Fehler ${status}${detail ? `: ${detail}` : ''}`
}
