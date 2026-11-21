import { enrichItemSchema, type EnrichItem } from './templates'

export interface ImportProblem {
  index: number
  id?: string
  error: string
}

export interface ImportResult {
  valid: EnrichItem[]
  invalid: ImportProblem[]
  /** ids in the answer that were not part of the batch */
  unknownIds: string[]
  /** batch ids missing from the answer */
  missingIds: string[]
  /** true if the JSON was cut off and had to be repaired */
  truncated: boolean
}

export class ParseError extends Error {}

/** Takes the JSON part out of a pasted chat answer. */
export function extractJson(text: string): { value: unknown; truncated: boolean } {
  const fence = /```(?:json|JSON)?\s*\n?([\s\S]*?)(?:```|$)/.exec(text)
  const body = (fence ? fence[1] : text).trim()
  const start = body.search(/[[{]/)
  if (start < 0) throw new ParseError('Kein JSON in der Antwort gefunden')
  const candidate = body.slice(start)
  try {
    return { value: JSON.parse(candidate), truncated: false }
  } catch {
    // text after the JSON, e.g. a closing remark
    const end = Math.max(candidate.lastIndexOf(']'), candidate.lastIndexOf('}'))
    if (end > 0) {
      try {
        return { value: JSON.parse(candidate.slice(0, end + 1)), truncated: false }
      } catch {
        /* fall through to repair */
      }
    }
    // cut off mid-answer: keep complete objects
    if (candidate.startsWith('[')) {
      const lastObj = candidate.lastIndexOf('}')
      if (lastObj > 0) {
        try {
          return { value: JSON.parse(candidate.slice(0, lastObj + 1) + ']'), truncated: true }
        } catch {
          /* give up */
        }
      }
    }
    throw new ParseError('Das JSON in der Antwort ist fehlerhaft und konnte nicht repariert werden')
  }
}

export function parseEnrichResponse(text: string, batchIds: string[]): ImportResult {
  const { value, truncated } = extractJson(text)
  const list = Array.isArray(value) ? value : [value]
  const batch = new Set(batchIds)
  const seen = new Set<string>()
  const valid: EnrichItem[] = []
  const invalid: ImportProblem[] = []
  const unknownIds: string[] = []
  list.forEach((raw, index) => {
    const id = raw && typeof raw === 'object' && 'id' in raw ? String((raw as { id: unknown }).id) : undefined
    if (id !== undefined && !batch.has(id)) {
      unknownIds.push(id)
      return
    }
    const parsed = enrichItemSchema.safeParse(raw)
    if (!parsed.success) {
      const error = parsed.error.issues.map(i => `${i.path.join('.') || 'Eintrag'}: ${i.message}`).join('; ')
      invalid.push({ index, id, error })
      return
    }
    if (seen.has(parsed.data.id)) return
    seen.add(parsed.data.id)
    valid.push(parsed.data)
  })
  const missingIds = batchIds.filter(id => !seen.has(id) && !invalid.some(p => p.id === id))
  return { valid, invalid, unknownIds, missingIds, truncated }
}
