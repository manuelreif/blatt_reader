import { describe, expect, it } from 'vitest'
import { formatInterval, newCard, preview, Rating, review, statusFromStability, type Grade } from '../src/quiz/scheduler'

describe('scheduler', () => {
  const now = new Date('2026-01-01T10:00:00Z')

  it('moves the due date forward after a good answer', () => {
    const { next } = review(newCard(now), Rating.Good as Grade, now)
    expect(next.due.getTime()).toBeGreaterThan(now.getTime())
    expect(next.reps).toBe(1)
  })

  it('orders intervals again < hard <= good < easy', () => {
    const p = preview(newCard(now), now)
    const t = (g: number) => p[g as Grade].getTime()
    expect(t(Rating.Again)).toBeLessThanOrEqual(t(Rating.Hard))
    expect(t(Rating.Hard)).toBeLessThanOrEqual(t(Rating.Good))
    expect(t(Rating.Good)).toBeLessThan(t(Rating.Easy))
  })

  it('formats intervals', () => {
    expect(formatInterval(now, new Date(now.getTime() + 10 * 60000))).toBe('10 min')
    expect(formatInterval(now, new Date(now.getTime() + 3 * 86400000))).toBe('3 T')
  })

  it('derives the learning status from stability', () => {
    expect(statusFromStability(0.3)).toBe(1)
    expect(statusFromStability(5)).toBe(3)
    expect(statusFromStability(30)).toBe(5)
    expect(statusFromStability(120)).toBe(6)
  })
})
