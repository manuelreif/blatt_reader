// Finds the tapped or selected word and its sentence inside a book document
// (an EPUB section or a PDF.js text layer, both rendered by foliate-js in iframes).
import type { HighlightColor } from '../db/schema'
import { cleanText, findSentence, hyphenatedWords, normalizeWord, PARAGRAPH_BREAK, wordAt } from '../nlp/sentence'
import { createGestureTracker, createPressTracker, LONG_PRESS_MS, type ReaderMode, type TouchSample } from './modes'

const BLOCK = new Set([
  'p', 'div', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'td', 'th', 'dd', 'dt',
  'figcaption', 'section', 'article', 'aside', 'pre', 'body', 'tr', 'caption', 'header', 'footer',
  'main', 'ul', 'ol', 'table', 'dl', 'figure',
])
const SKIP = new Set(['script', 'style', 'rt', 'rp', 'noscript'])

export interface BlockText {
  text: string
  nodes: { node: Text; start: number }[]
}

export interface LookupHit {
  surface: string
  sentence: string
  range: Range
}

export function blockOf(node: Node): Element {
  const el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement
  if (!el) return node.ownerDocument!.documentElement
  const textLayer = el.closest('.textLayer')
  if (textLayer) return textLayer
  let cur: Element | null = el
  while (cur && !BLOCK.has(cur.localName)) cur = cur.parentElement
  return cur ?? el.ownerDocument.body ?? el
}

/** Extent of the current line of a PDF text layer. */
export interface LineBox {
  top: number
  bottom: number
  left: number
  right: number
  height: number
}

/**
 * How a PDF text-layer span continues the current line: on the `same` line, on the `next`
 * line of the running text (below, or at the top of the next column), or after a paragraph
 * end the layer has no markup for (`para`): another font size (title, headings, footnotes,
 * captions), a blank gap, or a jump the text does not flow along.
 */
export function lineStep(line: LineBox, next: Pick<DOMRect, 'top' | 'bottom' | 'left' | 'height'>): 'same' | 'next' | 'para' {
  if (!next.height || !line.height) return 'same' // no layout (hidden frame, tests): change nothing
  const small = Math.min(next.height, line.height)
  const big = Math.max(next.height, line.height)
  const overlap = Math.min(line.bottom, next.bottom) - Math.max(line.top, next.top)
  if (overlap > small * 0.25) return 'same' // superscripts included
  if (small / big < 0.8) return 'para'
  if (next.top >= line.bottom - small * 0.25) {
    if (next.top - line.bottom > big * 0.6) return 'para'
    return next.left >= line.left - 3 * big && next.left < line.right ? 'next' : 'para'
  }
  // above the line: only the step up to the top of the next column continues the text
  return next.left >= line.right - big ? 'next' : 'para'
}

/** Text of a block plus the start offset of every text node in it. */
export function buildBlockText(block: Element): BlockText {
  const doc = block.ownerDocument
  const walker = doc.createTreeWalker(block, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode: n =>
      n.nodeType === Node.ELEMENT_NODE && SKIP.has((n as Element).localName)
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT,
  })
  const nodes: BlockText['nodes'] = []
  let text = ''
  // PDF text layers: one positioned span per text run, <br> at line ends, no paragraphs
  let line: LineBox | null = null
  let brAt = -1
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.nodeType === Node.TEXT_NODE) {
      const el = n.parentElement
      const layer = el?.closest('.textLayer')
      if (!el || !layer || layer === el) {
        line = null
        brAt = -1
      } else {
        const r = el.getBoundingClientRect()
        if (r.height > 0 && (n as Text).data.trim()) {
          const step = line ? lineStep(line, r) : 'same'
          if (line && step === 'same') {
            line = {
              top: Math.min(line.top, r.top),
              bottom: Math.max(line.bottom, r.bottom),
              left: Math.min(line.left, r.left),
              right: Math.max(line.right, r.right),
              height: Math.max(line.height, r.height),
            }
          } else {
            // the <br> keeps its place (same length, so offsets of saved marks stay valid)
            const mark = step === 'para' ? PARAGRAPH_BREAK : '\n'
            if (brAt >= 0) text = text.slice(0, brAt) + mark + text.slice(brAt + 1)
            else if (step === 'para' && text && !text.endsWith(PARAGRAPH_BREAK)) text += mark
            else if (step === 'next' && text && !/\s$/.test(text)) text += mark
            line = { top: r.top, bottom: r.bottom, left: r.left, right: r.right, height: r.height }
          }
          brAt = -1
        }
      }
      nodes.push({ node: n as Text, start: text.length })
      text += (n as Text).data
    } else {
      const name = (n as Element).localName
      if (name === 'br') {
        brAt = text.length
        text += '\n'
      } else if (BLOCK.has(name) && text && !/\s$/.test(text)) text += PARAGRAPH_BREAK
    }
  }
  return { text, nodes }
}

