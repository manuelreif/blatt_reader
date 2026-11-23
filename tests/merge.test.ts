import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { deleteTerm, recordReview, saveLookup, setTermStatus } from '../src/db/repo'
import { db, type Book } from '../src/db/schema'
import { Rating } from '../src/quiz/scheduler'
import { addHighlight, bookHighlights, deleteHighlight } from '../src/reader/highlights'
import { backupJson, mergeBackup, parseBackup, restoreBackup } from '../src/vocab/export'

// One IndexedDB plays both devices: take a snapshot on "device A", reset, build "device B", merge.
const reset = () => Promise.all(db.tables.map(t => t.clear()))
const snapshot = async () => parseBackup(await backupJson())

const DAY = 24 * 60 * 60 * 1000
const T0 = Date.UTC(2026, 0, 1)
const book = { id: 'b1', title: 'Testbuch' }

const save = (lemma: string, opts: { sentence?: string; translation?: string; now?: number; deeplPending?: boolean } = {}) =>
  saveLookup({
    lemma,
    surface: lemma,
    sentence: opts.sentence ?? `A sentence with ${lemma}.`,
    translation: opts.translation,
    deeplPending: opts.deeplPending,
    dictSenses: [],
    book,
    cardTypes: ['en-de'],
    now: opts.now ?? T0,
  })

const reviewOnce = async (termId: string, at: number) => {
  const card = (await db.cards.get(`${termId}|en-de`))!
  await recordReview(card, Rating.Good, { now: new Date(at) })
}

beforeEach(reset)

describe('mergeBackup', () => {
  it('takes a word from the backup only if it is newer', async () => {
    await save('bank', { translation: 'Bank' })
    await db.terms.update('bank', { translation: 'Ufer', updatedAt: T0 + 2 * DAY })
    const deviceA = await snapshot()

    await reset()
    await save('bank', { translation: 'Bank', now: T0 + DAY })
    expect(await mergeBackup(deviceA)).toMatchObject({ terms: 1, added: 0, updated: 1, removed: 0 })
    expect((await db.terms.get('bank'))?.translation).toBe('Ufer')

    await db.terms.update('bank', { translation: 'Bankett', updatedAt: T0 + 3 * DAY })
    expect(await mergeBackup(deviceA)).toMatchObject({ updated: 0 })
    expect((await db.terms.get('bank'))?.translation).toBe('Bankett')
  })

  it('keeps the further learned card and its review history', async () => {
    await save('estimator')
    await reviewOnce('estimator', T0 + DAY)
    const deviceA = await snapshot()

    await reset()
    await save('estimator') // device B: saved the same word, never reviewed it
    await mergeBackup(deviceA)
    const card = (await db.cards.get('estimator|en-de'))!
    expect(card.fsrs.reps).toBe(1)
    expect(card.fsrs.last_review).toBeInstanceOf(Date)
    expect(await db.reviewLogs.count()).toBe(1)

    await reviewOnce('estimator', T0 + 5 * DAY) // B reviews later than A
    await mergeBackup(deviceA)
    expect((await db.cards.get('estimator|en-de'))!.fsrs.reps).toBe(2)
    expect(await db.reviewLogs.count()).toBe(2) // A's review is not added twice
  })

  it('suspends the cards when the word became known on the other device', async () => {
    await save('estimator')
    await setTermStatus('estimator', 6, ['en-de'])
    const deviceA = await snapshot()

    await reset()
    await save('estimator')
    expect((await db.cards.get('estimator|en-de'))!.suspended).toBeFalsy()
    await mergeBackup(deviceA)
    expect((await db.terms.get('estimator'))?.status).toBe(6)
    expect((await db.cards.get('estimator|en-de'))!.suspended).toBe(true)
  })

  it('does not bring back a word deleted here, unless it was changed after the deletion', async () => {
    await save('bank', { now: T0 })
    await reviewOnce('bank', T0 + DAY)
    const deviceA = await snapshot()

    await deleteTerm('bank', T0 + 2 * DAY)
    expect(await mergeBackup(deviceA)).toMatchObject({ added: 0 })
    expect(await db.terms.get('bank')).toBeUndefined()
    expect(await db.contexts.count()).toBe(0)
    expect(await db.cards.count()).toBe(0)
    expect(await db.reviewLogs.count()).toBe(0)

    deviceA.terms[0].updatedAt = T0 + 3 * DAY // used again on A after the deletion
    expect(await mergeBackup(deviceA)).toMatchObject({ added: 1 })
    expect(await db.terms.get('bank')).toBeDefined()
    expect(await db.contexts.count()).toBe(1)
  })

  it('removes a word deleted on the other device together with its contexts', async () => {
    await save('bank', { now: T0 })
    await save('river', { now: T0 })
    const stats = await mergeBackup({ app: 'vokabel-reader', terms: [], tombstones: [{ id: 'bank', at: T0 + DAY }] })
    expect(stats).toMatchObject({ removed: 1 })
    expect(await db.terms.get('bank')).toBeUndefined()
    expect(await db.terms.get('river')).toBeDefined()
    expect((await db.contexts.toArray()).map(c => c.termId)).toEqual(['river'])
    expect(await db.tombstones.get('bank')).toEqual({ id: 'bank', at: T0 + DAY })
  })

  it('combines contexts; a context saved offline gets the translation from the other device', async () => {
    await save('bank', { sentence: 'We sat on the bank.', translation: 'Ufer' })
    await save('bank', { sentence: 'The bank was closed.', translation: 'Bank' })
    const deviceA = await snapshot()

    await reset()
    await save('bank', { sentence: 'We sat on the bank.', translation: 'Bank', deeplPending: true })
    await mergeBackup(deviceA)
    await mergeBackup(deviceA)
    const contexts = await db.contexts.orderBy('id').toArray()
    expect(contexts.map(c => c.sentence)).toEqual(['We sat on the bank.', 'The bank was closed.'])
    expect(contexts[0]).toMatchObject({ translation: 'Ufer' })
    expect(contexts[0].deeplPending).toBeUndefined()
  })

  it('moves the reading position forward to the newer one, only for books on this device', async () => {
    const b: Book = {
      id: 'b1',
      title: 'Testbuch',
      author: '',
      format: 'epub',
      fileName: 'test.epub',
      file: new Blob(['x']),
      addedAt: T0,
      lastLocation: 'epubcfi(/6/2)',
      progress: 0.1,
      progressAt: T0 + DAY,
    }
    await db.books.put(b)
    const progress = (lastLocation: string, at: number, id = 'b1') => ({ id, lastLocation, progress: 0.5, progressAt: at })

    await mergeBackup({ app: 'vokabel-reader', terms: [], bookProgress: [progress('epubcfi(/6/8)', T0), progress('x', T0, 'other')] })
    expect((await db.books.get('b1'))?.lastLocation).toBe('epubcfi(/6/2)')
    expect(await db.books.get('other')).toBeUndefined()

    await mergeBackup({ app: 'vokabel-reader', terms: [], bookProgress: [progress('epubcfi(/6/8)', T0 + 2 * DAY)] })
    expect(await db.books.get('b1')).toMatchObject({ lastLocation: 'epubcfi(/6/8)', progress: 0.5, progressAt: T0 + 2 * DAY })
    expect((await snapshot()).bookProgress).toEqual([progress('epubcfi(/6/8)', T0 + 2 * DAY)])
  })
})

