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
  /** DeepL failed: fetch the context translation later */
  deeplPending?: boolean
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
          ...(input.deeplPending ? { deeplPending: true } : {}),
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

/**
 * Stores a DeepL translation for a saved context. The word's own translation follows only
 * while it is still the one saved with that context (the dictionary fallback), never over a
 * translation the user typed later. Returns false if the context is gone or, with
 * `onlyIfPending`, no longer waiting for DeepL.
 */
export async function applyContextTranslation(
  where: { id: number } | { termId: string; sentence: string },
  translation: string,
  opts: { onlyIfPending?: boolean } = {},
): Promise<boolean> {
  return db.transaction('rw', db.contexts, db.terms, async () => {
    const ctx =
      'id' in where
        ? await db.contexts.get(where.id)
        : await db.contexts
            .where('termId')
            .equals(where.termId)
            .filter(c => c.sentence === where.sentence.trim())
            .first()
    if (!ctx || (opts.onlyIfPending && !ctx.deeplPending)) return false
    const term = await db.terms.get(ctx.termId)
    if (term && term.translation === (ctx.translation ?? ''))
      await db.terms.update(term.id, { translation, updatedAt: Date.now() })
    await db.contexts.update(ctx.id!, { translation, deeplPending: undefined })
    return true
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

export async function deleteTerm(id: string, now = Date.now()) {
  await db.transaction('rw', [db.terms, db.contexts, db.cards, db.reviewLogs, db.tombstones], async () => {
    await db.terms.delete(id)
    // remembered so that a sync with another device does not bring the word back
    await db.tombstones.put({ id, at: now })
    await db.contexts.where('termId').equals(id).delete()
    await db.cards.where('termId').equals(id).delete()
    await db.reviewLogs.where('termId').equals(id).delete()
  })
}

export async function deleteBook(id: string) {
  await db.transaction('rw', db.books, db.driveFiles, async () => {
    await db.books.delete(id)
    // a book from Google Drive must not come back with the next sync
    await db.driveFiles.where('bookId').equals(id).modify({ state: 'dismissed', updatedAt: Date.now() })
  })
}

export interface QuizItem {
  card: CardRow
  term: Term
  context?: Context
}

function isNewCard(c: CardRow) {
  return c.fsrs.state === 0
}

/** Ids of the words saved with at least one reading context from this book. */
export async function termIdsForBook(bookId: string): Promise<Set<string>> {
  const ids = new Set<string>()
  await db.contexts.where('bookId').equals(bookId).each(c => ids.add(c.termId))
  return ids
}

export interface BookWords {
  bookId: string
  /** title stored with the newest context (the book may be gone from the library) */
  title: string
  termIds: Set<string>
  /** newest context from this book */
  lastAt: number
}

/** Books that words were saved from, most recently read first. */
export async function booksWithWords(): Promise<BookWords[]> {
  const byBook = new Map<string, BookWords>()
  await db.contexts.each(c => {
    const b = byBook.get(c.bookId)
    if (!b) byBook.set(c.bookId, { bookId: c.bookId, title: c.bookTitle, termIds: new Set([c.termId]), lastAt: c.createdAt })
    else {
      b.termIds.add(c.termId)
      if (c.createdAt >= b.lastAt) Object.assign(b, { title: c.bookTitle, lastAt: c.createdAt })
    }
  })
  return [...byBook.values()].sort((a, b) => b.lastAt - a.lastAt)
}

export interface QuizBook {
  bookId: string
  title: string
  /** words from this book that are in the quiz (not ignored or known) */
  terms: number
  /** cards due now, new ones included */
  due: number
}

/** Books with words in the quiz, for the per-book quiz. A word read in two books counts for both. */
export async function quizBooks(now = new Date()): Promise<QuizBook[]> {
  const active = new Set<string>()
  const dueByTerm = new Map<string, number>()
  await db.cards.each(c => {
    if (c.suspended) return
    active.add(c.termId)
    if (c.due <= now.getTime()) dueByTerm.set(c.termId, (dueByTerm.get(c.termId) ?? 0) + 1)
  })
  const out: QuizBook[] = []
  for (const b of await booksWithWords()) {
    let terms = 0
    let due = 0
    for (const id of b.termIds) {
      if (!active.has(id)) continue
      terms++
      due += dueByTerm.get(id) ?? 0
    }
    if (terms) out.push({ bookId: b.bookId, title: b.title, terms, due })
  }
  return out
}

async function dueCards(now: Date, bookId?: string): Promise<CardRow[]> {
  const terms = bookId ? await termIdsForBook(bookId) : null
  return db.cards
    .where('due')
    .belowOrEqual(now.getTime())
    .filter(c => !c.suspended && (!terms || terms.has(c.termId)))
    .sortBy('due')
}

/** When the next card (of this book, if given) is due; null if there is none. */
export async function nextDueAt(bookId?: string): Promise<number | null> {
  const terms = bookId ? await termIdsForBook(bookId) : null
  const first = await db.cards
    .orderBy('due')
    .filter(c => !c.suspended && (!terms || terms.has(c.termId)))
    .first()
  return first?.due ?? null
}

/**
 * Due reviews first, then new cards up to the daily limit. With `bookId` only words saved
 * from that book; the learning state and the daily limit for new cards stay shared.
 */
export async function loadQuizSession(opts: {
  limit: number
  newPerDay: number
  bookId?: string
  now?: Date
}): Promise<QuizItem[]> {
  const now = opts.now ?? new Date()
  const due = await dueCards(now, opts.bookId)
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
    const all = await db.contexts.where('termId').equals(card.termId).toArray()
    // in a book's quiz, show a sentence from that book
    const fromBook = opts.bookId ? all.filter(c => c.bookId === opts.bookId) : []
    const contexts = fromBook.length ? fromBook : all
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

export async function countDue(now = new Date(), bookId?: string): Promise<number> {
  const terms = bookId ? await termIdsForBook(bookId) : null
  return db.cards
    .where('due')
    .belowOrEqual(now.getTime())
    .filter(c => !c.suspended && (!terms || terms.has(c.termId)))
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
      // updatedAt: a sync between devices keeps the word that was reviewed last
      await db.terms.update(card.termId, { status: statusFromStability(minStability), updatedAt: now.getTime() })
    }
  })
  return next
}