export function offsetOf(bt: BlockText, node: Node, offset: number): number | null {
  if (node.nodeType !== Node.TEXT_NODE) {
    const child = node.childNodes[offset] ?? node.childNodes[node.childNodes.length - 1]
    if (!child) return null
    const first = bt.nodes.find(e => child === e.node || child.contains(e.node))
    return first ? first.start : null
  }
  const entry = bt.nodes.find(e => e.node === node)
  return entry ? entry.start + offset : null
}

function locate(bt: BlockText, pos: number, asEnd: boolean): { node: Text; offset: number } | null {
  for (const { node, start } of bt.nodes) {
    const end = start + node.data.length
    if (asEnd ? pos > start && pos <= end : pos >= start && pos < end) return { node, offset: pos - start }
  }
  return null
}

export function rangeFromOffsets(bt: BlockText, start: number, end: number): Range | null {
  const a = locate(bt, start, false)
  const b = locate(bt, end, true)
  if (!a || !b) return null
  const range = a.node.ownerDocument.createRange()
  range.setStart(a.node, a.offset)
  range.setEnd(b.node, b.offset)
  return range
}

type CaretDoc = Document & {
  caretPositionFromPoint?(x: number, y: number): { offsetNode: Node; offset: number } | null
  caretRangeFromPoint?(x: number, y: number): Range | null
}

function caretAt(doc: Document, x: number, y: number): { node: Node; offset: number } | null {
  const d = doc as CaretDoc
  if (d.caretPositionFromPoint) {
    const p = d.caretPositionFromPoint(x, y)
    if (p) return { node: p.offsetNode, offset: p.offset }
  }
  if (d.caretRangeFromPoint) {
    const r = d.caretRangeFromPoint(x, y)
    if (r) return { node: r.startContainer, offset: r.startOffset }
  }
  return null
}

export function rangeContainsPoint(range: Range, x: number, y: number, slack = 3): boolean {
  for (const r of range.getClientRects())
    if (x >= r.left - slack && x <= r.right + slack && y >= r.top - slack && y <= r.bottom + slack) return true
  return false
}

/** The word under a tap or click, or null if the point is not over text. */
export function hitFromPoint(doc: Document, x: number, y: number): LookupHit | null {
  const caret = caretAt(doc, x, y)
  if (!caret) return null
  const bt = buildBlockText(blockOf(caret.node))
  const pos = offsetOf(bt, caret.node, caret.offset)
  if (pos === null) return null
  const w = wordAt(bt.text, pos)
  if (!w || !w.word) return null
  const range = rangeFromOffsets(bt, w.start, w.end)
  if (!range || !rangeContainsPoint(range, x, y)) return null
  return { surface: w.word, sentence: findSentence(bt.text, w.start).sentence, range }
}

const MAX_WORDS = 6

/** The current selection, widened to whole words; null for empty or long selections. */
export function hitFromSelection(doc: Document): LookupHit | null {
  const sel = doc.getSelection()
  if (!sel || sel.isCollapsed || !sel.rangeCount) return null
  return hitFromRange(sel.getRangeAt(0))
}

