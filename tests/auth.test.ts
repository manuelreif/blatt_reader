import { describe, expect, it } from 'vitest'
import { authGate, createSession, SESSION_COOKIE, SESSION_DAYS, verifySession, type AuthDecision } from '../server/auth'

const env = { APP_PASSWORD: 'correct horse battery staple' }
const DAY = 24 * 60 * 60 * 1000
const now = Date.UTC(2026, 10, 21)

const get = (path: string, headers: Record<string, string> = {}) => new Request(`https://vokabeln.example${path}`, { headers })
const nav = (path: string, cookie?: string) =>
  get(path, { 'sec-fetch-mode': 'navigate', accept: 'text/html', ...(cookie ? { cookie: `${SESSION_COOKIE}=${cookie}` } : {}) })
const login = (password: string) =>
  new Request('https://vokabeln.example/login', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ username: 'vokabel-reader', password }),
  })

const response = (d: AuthDecision) => {
  if (!('response' in d)) throw new Error('expected a response')
  return d.response
}

describe('authGate', () => {
  it('lets everything through without APP_PASSWORD', async () => {
    expect(await authGate(nav('/'), {})).toEqual({ pass: true })
  })

  it('sends page loads without a session to the login page', async () => {
    const res = response(await authGate(nav('/'), env, { now }))
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe('/login')
    const page = response(await authGate(nav('/login'), env, { now }))
    expect(page.status).toBe(200)
    expect(await page.text()).toContain('type="password"')
  })

  it('answers other requests without a session with 401 JSON', async () => {
    for (const path of ['/api/translate', '/dict/en-de/ba.json', '/assets/index.js']) {
      const res = response(await authGate(get(path), env, { now }))
      expect(res.status).toBe(401)
      expect(await res.json()).toMatchObject({ login: '/login' })
    }
  })

  it('keeps manifest and icons public so the app can be installed', async () => {
    for (const path of ['/manifest.webmanifest', '/icon-192.png', '/icon-maskable-512.png'])
      expect(await authGate(get(path), env, { now })).toEqual({ pass: true })
  })

  it('rejects a wrong password', async () => {
    const res = response(await authGate(login('wrong'), env, { now, failDelayMs: 0 }))
    expect(res.status).toBe(401)
    expect(res.headers.get('set-cookie')).toBeNull()
    expect(await res.text()).toContain('Falsches Passwort')
  })

  it('sets a long-lived HttpOnly cookie for the right password', async () => {
    const res = response(await authGate(login(env.APP_PASSWORD), env, { now }))
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe('/')
    const cookie = res.headers.get('set-cookie')!
    expect(cookie).toMatch(new RegExp(`^${SESSION_COOKIE}=v1\\.`))
    expect(cookie).toContain(`Max-Age=${SESSION_DAYS * 24 * 60 * 60}`)
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('Secure')
    const value = cookie.split(';')[0].split('=')[1]
    expect(await authGate(nav('/', value), env, { now })).toEqual({ pass: true })
    expect(await authGate(get('/api/translate', { cookie: `other=1; ${SESSION_COOKIE}=${value}` }), env, { now })).toEqual({ pass: true })
  })

  it('omits Secure over plain http (LAN), where the browser would drop the cookie', async () => {
    const req = new Request('http://192.168.1.5:5173/login', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ password: env.APP_PASSWORD }),
    })
    expect(response(await authGate(req, env, { now })).headers.get('set-cookie')).not.toContain('Secure')
  })

  it('rejects tampered, foreign and expired sessions', async () => {
    const valid = await createSession(env.APP_PASSWORD, now)
    const [v, exp, sig] = valid.split('.')
    const tampered = `${v}.${Number(exp) + DAY}.${sig}`
    const foreign = await createSession('another password', now)
    for (const cookie of [tampered, foreign, 'garbage'])
      expect(response(await authGate(nav('/', cookie), env, { now })).status).toBe(303)
    expect(await verifySession(env.APP_PASSWORD, valid, now + (SESSION_DAYS + 1) * DAY)).toBeNull()
  })

  it('renews the cookie once less than half of its lifetime is left', async () => {
    const value = await createSession(env.APP_PASSWORD, now)
    expect(await authGate(nav('/', value), env, { now: now + 10 * DAY })).toEqual({ pass: true })
    const later = await authGate(nav('/', value), env, { now: now + 300 * DAY })
    expect(later).toMatchObject({ pass: true, setCookie: expect.stringContaining(`${SESSION_COOKIE}=v1.`) })
  })

  it('logs out by clearing the cookie', async () => {
    const res = response(await authGate(get('/logout'), env, { now }))
    expect(res.headers.get('location')).toBe('/login')
    expect(res.headers.get('set-cookie')).toContain('Max-Age=0')
  })

  it('skips the login form when already logged in', async () => {
    const value = await createSession(env.APP_PASSWORD, now)
    expect(response(await authGate(nav('/login', value), env, { now })).headers.get('location')).toBe('/')
  })
})
