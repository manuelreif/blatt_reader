import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../src/db/schema'
import { setSetting } from '../src/settings/settings'
import { TranslateError, translateInContext } from '../src/translate/deepl'

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

  it('turns server errors into readable messages', async () => {
    const f = vi.fn(async () => Response.json({ error: 'DeepL-Key ungültig' }, { status: 502 }))
    await expect(translateInContext('bank', '', { fetchImpl: f })).rejects.toThrow(new TranslateError('DeepL-Key ungültig'))
  })
})
