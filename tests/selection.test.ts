// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { anchorIn } from '../src/reader/highlights'
import {
  blockOf,
  buildBlockText,
  extendSelection,
  hitFromRange,
  hitFromSelection,
  markFromSelection,
  offsetOf,
  passageFromRange,
  passageFromSelection,
  rangeFromOffsets,
} from '../src/reader/selection'

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

describe('markFromSelection', () => {
  it('marks across paragraphs, widened to whole words, with offsets in the section text', () => {
    const doc = setup('<h2>Title</h2><p id="a">The first paragraph ends here.</p><p id="b">The second one goes on.</p>')
    const a = doc.getElementById('a')!.firstChild!
    const b = doc.getElementById('b')!.firstChild!
    const range = doc.createRange()
    range.setStart(a, 'The first parag'.length - 2) // inside "paragraph"
    range.setEnd(b, 'The sec'.length) // inside "second"
    doc.getSelection()!.removeAllRanges()
    doc.getSelection()!.addRange(range)
    const m = markFromSelection(doc)!
    expect(m.range.toString()).toBe('paragraph ends here.The second')
    const body = buildBlockText(doc.body).text
    expect(body.slice(m.start, m.end)).toBe(m.text)
    expect(m.text).toBe('paragraph ends here.\u2029The second')
  })

  it('leaves out spaces at the edges and returns null for an empty selection', () => {
    const doc = setup('<p id="p">alpha beta gamma</p>')
    const t = doc.getElementById('p')!.firstChild!
    const range = doc.createRange()
    range.setStart(t, 5) // the space before "beta"
    range.setEnd(t, 11) // "beta " incl. the following space
    doc.getSelection()!.removeAllRanges()
    doc.getSelection()!.addRange(range)
    expect(markFromSelection(doc)?.text).toBe('beta')

    const space = doc.createRange()
    space.setStart(t, 5)
    space.setEnd(t, 6)
    doc.getSelection()!.removeAllRanges()
    doc.getSelection()!.addRange(space)
    expect(markFromSelection(doc)).toBeNull()
  })
})

describe('passageFromSelection', () => {
  it('takes sentences across paragraphs as one text, with the text around them as context', () => {
    const doc = setup(
      '<p id="a">It was late. The river rose quickly that night.</p><p id="b">Nobody saw the bank go under. Morning came.</p>',
    )
    const a = doc.getElementById('a')!.firstChild!
    const b = doc.getElementById('b')!.firstChild!
    const range = doc.createRange()
    range.setStart(a, 'It was late. The ri'.length) // inside "river"
    range.setEnd(b, 'Nobody saw the bank go under.'.length)
    doc.getSelection()!.removeAllRanges()
    doc.getSelection()!.addRange(range)
    const p = passageFromSelection(doc)!
    expect(p.text).toBe('river rose quickly that night. Nobody saw the bank go under.')
    expect(p.context).toBe('It was late. The … Morning came.')
    expect(buildBlockText(doc.body).text.slice(p.span.start, p.span.end)).toBe(p.span.text)
  })

  it('returns null without a selection', () => {
    const doc = setup('<p>alpha beta</p>')
    doc.getSelection()!.removeAllRanges()
    expect(passageFromSelection(doc)).toBeNull()
  })
})

describe('anchorIn', () => {
  it('uses the stored offsets, else the nearest occurrence of the text', () => {
    const text = 'one two three. one two three.'
    expect(anchorIn(text, { start: 4, end: 7, text: 'two' })).toEqual({ start: 4, end: 7 })
    // text moved by two characters: the occurrence near the old start wins
    expect(anchorIn('xx' + text, { start: 19, end: 22, text: 'two' })).toEqual({ start: 21, end: 24 })
    expect(anchorIn(text, { start: 0, end: 3, text: 'missing' })).toBeNull()
  })
})

describe('own touch selection', () => {
  const text = 'He gave up. Then, quite suddenly, the bank\u2029Morning came.'
  const word = (w: string) => ({ start: text.indexOf(w), end: text.indexOf(w) + w.length })
  const slice = (s: { start: number; end: number }) => text.slice(s.start, s.end)

  it('stays on the pressed word while the finger is on it', () => {
    expect(slice(extendSelection(text, word('gave'), text.indexOf('gave') + 2))).toBe('gave')
  })

  it('grows word by word forwards and backwards from the pressed word', () => {
    const gave = word('gave')
    expect(slice(extendSelection(text, gave, text.indexOf('up') + 1))).toBe('gave up')
    // the caret right before a word counts as that word
    expect(slice(extendSelection(text, gave, text.indexOf('up')))).toBe('gave up')
    expect(slice(extendSelection(text, gave, text.indexOf('He')))).toBe('He gave')
    expect(slice(extendSelection(text, word('bank'), text.indexOf('quite') + 3))).toBe('quite suddenly, the bank')
  })

  it('leaves out the whitespace and paragraph breaks the finger rests on', () => {
    const the = word('the')
    // finger on the paragraph break after "bank": the break is not selected
    expect(slice(extendSelection(text, the, text.indexOf('\u2029')))).toBe('the bank')
    const spaced = 'the bank   end'
    const span = extendSelection(spaced, { start: 0, end: 3 }, 10)
    expect(spaced.slice(span.start, span.end)).toBe('the bank')
    // finger in the space before "the"
    expect(slice(extendSelection(text, word('bank'), text.indexOf(' the')))).toBe('the bank')
  })

  it('looks a short selection up and translates a long one as a passage', () => {
    const doc = setup('<p id="a">It was late. The river rose quickly that night.</p><p id="b">Nobody saw the bank go under.</p>')
    const bt = buildBlockText(doc.body)
    const short = rangeFromOffsets(bt, bt.text.indexOf('river'), bt.text.indexOf(' quickly'))!
    expect(hitFromRange(short)!.surface).toBe('river rose')
    const long = rangeFromOffsets(bt, bt.text.indexOf('The river'), bt.text.indexOf(' go under'))!
    const p = passageFromRange(doc, long)!
    expect(p.text).toBe('The river rose quickly that night. Nobody saw the bank')
    expect(p.context).toBe('It was late. … go under.')
    // the own selection is no native one
    expect(doc.getSelection()!.isCollapsed).toBe(true)
  })
})
