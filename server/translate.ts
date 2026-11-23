// DeepL proxy. Runs as a Cloudflare Pages Function (functions/api/translate.ts)
// and in the Vite dev server (vite.config.ts). DeepL blocks calls straight from the
// browser (CORS), and the server key stays on the server this way.
//
// A device may bring its own DeepL key (header x-deepl-key, set under Einstellungen):
// then that key is used and billed instead of DEEPL_API_KEY. The key is only passed
// through to DeepL, never stored or logged.

export interface TranslateEnv {
  DEEPL_API_KEY?: string
  APP_TOKEN?: string
  DEEPL_API_URL?: string
  /** "1"/"true": never use DEEPL_API_KEY, every device needs its own key */
  DEEPL_REQUIRE_OWN_KEY?: string
}

export const OWN_KEY_HEADER = 'x-deepl-key'

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
  /** which key DeepL billed */
  keySource?: 'own' | 'server'
}

const MAX_TEXT = 1500
const MAX_CONTEXT = 4000
const LANG = /^[A-Z]{2}(-[A-Z]{2,4})?$/
// DeepL keys are UUIDs, Free keys end in ":fx"; anything else is a typo (or not a key)
const KEY_FORMAT = /^[A-Za-z0-9-]{8,100}(:fx)?$/

const isOn = (v: string | undefined) => !!v && /^(1|true|yes|on)$/i.test(v.trim())

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
  const ownKey = request.headers.get(OWN_KEY_HEADER)?.trim() ?? ''
  if (ownKey && !KEY_FORMAT.test(ownKey))
    return json({ error: 'Eigener DeepL-Key hat ein ungültiges Format (Einstellungen prüfen)' }, 400)
  const keySource = ownKey ? 'own' : 'server'
  if (!ownKey && isOn(env.DEEPL_REQUIRE_OWN_KEY))
    return json({ error: 'Bitte unter Einstellungen → Übersetzung einen eigenen DeepL-Key eintragen' }, 403)
  const key = ownKey || env.DEEPL_API_KEY?.trim()
  if (!key)
    return json({ error: 'Kein DeepL-Key: unter Einstellungen einen eigenen eintragen (oder DEEPL_API_KEY auf dem Server setzen)' }, 503)

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
    const whose = keySource === 'own' ? 'Eigener DeepL-Key' : 'DeepL-Key des Servers'
    const error =
      upstream.status === 456
        ? `${whose}: Kontingent für diesen Monat aufgebraucht`
        : upstream.status === 403
          ? `${whose} ungültig`
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
    keySource,
  }
  return json(result)
}
