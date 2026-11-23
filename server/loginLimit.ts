// Limits failed logins per client: at most MAX_FAILS within WINDOW_SECONDS, counted from the
// first failure. A blocked client gets 429 without its password being checked; a successful
// login clears the counter. Counters live in a Workers KV namespace (binding LOGIN_ATTEMPTS)
// on Cloudflare and in memory in the Vite dev/preview server.
//
// Cloudflare's own rate limiting rules only exist for custom domains, not for *.pages.dev,
// hence this. KV is eventually consistent across locations, so an attacker spread over many
// places may get a few extra tries: the limiter only has to make guessing slow, a long
// password does the rest. Any KV error (e.g. the free tier's daily write limit) disables the
// limiter for that request instead of locking the owner out.

export const MAX_FAILS = 5
export const WINDOW_SECONDS = 60 * 60

/** The part of a Workers KV namespace used here, so the real binding fits without extra types. */
export interface AttemptStore {
  get(key: string): Promise<string | null>
  /** expiration: absolute, in seconds since the epoch (KV wants it at least 60 s ahead) */
  put(key: string, value: string, options: { expiration: number }): Promise<void>
  delete(key: string): Promise<void>
}

export interface LoginLimiter {
  /** seconds until this client may try again, 0 if it may try now */
  readonly blockedFor: number
  /** Counts a failed attempt. `left` is null when the count is unknown (no store, store error). */
  failed(): Promise<{ left: number | null; blockedFor: number }>
  succeeded(): Promise<void>
}

/** failures so far and the end of the window (seconds since the epoch) */
interface Attempts {
  n: number
  reset: number
}

let warnedMissing = false
const warn = (error: unknown) => console.warn('[login-limit] limiter skipped:', error)

/**
 * Counter key for a client address: IPv4 as is, IPv6 per /64 (a single connection usually gets
 * a whole /64, so counting single addresses would be easy to dodge).
 */
export function clientKey(ip: string | null | undefined): string {
  const addr = (ip ?? '').trim().replace(/^\[|\]$/g, '').split('%')[0]
  if (!addr) return 'unknown'
  const mapped = addr.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i)
  if (mapped) return mapped[1]
  if (!addr.includes(':')) return addr
  const parts = addr.toLowerCase().split('::')
  const left = parts[0] ? parts[0].split(':') : []
  const right = parts.length > 1 && parts[1] ? parts[1].split(':') : []
  const groups = parts.length > 1 ? [...left, ...Array<string>(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right] : left
  return `${groups.slice(0, 4).map(g => (parseInt(g, 16) || 0).toString(16)).join(':')}::/64`
}

const storeKey = (client: string) => `login:${client}`

function parse(raw: string | null, nowSec: number): Attempts | null {
  if (!raw) return null
  const a = JSON.parse(raw) as Partial<Attempts>
  return typeof a.n === 'number' && typeof a.reset === 'number' && a.reset > nowSec ? { n: a.n, reset: a.reset } : null
}

const noLimit: LoginLimiter = {
  blockedFor: 0,
  failed: async () => ({ left: null, blockedFor: 0 }),
  succeeded: async () => {},
}

/** Reads the client's counter once; `failed`/`succeeded` then update it. */
export async function loginLimiter(store: AttemptStore | undefined, ip: string | null | undefined, nowSec: number): Promise<LoginLimiter> {
  if (!store) {
    if (!warnedMissing) console.warn('[login-limit] no LOGIN_ATTEMPTS store bound: failed logins are not limited')
    warnedMissing = true
    return noLimit
  }
  const key = storeKey(clientKey(ip))
  let current: Attempts | null
  try {
    current = parse(await store.get(key), nowSec)
  } catch (error) {
    warn(error)
    return noLimit
  }
  return {
    blockedFor: current && current.n >= MAX_FAILS ? current.reset - nowSec : 0,
    async failed() {
      const next = current ? { n: current.n + 1, reset: current.reset } : { n: 1, reset: nowSec + WINDOW_SECONDS }
      try {
        await store.put(key, JSON.stringify(next), { expiration: Math.max(next.reset, nowSec + 60) })
      } catch (error) {
        warn(error)
        return { left: null, blockedFor: 0 }
      }
      const left = Math.max(0, MAX_FAILS - next.n)
      return { left, blockedFor: left ? 0 : next.reset - nowSec }
    },
    async succeeded() {
      if (!current) return
      try {
        await store.delete(key)
      } catch (error) {
        warn(error)
      }
    },
  }
}

/** In-memory store for the Vite dev/preview server and tests. */
export function memoryAttemptStore(clock: () => number = Date.now): AttemptStore {
  const entries = new Map<string, { value: string; expiration: number }>()
  return {
    async get(key) {
      const entry = entries.get(key)
      if (!entry) return null
      if (entry.expiration * 1000 > clock()) return entry.value
      entries.delete(key)
      return null
    },
    async put(key, value, { expiration }) {
      entries.set(key, { value, expiration })
    },
    async delete(key) {
      entries.delete(key)
    },
  }
}
