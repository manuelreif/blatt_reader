import type nlpType from 'compromise'
import { normalizeWord } from './sentence'

export interface LemmaInfo {
  /** base form, lowercase ("went" → "go") */
  lemma: string
  /** coarse part of speech from compromise */
  pos?: string
  /** further spellings to try in the dictionary */
  candidates: string[]
}

const POS_ORDER: [string, string][] = [
  ['Verb', 'verb'],
  ['Noun', 'noun'],
  ['Adjective', 'adj'],
  ['Adverb', 'adv'],
  ['Preposition', 'prep'],
  ['Conjunction', 'conj'],
  ['Pronoun', 'pron'],
]

type Nlp = typeof nlpType

// compromise is ~350 kB; load it with the first lookup instead of at startup
let nlpModule: Promise<Nlp> | null = null
const loadNlp = () => (nlpModule ??= import('compromise').then(m => m.default))

function rootInSentence(nlp: Nlp, surface: string, sentence: string): { root?: string; tags: string[] } {
  try {
    const doc = nlp(sentence || surface)
    doc.compute('root')
    let match = doc.match(surface.replace(/[^\p{L}\p{N}' -]/gu, ' ').trim())
    if (!match.found) {
      const alone = nlp(surface)
      alone.compute('root')
      match = alone
    }
    const json = match.json() as { terms?: { tags?: string[] }[] }[]
    const tags = json[0]?.terms?.flatMap(t => t.tags ?? []) ?? []
    const root = match.text('root').trim().toLowerCase()
    return { root: root || undefined, tags }
  } catch {
    return { tags: [] }
  }
}

/** Simple suffix rules as a fallback for words compromise does not know. */
export function stemVariants(word: string): string[] {
  const w = word.toLowerCase()
  const out: string[] = []
  const add = (s: string) => s.length > 1 && s !== w && out.push(s)
  if (w.endsWith('ies')) add(w.slice(0, -3) + 'y')
  if (w.endsWith('es')) add(w.slice(0, -2))
  if (w.endsWith('s') && !w.endsWith('ss')) add(w.slice(0, -1))
  if (w.endsWith('ied')) add(w.slice(0, -3) + 'y')
  if (w.endsWith('ed')) {
    add(w.slice(0, -2))
    add(w.slice(0, -1))
    if (/(.)\1ed$/.test(w)) add(w.slice(0, -3))
  }
  if (w.endsWith('ing')) {
    add(w.slice(0, -3))
    add(w.slice(0, -3) + 'e')
    if (/(.)\1ing$/.test(w)) add(w.slice(0, -4))
  }
  if (w.endsWith('ly')) add(w.slice(0, -2))
  if (w.endsWith('er')) add(w.slice(0, -2))
  if (w.endsWith('est')) add(w.slice(0, -3))
  return [...new Set(out)]
}

export async function lemmatize(surface: string, sentence = ''): Promise<LemmaInfo> {
  const word = normalizeWord(surface)
  const lower = word.toLowerCase()
  const isPhrase = /\s/.test(word)
  const { root, tags } = rootInSentence(await loadNlp(), word, sentence)
  const pos = isPhrase ? undefined : POS_ORDER.find(([tag]) => tags.includes(tag))?.[1]
  const lemma = root && (!isPhrase || root.split(' ').length === lower.split(' ').length) ? root : lower
  const candidates = [...new Set([lemma, lower, ...(isPhrase ? [] : stemVariants(lower))])]
  return { lemma, pos, candidates }
}
