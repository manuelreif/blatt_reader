import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../src/db/schema'
import { setSetting } from '../src/settings/settings'
import { cachedTranslation, TranslateError, translateInContext } from '../src/translate/deepl'

beforeEach(async () => {
  await Promise.all(db.tables.map(t => t.clear()))
})

describe('translateInContext', () => {
  it('posts to /api/translate with the app token and caches the result', async () => {
    await setSetting('appToken', 'tok')
    const f = vi.fn(async () => Response.json({ translation: 'Ufer', billedCharacters: 4 }))
    const r1 = await translateInContext('bank', 'the bank of the river', { fetchImpl: f })
    const r2 = await translateInContext('bank', 'the bank of the river', { fetchImpl: f })
    expect(r1).toEqual({ translation: 'Ufer', billedCharacters: 4 })
    expect(r2).toEqual({ translation: 'Ufer', cached: true })
    expect(f).toHaveBeenCalledTimes(1)
    const [, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect((init.headers as Record<string, string>)['x-app-token']).toBe('tok')
  })

  it("sends this device's own DeepL key, and none when it is empty", async () => {
    const f = vi.fn(async () => Response.json({ translation: 'Ufer', keySource: 'own' }))
    await translateInContext('bank', 'a', { fetchImpl: f })
    expect((f.mock.calls[0] as unknown as [string, RequestInit])[1].headers).not.toHaveProperty('x-deepl-key')
    await setSetting('deeplKey', ' 1234abcd-ef:fx ')
    const r = await translateInContext('bank', 'b', { fetchImpl: f })
    expect((f.mock.calls[1] as unknown as [string, RequestInit])[1].headers).toMatchObject({ 'x-deepl-key': '1234abcd-ef:fx' })
    expect(r.keySource).toBe('own')
  })

  it('turns server errors into readable messages', async () => {
    const f = vi.fn(async () => Response.json({ error: 'DeepL-Key ungültig' }, { status: 502 }))
    await expect(translateInContext('bank', '', { fetchImpl: f })).rejects.toThrow(new TranslateError('DeepL-Key ungültig'))
  })
})

describe('cachedTranslation', () => {
  it('only reads the cache of earlier translations', async () => {
    expect(await cachedTranslation('bank', 'the bank of the river')).toBeNull()
    const f = vi.fn(async () => Response.json({ translation: 'Ufer' }))
    await translateInContext('bank', 'the bank of the river', { fetchImpl: f })
    expect(await cachedTranslation('bank', 'the bank of the river')).toBe('Ufer')
    expect(await cachedTranslation('bank', 'a bank account')).toBeNull()
    expect(f).toHaveBeenCalledTimes(1)
  })
})
