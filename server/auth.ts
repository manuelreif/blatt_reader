// Password gate in front of the whole app. Runs as Cloudflare Pages middleware
// (functions/_middleware.ts) and in the Vite dev/preview server (vite.config.ts).
// Without APP_PASSWORD the gate is off. The session cookie is signed with the
// password itself (HMAC-SHA256), so changing the password logs out every device.
// Failed logins are limited per client address (server/loginLimit.ts).

import { EMBLEM, LETTERING } from '../src/brand/logoPaths.ts'
import { loginLimiter, type AttemptStore } from './loginLimit.ts'

export interface AuthEnv {
  APP_PASSWORD?: string
  /** Workers KV namespace (Cloudflare) or memory store (Vite) counting failed logins */
  LOGIN_ATTEMPTS?: AttemptStore
}

export type AuthDecision =
  /** answer the request with this (login page, redirect, 401) */
  | { response: Response }
  /** let the request through; optionally renew the session cookie */
  | { pass: true; setCookie?: string }

export const SESSION_COOKIE = 'vr_session'
const DAY = 24 * 60 * 60 * 1000
/** Chrome caps cookie lifetimes at 400 days */
export const SESSION_DAYS = 400
/** renew the cookie on any request once less than this is left */
const RENEW_BELOW_DAYS = 200

/** Reachable without a session: needed to install the app (browsers fetch the manifest without cookies). */
const PUBLIC_PATHS = new Set([
  '/manifest.webmanifest',
  '/icon.svg',
  '/icon-192.png',
  '/icon-512.png',
  '/icon-maskable-512.png',
  '/apple-touch-icon.png',
  '/favicon.ico',
  // background pattern of the login page
  '/brand/pattern.svg',
])

const enc = new TextEncoder()

const b64url = (bytes: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')

async function hmac(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return b64url(await crypto.subtle.sign('HMAC', key, enc.encode(message)))
}

/** Compares via HMAC digests so the comparison time does not depend on the input. */
async function safeEqual(a: string, b: string): Promise<boolean> {
  const [x, y] = await Promise.all([hmac('compare', a), hmac('compare', b)])
  let diff = 0
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i)
  return diff === 0
}

export async function createSession(password: string, now = Date.now()): Promise<string> {
  const payload = `v1.${now + SESSION_DAYS * DAY}`
  return `${payload}.${await hmac(password, payload)}`
}

/** Returns the expiry time of a valid session, else null. */
export async function verifySession(password: string, value: string | undefined, now = Date.now()): Promise<number | null> {
  const m = value?.match(/^(v1\.(\d+))\.([\w-]+)$/)
  if (!m) return null
  const exp = Number(m[2])
  if (!(exp > now)) return null
  return (await safeEqual(m[3], await hmac(password, m[1]))) ? exp : null
}

function readCookie(request: Request, name: string): string | undefined {
  for (const part of (request.headers.get('cookie') ?? '').split(';')) {
    const i = part.indexOf('=')
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim()
  }
  return undefined
}

function cookieHeader(url: URL, value: string, maxAgeSeconds: number): string {
  // Secure only over https: plain http in the LAN would drop the cookie and loop on the login page
  const secure = url.protocol === 'https:' ? '; Secure' : ''
  return `${SESSION_COOKIE}=${value}; Path=/; Max-Age=${maxAgeSeconds}; HttpOnly; SameSite=Lax${secure}`
}

const escapeHtml = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

const LOGIN_LOGO = `<div class="logo" role="img" aria-label="Blatt-Reader">
  <svg class="emblem" viewBox="0 0 512 512" aria-hidden="true"><circle cx="256" cy="256" r="256" fill="#141f2d"/><circle cx="256" cy="256" r="${EMBLEM.ringR}" fill="none" stroke="#e6dfca" stroke-width="${EMBLEM.ringW}"/><path fill="#e6dfca" d="${EMBLEM.glyph}"/></svg>
  <svg class="lettering" viewBox="0 0 ${LETTERING.width} 100" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" d="${LETTERING.d}"/></svg>
</div>`

