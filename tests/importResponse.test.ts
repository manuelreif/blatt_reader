import { describe, expect, it } from 'vitest'
import { extractJson, ParseError, parseEnrichResponse } from '../src/enrich/importResponse'
import { buildEnrichPrompt, buildFixPrompt } from '../src/enrich/templates'

const item = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  translation_de: 'Schätzer',
  explanation_de: 'Eine Funktion der Stichprobe.',
  example_en: 'This estimator is unbiased.',
  ipa: '/ˈɛstɪmeɪtə/',
  mnemonic_de: '',
  confusables: ['estimate'],
  distractors_de: ['Schätzung', 'Gutachter', 'Rechner'],
  ...extra,
})

describe('extractJson', () => {
  it('reads a ```json block with text around it', () => {
    const text = 'Gern! Hier:\n```json\n[{"a":1}]\n```\nViel Erfolg!'
    expect(extractJson(text)).toEqual({ value: [{ a: 1 }], truncated: false })
  })
  it('reads bare JSON followed by a remark', () => {
    expect(extractJson('[{"a":1}] Hoffe, das hilft.').value).toEqual([{ a: 1 }])
  })
  it('repairs an answer that was cut off', () => {
    const r = extractJson('```json\n[{"a":1},{"a":2},{"a":')
    expect(r).toEqual({ value: [{ a: 1 }, { a: 2 }], truncated: true })
  })
  it('throws on text without JSON', () => {
    expect(() => extractJson('Tut mir leid, das kann ich nicht.')).toThrow(ParseError)
  })
})

describe('parseEnrichResponse', () => {
  it('validates entries and matches them to the batch', () => {
    const answer = '```json\n' + JSON.stringify([item('estimator'), item('bias'), item('stranger')]) + '\n```'
    const r = parseEnrichResponse(answer, ['estimator', 'bias', 'variance'])
    expect(r.valid.map(v => v.id)).toEqual(['estimator', 'bias'])
    expect(r.unknownIds).toEqual(['stranger'])
    expect(r.missingIds).toEqual(['variance'])
    expect(r.invalid).toEqual([])
  })
  it('reports invalid entries with a reason', () => {
    const answer = JSON.stringify([item('estimator', { distractors_de: ['nur eins'] }), item('bias', { explanation_de: '' })])
    const r = parseEnrichResponse(answer, ['estimator', 'bias'])
    expect(r.valid).toEqual([])
    expect(r.invalid.map(p => p.id)).toEqual(['estimator', 'bias'])
    expect(r.invalid[0].error).toMatch(/distractors_de/)
    expect(r.missingIds).toEqual([])
  })
  it('fills optional fields with defaults', () => {
    const { ipa: _i, mnemonic_de: _m, confusables: _c, ...minimal } = item('bias')
    const r = parseEnrichResponse(JSON.stringify([minimal]), ['bias'])
    expect(r.valid[0]).toMatchObject({ ipa: '', mnemonic_de: '', confusables: [] })
  })
  it('accepts a single object instead of an array', () => {
    expect(parseEnrichResponse(JSON.stringify(item('bias')), ['bias']).valid).toHaveLength(1)
  })
  it('unwraps an array inside an object (JSON mode of some models)', () => {
    const r = parseEnrichResponse(JSON.stringify({ words: [item('bias'), item('variance')] }), ['bias', 'variance'])
    expect(r.valid.map(v => v.id)).toEqual(['bias', 'variance'])
  })
})

describe('prompts', () => {
  it('includes ids, sentences and the answer format', () => {
    const p = buildEnrichPrompt([
      { id: 'bias', word: 'bias', sentence: 'The estimator has a small bias.', source: 'Paper', current_translation: 'Verzerrung' },
    ])
    expect(p).toContain('"id": "bias"')
    expect(p).toContain('The estimator has a small bias.')
    expect(p).toContain('```json')
  })
  it('lists problems in the fix prompt', () => {
    expect(buildFixPrompt([{ id: 'bias', error: 'example_en fehlt' }])).toContain('bias: example_en fehlt')
  })
})
