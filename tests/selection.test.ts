// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { blockOf, buildBlockText, hitFromSelection, offsetOf, rangeFromOffsets } from '../src/reader/selection'

function setup(html: string) {
  document.body.innerHTML = html
  return document
}

describe('block text', () => {
  it('concatenates inline text and maps offsets back to DOM ranges', () => {
    const doc = setup('<p id="p">The <em>unbiased</em> estimator is <b>consistent</b>.</p>')
    const p = doc.getElementById('p')!
    const bt = buildBlockText(p)
    expect(bt.text).toBe('The unbiased estimator is consistent.')
    const start = bt.text.indexOf('estimator')
    const range = rangeFromOffsets(bt, start, start + 'estimator'.length)!
    expect(range.toString()).toBe('estimator')
    const em = p.querySelector('em')!.firstChild!
    expect(offsetOf(bt, em, 2)).toBe(4 + 2)
  })

  it('uses the PDF text layer as block and turns <br> into line breaks', () => {
    const doc = setup('<div class="textLayer"><span>We fit a statis-</span><br><span>tical model.</span></div>')
    const span = doc.querySelector('span')!
    const layer = blockOf(span.firstChild!)
    expect(layer.className).toBe('textLayer')
    expect(buildBlockText(layer).text).toBe('We fit a statis-\ntical model.')
  })
})

describe('hitFromSelection', () => {
  it('widens a partial selection to whole words and finds the sentence', () => {
    const doc = setup('<p>First sentence here. The <i>heteroscedastic</i> errors were large. Last one.</p>')
    const text = doc.querySelector('i')!.firstChild!
    const range = doc.createRange()
    range.setStart(text, 3)
    range.setEnd(text, 8)
    const sel = doc.getSelection()!
    sel.removeAllRanges()
    sel.addRange(range)
    const hit = hitFromSelection(doc)!
    expect(hit.surface).toBe('heteroscedastic')
    expect(hit.sentence).toBe('The heteroscedastic errors were large.')
  })

  it('keeps multi-word phrases', () => {
    const doc = setup('<p id="p">She gave up on the idea.</p>')
    const t = doc.getElementById('p')!.firstChild!
    const range = doc.createRange()
    range.setStart(t, 4)
    range.setEnd(t, 11)
    doc.getSelection()!.removeAllRanges()
    doc.getSelection()!.addRange(range)
    expect(hitFromSelection(doc)?.surface).toBe('gave up')
  })

  it('ignores long selections', () => {
    const doc = setup('<p id="p">one two three four five six seven eight</p>')
    const t = doc.getElementById('p')!.firstChild!
    const range = doc.createRange()
    range.selectNodeContents(t)
    doc.getSelection()!.removeAllRanges()
    doc.getSelection()!.addRange(range)
    expect(hitFromSelection(doc)).toBeNull()
  })
})
