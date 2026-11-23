import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  applyContextTranslation,
  booksWithWords,
  countDue,
  deleteTerm,
  loadQuizSession,
  nextDueAt,
  quizBooks,
  recordReview,
  saveLookup,
  setTermStatus,
} from '../src/db/repo'
import { db, STATUS_IGNORED } from '../src/db/schema'
import { Rating, type Grade } from '../src/quiz/scheduler'

const book = { id: 'b1', title: 'Testbuch' }
const base = {
  lemma: 'estimator',
  surface: 'estimators',
  sentence: 'The estimators were biased.',
  translation: 'Schätzer',
  dictSenses: [{ de: 'Schätzfunktion {f} [statist.]', pos: 'noun' }],
  pos: 'noun',
  book,
  cardTypes: ['en-de', 'cloze'] as ('en-de' | 'cloze')[],
}

beforeEach(async () => {
  await Promise.all(db.tables.map(t => t.clear()))
})

describe('saveLookup', () => {
  it('creates term, context and cards for a new word', async () => {
    const r = await saveLookup(base)
    expect(r.isNew).toBe(true)
    expect(await db.terms.get('estimator')).toMatchObject({ lemma: 'estimator', forms: ['estimators'], translation: 'Schätzer', status: 1 })
    expect(await db.contexts.count()).toBe(1)
    expect((await db.cards.toArray()).map(c => c.id).sort()).toEqual(['estimator|cloze', 'estimator|en-de'])
  })

  it('adds only a new context when the word is looked up again', async () => {
    await saveLookup(base)
    const again = await saveLookup({ ...base, surface: 'estimator', sentence: 'An estimator maps data to a number.', translation: 'Schätzfunktion' })
    expect(again).toMatchObject({ isNew: false, contextAdded: true })
    const term = await db.terms.get('estimator')
    expect(term?.translation).toBe('Schätzer') // first translation is kept
    expect(term?.forms).toEqual(['estimators', 'estimator'])
    expect(await db.contexts.count()).toBe(2)
    expect(await db.cards.count()).toBe(2)
  })

  it('does not duplicate the same sentence', async () => {
    await saveLookup(base)
    const again = await saveLookup(base)
    expect(again.contextAdded).toBe(false)
    expect(await db.contexts.count()).toBe(1)
  })

  it('creates no cards for ignored words', async () => {
    await saveLookup({ ...base, lemma: 'Holmes', surface: 'Holmes', status: STATUS_IGNORED })
    expect(await db.cards.count()).toBe(0)
  })

  it('falls back to the dictionary when DeepL gave nothing', async () => {
    await saveLookup({ ...base, translation: undefined })
    expect((await db.terms.get('estimator'))?.translation).toBe('Schätzfunktion {f} [statist.]')
  })
})

describe('applyContextTranslation', () => {
  const fromDictionary = { ...base, translation: 'Schätzfunktion', dictSenses: [{ de: 'Schätzfunktion {f}' }] }

  it('replaces the dictionary fallback saved with the context', async () => {
    await saveLookup(fromDictionary)
    expect(await applyContextTranslation({ termId: 'estimator', sentence: base.sentence }, 'Schätzer')).toBe(true)
    expect((await db.terms.get('estimator'))?.translation).toBe('Schätzer')
    expect((await db.contexts.where('termId').equals('estimator').first())?.translation).toBe('Schätzer')
  })

  it('keeps a translation typed later, and ignores unknown contexts', async () => {
    await saveLookup(fromDictionary)
    await db.terms.update('estimator', { translation: 'Schätzwert' })
    await applyContextTranslation({ termId: 'estimator', sentence: base.sentence }, 'Schätzer')
    expect((await db.terms.get('estimator'))?.translation).toBe('Schätzwert')
    expect((await db.contexts.where('termId').equals('estimator').first())?.translation).toBe('Schätzer')
    expect(await applyContextTranslation({ termId: 'estimator', sentence: 'Another sentence.' }, 'x')).toBe(false)
  })

  it('with onlyIfPending, leaves contexts alone that wait for nothing', async () => {
    await saveLookup(fromDictionary)
    const ctx = (await db.contexts.where('termId').equals('estimator').first())!
    expect(await applyContextTranslation({ id: ctx.id! }, 'Schätzer', { onlyIfPending: true })).toBe(false)
    expect((await db.terms.get('estimator'))?.translation).toBe('Schätzfunktion')
  })
})

