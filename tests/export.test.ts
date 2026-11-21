import { describe, expect, it } from 'vitest'
import { toCsv } from '../src/vocab/export'

describe('toCsv', () => {
  it('quotes cells with commas, quotes and line breaks', () => {
    expect(toCsv([['a', 'b,c', 'say "hi"', 'x\ny', undefined, 3]])).toBe('a,"b,c","say ""hi""","x\ny",,3\n')
  })
})
