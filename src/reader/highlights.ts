// Marked passages: stored in db.highlights, drawn with the CSS Custom Highlight API
// (works the same for EPUB sections and PDF text layers). A mark is anchored by its
// offsets in the section text; if the text moved, the nearest occurrence of the
// marked text is used instead.
import { db, HIGHLIGHT_COLORS, type Highlight, type HighlightColor } from '../db/schema'
import { cleanText } from '../nlp/sentence'
import { buildBlockText, rangeContainsPoint, rangeFromOffsets } from './selection'

const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 10)

export type NewHighlight = Pick<Highlight, 'bookId' | 'bookTitle' | 'section' | 'start' | 'end' | 'text' | 'cfi' | 'color'> &
  Partial<Pick<Highlight, 'note'>>

export async function addHighlight(fields: NewHighlight): Promise<Highlight> {
  const now = Date.now()
  const h: Highlight = { ...fields, id: newId(), createdAt: now, updatedAt: now }
  await db.highlights.add(h)
  return h
}

export async function updateHighlight(id: string, patch: Partial<Pick<Highlight, 'color' | 'note'>>) {
  await db.highlights.update(id, { ...patch, updatedAt: Date.now() })
}

/** Soft delete: the row stays (marked deleted), so a sync does not bring it back. */
export async function deleteHighlight(id: string) {
  await db.highlights.update(id, { deleted: true, note: undefined, updatedAt: Date.now() })
}

export const byPosition = (a: Highlight, b: Highlight) => a.section - b.section || a.start - b.start

/** Live marks of a book in reading order. */
export async function bookHighlights(bookId: string): Promise<Highlight[]> {
  const list = await db.highlights.where('bookId').equals(bookId).toArray()
  return list.filter(h => !h.deleted).sort(byPosition)
}

/** Marked text for display (line breaks and hyphenation at line ends removed). */
export const displayText = (h: Pick<Highlight, 'text'>) => cleanText(h.text)

/** Where a mark is in the section text now: its offsets, else the nearest occurrence of its text. */
export function anchorIn(text: string, h: Pick<Highlight, 'start' | 'end' | 'text'>): { start: number; end: number } | null {
  if (!h.text) return null
  if (text.slice(h.start, h.end) === h.text) return { start: h.start, end: h.end }
  let best = -1
  for (let i = text.indexOf(h.text); i >= 0; i = text.indexOf(h.text, i + 1))
    if (best < 0 || Math.abs(i - h.start) < Math.abs(best - h.start)) best = i
  return best < 0 ? null : { start: best, end: best + h.text.length }
}

const painted = new WeakMap<Document, { id: string; range: Range }[]>()
const NOTE = 'vr-hl-note'

/** Draws the marks of one section into its document (replaces what was drawn before). */
export function paintHighlights(doc: Document, list: Highlight[]) {
  const win = doc.defaultView as (Window & typeof globalThis) | null
  const registry = win?.CSS?.highlights
  const drawn: { id: string; range: Range }[] = []
  const byColor = new Map<HighlightColor, Range[]>()
  const noted: Range[] = []
  if (doc.body && list.length) {
    const bt = buildBlockText(doc.body)
    for (const h of list) {
      const at = anchorIn(bt.text, h)
      const range = at && rangeFromOffsets(bt, at.start, at.end)
      if (!range) continue
      drawn.push({ id: h.id, range })
      byColor.set(h.color, [...(byColor.get(h.color) ?? []), range])
      if (h.note?.trim()) noted.push(range)
    }
  }
  painted.set(doc, drawn)
  if (!registry || !win?.Highlight) return
  for (const c of HIGHLIGHT_COLORS) {
    const ranges = byColor.get(c)
    if (ranges?.length) registry.set(`vr-hl-${c}`, new win.Highlight(...ranges))
    else registry.delete(`vr-hl-${c}`)
  }
  if (noted.length) registry.set(NOTE, new win.Highlight(...noted))
  else registry.delete(NOTE)
}

/** Where a mark is drawn in this document right now. */
export const drawnRange = (doc: Document, id: string): Range | null => painted.get(doc)?.find(d => d.id === id)?.range ?? null

/** The drawn mark at a point (the most recently drawn one if they overlap). */
export function highlightAt(doc: Document, x: number, y: number): { id: string; range: Range } | null {
  const drawn = painted.get(doc) ?? []
  for (let i = drawn.length - 1; i >= 0; i--) if (rangeContainsPoint(drawn[i].range, x, y, 1)) return drawn[i]
  return null
}
