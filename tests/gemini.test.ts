import { describe, expect, it, vi } from 'vitest'
import { askGemini, DEFAULT_GEMINI_MODEL, GeminiError, normalizeModel } from '../src/enrich/gemini'

const answer = (parts: { text?: string; thought?: boolean }[], finishReason = 'STOP') =>
  Response.json({ candidates: [{ content: { parts }, finishReason }] })

describe('askGemini', () => {
  it('sends the key as a header, the model in the path, and asks for JSON on request', async () => {
    const f = vi.fn(async () => answer([{ text: '[{"id":"bank"}]' }]))
    const text = await askGemini('hallo', { key: ' AIzaTest ', model: 'models/gemini-x', json: true, fetchImpl: f })
    expect(text).toBe('[{"id":"bank"}]')
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-x:generateContent')
    expect(url).not.toContain('AIza')
    expect(init.headers).toMatchObject({ 'x-goog-api-key': 'AIzaTest' })
    const body = JSON.parse(init.body as string)
    expect(body.contents[0].parts[0].text).toBe('hallo')
    expect(body.generationConfig.responseMimeType).toBe('application/json')
  })

  it('joins text parts and leaves out thoughts', async () => {
    const f = vi.fn(async () => answer([{ text: 'hmm', thought: true }, { text: 'Ufer' }, { text: '!' }]))
    expect(await askGemini('x', { key: 'k', fetchImpl: f })).toBe('Ufer!')
  })

  it('needs a key', async () => {
    const f = vi.fn()
    await expect(askGemini('x', { key: '  ', fetchImpl: f })).rejects.toThrow('Kein Gemini-Key')
    expect(f).not.toHaveBeenCalled()
  })

  it.each([
    [429, {}, 'Kontingent'],
    [400, { error: { message: 'API key not valid. Please pass a valid API key.' } }, 'Key ungültig'],
    [403, {}, 'Key ungültig'],
    [404, {}, 'Modell nicht gefunden'],
    [503, {}, 'gestört'],
  ])('turns HTTP %i into a German message', async (status, body, message) => {
    const f = vi.fn(async () => Response.json(body, { status }))
    const err = await askGemini('x', { key: 'k', fetchImpl: f }).catch(e => e)
    expect(err).toBeInstanceOf(GeminiError)
    expect(err.message).toContain(message)
  })

  it('explains a withheld answer and a blocked prompt', async () => {
    await expect(askGemini('x', { key: 'k', fetchImpl: async () => answer([], 'SAFETY') })).rejects.toThrow('zurückgehalten')
    await expect(
      askGemini('x', { key: 'k', fetchImpl: async () => Response.json({ promptFeedback: { blockReason: 'OTHER' } }) }),
    ).rejects.toThrow('abgelehnt')
  })

  it('reports a network failure and an abort', async () => {
    await expect(askGemini('x', { key: 'k', fetchImpl: async () => Promise.reject(new TypeError('fetch failed')) })).rejects.toThrow(
      'nicht erreichbar',
    )
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' })
    await expect(askGemini('x', { key: 'k', fetchImpl: async () => Promise.reject(abort) })).rejects.toThrow('Abgebrochen')
  })
})

describe('normalizeModel', () => {
  it('strips "models/" and falls back to the default for empty or odd input', () => {
    expect(normalizeModel(' models/gemini-flash-latest ')).toBe('gemini-flash-latest')
    expect(normalizeModel('')).toBe(DEFAULT_GEMINI_MODEL)
    expect(normalizeModel('../x?y')).toBe(DEFAULT_GEMINI_MODEL)
  })
})
