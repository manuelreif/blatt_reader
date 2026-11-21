import { describe, expect, it } from 'vitest'
import { href, parseHash } from '../src/router'

describe('router', () => {
  it('round-trips the quiz of one book', () => {
    expect(parseHash('#/quiz')).toEqual({ name: 'quiz', bookId: undefined })
    expect(href({ name: 'quiz' })).toBe('#/quiz')
    const route = { name: 'quiz' as const, bookId: 'a/b 1' }
    expect(href(route)).toBe('#/quiz/a%2Fb%201')
    expect(parseHash(href(route))).toEqual(route)
  })
})
