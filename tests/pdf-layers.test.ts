// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { guardPdfLayers, serializeZoom, type ZoomArgs } from '../src/reader/pdfLayers'

const tick = () => new Promise(r => setTimeout(r, 0))

function pageDoc() {
  const doc = document.implementation.createHTMLDocument('page')
  doc.body.innerHTML = '<div id="canvas"></div><div class="textLayer"></div><div class="annotationLayer"></div>'
  return doc
}

/** Like foliate's render(): appends the page text in chunks, with pauses in between. */
function fakeRender(log: number[]) {
  return async ({ doc, scale }: ZoomArgs) => {
    log.push(scale)
    const layer = doc.querySelector('.textLayer')!
    for (const word of ['one', 'two', 'three']) {
      await tick()
      layer.append(Object.assign(doc.createElement('span'), { textContent: word }))
    }
    doc.querySelector('.annotationLayer')!.append(doc.createElement('section'))
  }
}

describe('serializeZoom', () => {
  it('runs only the newest of several zooms that arrive together', async () => {
    const doc = pageDoc()
    const log: number[] = []
    const zoom = serializeZoom(fakeRender(log))
    void zoom({ doc, scale: 1 })
    void zoom({ doc, scale: 1.5 })
    await zoom({ doc, scale: 2 })
    expect(log).toEqual([2])
    expect(doc.querySelector('.textLayer')!.textContent).toBe('onetwothree')
  })

  it('waits for a render in flight, then empties both layers before the next one', async () => {
    const doc = pageDoc()
    const log: number[] = []
    const zoom = serializeZoom(fakeRender(log))
    const first = zoom({ doc, scale: 1 })
    await tick() // first render has started and written its first chunk
    await Promise.all([first, zoom({ doc, scale: 2 })])
    expect(log).toEqual([1, 2])
    expect(doc.querySelector('.textLayer')!.textContent).toBe('onetwothree')
    expect(doc.querySelector('.annotationLayer')!.children).toHaveLength(1)
  })

  it('keeps going after a failed render', async () => {
    const doc = pageDoc()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    let fail = true
    const log: number[] = []
    const render = fakeRender(log)
    const zoom = serializeZoom(async args => {
      if (fail) {
        fail = false
        throw new Error('boom')
      }
      await render(args)
    })
    await zoom({ doc, scale: 1 })
    await zoom({ doc, scale: 2 })
    expect(log).toEqual([2])
    expect(doc.querySelector('.textLayer')!.textContent).toBe('onetwothree')
  })
})

describe('guardPdfLayers', () => {
  it('wraps onZoom once per page and leaves other sections alone', async () => {
    const page = { src: 'blob:page', onZoom: vi.fn(async (_: ZoomArgs) => {}) }
    const book = { sections: [{ load: async () => page }, { load: async () => 'blob:plain' }, {}] }
    guardPdfLayers(book)
    const [s0, s1] = book.sections as { load: () => Promise<unknown> }[]
    const a = (await s0.load()) as typeof page
    const b = (await s0.load()) as typeof page
    expect(a).toBe(b) // one queue per page, even if foliate loads it again
    expect(a.src).toBe('blob:page')
    expect(a.onZoom).not.toBe(page.onZoom)
    const doc = pageDoc()
    await a.onZoom({ doc, scale: 1 } as never)
    expect(page.onZoom).toHaveBeenCalledWith({ doc, scale: 1 })
    expect(await s1.load()).toBe('blob:plain')
  })
})