export function loginPage(error?: string): string {
  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<meta name="theme-color" content="#141f2d">
<link rel="icon" href="/icon.svg" type="image/svg+xml">
<title>Anmelden · Blatt-Reader</title>
<style>
  :root { --bg: #f4efe3; --surface: #fffcf5; --text: #18222f; --muted: #5d6877; --line: #e1d9c5; --accent: #1f3350; --accent-text: #f7f3e8; --danger: #a8322a; --watermark: rgb(20 31 45 / 0.04); color-scheme: light dark; }
  @media (prefers-color-scheme: dark) {
    :root { --bg: #0f1722; --surface: #172231; --text: #ebe5d3; --muted: #9ba6b3; --line: #273548; --accent: #e2d5ad; --accent-text: #141f2d; --danger: #f0958b; --watermark: rgb(230 223 202 / 0.035); }
  }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; min-height: 100dvh; display: grid; place-items: center; padding: 16px; background: var(--bg); color: var(--text);
    font: 16px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  body::before { content: ""; position: fixed; inset: 0; z-index: -1; background: var(--watermark);
    -webkit-mask: url("/brand/pattern.svg") 0 0 / 200px 200px repeat; mask: url("/brand/pattern.svg") 0 0 / 200px 200px repeat; }
  main { width: 100%; max-width: 360px; }
  .logo { display: flex; align-items: center; justify-content: center; gap: 14px; height: 60px; margin-bottom: 28px; }
  .logo .emblem { width: 60px; height: 60px; flex: none; }
  .logo .lettering { height: 25px; width: auto; }
  form { background: var(--surface); border: 1px solid var(--line); border-radius: 14px; padding: 24px;
    box-shadow: 0 1px 2px rgb(20 31 45 / 0.06), 0 10px 30px rgb(20 31 45 / 0.08); }
  h1 { font-size: 1.15rem; margin: 0 0 4px; }
  p { margin: 0 0 18px; color: var(--muted); }
  label { display: block; font-size: .875rem; color: var(--muted); margin-bottom: 4px; }
  input, button { width: 100%; font: inherit; padding: 10px 12px; border-radius: 10px; }
  input { border: 1px solid var(--line); background: var(--bg); color: var(--text); margin-bottom: 16px; }
  input:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 22%, transparent); }
  button { border: 1px solid var(--accent); background: var(--accent); color: var(--accent-text); font-weight: 600; cursor: pointer; }
  .error { color: var(--danger); }
</style>
</head>
<body>
<main>
${LOGIN_LOGO}
<form method="post" action="/login">
  <h1>Anmelden</h1>
  <p>Bitte einmal anmelden. Dieses Gerät bleibt danach angemeldet.</p>
  ${error ? `<p class="error" role="alert">${escapeHtml(error)}</p>` : ''}
  <input type="text" name="username" value="vokabel-reader" autocomplete="username" hidden>
  <label for="password">Passwort</label>
  <input id="password" type="password" name="password" autocomplete="current-password" required autofocus>
  <button type="submit">Anmelden</button>
</form>
</main>
</body>
</html>`
}

const LOGIN_HEADERS = {
  'content-type': 'text/html; charset=utf-8',
  'cache-control': 'no-store',
  'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
  'x-robots-tag': 'noindex',
}

const html = (body: string, status = 200, headers: Record<string, string> = {}) =>
  new Response(body, { status, headers: { ...LOGIN_HEADERS, ...headers } })

const tooManyAttempts = (seconds: number) => {
  const minutes = Math.max(1, Math.ceil(seconds / 60))
  const message = `Zu viele Fehlversuche. Bitte in ${minutes} ${minutes === 1 ? 'Minute' : 'Minuten'} noch einmal versuchen.`
  return html(loginPage(message), 429, { 'retry-after': String(Math.max(1, Math.ceil(seconds))) })
}

const redirect = (location: string, setCookie?: string) =>
  new Response(null, {
    status: 303,
    headers: { location, 'cache-control': 'no-store', ...(setCookie ? { 'set-cookie': setCookie } : {}) },
  })

const wantsHtml = (request: Request) =>
  request.method === 'GET' &&
  (request.headers.get('sec-fetch-mode') === 'navigate' || (request.headers.get('accept') ?? '').includes('text/html'))

/**
 * Decides what to do with a request. Reads the body only for POST /login, so other
 * requests can be passed on untouched.
 */
export async function authGate(
  request: Request,
  env: AuthEnv,
  /** ip: client address where no trusted cf-connecting-ip header exists (Vite server) */
  opts: { now?: number; failDelayMs?: number; ip?: string } = {},
): Promise<AuthDecision> {
  const password = env.APP_PASSWORD
  if (!password) return { pass: true }
  const now = opts.now ?? Date.now()
  const url = new URL(request.url)
  const path = url.pathname

  if (path === '/logout') return { response: redirect('/login', cookieHeader(url, '', 0)) }

  const exp = await verifySession(password, readCookie(request, SESSION_COOKIE), now)

  if (path === '/login') {
    if (request.method === 'POST') {
      // Cloudflare sets cf-connecting-ip itself, a client cannot fake it
      const ip = opts.ip ?? request.headers.get('cf-connecting-ip')
      const limiter = await loginLimiter(env.LOGIN_ATTEMPTS, ip, Math.floor(now / 1000))
      // blocked: do not even look at the password
      if (limiter.blockedFor) return { response: tooManyAttempts(limiter.blockedFor) }
      const form = await request.formData().catch(() => null)
      const given = form?.get('password')
      if (typeof given === 'string' && (await safeEqual(given, password))) {
        await limiter.succeeded()
        return { response: redirect('/', cookieHeader(url, await createSession(password, now), SESSION_DAYS * 24 * 60 * 60)) }
      }
      // slows down guessing a little more; a long password is the real protection
      await new Promise(r => setTimeout(r, opts.failDelayMs ?? 1000))
      const { left, blockedFor } = await limiter.failed()
      if (blockedFor) return { response: tooManyAttempts(blockedFor) }
      const hint = left === null ? '' : ` Noch ${left} ${left === 1 ? 'Versuch' : 'Versuche'}.`
      return { response: html(loginPage(`Falsches Passwort.${hint}`), 401) }
    }
    return { response: exp ? redirect('/') : html(loginPage()) }
  }

  if (PUBLIC_PATHS.has(path)) return { pass: true }

  if (exp) {
    const renew = exp - now < RENEW_BELOW_DAYS * DAY
    return renew
      ? { pass: true, setCookie: cookieHeader(url, await createSession(password, now), SESSION_DAYS * 24 * 60 * 60) }
      : { pass: true }
  }

  if (wantsHtml(request)) return { response: redirect('/login') }
  return {
    response: new Response(JSON.stringify({ error: 'Nicht angemeldet – bitte neu anmelden', login: '/login' }), {
      status: 401,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    }),
  }
}
