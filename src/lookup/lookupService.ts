import { lookupCandidates } from '../dict/dictionary'
import type { DictSense } from '../db/schema'
import { lemmatize } from '../nlp/lemmatize'

export interface LookupTarget {
  /** text as selected/tapped */
  surface: string
  sentence: string
  cfi?: string
}

export interface DictResult {
  lemma: string
  pos?: string
  matchedKey?: string
  senses: DictSense[]
}

export async function lookupDictionary(target: LookupTarget): Promise<DictResult> {
  const { lemma, pos, candidates } = await lemmatize(target.surface, target.sentence)
  const hit = await lookupCandidates(candidates)
  return {
    lemma: hit && hit.key !== lemma && candidates.indexOf(hit.key) < candidates.indexOf(lemma) ? hit.key : lemma,
    pos: pos ?? hit?.senses[0]?.pos,
    matchedKey: hit?.key,
    senses: hit?.senses ?? [],
  }
}

/** Strips Ding annotations like {m}, [ugs.] for compact display. */
export function plainSense(de: string): string {
  return de
    .replace(/\{[^}]*\}/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s+([;,])/g, '$1')
    .trim()
}
