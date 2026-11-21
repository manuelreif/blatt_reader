import { describe, expect, it } from 'vitest'
import { lemmatize, stemVariants } from '../src/nlp/lemmatize'

describe('lemmatize', () => {
  it('finds base forms using the sentence', async () => {
    expect((await lemmatize('went', 'She went home early.')).lemma).toBe('go')
    expect((await lemmatize('studies', 'Two studies show this.')).lemma).toBe('study')
    expect((await lemmatize('estimators', 'The estimators were biased.')).lemma).toBe('estimator')
  })
  it('reports a part of speech for single words', async () => {
    expect((await lemmatize('running', 'He was running late.')).pos).toBe('verb')
  })
  it('keeps phrases as phrases', async () => {
    const r = await lemmatize('give up', 'Never give up on your dreams.')
    expect(r.lemma).toBe('give up')
    expect(r.pos).toBeUndefined()
  })
  it('offers the surface form as a dictionary candidate', async () => {
    expect((await lemmatize('Heteroscedasticity', '')).candidates).toContain('heteroscedasticity')
  })
})

describe('stemVariants', () => {
  it('covers common inflections', () => {
    expect(stemVariants('studies')).toContain('study')
    expect(stemVariants('stopped')).toContain('stop')
    expect(stemVariants('making')).toContain('make')
    expect(stemVariants('quickly')).toContain('quick')
  })
})
