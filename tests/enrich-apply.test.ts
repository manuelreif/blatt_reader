import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { saveLookup } from '../src/db/repo'
import { db } from '../src/db/schema'
import { applyEnrichment, translationFromDictionary } from '../src/enrich/apply'
import type { EnrichItem } from '../src/enrich/templates'

const book = { id: 'b1', title: 'Testbuch' }
const senses = [{ de: 'Kalkulationsingenieur {m}; Kalkulationsingenieurin {f}' }, { de: 'Schätzfunktion {f} [statist.]' }]
const save = (translation?: string) =>
  saveLookup({ lemma: 'estimator', surface: 'estimator', sentence: 'The estimator was biased.', translation, dictSenses: senses, book, cardTypes: ['en-de'] })

const item: EnrichItem = {
  id: 'estimator',
  translation_de: 'Schätzer',
  explanation_de: 'Eine Funktion der Daten, die einen Parameter schätzt.',
  example_en: 'The sample mean is an unbiased estimator.',
  ipa: '',
  mnemonic_de: '',
  confusables: [],
  distractors_de: ['Schätzung', 'Gutachten', 'Rechner'],
}

beforeEach(async () => {
  await Promise.all(db.tables.map(t => t.clear()))
})

describe('translationFromDictionary', () => {
  it('recognizes dictionary senses with or without Ding annotations, and empty translations', () => {
    expect(translationFromDictionary({ translation: 'Kalkulationsingenieur; Kalkulationsingenieurin', dictSenses: senses })).toBe(true)
    expect(translationFromDictionary({ translation: 'Schätzfunktion {f} [statist.]', dictSenses: senses })).toBe(true)
    expect(translationFromDictionary({ translation: '', dictSenses: [] })).toBe(true)
    expect(translationFromDictionary({ translation: 'Schätzer', dictSenses: senses })).toBe(false)
  })
})

describe('applyEnrichment', () => {
  it("replaces a translation from the dictionary with Claude's", async () => {
    await save('Kalkulationsingenieur; Kalkulationsingenieurin')
    await applyEnrichment([item], { overwriteTranslation: false })
    expect(await db.terms.get('estimator')).toMatchObject({ translation: 'Schätzer', explanationDe: item.explanation_de })
  })

  it('keeps a DeepL or self-typed translation unless asked to overwrite', async () => {
    await save('Schätzwert')
    await applyEnrichment([item], { overwriteTranslation: false })
    expect((await db.terms.get('estimator'))?.translation).toBe('Schätzwert')
    await applyEnrichment([item], { overwriteTranslation: true })
    expect((await db.terms.get('estimator'))?.translation).toBe('Schätzer')
  })
})
