// Offline EN→DE dictionary (Ding, GPL), built by scripts/build-dictionary.mjs into
// public/dict/en-de/<shard>.json plus index.json. Shards are fetched on demand; the
// service worker caches them for offline use. downloadDictionary() stores all shards
// at once in the same cache.
import type { DictSense } from '../db/schema'

type Shard = Record<string, [string, string?][]>

export interface DictIndex {
  source: string
  license: string
  entries: number
  /** total shard size in bytes (missing in older builds) */
  bytes?: number
  shards: string[]
}

/** Same cache name as the service worker's runtime cache for /dict/ (vite.config.ts). */
export const DICT_CACHE = 'dict'

const base = `${import.meta.env?.BASE_URL ?? '/'}dict/en-de/`
const indexUrl = `${base}index.json`
const shardUrl = (name: string) => `${base}${name}.json`

const shards = new Map<string, Promise<Shard | null>>()
let indexPromise: Promise<DictIndex | null> | null = null

/** Forgets loaded shards and the index (tests, or after the offline copy changed). */
export function resetDictionaryCache() {
  shards.clear()
  indexPromise = null
}

export function shardOf(key: string): string {
  const norm = (c: string | undefined) => (c && /[a-z0-9]/.test(c) ? c : '_')
  return norm(key[0]) + norm(key[1])
}

async function fetchJson<T>(url: string, fetchImpl: typeof fetch): Promise<T | null> {
  try {
    const res = await fetchImpl(url)
    if (res.ok) return (await res.json()) as T
  } catch {
    // offline, or not JSON (e.g. an HTML fallback page)
  }
  // Without an active service worker (first visit, dev server) the offline copy is
  // only reachable through the Cache API directly.
  try {
    const hit = await globalThis.caches?.match(url)
    if (hit) return (await hit.json()) as T
  } catch {
    // no Cache API (plain http) or a broken entry
  }
  return null
}

export function loadIndex(fetchImpl: typeof fetch = fetch): Promise<DictIndex | null> {
  if (!indexPromise) {
    indexPromise = fetchJson<DictIndex>(indexUrl, fetchImpl).then(ix => {
      if (!ix || !Array.isArray(ix.shards)) {
        indexPromise = null // retry next time
        return null
      }
      return ix
    })
  }
  return indexPromise
}

/**
 * Dictionary senses for `key`. `null` means the part of the dictionary that would
 * contain the word could not be loaded (offline and not stored yet); `[]` means the
 * word is not in the dictionary.
 */
export async function lookupKey(key: string, fetchImpl: typeof fetch = fetch): Promise<DictSense[] | null> {
  const k = key.trim().toLowerCase()
  if (!k) return []
  const name = shardOf(k)
  const index = await loadIndex(fetchImpl)
  if (index && !index.shards.includes(name)) return []
  let shard = shards.get(name)
  if (!shard) {
    shard = fetchJson<Shard>(shardUrl(name), fetchImpl)
    shards.set(name, shard)
  }
  const data = await shard
  if (!data) {
    shards.delete(name) // retry next time (e.g. was offline)
    return null
  }
  return (data[k] ?? []).map(([de, pos]) => (pos ? { de, pos } : { de }))
}

export interface CandidatesResult {
  /** first candidate with dictionary entries */
  hit: { key: string; senses: DictSense[] } | null
  /** some candidate could not be checked because its part of the dictionary is missing */
  unavailable: boolean
}

export async function lookupCandidates(candidates: string[], fetchImpl: typeof fetch = fetch): Promise<CandidatesResult> {
  let unavailable = false
  for (const key of candidates) {
    const senses = await lookupKey(key, fetchImpl)
    if (senses === null) unavailable = true
    else if (senses.length) return { hit: { key, senses }, unavailable }
  }
  return { hit: null, unavailable }
}

export async function dictionaryAvailable(fetchImpl: typeof fetch = fetch): Promise<boolean> {
  return (await loadIndex(fetchImpl)) !== null
}

export interface OfflineStatus {
  /** Cache API present (needs https or localhost) */
  supported: boolean
  /** number of files that make up the offline copy (index + shards); 0 if unknown */
  total: number
  stored: number
  bytes?: number
}

type CacheStorageLike = Pick<CacheStorage, 'open'>

const storedPaths = async (cache: Cache) => new Set((await cache.keys()).map(r => new URL(r.url).pathname))

const offlineFiles = (index: DictIndex) => [indexUrl, ...index.shards.map(shardUrl)]

export async function offlineStatus(
  opts: { fetchImpl?: typeof fetch; cacheStorage?: CacheStorageLike } = {},
): Promise<OfflineStatus> {
  const cacheStorage = opts.cacheStorage ?? globalThis.caches
  if (!cacheStorage) return { supported: false, total: 0, stored: 0 }
  const index = await loadIndex(opts.fetchImpl)
  if (!index) return { supported: true, total: 0, stored: 0 }
  const have = await storedPaths(await cacheStorage.open(DICT_CACHE))
  const files = offlineFiles(index)
  return { supported: true, total: files.length, stored: files.filter(f => have.has(f)).length, bytes: index.bytes }
}

export class DictDownloadError extends Error {
  constructor(
    message: string,
    readonly login = false,
  ) {
    super(message)
  }
}

/**
 * Stores the whole dictionary for offline use. Files already stored are skipped,
 * so an interrupted download continues where it stopped.
 */
export async function downloadDictionary(
  onProgress: (done: number, total: number) => void,
  opts: { fetchImpl?: typeof fetch; cacheStorage?: CacheStorageLike; concurrency?: number } = {},
): Promise<void> {
  const { fetchImpl = fetch, concurrency = 6 } = opts
  const cacheStorage = opts.cacheStorage ?? globalThis.caches
  if (!cacheStorage) throw new DictDownloadError('Offline-Speicher geht nur über https (oder localhost)')
  const index = await loadIndex(fetchImpl)
  if (!index) throw new DictDownloadError('Wörterbuch nicht erreichbar (offline?)')
  const cache = await cacheStorage.open(DICT_CACHE)
  const files = offlineFiles(index)
  const have = await storedPaths(cache)
  const todo = files.filter(f => !have.has(f))
  let done = files.length - todo.length
  onProgress(done, files.length)

  let failure: DictDownloadError | null = null
  const worker = async () => {
    while (todo.length && !failure) {
      const url = todo.shift()!
      try {
        const res = await fetchImpl(url).catch(() => {
          throw new DictDownloadError('Keine Verbindung (offline?)')
        })
        if (res.status === 401) throw new DictDownloadError('Nicht angemeldet – bitte neu anmelden', true)
        if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json'))
          throw new DictDownloadError(`Download fehlgeschlagen (${res.status})`)
        await cache.put(url, res)
        onProgress(++done, files.length)
      } catch (e) {
        failure =
          e instanceof DictDownloadError
            ? e
            : (e as Error).name === 'QuotaExceededError'
              ? new DictDownloadError('Nicht genug Speicherplatz auf dem Gerät')
              : new DictDownloadError(`Download fehlgeschlagen: ${(e as Error).message}`)
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(1, todo.length)) }, worker))
  if (failure) throw failure
}