describe('quiz', () => {
  it('serves new cards up to the daily limit and records reviews', async () => {
    const now = new Date()
    await saveLookup({ ...base, now: now.getTime() - 1000 })
    expect(await countDue()).toBe(2)
    const session = await loadQuizSession({ limit: 20, newPerDay: 1 })
    expect(session).toHaveLength(1)
    expect(session[0].context?.sentence).toBe(base.sentence)

    await recordReview(session[0].card, Rating.Good as Grade)
    expect(await db.reviewLogs.count()).toBe(1)
    const card = await db.cards.get(session[0].card.id)
    expect(card!.due).toBeGreaterThan(now.getTime())
    // the daily budget for new cards is used up
    expect(await loadQuizSession({ limit: 20, newPerDay: 1 })).toHaveLength(0)
  })

  it('suspends cards of ignored words and deletes everything with the word', async () => {
    await saveLookup(base)
    await setTermStatus('estimator', STATUS_IGNORED, base.cardTypes)
    expect(await countDue()).toBe(0)
    await deleteTerm('estimator')
    expect(await db.terms.count()).toBe(0)
    expect(await db.contexts.count()).toBe(0)
    expect(await db.cards.count()).toBe(0)
  })
})

describe('quiz per book', () => {
  const other = { id: 'b2', title: 'Zweites Buch' }
  const t0 = Date.now() - 10_000

  async function twoBooks() {
    await saveLookup({ ...base, now: t0 })
    await saveLookup({ ...base, lemma: 'variance', surface: 'variance', sentence: 'The variance was large.', book: other, now: t0 + 1 })
    // read in both books
    await saveLookup({ ...base, lemma: 'mean', surface: 'mean', sentence: 'The mean moved.', now: t0 + 2 })
    await saveLookup({ ...base, lemma: 'mean', surface: 'mean', sentence: 'We report the mean.', book: other, now: t0 + 3 })
  }

  it('asks only the words saved from the chosen book', async () => {
    await twoBooks()
    const b1 = await loadQuizSession({ limit: 20, newPerDay: 20, bookId: 'b1' })
    expect(new Set(b1.map(i => i.term.id))).toEqual(new Set(['estimator', 'mean']))
    const b2 = await loadQuizSession({ limit: 20, newPerDay: 20, bookId: 'b2' })
    expect(new Set(b2.map(i => i.term.id))).toEqual(new Set(['variance', 'mean']))
    // the sentence comes from the chosen book
    expect(b2.filter(i => i.term.id === 'mean').every(i => i.context?.bookId === 'b2')).toBe(true)
    expect(await loadQuizSession({ limit: 20, newPerDay: 20 })).toHaveLength(6)
    expect(await loadQuizSession({ limit: 20, newPerDay: 20, bookId: 'nope' })).toHaveLength(0)
    expect(await countDue(new Date(), 'b2')).toBe(4)
  })

  it('shares the learning state and the daily limit between the quizzes', async () => {
    await twoBooks()
    const b1 = await loadQuizSession({ limit: 20, newPerDay: 3, bookId: 'b1' })
    expect(b1).toHaveLength(3)
    for (const i of b1) await recordReview(i.card, Rating.Good as Grade)
    // the daily limit is used up, also for the other book
    expect(await loadQuizSession({ limit: 20, newPerDay: 3, bookId: 'b2' })).toHaveLength(0)
    // a card of "mean" learned through book 1 is no longer due in book 2
    const b2 = await loadQuizSession({ limit: 20, newPerDay: 20, bookId: 'b2' })
    const learned = new Set(b1.map(i => i.card.id))
    expect(b2.some(i => learned.has(i.card.id))).toBe(false)
  })

  it('lists the books with their due cards and the next due date', async () => {
    await twoBooks()
    await saveLookup({ ...base, lemma: 'Holmes', surface: 'Holmes', sentence: 'Holmes smiled.', book: { id: 'b3', title: 'Nur Namen' }, status: STATUS_IGNORED, now: t0 + 4 })
    expect((await booksWithWords()).map(b => b.bookId)).toEqual(['b3', 'b2', 'b1'])
    expect(await quizBooks()).toEqual([
      { bookId: 'b2', title: 'Zweites Buch', terms: 2, due: 4 },
      { bookId: 'b1', title: 'Testbuch', terms: 2, due: 4 },
    ])
    for (const i of await loadQuizSession({ limit: 20, newPerDay: 20, bookId: 'b2' })) await recordReview(i.card, Rating.Easy as Grade)
    expect((await quizBooks()).find(b => b.bookId === 'b2')?.due).toBe(0)
    expect((await quizBooks()).find(b => b.bookId === 'b1')?.due).toBe(2)
    expect(await nextDueAt('b2')).toBeGreaterThan(Date.now())
    expect(await nextDueAt('b1')).toBeLessThanOrEqual(Date.now())
    expect(await nextDueAt('b3')).toBeNull()
  })
})
