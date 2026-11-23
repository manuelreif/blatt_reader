import { db, type Term } from '../db/schema'
import { plainSense } from '../lookup/lookupService'
import type { EnrichItem } from './templates'

/**
 * The word's translation is only a dictionary sense (or empty): saved without DeepL, or with
 * DeepL offline. Claude's translation in context is better, so it replaces it without asking.
 */
export function translationFromDictionary(term: Pick<Term, 'translation' | 'dictSenses'>): boolean {
  const t = term.translation.trim()
  return !t || term.dictSenses.some(s => s.de.trim() === t || plainSense(s.de) === t)
}

/**
 * Stores Claude's fields. The translation is replaced where it came from the dictionary;
 * a DeepL or self-typed one only with `overwriteTranslation`.
 */
export async function applyEnrichment(items: EnrichItem[], opts: { overwriteTranslation: boolean }) {
  const now = Date.now()
  await db.transaction('rw', db.terms, async () => {
    for (const it of items) {
      const term = await db.terms.get(it.id)
      if (!term) continue
      await db.terms.put({
        ...term,
        translation: opts.overwriteTranslation || translationFromDictionary(term) ? it.translation_de : term.translation,
        explanationDe: it.explanation_de,
        exampleEn: it.example_en,
        ipa: it.ipa || term.ipa,
        mnemonic: it.mnemonic_de || undefined,
        confusables: it.confusables,
        distractors: it.distractors_de,
        enrichedAt: now,
        updatedAt: now,
      })
    }
  })
}
