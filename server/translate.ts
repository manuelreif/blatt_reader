// DeepL-Vermittler. Läuft als Cloudflare Pages Function (functions/api/translate.ts)
// und im Vite-Dev-Server (vite.config.ts). DeepL blockiert Aufrufe direkt aus dem
// Browser (CORS), außerdem bleibt der API-Key so auf dem Server.

export interface TranslateEnv {
  DEEPL_API_KEY?: string
  APP_TOKEN?: string
  DEEPL_API_URL?: string
}

export interface TranslateRequestBody {
  text: string
  context?: string
  sourceLang?: string
  targetLang?: string
}

export interface TranslateResponseBody {
  translation: string
  detectedSourceLang?: string
  billedCharacters?: number
}

const MAX_TEXT = 1500
const MAX_CONTEXT = 4000
const LANG = /^[A-Z]{2}(-[A-Z]{2,4})?$/

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })

const deeplUrl = (env: TranslateEnv, key: string) =>
  env.DEEPL_API_URL ??
  (key.endsWith(':fx') ? 'https://api-free.deepl.com/v2/translate' : 'https://api.deepl.com/v2/translate')

export async function handleTranslate(
  request: Request,
  env: TranslateEnv,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  if (request.method !== 'POST') return json({ error: 'Nur POST erlaubt' }, 405)
  if (env.APP_TOKEN && request.headers.get('x-app-token') !== env.APP_TOKEN)
    return json({ error: 'App-Token fehlt oder ist falsch (Einstellungen prüfen)' }, 401)
  const key = env.DEEPL_API_KEY?.trim()
  if (!key) return json({ error: 'DEEPL_API_KEY ist auf dem Server nicht gesetzt' }, 503)

  let body: Partial<TranslateRequestBody>
  try {
    body = await request.json()
  } catch {
    return json({ error: 'Ungültiges JSON' }, 400)
  }
  const text = typeof body.text === 'string' ? body.text.trim() : ''
  if (!text) return json({ error: 'text fehlt' }, 400)
  if (text.length > MAX_TEXT) return json({ error: `text ist zu lang (max. ${MAX_TEXT} Zeichen)` }, 413)
  const context = typeof body.context === 'string' ? body.context.trim().slice(0, MAX_CONTEXT) : ''
  const sourceLang = typeof body.sourceLang === 'string' && LANG.test(body.sourceLang) ? body.sourceLang : 'EN'
  const targetLang = typeof body.targetLang === 'string' && LANG.test(body.targetLang) ? body.targetLang : 'DE'

  let upstream: Response
  try {
    upstream = await fetchImpl(deeplUrl(env, key), {
      method: 'POST',
      headers: { Authorization: `DeepL-Auth-Key ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: [text],
        source_lang: sourceLang,
        target_lang: targetLang,
        ...(context ? { context } : {}),
        show_billed_characters: true,
      }),
    })
  } catch {
    return json({ error: 'DeepL ist nicht erreichbar' }, 502)
  }
  if (!upstream.ok) {
    const error =
      upstream.status === 456
        ? 'DeepL-Kontingent für diesen Monat aufgebraucht'
        : upstream.status === 403
          ? 'DeepL-Key ungültig'
          : upstream.status === 429
            ? 'Zu viele Anfragen an DeepL, bitte kurz warten'
            : `DeepL-Fehler ${upstream.status}`
    return json({ error }, 502)
  }
  const data = (await upstream.json()) as {
    translations?: { text: string; detected_source_language?: string; billed_characters?: number }[]
  }
  const t = data.translations?.[0]
  if (!t) return json({ error: 'Leere Antwort von DeepL' }, 502)
  const result: TranslateResponseBody = {
    translation: t.text,
    detectedSourceLang: t.detected_source_language,
    billedCharacters: t.billed_characters,
  }
  return json(result)
}
