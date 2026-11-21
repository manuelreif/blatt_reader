import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DICT_CACHE, downloadDictionary, lookupCandidates, lookupKey, offlineStatus, resetDictionaryCache } from '../src/dict/dictionary'

const index = { source: 'Ding', license: 'GPL', entries: 3, bytes: 100, shards: ['ba', 'es'] }
const files: Record<string, unknown> = {
  '/dict/en-de/index.json': index,
  '/dict/en-de/ba.json': { bank: [['Ufer {n}', 'noun'], ['Bank {f}', 'noun']] },
  '/dict/en-de/es.json': { estimator: [['Schätzfunktion {f}', 'noun']] },
}

/** Serves `files`; paths in `fail` behave as if the device were offline. */
const server = (fail: (path: string) => boolean = () => false, status?: (path: string) => number | undefined) =>
  vi.fn(async (input: RequestInfo | URL) => {
    const path = String(input)
    if (fail(path)) throw new TypeError('Failed to fetch')
    const s = status?.(path)
    if (s) return Response.json({ error: 'x' }, { status: s })
    return path in files ? Response.json(files[path]) : new Response('not found', { status: 404 })
  })

/** Minimal in-memory Cache Storage with one cache. */
function fakeCaches() {
  const store = new Map<string, Response>()
  const abs = (u: RequestInfo | URL) => new URL(String(u instanceof Request ? u.url : u), 'https://app.example').href
  const cache = {
    keys: async () => [...store.keys()].map(u => new Request(u)),
    put: async (u: RequestInfo | URL, r: Response) => void store.set(abs(u), r),
    match: async (u: RequestInfo | URL) => store.get(abs(u))?.clone(),
  }
  return { store, cacheStorage: { open: vi.fn(async (_name: string) => cache as unknown as Cache) } }
}

beforeEach(() => resetDictionaryCache())

describe('dictionary lookup', () => {
  it('finds senses and tells "not in the dictionary" apart from "not loaded"', async () => {
    expect(await lookupKey('bank', server())).toEqual([{ de: 'Ufer {n}', pos: 'noun' }, { de: 'Bank {f}', pos: 'noun' }])
    expect(await lookupKey('banana', server())).toEqual([])
    // shard "qu" does not exist according to the index: nothing to load, simply no entry
    const f = server()
    expect(await lookupKey('quickly', f)).toEqual([])
    expect(f.mock.calls.map(c => String(c[0]))).not.toContain('/dict/en-de/qu.json')
  })

  it('reports an unavailable shard when offline', async () => {
    const offline = server(p => p.endsWith('/es.json'))
    expect(await lookupKey('estimator', offline)).toBeNull()
    expect(await lookupCandidates(['estimators', 'estimator'], offline)).toEqual({ hit: null, unavailable: true })
    // back online: the shard is fetched again instead of staying "missing"
    expect(await lookupCandidates(['estimator'], server())).toEqual({
      hit: { key: 'estimator', senses: [{ de: 'Schätzfunktion {f}', pos: 'noun' }] },
      unavailable: false,
    })
  })
})

describe('downloadDictionary', () => {
  it('stores index and all shards and reports progress', async () => {
    const { store, cacheStorage } = fakeCaches()
    const progress: number[] = []
    await downloadDictionary(done => progress.push(done), { fetchImpl: server(), cacheStorage })
    expect(cacheStorage.open).toHaveBeenCalledWith(DICT_CACHE)
    expect([...store.keys()].map(u => new URL(u).pathname).sort()).toEqual([
      '/dict/en-de/ba.json',
      '/dict/en-de/es.json',
      '/dict/en-de/index.json',
    ])
    expect(progress[0]).toBe(0)
    expect(progress.at(-1)).toBe(3)
    expect(await offlineStatus({ fetchImpl: server(), cacheStorage })).toEqual({ supported: true, total: 3, stored: 3, bytes: 100 })
  })

  it('continues an interrupted download and skips what is stored', async () => {
    const { cacheStorage } = fakeCaches()
    await expect(
      downloadDictionary(() => {}, { fetchImpl: server(p => p.endsWith('/es.json')), cacheStorage, concurrency: 1 }),
    ).rejects.toThrow(/offline/)
    expect((await offlineStatus({ fetchImpl: server(), cacheStorage })).stored).toBe(2)
    const f = server()
    await downloadDictionary(() => {}, { fetchImpl: f, cacheStorage })
    expect(f.mock.calls.map(c => String(c[0]))).toEqual(['/dict/en-de/es.json'])
  })

  it('asks to log in again when the password gate answers 401', async () => {
    const { cacheStorage } = fakeCaches()
    const f = server(undefined, p => (p.endsWith('/ba.json') ? 401 : undefined))
    await expect(downloadDictionary(() => {}, { fetchImpl: f, cacheStorage })).rejects.toMatchObject({ login: true })
  })

  it('needs the Cache API', async () => {
    expect(await offlineStatus({ fetchImpl: server() })).toMatchObject({ supported: false })
  })
})
