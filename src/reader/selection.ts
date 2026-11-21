// Finds the tapped or selected word and its sentence inside a book document
// (an EPUB section or a PDF.js text layer, both rendered by foliate-js in iframes).
import { findSentence, normalizeWord, PARAGRAPH_BREAK, wordAt } from '../nlp/sentence'

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
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.nodeType === Node.TEXT_NODE) {
      nodes.push({ node: n as Text, start: text.length })
      text += (n as Text).data
    } else {
      const name = (n as Element).localName
      if (name === 'br') text += '\n'
      else if (BLOCK.has(name) && text && !/\s$/.test(text)) text += PARAGRAPH_BREAK
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

function rangeContainsPoint(range: Range, x: number, y: number, slack = 3): boolean {
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
  const selRange = sel.getRangeAt(0)
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
  const surface = normalizeWord(bt.text.slice(start, end)) || raw
  return { surface, sentence: findSentence(bt.text, start).sentence, range }
}

const HIGHLIGHT = 'vr-lookup'

export function prepareDocument(doc: Document) {
  if (doc.getElementById('vr-style')) return
  const style = doc.createElement('style')
  style.id = 'vr-style'
  style.textContent = `::highlight(${HIGHLIGHT}) { background-color: rgba(255, 196, 0, 0.45); }`
  ;(doc.head ?? doc.documentElement).append(style)
}

export function markRange(doc: Document, range: Range | null) {
  const win = doc.defaultView as (Window & typeof globalThis) | null
  const registry = win?.CSS?.highlights
  if (!registry || !win?.Highlight) return
  if (range) registry.set(HIGHLIGHT, new win.Highlight(range))
  else registry.delete(HIGHLIGHT)
}

/** Tap/click on a word or select a phrase → onHit. */
export function attachLookupHandlers(doc: Document, onHit: (hit: LookupHit) => void) {
  let down: { x: number; y: number; t: number } | null = null
  let selTimer: ReturnType<typeof setTimeout> | undefined
  doc.addEventListener('pointerdown', e => {
    down = { x: e.clientX, y: e.clientY, t: e.timeStamp }
  })
  doc.addEventListener('pointerup', e => {
    const start = down
    down = null
    if (e.button !== 0) return
    if ((e.target as Element | null)?.closest?.('a[href]')) return
    setTimeout(() => {
      const sel = hitFromSelection(doc)
      if (sel) {
        clearTimeout(selTimer)
        return onHit(sel)
      }
      if (!start) return
      const moved = Math.hypot(e.clientX - start.x, e.clientY - start.y)
      if (moved > 8 || e.timeStamp - start.t > 600) return
      const hit = hitFromPoint(doc, e.clientX, e.clientY)
      if (hit) onHit(hit)
    }, 10)
  })
  // long-press selection on touch screens ends without a usable pointerup
  doc.addEventListener('selectionchange', () => {
    clearTimeout(selTimer)
    selTimer = setTimeout(() => {
      if (down) return
      const sel = hitFromSelection(doc)
      if (sel) onHit(sel)
    }, 700)
  })
}
