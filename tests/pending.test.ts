import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { saveLookup } from '../src/db/repo'
import { db } from '../src/db/schema'
import { countPendingTranslations, retryPendingTranslations } from '../src/translate/pending'

const book = { id: 'b1', title: 'Testbuch' }
const offlineSave = (lemma: string, sentence: string, fallback?: string) =>
  saveLookup({
    lemma,
    surface: lemma,
    sentence,
    translation: fallback,
    deeplPending: true,
    dictSenses: fallback ? [{ de: `${fallback} {f}` }] : [],
    book,
    cardTypes: ['en-de'],
  })

const deepl = (map: Record<string, string>) =>
  vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
    const { text } = JSON.parse(String(init?.body)) as { text: string }
    return Response.json({ translation: map[text] ?? `DE:${text}` })
  })

beforeEach(async () => {
  await Promise.all(db.tables.map(t => t.clear()))
})

describe('retryPendingTranslations', () => {
  it('fills in DeepL for words saved offline and replaces the dictionary fallback', async () => {
    await offlineSave('bank', 'We sat on the bank of the river.', 'Bank')
    await offlineSave('estimator', 'The estimator was biased.')
    expect(await countPendingTranslations()).toBe(2)

    const r = await retryPendingTranslations({ fetchImpl: deepl({ bank: 'Ufer', estimator: 'Schätzer' }) })
    expect(r).toEqual({ done: 2 })
    expect(await countPendingTranslations()).toBe(0)
    expect((await db.terms.get('bank'))?.translation).toBe('Ufer')
    expect((await db.terms.get('estimator'))?.translation).toBe('Schätzer')
    const ctx = await db.contexts.where('termId').equals('bank').first()
    expect(ctx).toMatchObject({ translation: 'Ufer' })
    expect(ctx).not.toHaveProperty('deeplPending')
  })

  it('keeps a translation the user changed in the meantime', async () => {
    await offlineSave('bank', 'We sat on the bank of the river.', 'Bank')
    await db.terms.update('bank', { translation: 'Flussufer' })
    await retryPendingTranslations({ fetchImpl: deepl({ bank: 'Ufer' }) })
    expect((await db.terms.get('bank'))?.translation).toBe('Flussufer')
    expect((await db.contexts.where('termId').equals('bank').first())?.translation).toBe('Ufer')
  })

  it('stops at the first failure and keeps the rest pending', async () => {
    await offlineSave('bank', 'We sat on the bank of the river.', 'Bank')
    await offlineSave('estimator', 'The estimator was biased.')
    const f = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    })
    const r = await retryPendingTranslations({ fetchImpl: f })
    expect(r.done).toBe(0)
    expect(r.failed).toMatch(/offline/)
    expect(f).toHaveBeenCalledTimes(1)
    expect(await countPendingTranslations()).toBe(2)
  })

  it('runs only once at a time', async () => {
    await offlineSave('bank', 'We sat on the bank of the river.', 'Bank')
    const f = deepl({ bank: 'Ufer' })
    const [a, b] = await Promise.all([retryPendingTranslations({ fetchImpl: f }), retryPendingTranslations({ fetchImpl: f })])
    expect(a).toBe(b)
    expect(f).toHaveBeenCalledTimes(1)
  })

  it('does not mark words saved with DeepL as pending', async () => {
    await saveLookup({ lemma: 'bank', surface: 'bank', sentence: 'x', translation: 'Ufer', dictSenses: [], book, cardTypes: ['en-de'] })
    expect(await countPendingTranslations()).toBe(0)
  })
})
