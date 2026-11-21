import { db } from '../db/schema'
import type { EnrichItem } from './templates'

export async function applyEnrichment(items: EnrichItem[], opts: { overwriteTranslation: boolean }) {
  const now = Date.now()
  await db.transaction('rw', db.terms, async () => {
    for (const it of items) {
      const term = await db.terms.get(it.id)
      if (!term) continue
      await db.terms.put({
        ...term,
        translation: opts.overwriteTranslation || !term.translation ? it.translation_de : term.translation,
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
