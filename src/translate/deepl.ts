import { db } from '../db/schema'
import { getSettings } from '../settings/settings'
import { hashString } from '../util/hash'

export interface DeeplResult {
  translation: string
  billedCharacters?: number
  cached?: boolean
}

export class TranslateError extends Error {
  constructor(
    message: string,
    /** the password gate rejected the request: the user has to log in again */
    readonly login = false,
  ) {
    super(message)
  }
}

const inFlight = new Map<string, Promise<DeeplResult>>()

/** Translates `text` (a word or phrase) with the sentence as DeepL `context`. */
export async function translateInContext(
  text: string,
  context: string,
  opts: { fetchImpl?: typeof fetch; useCache?: boolean } = {},
): Promise<DeeplResult> {
  const { fetchImpl = fetch, useCache = true } = opts
  const key = hashString(`${text}\u0000${context}`)
  if (useCache) {
    const hit = await db.translationCache.get(key)
    if (hit) return { translation: hit.translation, cached: true }
  }
  const pending = inFlight.get(key)
  if (pending) return pending
  const request = requestTranslation(key, text, context, fetchImpl).finally(() => inFlight.delete(key))
  inFlight.set(key, request)
  return request
}

async function requestTranslation(key: string, text: string, context: string, fetchImpl: typeof fetch): Promise<DeeplResult> {
  const { appToken } = await getSettings()
  let res: Response
  try {
    res = await fetchImpl('/api/translate', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(appToken ? { 'x-app-token': appToken } : {}) },
      body: JSON.stringify({ text, context, sourceLang: 'EN', targetLang: 'DE' }),
    })
  } catch {
    throw new TranslateError('Keine Verbindung zum Übersetzungsdienst (offline?)')
  }
  const data = (await res.json().catch(() => ({}))) as {
    translation?: string
    error?: string
    billedCharacters?: number
    login?: string
  }
  if (!res.ok || !data.translation)
    throw new TranslateError(data.error ?? `Übersetzung fehlgeschlagen (${res.status})`, res.status === 401 && !!data.login)
  await db.translationCache.put({ key, translation: data.translation, createdAt: Date.now() })
  return { translation: data.translation, billedCharacters: data.billedCharacters }
}