/** A range (selection or mark) as lookup target, widened to whole words; null if empty or too long. */
export function hitFromRange(selRange: Range): LookupHit | null {
  const raw = normalizeWord(selRange.toString())
  if (!raw || raw.split(/\s+/).length > MAX_WORDS || raw.length > 80) return null
  const bt = buildBlockText(blockOf(selRange.startContainer))
  let start = offsetOf(bt, selRange.startContainer, selRange.startOffset)
  let end = offsetOf(bt, selRange.endContainer, selRange.endOffset)
  if (start === null) return { surface: raw, sentence: '', range: selRange.cloneRange() }
  if (end === null || end <= start) end = start + selRange.toString().length
  const first = wordAt(bt.text, start)
  const last = wordAt(bt.text, end - 1)
  if (first) start = Math.min(start, first.start)
  if (last) end = Math.max(end, last.end)
  const range = rangeFromOffsets(bt, start, end) ?? selRange.cloneRange()
  const surface = normalizeWord(bt.text.slice(start, end), hyphenatedWords(bt.text)) || raw
  return { surface, sentence: findSentence(bt.text, start).sentence, range }
}

/** A passage to mark: offsets in the text of the whole section (buildBlockText(doc.body)). */
export interface MarkSpan {
  start: number
  end: number
  /** exactly bodyText.slice(start, end) */
  text: string
  range: Range
}

/** The word at `pos`, segmenting only a window around it (section texts are long). */
function wordNear(text: string, pos: number) {
  const from = Math.max(0, pos - 80)
  const w = wordAt(text.slice(from, pos + 80), pos - from)
  return w && { start: w.start + from, end: w.end + from }
}

const SPACE = /[\s\u2029]/

/**
 * The own touch selection: from the anchor word to the word at `pos` (either direction),
 * whole words, without the whitespace the finger may rest on.
 */
export function extendSelection(text: string, anchor: { start: number; end: number }, pos: number) {
  if (pos >= anchor.start && pos <= anchor.end) return { start: anchor.start, end: anchor.end }
  const w = wordNear(text, pos)
  if (pos < anchor.start) {
    let start = w ? Math.min(w.start, pos) : pos
    while (start < anchor.start && SPACE.test(text[start])) start++
    return { start, end: anchor.end }
  }
  let end = w ? Math.max(w.end, pos) : pos
  while (end > anchor.end && SPACE.test(text[end - 1])) end--
  return { start: anchor.start, end }
}

/** Offsets of a DOM range in the section text, widened to whole words; null if empty. */
export function markFromRange(doc: Document, range: Range): MarkSpan | null {
  return doc.body ? spanIn(buildBlockText(doc.body), range) : null
}

function spanIn(bt: BlockText, range: Range): MarkSpan | null {
  let start = offsetOf(bt, range.startContainer, range.startOffset)
  let end = offsetOf(bt, range.endContainer, range.endOffset)
  if (start === null) return null
  if (end === null || end <= start) end = start + range.toString().length
  // leading/trailing whitespace is not part of the mark
  while (start < end && /[\s\u2029]/.test(bt.text[start])) start++
  while (end > start && /[\s\u2029]/.test(bt.text[end - 1])) end--
  if (end <= start) return null
  const first = wordNear(bt.text, start)
  const last = wordNear(bt.text, end - 1)
  if (first && first.start <= start && first.end > start) start = first.start
  if (last && last.start < end && last.end >= end) end = last.end
  const r = rangeFromOffsets(bt, start, end)
  if (!r) return null
  return { start, end, text: bt.text.slice(start, end), range: r }
}

/** The current selection as a passage to mark (any length, across paragraphs). */
export function markFromSelection(doc: Document): MarkSpan | null {
  const sel = doc.getSelection()
  if (!sel || sel.isCollapsed || !sel.rangeCount) return null
  return markFromRange(doc, sel.getRangeAt(0))
}

