import type { Grade } from 'ts-fsrs'
import {
  db,
  STATUS_IGNORED,
  STATUS_KNOWN,
  type CardRow,
  type CardType,
  type Context,
  type DictSense,
  type Term,
} from './schema'
import { newCard, review, statusFromStability } from '../quiz/scheduler'

export function termKey(lemma: string): string {
  return lemma.trim().toLowerCase().replace(/\s+/g, ' ')
}

export interface SaveLookupInput {
  lemma: string
  surface: string
  sentence: string
  translation?: string
  dictSenses: DictSense[]
  pos?: string
  book: { id: string; title: string }
  cfi?: string
  cardTypes: CardType[]
  status?: number
  now?: number
}

export interface SaveLookupResult {
  term: Term
  isNew: boolean
  contextAdded: boolean
}

/** Creates or updates the term, adds the reading context and the quiz cards. */
export async function saveLookup(input: SaveLookupInput): Promise<SaveLookupResult> {
  const now = input.now ?? Date.now()
  const id = termKey(input.lemma)
  const surface = input.surface.trim()
  return db.transaction('rw', db.terms, db.contexts, db.cards, async () => {
    const existing = await db.terms.get(id)
    let term: Term
    if (existing) {
      const forms = existing.forms.includes(surface.toLowerCase())
        ? existing.forms
        : [...existing.forms, surface.toLowerCase()]
      term = {
        ...existing,
        forms,
        translation: existing.translation || input.translation || input.dictSenses[0]?.de || '',
        dictSenses: existing.dictSenses.length ? existing.dictSenses : input.dictSenses,
        pos: existing.pos ?? input.pos,
        status: input.status ?? existing.status,
        updatedAt: now,
      }
    } else {
      term = {
        id,
        lemma: input.lemma.trim(),
        forms: [surface.toLowerCase()],
        translation: input.translation || input.dictSenses[0]?.de || '',
        dictSenses: input.dictSenses,
        pos: input.pos,
        status: input.status ?? 1,
        tags: [],
        createdAt: now,
        updatedAt: now,
      }
    }
    await db.terms.put(term)

    let contextAdded = false
    const sentence = input.sentence.trim()
    if (sentence) {
      const dup = await db.contexts.where('termId').equals(id).filter(c => c.sentence === sentence).first()
      if (!dup) {
        const ctx: Context = {
          termId: id,
          bookId: input.book.id,
          bookTitle: input.book.title,
          surface,
          sentence,
          cfi: input.cfi,
          translation: input.translation,
          createdAt: now,
        }
        await db.contexts.add(ctx)
        contextAdded = true
      }
    }

    if (term.status !== STATUS_IGNORED) await ensureCards(id, input.cardTypes, new Date(now))
    return { term, isNew: !existing, contextAdded }
  })
}

export async function ensureCards(termId: string, types: CardType[], now = new Date()) {
  for (const type of types) {
    const cardId = `${termId}|${type}`
    if (await db.cards.get(cardId)) continue
    const fsrs = newCard(now)
    await db.cards.put({ id: cardId, termId, type, due: fsrs.due.getTime(), fsrs })
  }
}

export async function updateTerm(id: string, patch: Partial<Term>) {
  await db.terms.update(id, { ...patch, updatedAt: Date.now() })
}

/** Ignored or known words leave the quiz; others get their cards back. */
export async function setTermStatus(id: string, status: number, cardTypes: CardType[]) {
  await db.transaction('rw', db.terms, db.cards, async () => {
    await db.terms.update(id, { status, updatedAt: Date.now() })
    const suspended = status === STATUS_IGNORED || status === STATUS_KNOWN
    await db.cards.where('termId').equals(id).modify({ suspended })
    if (!suspended) await ensureCards(id, cardTypes)
  })
}

export async function deleteTerm(id: string) {
  await db.transaction('rw', [db.terms, db.contexts, db.cards, db.reviewLogs], async () => {
    await db.terms.delete(id)
    await db.contexts.where('termId').equals(id).delete()
    await db.cards.where('termId').equals(id).delete()
    await db.reviewLogs.where('termId').equals(id).delete()
  })
}

export async function deleteBook(id: string) {
  await db.books.delete(id)
}

export interface QuizItem {
  card: CardRow
  term: Term
  context?: Context
}

function isNewCard(c: CardRow) {
  return c.fsrs.state === 0
}

/** Due reviews first, then new cards up to the daily limit. */
export async function loadQuizSession(opts: { limit: number; newPerDay: number; now?: Date }): Promise<QuizItem[]> {
  const now = opts.now ?? new Date()
  const due = await db.cards
    .where('due')
    .belowOrEqual(now.getTime())
    .filter(c => !c.suspended)
    .sortBy('due')
  const startOfDay = new Date(now)
  startOfDay.setHours(0, 0, 0, 0)
  const newToday = await db.reviewLogs
    .where('reviewedAt')
    .aboveOrEqual(startOfDay.getTime())
    .filter(l => l.state === 0)
    .count()
  const newBudget = Math.max(0, opts.newPerDay - newToday)
  const reviews = due.filter(c => !isNewCard(c))
  const fresh = due.filter(isNewCard).slice(0, newBudget)
  const cards = [...reviews, ...fresh].slice(0, opts.limit)
  // don't show two cards of the same word back to back if avoidable
  const items: QuizItem[] = []
  for (const card of cards) {
    const term = await db.terms.get(card.termId)
    if (!term) continue
    const contexts = await db.contexts.where('termId').equals(card.termId).toArray()
    const context = contexts.length ? contexts[Math.floor(Math.random() * contexts.length)] : undefined
    items.push({ card, term, context })
  }
  return spreadSiblings(items)
}

function spreadSiblings(items: QuizItem[]): QuizItem[] {
  const out: QuizItem[] = []
  const rest = [...items]
  while (rest.length) {
    const prev = out[out.length - 1]
    const i = rest.findIndex(x => x.term.id !== prev?.term.id)
    out.push(...rest.splice(i < 0 ? 0 : i, 1))
  }
  return out
}

export async function countDue(now = new Date()): Promise<number> {
  return db.cards
    .where('due')
    .belowOrEqual(now.getTime())
    .filter(c => !c.suspended)
    .count()
}

/** Applies a rating, logs it and updates the word's learning status. */
export async function recordReview(card: CardRow, rating: Grade, opts: { now?: Date; answerMs?: number } = {}) {
  const now = opts.now ?? new Date()
  const { next, log } = review(card.fsrs, rating, now)
  await db.transaction('rw', db.cards, db.reviewLogs, db.terms, async () => {
    await db.cards.update(card.id, { fsrs: next, due: next.due.getTime() })
    await db.reviewLogs.add({
      cardId: card.id,
      termId: card.termId,
      cardType: card.type,
      rating: log.rating,
      state: log.state,
      reviewedAt: now.getTime(),
      scheduledDays: next.scheduled_days,
      stability: next.stability,
      difficulty: next.difficulty,
      answerMs: opts.answerMs,
    })
    const term = await db.terms.get(card.termId)
    if (term && term.status !== STATUS_IGNORED) {
      const siblings = await db.cards.where('termId').equals(card.termId).toArray()
      const minStability = Math.min(...siblings.map(c => (c.id === card.id ? next.stability : c.fsrs.stability)))
      await db.terms.update(card.termId, { status: statusFromStability(minStability) })
    }
  })
  return next
}
