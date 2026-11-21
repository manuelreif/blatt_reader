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
    expect(await res.json()).toEqual({ translation: 'Ufer', detectedSourceLang: 'EN', billedCharacters: 4 })
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

  it('explains DeepL quota errors', async () => {
    const f = vi.fn(async () => new Response('', { status: 456 }))
    const res = await handleTranslate(post({ text: 'bank' }), { DEEPL_API_KEY: 'k:fx' }, f)
    expect(res.status).toBe(502)
    expect((await res.json()).error).toMatch(/Kontingent/)
  })
})