describe('backup files', () => {
  it('leave out and keep the settings that belong to this device', async () => {
    await db.settings.bulkPut([
      { key: 'autoSave', value: true },
      { key: 'drive', value: { connected: true } },
      { key: 'enrichBatch', value: { ids: [] } },
      { key: 'deeplKey', value: 'mine:fx' },
    ])
    expect((await snapshot()).settings?.map(s => s.key)).toEqual(['autoSave'])

    const other = JSON.stringify({
      app: 'vokabel-reader',
      version: 1,
      terms: [],
      settings: [
        { key: 'newCardsPerDay', value: 5 },
        { key: 'drive', value: { connected: false } },
        { key: 'deeplKey', value: 'theirs:fx' },
      ],
    })
    await restoreBackup(other)
    expect((await db.settings.get('newCardsPerDay'))?.value).toBe(5)
    expect((await db.settings.get('drive'))?.value).toEqual({ connected: true })
    expect((await db.settings.get('deeplKey'))?.value).toBe('mine:fx')

    await mergeBackup({ ...JSON.parse(other), settings: [{ key: 'newCardsPerDay', value: 9 }] }, { settings: false })
    expect((await db.settings.get('newCardsPerDay'))?.value).toBe(5)
  })

  it('from before the Drive sync (no tombstones, no reading positions) still restore', async () => {
    await save('bank')
    const old = await snapshot()
    delete old.tombstones
    delete old.bookProgress
    delete old.highlights
    await reset()
    expect(await restoreBackup(JSON.stringify(old))).toEqual({ terms: 1 })
    expect(await db.cards.count()).toBe(1)
  })

  it('are checked before anything is changed', async () => {
    await expect(restoreBackup('{"app":"other"}')).rejects.toThrow('Keine gültige Sicherungsdatei')
    await expect(restoreBackup('not json')).rejects.toThrow('Keine gültige Sicherungsdatei')
  })
})

describe('marks', () => {
  const mark = { bookId: 'b1', bookTitle: 'Testbuch', section: 2, start: 10, end: 20, text: 'some words', color: 'yellow' as const }

  it('travel to the other device, the later change wins, a deletion stays', async () => {
    const a = await addHighlight(mark)
    const b = await addHighlight({ ...mark, start: 40, end: 45, text: 'other' })
    const deviceA = await snapshot()

    await reset()
    expect(await mergeBackup(deviceA)).toMatchObject({ highlights: 2 })
    expect((await bookHighlights('b1')).map(h => h.text)).toEqual(['some words', 'other'])

    // device B: a newer note on a, deletes b
    await db.highlights.update(a.id, { note: 'wichtig', updatedAt: a.updatedAt + 1000 })
    await db.highlights.update(b.id, { deleted: true, updatedAt: b.updatedAt + 1000 })
    const deviceB = await snapshot()

    // back on device A (still the old state): B's changes win
    await reset()
    await mergeBackup(deviceA)
    expect(await mergeBackup(deviceB)).toMatchObject({ highlights: 2 })
    expect(await bookHighlights('b1')).toMatchObject([{ id: a.id, note: 'wichtig' }])

    // merging the older state again changes nothing
    expect(await mergeBackup(deviceA)).toMatchObject({ highlights: 0 })
    expect(await bookHighlights('b1')).toHaveLength(1)
  })

  it('a mark deleted with deleteHighlight is soft deleted', async () => {
    const a = await addHighlight(mark)
    await deleteHighlight(a.id)
    expect(await bookHighlights('b1')).toEqual([])
    expect((await db.highlights.get(a.id))?.deleted).toBe(true)
  })
})
