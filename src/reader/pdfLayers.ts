// foliate-js's PDF adapter (public/foliate-js/pdf.js, render()) draws a page's text and
// annotation layers on every zoom (onZoom: also on load and on resize) by appending to the
// same containers, without emptying them and without waiting for a render still in flight.
// The text layer then holds the page several times, interleaved (seen with a real arXiv
// paper): taps return sentences glued across copies ("…architectures that BERT: Pre-training…")
// and offsets of marks point into the wrong copy. Wrapping each page's onZoom fixes that
// without touching the submodule: one render at a time, a render overtaken by a newer zoom
// is skipped, and both layers are emptied right before each render.

export interface ZoomArgs {
  doc: Document
  scale: number
}
type OnZoom = (args: ZoomArgs) => unknown

const LAYERS = ['.textLayer', '.annotationLayer']

export function serializeZoom(onZoom: OnZoom): (args: ZoomArgs) => Promise<void> {
  let queue: Promise<void> = Promise.resolve()
  let latest = 0
  return args => {
    const ticket = ++latest
    queue = queue.then(async () => {
      if (ticket !== latest) return // a newer zoom is already waiting
      for (const sel of LAYERS) args.doc.querySelector(sel)?.replaceChildren()
      try {
        await onZoom(args)
      } catch (e) {
        console.warn('PDF page render failed', e)
      }
    })
    return queue
  }
}

interface LoadableSection {
  load?: () => Promise<unknown>
}

/** Wraps the onZoom of every page a PDF book (foliate makeBook) loads, see serializeZoom. */
export function guardPdfLayers(book: { sections: unknown[] }) {
  for (const section of book.sections as LoadableSection[]) {
    const load = section.load
    if (typeof load !== 'function') continue
    // foliate caches the loaded page object; keep one wrapper (and one queue) per page
    const wrapped = new WeakMap<object, unknown>()
    section.load = async () => {
      const res = await load.call(section)
      if (!res || typeof res !== 'object') return res
      const onZoom = (res as { onZoom?: unknown }).onZoom
      if (typeof onZoom !== 'function') return res
      let w = wrapped.get(res)
      if (!w) {
        w = { ...res, onZoom: serializeZoom(onZoom as OnZoom) }
        wrapped.set(res, w)
      }
      return w
    }
  }
}