/** A selection too long to look up: translated as a whole, with the text around it as DeepL context. */
export interface PassageHit {
  /** the passage, line breaks and hyphenation at line ends removed */
  text: string
  /** text before and after the passage (not billed by DeepL) */
  context: string
  span: MarkSpan
}

const PASSAGE_CONTEXT = 800

/** The current selection as a passage to translate; null if empty. */
export function passageFromSelection(doc: Document): PassageHit | null {
  const sel = doc.getSelection()
  if (!sel || sel.isCollapsed || !sel.rangeCount) return null
  return passageFromRange(doc, sel.getRangeAt(0))
}

/** A range (selection or own touch selection) as a passage to translate; null if empty. */
export function passageFromRange(doc: Document, range: Range): PassageHit | null {
  if (!doc.body) return null
  const bt = buildBlockText(doc.body)
  const span = spanIn(bt, range)
  if (!span) return null
  const keep = hyphenatedWords(bt.text)
  const text = cleanText(span.text, keep)
  if (!text) return null
  const before = cleanText(bt.text.slice(Math.max(0, span.start - PASSAGE_CONTEXT), span.start), keep)
  const after = cleanText(bt.text.slice(span.end, span.end + PASSAGE_CONTEXT), keep)
  return { text, context: [before, after].filter(Boolean).join(' … '), span }
}

const LOOKUP = 'vr-lookup'

/** background per mark color; the CSS highlight is named vr-hl-<color> (highlights.ts) */
export const HIGHLIGHT_CSS: Record<HighlightColor, string> = {
  yellow: 'rgba(255, 213, 0, 0.42)',
  green: 'rgba(80, 200, 90, 0.36)',
  blue: 'rgba(70, 150, 255, 0.34)',
  pink: 'rgba(255, 90, 170, 0.32)',
}

export function prepareDocument(doc: Document) {
  if (doc.getElementById('vr-style')) return
  const style = doc.createElement('style')
  style.id = 'vr-style'
  style.textContent = [
    ...Object.entries(HIGHLIGHT_CSS).map(([c, bg]) => `::highlight(vr-hl-${c}) { background-color: ${bg}; }`),
    '::highlight(vr-hl-note) { text-decoration: underline dotted 2px; text-underline-offset: 3px; }',
    // after the marks, so the word being looked up stands out on top of them
    `::highlight(${LOOKUP}) { background-color: rgba(255, 160, 0, 0.55); }`,
  ].join('\n')
  ;(doc.head ?? doc.documentElement).append(style)
}

export function markRange(doc: Document, range: Range | null) {
  const win = doc.defaultView as (Window & typeof globalThis) | null
  const registry = win?.CSS?.highlights
  if (!registry || !win?.Highlight) return
  if (range) registry.set(LOOKUP, new win.Highlight(range))
  else registry.delete(LOOKUP)
}

export interface ReaderHandlers {
  mode(): ReaderMode
  /** translate mode: tapped word or selected phrase */
  onLookup(hit: LookupHit): void
  /** translate mode: a selection too long to look up (called again while it changes) */
  onPassage(p: PassageHit): void
  /** mark mode: tapped word that is not marked yet */
  onMarkWord(hit: LookupHit): void
  /** mark mode: there is a selection (called again while it changes); `span` for the own touch selection */
  onMarkSelection(span?: MarkSpan): void
  /** mark mode: tap on a mark; returns false if there is none at that point */
  onTapMark(x: number, y: number): boolean
  /** read mode: tap; x in the coordinates of the app window */
  onTap(x: number): void
  /** two-finger tap */
  onCycleMode(): void
}

const touchSample = (e: TouchEvent): TouchSample => ({
  touches: e.touches.length,
  points: Array.from(e.changedTouches, t => ({ id: t.identifier, x: t.clientX, y: t.clientY })),
  t: e.timeStamp,
})

/** x of a point in the book frame, in the coordinates of the app window */
function outerX(doc: Document, x: number): number {
  const win = doc.defaultView
  const frame = win?.frameElement?.getBoundingClientRect()
  if (!win || !frame) return x
  return frame.left + x * (win.innerWidth ? frame.width / win.innerWidth : 1)
}

