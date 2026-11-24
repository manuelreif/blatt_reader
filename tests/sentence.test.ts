import { describe, expect, it } from 'vitest'
import { cleanText, dehyphenate, findSentence, hyphenatedWords, normalizeWord, wordAt } from '../src/nlp/sentence'

describe('normalizeWord', () => {
  it('trims punctuation and quotes', () => {
    expect(normalizeWord('“estimator,”')).toBe('estimator')
    expect(normalizeWord('(bias)')).toBe('bias')
  })
  it('drops possessive s and normalizes apostrophes', () => {
    expect(normalizeWord("Bayes’s")).toBe('Bayes')
    expect(normalizeWord("don’t")).toBe("don't")
  })
  it('keeps hyphenated compounds', () => {
    expect(normalizeWord('well-known')).toBe('well-known')
  })
})

describe('dehyphenate', () => {
  it('joins words split at a line end', () => {
    expect(dehyphenate('a statis-\ntical model')).toBe('a statistical model')
  })
  it('keeps hyphens next to capitals and turns line breaks into spaces', () => {
    expect(dehyphenate('non-\nGaussian noise\nhere')).toBe('non-Gaussian noise here')
    expect(dehyphenate('a BERT-\nbased model')).toBe('a BERT-based model')
  })
  it('keeps the hyphen of compounds the text writes with one elsewhere', () => {
    // BERT paper: "fine-\ntuned" at a line end, "fine-tuned" inside a line
    const text = 'can be fine-\ntuned with one layer. All fine-tuned models are pre-\ntrained.'
    const keep = hyphenatedWords(text)
    expect(keep).toEqual(new Set(['fine-tuned']))
    expect(dehyphenate(text, keep)).toBe('can be fine-tuned with one layer. All fine-tuned models are pretrained.')
    expect(findSentence(text, 3).sentence).toBe('can be fine-tuned with one layer.')
    expect(wordAt(text, text.indexOf('tuned'))!.word).toBe('fine-tuned')
    expect(wordAt(text, text.indexOf('trained'))!.word).toBe('pretrained')
  })
  it('takes other forms of the compound as evidence too', () => {
    const keep = new Set(['fine-tuning', 'pre-trained'])
    expect(dehyphenate('is fine-\ntuned and pre-\ntrains a statis-\ntical model', keep)).toBe(
      'is fine-tuned and pre-trains a statistical model',
    )
  })
  it('removes soft hyphens', () => {
    expect(cleanText('esti­mator')).toBe('estimator')
  })
})

describe('findSentence', () => {
  const text = 'The estimator is biased. However, it is consistent! Is it efficient?'
  it('returns the sentence around an offset', () => {
    expect(findSentence(text, text.indexOf('consistent')).sentence).toBe('However, it is consistent!')
    expect(findSentence(text, 0).sentence).toBe('The estimator is biased.')
  })
  it('handles line breaks inside a sentence', () => {
    const pdf = 'We fit a statis-\ntical model\nto the data. Then we stop.'
    expect(findSentence(pdf, 5).sentence).toBe('We fit a statistical model to the data.')
  })
})

describe('wordAt', () => {
  it('finds the word at an offset', () => {
    const t = 'The quick brown fox.'
    expect(wordAt(t, t.indexOf('brown') + 2)?.word).toBe('brown')
  })
  it('accepts a caret right after the word', () => {
    const t = 'quick brown fox'
    expect(wordAt(t, 'quick brown'.length)?.word).toBe('brown')
  })
  it('returns null on whitespace between words', () => {
    expect(wordAt('a  b', 2)).toBeNull()
  })
  it('joins a word hyphenated across lines', () => {
    const t = 'a statis-\ntical model'
    const w = wordAt(t, t.indexOf('tical') + 1)!
    expect(w.word).toBe('statistical')
    expect(t.slice(w.start, w.end)).toBe('statis-\ntical')
  })
  it('keeps hyphenated compounds together', () => {
    const t = 'a well-known result'
    expect(wordAt(t, t.indexOf('known'))?.word).toBe('well-known')
  })
})

describe('paragraph breaks', () => {
  it('keeps a heading out of the following sentence', async () => {
    const { PARAGRAPH_BREAK } = await import('../src/nlp/sentence')
    const t = `Chapter One${PARAGRAPH_BREAK}It was a dark night.`
    expect(findSentence(t, t.indexOf('dark')).sentence).toBe('It was a dark night.')
  })
})
