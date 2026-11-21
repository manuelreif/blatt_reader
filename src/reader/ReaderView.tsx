import { useEffect, useRef, useState } from 'react'
import { db, type Book } from '../db/schema'
import { LookupSheet } from '../lookup/LookupSheet'
import type { LookupTarget } from '../lookup/lookupService'
import { href } from '../router'
import { setSetting, useSettings } from '../settings/settings'
import { flattenToc, loadFoliate, type FoliateView, type RelocateDetail } from './foliate'
import { attachLookupHandlers, markRange, prepareDocument, type LookupHit } from './selection'

const bookCSS = (fontScale: number) => `
  html { color-scheme: light dark; font-size: ${Math.round(fontScale * 100)}% !important; }
  p, li, blockquote, dd {
    line-height: 1.5;
    hyphens: auto;
    -webkit-hyphens: auto;
    widows: 2;
  }
  pre { white-space: pre-wrap !important; }
  @media (prefers-color-scheme: dark) { a:link { color: lightblue; } }
`

type ActiveHit = LookupTarget & { doc: Document; range: Range }

export function ReaderView({ bookId, cfi }: { bookId: string; cfi?: string }) {
  const host = useRef<HTMLDivElement>(null)
  const viewRef = useRef<FoliateView | null>(null)
  const [book, setBook] = useState<Book | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState('')
  const [loc, setLoc] = useState<RelocateDetail | null>(null)
  const [toc, setToc] = useState<{ label: string; href: string; depth: number }[]>([])
  const [fixed, setFixed] = useState(false)
  const [zoom, setZoom] = useState<'fit-page' | 'fit-width'>('fit-page')
  const [hit, setHit] = useState<ActiveHit | null>(null)
  const hitRef = useRef<ActiveHit | null>(null)
  const settings = useSettings()

  function closeLookup() {
    const current = hitRef.current
    if (current) {
      markRange(current.doc, null)
      current.doc.getSelection()?.removeAllRanges()
    }
    hitRef.current = null
    setHit(null)
  }

  useEffect(() => {
    let cancelled = false
    let view: FoliateView | null = null
    let saveTimer: ReturnType<typeof setTimeout> | undefined

    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement | null)?.closest?.('input, textarea, select')) return
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') void view?.goLeft()
      else if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') void view?.goRight()
      else if (e.key === 'Escape') closeLookup()
    }

    const onHit = (doc: Document, index: number, h: LookupHit) => {
      const prev = hitRef.current
      if (prev && prev.surface === h.surface && prev.sentence === h.sentence) return
      if (prev && prev.doc !== doc) markRange(prev.doc, null)
      markRange(doc, h.range)
      let location: string | undefined
      try {
        location = view?.getCFI(index, h.range)
      } catch {
        location = undefined
      }
      const next: ActiveHit = { surface: h.surface, sentence: h.sentence, cfi: location, doc, range: h.range }
      hitRef.current = next
      setHit(next)
    }

    ;(async () => {
      try {
        const b = await db.books.get(bookId)
        if (!b) throw new Error('Das Buch ist nicht (mehr) in der Bibliothek.')
        setBook(b)
        void db.books.update(bookId, { openedAt: Date.now() })
        const { makeBook } = await loadFoliate()
        const parsed = await makeBook(new File([b.file], b.fileName, { type: b.file.type }))
        // papers read better one page at a time than as two-page spreads
        if (b.format === 'pdf' && parsed.rendition) parsed.rendition.spread = 'none'
        if (cancelled || !host.current) return parsed.destroy?.()
        view = document.createElement('foliate-view') as FoliateView
        view.className = 'foliate'
        host.current.append(view)
        viewRef.current = view
        view.addEventListener('load', e => {
          const { doc, index } = (e as CustomEvent<{ doc: Document; index: number }>).detail
          prepareDocument(doc)
          attachLookupHandlers(doc, h => onHit(doc, index, h))
          doc.addEventListener('keydown', onKey)
        })
        view.addEventListener('relocate', e => {
          const detail = (e as CustomEvent<RelocateDetail>).detail
          setLoc(detail)
          clearTimeout(saveTimer)
          saveTimer = setTimeout(() => {
            void db.books.update(bookId, { lastLocation: detail.cfi, progress: detail.fraction ?? 0 })
          }, 600)
        })
        await view.open(parsed)
        if (cancelled) return
        setFixed(view.isFixedLayout)
        setToc(flattenToc(view.book.toc))
        if (!view.isFixedLayout) {
          const r = view.renderer
          r.setAttribute('flow', 'paginated')
          r.setAttribute('margin', '32px')
          r.setAttribute('gap', '6%')
          r.setAttribute('max-inline-size', '680px')
          r.setAttribute('max-column-count', '2')
        }
        await view.init({ lastLocation: cfi ?? b.lastLocation ?? null, showTextStart: !b.lastLocation && !cfi })
        if (!cancelled) setState('ready')
      } catch (e) {
        console.error(e)
        if (!cancelled) {
          setError((e as Error).message)
          setState('error')
        }
      }
    })()

    addEventListener('keydown', onKey)
    return () => {
      cancelled = true
      clearTimeout(saveTimer)
      removeEventListener('keydown', onKey)
      view?.close()
      view?.remove()
      viewRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId])

  // font size for reflowable books
  useEffect(() => {
    const view = viewRef.current
    if (state === 'ready' && view && !view.isFixedLayout) view.renderer.setStyles?.(bookCSS(settings.readerFontScale))
  }, [state, settings.readerFontScale])

  useEffect(() => {
    const view = viewRef.current
    if (state === 'ready' && view?.isFixedLayout) view.renderer.setAttribute('zoom', zoom)
  }, [state, zoom])

  const percent = Math.round((loc?.fraction ?? 0) * 100)
  const chapter = loc?.tocItem?.label?.trim()
  const pageLabel = fixed && loc?.section ? `Seite ${loc.section.current + 1} / ${loc.section.total}` : `${percent} %`
  const view = viewRef.current

  return (
    <div className={`reader ${hit ? 'with-sheet' : ''}`}>
      <header className="reader-bar">
        <a className="icon" href={href({ name: 'library' })} title="Zur Bibliothek">
          ←
        </a>
        <span className="reader-title" title={book?.title}>
          {book?.title ?? '…'}
        </span>
        {toc.length > 0 && (
          <select
            className="toc"
            aria-label="Inhaltsverzeichnis"
            value=""
            onChange={e => {
              if (e.target.value) void view?.goTo(e.target.value)
            }}
          >
            <option value="">{chapter ? chapter.slice(0, 40) : 'Inhalt'}</option>
            {toc.map((t, i) => (
              <option key={i} value={t.href}>
                {'  '.repeat(t.depth)}
                {t.label}
              </option>
            ))}
          </select>
        )}
        {fixed ? (
          <button className="icon" title="Zoom umschalten" onClick={() => setZoom(z => (z === 'fit-page' ? 'fit-width' : 'fit-page'))}>
            {zoom === 'fit-page' ? '⇔' : '⇕'}
          </button>
        ) : (
          <>
            <button
              className="icon"
              title="Schrift kleiner"
              onClick={() => void setSetting('readerFontScale', Math.max(0.7, +(settings.readerFontScale - 0.1).toFixed(1)))}
            >
              A−
            </button>
            <button
              className="icon"
              title="Schrift größer"
              onClick={() => void setSetting('readerFontScale', Math.min(2, +(settings.readerFontScale + 0.1).toFixed(1)))}
            >
              A+
            </button>
          </>
        )}
        <a className="icon" href={href({ name: 'vocab' })} title="Vokabeln">
          📒
        </a>
      </header>

      <div className="reader-stage">
        <button className="turn turn-left" aria-label="Zurück blättern" onClick={() => void view?.goLeft()}>
          ‹
        </button>
        <div className="reader-host" ref={host} data-testid="reader-host" />
        <button className="turn turn-right" aria-label="Weiter blättern" onClick={() => void view?.goRight()}>
          ›
        </button>
        {state === 'loading' && <p className="reader-msg">Öffne Buch …</p>}
        {state === 'error' && (
          <p className="reader-msg error">
            {error} <a href={href({ name: 'library' })}>Zur Bibliothek</a>
          </p>
        )}
      </div>

      <footer className="reader-foot">
        <input
          type="range"
          min={0}
          max={1000}
          value={Math.round((loc?.fraction ?? 0) * 1000)}
          aria-label="Position im Buch"
          onChange={e => void view?.goToFraction(Number(e.target.value) / 1000)}
        />
        <span className="muted">{pageLabel}</span>
      </footer>

      {hit && book && <LookupSheet target={hit} book={{ id: book.id, title: book.title }} onClose={closeLookup} />}
    </div>
  )
}