/** the element of an event target, which may be a text node (no instanceof: the book lives in an iframe) */
function elementOf(target: EventTarget | null): Element | null {
  const n = target as Node | null
  if (!n || typeof n.nodeType !== 'number') return null
  return n.nodeType === Node.ELEMENT_NODE ? (n as Element) : n.parentElement
}

const inLink = (target: EventTarget | null) => !!elementOf(target)?.closest('a[href]')

/**
 * Taps, selections and two-finger taps in a book document, dispatched by the reader mode.
 *
 * On touch screens, translate and mark mode do not use the native selection: it brings handles,
 * Android's menu with "web search" and Chrome's "Touch to Search" bar. Instead, pressing a word
 * for LONG_PRESS_MS and dragging selects whole words (drawn with the lookup highlight).
 */
export function attachReaderHandlers(doc: Document, h: ReaderHandlers) {
  let down: { x: number; y: number; t: number } | null = null
  let selTimer: ReturnType<typeof setTimeout> | undefined
  const gesture = createGestureTracker()
  const opts = { passive: true }

  /** the last pointer was a finger: no native selection outside read mode */
  let touchInput = false
  const ownSelection = () => touchInput && h.mode() !== 'read'
  const press = createPressTracker()
  let pressTimer: ReturnType<typeof setTimeout> | undefined
  /** the own touch selection: section text, the word pressed first, the current range */
  let touchSel: { bt: BlockText; anchor: { start: number; end: number }; range: Range } | null = null
  /** this touch made an own selection, so its pointerup is no tap */
  let pressUsed = false

  const dropTouchSelection = () => {
    clearTimeout(pressTimer)
    if (!touchSel) return
    touchSel = null
    markRange(doc, null)
  }

  const beginTouchSelection = (x: number, y: number) => {
    const caret = h.mode() !== 'read' && doc.body ? caretAt(doc, x, y) : null
    const bt = caret && buildBlockText(doc.body)
    const pos = caret && bt ? offsetOf(bt, caret.node, caret.offset) : null
    const w = bt && pos !== null ? wordNear(bt.text, pos) : null
    const range = bt && w && rangeFromOffsets(bt, w.start, w.end)
    if (!bt || !w || !range || !rangeContainsPoint(range, x, y)) return void press.cancel()
    touchSel = { bt, anchor: w, range }
    pressUsed = true
    doc.getSelection()?.removeAllRanges()
    markRange(doc, range)
    try {
      navigator.vibrate?.(10)
    } catch {
      // no vibration, no matter
    }
  }

  const extendTouchSelection = (x: number, y: number) => {
    const sel = touchSel
    const caret = sel && caretAt(doc, x, y)
    const pos = sel && caret ? offsetOf(sel.bt, caret.node, caret.offset) : null
    if (!sel || pos === null) return
    const { start, end } = extendSelection(sel.bt.text, sel.anchor, pos)
    const range = rangeFromOffsets(sel.bt, start, end)
    if (!range) return
    sel.range = range
    markRange(doc, range)
  }

  const finishTouchSelection = () => {
    const sel = touchSel
    touchSel = null
    if (!sel) return
    const mode = h.mode()
    if (mode === 'translate') {
      const hit = hitFromRange(sel.range)
      if (hit) return h.onLookup(hit)
      const passage = passageFromRange(doc, sel.range)
      if (passage) return h.onPassage(passage)
    } else if (mode === 'mark') {
      const span = markFromRange(doc, sel.range)
      if (span) return h.onMarkSelection(span)
    }
    markRange(doc, null)
  }

  doc.addEventListener(
    'touchstart',
    e => {
      const sample = touchSample(e)
      gesture.start(sample)
      const step = press.start(sample)
      if (step?.kind === 'cancel') dropTouchSelection()
      if (step?.kind !== 'press' || h.mode() === 'read' || inLink(e.target)) return
      clearTimeout(pressTimer)
      pressTimer = setTimeout(() => {
        const at = press.fire()
        if (at) beginTouchSelection(at.x, at.y)
      }, LONG_PRESS_MS)
    },
    opts,
  )
  doc.addEventListener('touchmove', e => gesture.move(touchSample(e)), opts)
  // ahead of foliate's own touch handlers on the document, which turn or scroll the page
  doc.defaultView?.addEventListener(
    'touchmove',
    e => {
      const step = press.move(touchSample(e))
      if (step?.kind === 'cancel') clearTimeout(pressTimer)
      if (!press.active) return
      if (e.cancelable) e.preventDefault()
      e.stopPropagation()
      if (step?.kind === 'drag') extendTouchSelection(step.x, step.y)
    },
    { capture: true, passive: false },
  )
  doc.addEventListener(
    'touchend',
    e => {
      const sample = touchSample(e)
      if (gesture.end(sample)) {
        dropTouchSelection()
        doc.getSelection()?.removeAllRanges()
        return h.onCycleMode()
      }
      const step = press.end(sample)
      if (step) clearTimeout(pressTimer)
      if (step?.kind === 'done') finishTouchSelection()
    },
    opts,
  )
  doc.addEventListener(
    'touchcancel',
    e => {
      gesture.end(touchSample(e))
      press.cancel()
      dropTouchSelection()
    },
    opts,
  )

  // no native selection by finger outside read mode (programmatic selections and the mouse stay)
  const blockNative = (e: Event) => {
    if (ownSelection() && !inLink(e.target)) e.preventDefault()
  }
  doc.addEventListener('selectstart', blockNative)
  doc.addEventListener('contextmenu', blockNative)

  doc.addEventListener('pointerdown', e => {
    down = { x: e.clientX, y: e.clientY, t: e.timeStamp }
    touchInput = e.pointerType === 'touch'
    pressUsed = false
  })
  doc.addEventListener('pointercancel', () => {
    down = null
  })
  doc.addEventListener('pointerup', e => {
    const start = down
    down = null
    if (e.button !== 0 || gesture.multi(e.timeStamp) || pressUsed) return
    if ((e.target as Element | null)?.closest?.('a[href]')) return
    setTimeout(() => {
      const mode = h.mode()
      const selected = doc.getSelection()
      const hasSelection = !!selected && !selected.isCollapsed && selected.toString().trim() !== ''
      if (mode === 'translate' && hasSelection) {
        const sel = hitFromSelection(doc)
        const passage = sel ? null : passageFromSelection(doc)
        if (sel || passage) {
          clearTimeout(selTimer)
          return sel ? h.onLookup(sel) : h.onPassage(passage!)
        }
      } else if (mode === 'mark' && hasSelection) {
        clearTimeout(selTimer)
        return h.onMarkSelection()
      }
      if (!start || hasSelection) return
      const moved = Math.hypot(e.clientX - start.x, e.clientY - start.y)
      if (moved > 8 || e.timeStamp - start.t > 600) return
      if (mode === 'read') return h.onTap(outerX(doc, e.clientX))
      if (mode === 'mark' && h.onTapMark(e.clientX, e.clientY)) return
      const hit = hitFromPoint(doc, e.clientX, e.clientY)
      if (!hit) return
      if (mode === 'mark') h.onMarkWord(hit)
      else h.onLookup(hit)
    }, 10)
  })
  // a native selection that ends without a usable pointerup (keyboard, or a finger in read mode)
  doc.addEventListener('selectionchange', () => {
    clearTimeout(selTimer)
    selTimer = setTimeout(() => {
      if (down) return
      const mode = h.mode()
      if (mode === 'translate') {
        const sel = hitFromSelection(doc)
        const passage = sel ? null : passageFromSelection(doc)
        if (sel) h.onLookup(sel)
        else if (passage) h.onPassage(passage)
      } else if (mode === 'mark' && markFromSelection(doc)) h.onMarkSelection()
    }, 700)
  })
}
