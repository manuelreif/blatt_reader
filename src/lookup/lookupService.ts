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
  /** no senses found, but part of the dictionary could not be loaded (offline) */
  unavailable?: boolean
}

export async function lookupDictionary(target: LookupTarget): Promise<DictResult> {
  const { lemma, pos, candidates } = await lemmatize(target.surface, target.sentence)
  const { hit, unavailable } = await lookupCandidates(candidates)
  return {
    lemma: hit && hit.key !== lemma && candidates.indexOf(hit.key) < candidates.indexOf(lemma) ? hit.key : lemma,
    pos: pos ?? hit?.senses[0]?.pos,
    matchedKey: hit?.key,
    senses: hit?.senses ?? [],
    ...(!hit && unavailable ? { unavailable: true } : {}),
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
