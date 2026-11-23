import { describe, expect, it, vi } from 'vitest'
import { authGate, createSession, SESSION_COOKIE, SESSION_DAYS, verifySession, type AuthDecision } from '../server/auth'
import { clientKey, MAX_FAILS, memoryAttemptStore, WINDOW_SECONDS } from '../server/loginLimit'

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

describe('login limit', () => {
  const HOUR = 60 * 60 * 1000
  const setup = () => {
    const clock = { t: now }
    const limited = { ...env, LOGIN_ATTEMPTS: memoryAttemptStore(() => clock.t) }
    const attempt = async (password: string, ip = '203.0.113.7') =>
      response(await authGate(login(password), limited, { now: clock.t, failDelayMs: 0, ip }))
    return { clock, attempt }
  }

  it(`blocks a client after ${MAX_FAILS} failures, even with the right password`, async () => {
    const { attempt } = setup()
    for (let left = MAX_FAILS - 1; left > 0; left--) {
      const res = await attempt('wrong')
      expect(res.status).toBe(401)
      expect(await res.text()).toContain(`Noch ${left} ${left === 1 ? 'Versuch' : 'Versuche'}.`)
    }
    const blocked = await attempt('wrong')
    expect(blocked.status).toBe(429)
    expect(blocked.headers.get('retry-after')).toBe(String(WINDOW_SECONDS))
    expect(await blocked.text()).toContain('Zu viele Fehlversuche. Bitte in 60 Minuten')
    const right = await attempt(env.APP_PASSWORD)
    expect(right.status).toBe(429)
    expect(right.headers.get('set-cookie')).toBeNull()
  })

  it('counts the hour from the first failure', async () => {
    const { clock, attempt } = setup()
    await attempt('wrong')
    clock.t += HOUR / 2
    for (let i = 1; i < MAX_FAILS; i++) await attempt('wrong')
    expect((await attempt(env.APP_PASSWORD)).headers.get('retry-after')).toBe(String(WINDOW_SECONDS / 2))
    clock.t += HOUR / 2
    expect((await attempt(env.APP_PASSWORD)).status).toBe(303)
  })

  it('starts over after a successful login', async () => {
    const { attempt } = setup()
    for (let i = 1; i < MAX_FAILS; i++) await attempt('wrong')
    expect((await attempt(env.APP_PASSWORD)).status).toBe(303)
    expect(await (await attempt('wrong')).text()).toContain(`Noch ${MAX_FAILS - 1} Versuche.`)
  })

  it('counts per IPv4 address and per IPv6 /64', async () => {
    const { attempt } = setup()
    for (let i = 0; i < MAX_FAILS; i++) await attempt('wrong', '2001:db8:1:2::1')
    expect((await attempt('wrong', '2001:db8:1:2:ffff::9')).status).toBe(429)
    expect((await attempt('wrong', '2001:db8:1:3::1')).status).toBe(401)
    expect((await attempt('wrong', '203.0.113.8')).status).toBe(401)
  })

  it('takes the address from cf-connecting-ip on Cloudflare', async () => {
    const { clock } = setup()
    const limited = { ...env, LOGIN_ATTEMPTS: memoryAttemptStore(() => clock.t) }
    const fromCloudflare = () => {
      const req = login('wrong')
      req.headers.set('cf-connecting-ip', '198.51.100.4')
      return authGate(req, limited, { now: clock.t, failDelayMs: 0 })
    }
    for (let i = 0; i < MAX_FAILS; i++) await fromCloudflare()
    expect(response(await fromCloudflare()).status).toBe(429)
    expect(response(await authGate(login('wrong'), limited, { now: clock.t, failDelayMs: 0, ip: '198.51.100.5' })).status).toBe(401)
  })

  it('logs in as before when the store fails (never locks the owner out)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const broken = { ...env, LOGIN_ATTEMPTS: { get: () => Promise.reject(new Error('KV down')), put: () => Promise.reject(new Error('KV down')), delete: () => Promise.reject(new Error('KV down')) } }
    for (let i = 0; i <= MAX_FAILS; i++) {
      const res = response(await authGate(login('wrong'), broken, { now, failDelayMs: 0 }))
      expect(res.status).toBe(401)
      expect(await res.text()).not.toContain('Noch')
    }
    expect(response(await authGate(login(env.APP_PASSWORD), broken, { now })).status).toBe(303)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('builds counter keys from client addresses', () => {
    expect(clientKey('203.0.113.7')).toBe('203.0.113.7')
    expect(clientKey('::ffff:127.0.0.1')).toBe('127.0.0.1')
    expect(clientKey('2001:db8::1')).toBe('2001:db8:0:0::/64')
    expect(clientKey('2001:0DB8:0000:0000:ffff:0:0:2')).toBe('2001:db8:0:0::/64')
    expect(clientKey('[2001:db8:a:b:c::1]')).toBe('2001:db8:a:b::/64')
    expect(clientKey('fe80::1%eth0')).toBe('fe80:0:0:0::/64')
    expect(clientKey('::1')).toBe('0:0:0:0::/64')
    expect(clientKey('')).toBe('unknown')
    expect(clientKey(null)).toBe('unknown')
  })
})
