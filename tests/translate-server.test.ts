import { describe, expect, it, vi } from 'vitest'
import { handleTranslate } from '../server/translate'

const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request('http://x/api/translate', { method: 'POST', body: JSON.stringify(body), headers })

const deeplOk = (text = 'Ufer') =>
  vi.fn(async () => Response.json({ translations: [{ text, detected_source_language: 'EN', billed_characters: 4 }] }))

describe('handleTranslate', () => {
  it('sends the word as text and the sentence as context', async () => {
    const f = deeplOk()
    const res = await handleTranslate(post({ text: 'bank', context: 'We sat on the bank of the river.' }), { DEEPL_API_KEY: 'k:fx' }, f)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ translation: 'Ufer', detectedSourceLang: 'EN', billedCharacters: 4, keySource: 'server' })
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api-free.deepl.com/v2/translate')
    expect((init.headers as Record<string, string>).Authorization).toBe('DeepL-Auth-Key k:fx')
    expect(JSON.parse(init.body as string)).toMatchObject({
      text: ['bank'],
      context: 'We sat on the bank of the river.',
      source_lang: 'EN',
      target_lang: 'DE',
      show_billed_characters: true,
    })
  })

  it('uses the Pro endpoint for keys without :fx', async () => {
    const f = deeplOk()
    await handleTranslate(post({ text: 'bank' }), { DEEPL_API_KEY: 'pro-key' }, f)
    expect((f.mock.calls[0] as unknown as [string])[0]).toBe('https://api.deepl.com/v2/translate')
  })

  it('checks the app token when one is configured', async () => {
    const env = { DEEPL_API_KEY: 'k:fx', APP_TOKEN: 'secret' }
    expect((await handleTranslate(post({ text: 'bank' }), env, deeplOk())).status).toBe(401)
    expect((await handleTranslate(post({ text: 'bank' }, { 'x-app-token': 'secret' }), env, deeplOk())).status).toBe(200)
  })

  it('reports a missing key and bad input', async () => {
    expect((await handleTranslate(post({ text: 'bank' }), {}, deeplOk())).status).toBe(503)
    expect((await handleTranslate(post({ text: '' }), { DEEPL_API_KEY: 'k' }, deeplOk())).status).toBe(400)
    expect((await handleTranslate(new Request('http://x', { method: 'GET' }), { DEEPL_API_KEY: 'k' })).status).toBe(405)
  })

  it("uses the device's own key instead of the server key", async () => {
    const f = deeplOk()
    const res = await handleTranslate(post({ text: 'bank' }, { 'x-deepl-key': ' 1234abcd-ef:fx ' }), { DEEPL_API_KEY: 'server-pro' }, f)
    expect(res.status).toBe(200)
    expect((await res.json()).keySource).toBe('own')
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api-free.deepl.com/v2/translate')
    expect((init.headers as Record<string, string>).Authorization).toBe('DeepL-Auth-Key 1234abcd-ef:fx')
  })

  it('works with an own key when the server has none', async () => {
    const res = await handleTranslate(post({ text: 'bank' }, { 'x-deepl-key': '1234abcd-ef:fx' }), {}, deeplOk())
    expect(res.status).toBe(200)
  })

  it('reports the server key as the one billed', async () => {
    const res = await handleTranslate(post({ text: 'bank' }), { DEEPL_API_KEY: 'k:fx' }, deeplOk())
    expect((await res.json()).keySource).toBe('server')
  })

  it('rejects an own key that cannot be a DeepL key', async () => {
    const f = deeplOk()
    const res = await handleTranslate(post({ text: 'bank' }, { 'x-deepl-key': 'kein key' }), { DEEPL_API_KEY: 'k:fx' }, f)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/Format/)
    expect(f).not.toHaveBeenCalled()
  })

  it('still checks the app token with an own key', async () => {
    const env = { APP_TOKEN: 'secret' }
    const res = await handleTranslate(post({ text: 'bank' }, { 'x-deepl-key': '1234abcd-ef:fx' }), env, deeplOk())
    expect(res.status).toBe(401)
  })

  it('never uses the server key when DEEPL_REQUIRE_OWN_KEY is on', async () => {
    const env = { DEEPL_API_KEY: 'k:fx', DEEPL_REQUIRE_OWN_KEY: 'true' }
    const f = deeplOk()
    const res = await handleTranslate(post({ text: 'bank' }), env, f)
    expect(res.status).toBe(403)
    expect((await res.json()).error).toMatch(/eigenen DeepL-Key/)
    expect(f).not.toHaveBeenCalled()
    expect((await handleTranslate(post({ text: 'bank' }, { 'x-deepl-key': '1234abcd-ef:fx' }), env, f)).status).toBe(200)
    expect((await handleTranslate(post({ text: 'bank' }), { ...env, DEEPL_REQUIRE_OWN_KEY: '0' }, f)).status).toBe(200)
  })

  it('says whose key is out of quota', async () => {
    const f = vi.fn(async () => new Response('', { status: 456 }))
    const res = await handleTranslate(post({ text: 'bank' }, { 'x-deepl-key': '1234abcd-ef:fx' }), { DEEPL_API_KEY: 'k:fx' }, f)
    expect((await res.json()).error).toMatch(/Eigener DeepL-Key: Kontingent/)
  })

  it('explains DeepL quota errors', async () => {
    const f = vi.fn(async () => new Response('', { status: 456 }))
    const res = await handleTranslate(post({ text: 'bank' }), { DEEPL_API_KEY: 'k:fx' }, f)
    expect(res.status).toBe(502)
    expect((await res.json()).error).toMatch(/Kontingent/)
  })
})
