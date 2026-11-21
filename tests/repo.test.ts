import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { countDue, deleteTerm, loadQuizSession, recordReview, saveLookup, setTermStatus } from '../src/db/repo'
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
