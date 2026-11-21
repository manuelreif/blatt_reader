// Text helpers for finding the looked-up word and its sentence.
// Block text uses "\n" for line ends inside a paragraph (PDF text layers), so words
// hyphenated across lines ("statis-\ntical") can be joined again, and
// PARAGRAPH_BREAK between block elements (headings, paragraphs).

export const PARAGRAPH_BREAK = '\u2029'

const SOFT_HYPHEN = /­/g
const EDGE_PUNCT = /^[\s"'“”‘’«»„()[\]{}<>.,;:!?…–—-]+|[\s"'“”‘’«»„()[\]{}<>.,;:!?…–—-]+$/g

const sentenceSegmenter = new Intl.Segmenter('en', { granularity: 'sentence' })
const wordSegmenter = new Intl.Segmenter('en', { granularity: 'word' })

/** Joins words hyphenated at a line end and turns remaining line breaks into spaces. */
export function dehyphenate(text: string): string {
  return text
    .replace(SOFT_HYPHEN, '')
    .replace(/(\p{Ll})-\n(\p{Ll})/gu, '$1$2')
    .replace(/\s*\n\s*/g, ' ')
}

export function cleanText(text: string): string {
  return dehyphenate(text).replace(/\s+/g, ' ').trim()
}

/** Trims quotes and punctuation, normalizes apostrophes and whitespace. */
export function normalizeWord(word: string): string {
  return cleanText(word).replace(/[’‘`]/g, "'").replace(EDGE_PUNCT, '').replace(/'s$/i, '')
}

export interface Span {
  start: number
  end: number
}

/** The sentence around `offset` in `text`. */
export function findSentence(text: string, offset: number): Span & { sentence: string } {
  // Intl.Segmenter ends a sentence at every "\n"; PDF lines are not sentences.
  // Same length, so offsets stay valid.
  const flat = text.replace(/\n/g, ' ')
  for (const seg of sentenceSegmenter.segment(flat)) {
    const end = seg.index + seg.segment.length
    if (offset >= seg.index && offset < end) {
      return { start: seg.index, end, sentence: cleanText(text.slice(seg.index, end)) }
    }
  }
  return { start: 0, end: text.length, sentence: cleanText(text) }
}

/**
 * The word at `offset`. Joins "statis-\ntical" (hyphen at a line end) and keeps
 * hyphenated compounds ("well-known") together. If `offset` sits right after a
 * word (caret at its end), that word is returned.
 */
export function wordAt(text: string, offset: number): (Span & { word: string }) | null {
  const segs = [...wordSegmenter.segment(text)]
  const find = (o: number) => segs.findIndex(s => o >= s.index && o < s.index + s.segment.length && s.isWordLike)
  let i = find(offset)
  if (i < 0) i = find(offset - 1)
  if (i < 0) return null
  const joinable = (sep: string) => /^(-|\u00ad)\n?$/.test(sep)
  const sepAfter = (w: number) => {
    let j = w + 1
    let sep = ''
    while (j < segs.length && !segs[j].isWordLike) sep += segs[j++].segment
    return { sep, next: j < segs.length ? j : -1 }
  }
  const sepBefore = (w: number) => {
    let j = w - 1
    let sep = ''
    while (j >= 0 && !segs[j].isWordLike) sep = segs[j--].segment + sep
    return { sep, prev: j }
  }
  let first = i
  let last = i
  for (let a = sepAfter(last); a.next > 0 && joinable(a.sep); a = sepAfter(last)) last = a.next
  for (let b = sepBefore(first); b.prev >= 0 && joinable(b.sep); b = sepBefore(first)) first = b.prev
  const start = segs[first].index
  const end = segs[last].index + segs[last].segment.length
  return { start, end, word: normalizeWord(text.slice(start, end)) }
}
