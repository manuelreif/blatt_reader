import { z } from 'zod'
import type { Context, Term } from '../db/schema'

export const enrichItemSchema = z.object({
  id: z.string().min(1),
  translation_de: z.string().trim().min(1),
  explanation_de: z.string().trim().min(1),
  example_en: z.string().trim().min(1),
  ipa: z.string().trim().optional().default(''),
  mnemonic_de: z.string().trim().optional().default(''),
  confusables: z.array(z.string().trim()).max(5).optional().default([]),
  distractors_de: z.array(z.string().trim().min(1)).min(2).max(5),
})

export type EnrichItem = z.infer<typeof enrichItemSchema>

export interface EnrichInput {
  id: string
  word: string
  sentence: string
  source: string
  current_translation: string
}

export function toEnrichInput(term: Term, context?: Context): EnrichInput {
  return {
    id: term.id,
    word: context?.surface && context.surface.toLowerCase() !== term.lemma.toLowerCase()
      ? `${term.lemma} (im Text: ${context.surface})`
      : term.lemma,
    sentence: context?.sentence ?? '',
    source: context?.bookTitle ?? '',
    current_translation: term.translation,
  }
}

export function buildEnrichPrompt(items: EnrichInput[]): string {
  return `Ich lerne Englisch, indem ich englische Bücher und Fachtexte lese. Die folgenden Wörter habe ich beim Lesen nachgeschlagen. Ergänze bitte für jedes Wort:

- "translation_de": die beste deutsche Übersetzung in genau diesem Satz (kurz, 1–4 Wörter)
- "explanation_de": eine kurze Erklärung auf Deutsch (höchstens 2 Sätze), was das Wort hier bedeutet; bei Fachbegriffen das Fachgebiet nennen
- "example_en": ein neuer, natürlicher englischer Beispielsatz mit dem Wort (nicht der Originalsatz)
- "ipa": die Aussprache in IPA (durchgehend britisch oder durchgehend amerikanisch)
- "mnemonic_de": eine kurze Eselsbrücke auf Deutsch, falls eine gute existiert, sonst ""
- "confusables": englische Wörter, die man leicht damit verwechselt (0–3 Stück)
- "distractors_de": genau 3 plausible, aber falsche deutsche Übersetzungen für ein Multiple-Choice-Quiz

Antworte ausschließlich mit einem JSON-Array in einem \`\`\`json-Codeblock: ein Objekt pro Wort, in derselben Reihenfolge, die "id" unverändert übernommen. Kein Text davor oder danach.

Beispiel für ein Objekt:
{"id": "bank", "translation_de": "Ufer", "explanation_de": "Hier das Ufer eines Flusses, nicht das Geldinstitut.", "example_en": "They had a picnic on the bank of the river.", "ipa": "/bæŋk/", "mnemonic_de": "", "confusables": ["bench"], "distractors_de": ["Bank", "Damm", "Brücke"]}

Wörter (${items.length}):
${JSON.stringify(items, null, 1)}`
}

export function buildFixPrompt(problems: { id?: string; error: string }[]): string {
  return `Einige Einträge deiner letzten Antwort waren ungültig:
${problems.map(p => `- ${p.id ?? '(ohne id)'}: ${p.error}`).join('\n')}

Bitte gib nur diese Einträge korrigiert aus, wieder als JSON-Array in einem \`\`\`json-Codeblock mit denselben Feldern und ids.`
}
