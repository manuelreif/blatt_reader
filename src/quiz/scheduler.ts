import { createEmptyCard, fsrs, generatorParameters, Rating, type Card, type Grade } from 'ts-fsrs'
import { STATUS_KNOWN } from '../db/schema'

export { Rating }
export type { Grade }

const scheduler = fsrs(generatorParameters({ enable_fuzz: true, request_retention: 0.9 }))

export function newCard(now = new Date()): Card {
  return createEmptyCard(now)
}

export function review(card: Card, rating: Grade, now = new Date()) {
  const { card: next, log } = scheduler.next(card, now, rating)
  return { next, log }
}

/** Due date for each possible rating, e.g. to label the buttons. */
export function preview(card: Card, now = new Date()): Record<Grade, Date> {
  const grades = [Rating.Again, Rating.Hard, Rating.Good, Rating.Easy] as Grade[]
  return Object.fromEntries(grades.map(g => [g, scheduler.next(card, now, g).card.due])) as Record<Grade, Date>
}

export function formatInterval(from: Date, to: Date): string {
  const min = Math.max(1, Math.round((to.getTime() - from.getTime()) / 60000))
  if (min < 60) return `${min} min`
  const h = Math.round(min / 60)
  if (h < 24) return `${h} h`
  const d = Math.round(h / 24)
  if (d < 31) return `${d} T`
  const m = Math.round(d / 30)
  if (m < 12) return `${m} Mon`
  return `${(d / 365).toFixed(1)} J`
}

/** Learning status 1–5 (LingQ-style) from the card's stability in days. */
export function statusFromStability(stabilityDays: number): number {
  if (stabilityDays >= 90) return STATUS_KNOWN
  if (stabilityDays >= 21) return 5
  if (stabilityDays >= 7) return 4
  if (stabilityDays >= 3) return 3
  if (stabilityDays >= 1) return 2
  return 1
}
