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
  it('keeps -ly adverbs instead of their adjective', async () => {
    for (const [word, sentence, adj] of [
      ['jointly', 'We jointly condition on both left and right context.', 'joint'],
      ['hardly', 'We hardly noticed.', 'hard'],
      ['quickly', 'He ran quickly.', 'quick'],
    ]) {
      const r = await lemmatize(word, sentence)
      expect(r.lemma).toBe(word)
      expect(r.pos).toBe('adv')
      expect(r.candidates[0]).toBe(word)
      expect(r.candidates).toContain(adj)
    }
  })
  it('leaves -ly adjectives to compromise', async () => {
    expect((await lemmatize('friendly', 'A friendly dog.')).lemma).toBe('friendly')
  })
  it('keeps hyphenated words as written', async () => {
    for (const [word, sentence] of [
      ['fine-grained', 'This yields fine-grained representations.'],
      ['well-known', 'A well-known result.'],
      ['left-to-right', 'A left-to-right model.'],
      ['state-of-the-art', 'A state-of-the-art model.'],
    ]) {
      const r = await lemmatize(word, sentence)
      expect(r.lemma).toBe(word)
      expect(r.candidates[0]).toBe(word)
      expect(r.candidates.some(c => /\s/.test(c))).toBe(false)
    }
  })
  it('takes the part of speech of a compound from its last part', async () => {
    expect((await lemmatize('well-known', 'A well-known result.')).pos).toBe('adj')
    expect((await lemmatize('self-attention', 'Self-attention layers help.')).pos).toBe('noun')
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
