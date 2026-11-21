// Offline EN→DE dictionary (Ding, GPL), built by scripts/build-dictionary.mjs into
// public/dict/en-de/<shard>.json. Shards are fetched on demand; the service worker
// caches them for offline use.
import type { DictSense } from '../db/schema'

type Shard = Record<string, [string, string?][]>

const shards = new Map<string, Promise<Shard | null>>()
const base = `${import.meta.env?.BASE_URL ?? '/'}dict/en-de/`

export function shardOf(key: string): string {
  const norm = (c: string | undefined) => (c && /[a-z0-9]/.test(c) ? c : '_')
  return norm(key[0]) + norm(key[1])
}

async function loadShard(name: string, fetchImpl: typeof fetch): Promise<Shard | null> {
  try {
    const res = await fetchImpl(`${base}${name}.json`)
    if (!res.ok) return null
    return (await res.json()) as Shard
  } catch {
    return null
  }
}

export async function lookupKey(key: string, fetchImpl: typeof fetch = fetch): Promise<DictSense[]> {
  const k = key.trim().toLowerCase()
  if (!k) return []
  const name = shardOf(k)
  let shard = shards.get(name)
  if (!shard) {
    shard = loadShard(name, fetchImpl)
    shards.set(name, shard)
  }
  const data = await shard
  if (!data) {
    shards.delete(name) // retry next time (e.g. was offline)
    return []
  }
  return (data[k] ?? []).map(([de, pos]) => (pos ? { de, pos } : { de }))
}

/** First candidate with dictionary entries wins. */
export async function lookupCandidates(
  candidates: string[],
  fetchImpl: typeof fetch = fetch,
): Promise<{ key: string; senses: DictSense[] } | null> {
  for (const key of candidates) {
    const senses = await lookupKey(key, fetchImpl)
    if (senses.length) return { key, senses }
  }
  return null
}

export async function dictionaryAvailable(fetchImpl: typeof fetch = fetch): Promise<boolean> {
  try {
    const res = await fetchImpl(`${base}index.json`)
    return res.ok
  } catch {
    return false
  }
}
