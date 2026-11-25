import { describe, expect, it, vi } from 'vitest'

// Tiny stand-in for the Ding shards: only these keys have entries.
const entries: Record<string, string> = {
  jointly: 'gemeinschaftlich {adv}',
  joint: 'ausfugen {vt}',
  'fine-grained': 'feinkörnig {adj}',
  'fine-tune': 'feinabstimmen {vt}',
  hard: 'hart {adj}',
}
vi.mock('../src/dict/dictionary', () => ({
  lookupCandidates: async (candidates: string[]) => {
    const key = candidates.find(c => c in entries)
    return { hit: key ? { key, senses: [{ de: entries[key] }] } : null, unavailable: false }
  },
}))

const { lookupDictionary } = await import('../src/lookup/lookupService')
const look = (surface: string, sentence: string) => lookupDictionary({ surface, sentence })

describe('lookupDictionary', () => {
  it('translates an adverb as the adverb, not its adjective', async () => {
    const r = await look('jointly', 'We jointly condition on both left and right context.')
    expect(r.lemma).toBe('jointly')
    expect(r.senses[0].de).toContain('gemeinschaftlich')
  })
  it('falls back to the adjective but keeps the adverb as the term', async () => {
    const r = await look('hardly', 'We hardly noticed.')
    expect(r.lemma).toBe('hardly')
    expect(r.matchedKey).toBe('hard')
  })
  it('keeps the hyphen in lemma and dictionary key', async () => {
    const r = await look('fine-grained', 'This yields fine-grained representations.')
    expect(r.lemma).toBe('fine-grained')
    expect(r.matchedKey).toBe('fine-grained')
  })
  it('finds the base form of a hyphenated verb via stem variants', async () => {
    const r = await look('fine-tuned', 'The model is fine-tuned on each task.')
    expect(r.lemma).toBe('fine-tuned')
    expect(r.matchedKey).toBe('fine-tune')
  })
})
