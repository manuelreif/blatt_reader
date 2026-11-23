import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useRef, useState } from 'react'
import { Emblem } from '../brand/Logo'
import { db, type Book, type Highlight, type HighlightColor } from '../db/schema'
import { LookupSheet } from '../lookup/LookupSheet'
import { PassageSheet } from '../lookup/PassageSheet'
import type { LookupTarget } from '../lookup/lookupService'
import { href } from '../router'
import { getSettings, setSetting, useSettings } from '../settings/settings'
import { trackVisualViewport } from '../util/visualViewport'
import { flattenToc, loadFoliate, type FoliateView, type RelocateDetail } from './foliate'
import { HighlightList } from './HighlightList'
import { addHighlight, bookHighlights, drawnRange, highlightAt, paintHighlights } from './highlights'
import { HighlightSheet } from './HighlightSheet'
import { modeForKey, modeInfo, nextMode, tapZone, type ReaderMode } from './modes'
import {
  attachReaderHandlers,
  hitFromRange,
  markFromRange,
  markFromSelection,
  markRange,
  prepareDocument,
  type LookupHit,
  type MarkSpan,
  type PassageHit,
} from './selection'

const bookCSS = (fontScale: number) => `
  html { color-scheme: light dark; font-size: ${Math.round(fontScale * 100)}% !important; }
  p, li, blockquote, dd {
    line-height: 1.5;
    hyphens: auto;
    -webkit-hyphens: auto;
    widows: 2;
  }
  pre { white-space: pre-wrap !important; }
  html { color: #18222f; }
  a:link { color: #1f3350; }
  @media (prefers-color-scheme: dark) {
    html { color: #e4ddca; }
    a:link { color: #e2d5ad; }
  }
`

type ActiveHit = LookupTarget & { doc: Document; range: Range }
/** a selection too long to look up, shown in the passage sheet */
type ActivePassage = PassageHit & { doc: Document; index: number }

/** the mark sheet: a selection waiting for a color, or a saved mark */
type MarkSheet = { kind: 'pending'; doc: Document; index: number; span: MarkSpan } | { kind: 'saved'; id: string }

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
  const [passage, setPassage] = useState<ActivePassage | null>(null)
  const passageRef = useRef<ActivePassage | null>(null)
  const [markSheet, setMarkSheet] = useState<MarkSheet | null>(null)
  const [listOpen, setListOpen] = useState(false)
  const [toast, setToast] = useState('')
  const settings = useSettings()
  const mode = settings.readerMode
  const modeRef = useRef<ReaderMode>(mode)
  modeRef.current = mode
  const highlights = useLiveQuery(() => bookHighlights(bookId), [bookId])
  const highlightsRef = useRef<Highlight[]>([])
  /** loaded book documents and their section index (the PDF renderer does not tell the index) */
  const docs = useRef(new Map<Document, number>())
  // set up once the book opens, used by the sheets
  const saveMarkRef = useRef<
    ((doc: Document, index: number, span: MarkSpan, color?: HighlightColor, note?: string) => Promise<void>) | null
  >(null)
  const lookupRef = useRef<((doc: Document, index: number, h: LookupHit) => void) | null>(null)

  function paint(doc: Document, index: number) {
    paintHighlights(
      doc,
      highlightsRef.current.filter(h => h.section === index),
    )
  }

  function switchMode(next: ReaderMode) {
    if (next !== modeRef.current) {
      modeRef.current = next
      void setSetting('readerMode', next)
    }
    closeLookup()
    setMarkSheet(null)
    const info = modeInfo(next)
    setToast(`Modus: ${info.icon} ${info.label} – ${info.hint}`)
  }

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(''), 2200)
    return () => clearTimeout(t)
  }, [toast])

  // the sheets stay in the part of the page on screen when it is pinch-zoomed (.overlay-layer)
  useEffect(() => trackVisualViewport(), [])

  // the word, passage or pending mark being worked on carries the lookup highlight; on touch
  // screens it is the only sign of the selection (no native one, see attachReaderHandlers)
  useEffect(() => {
    const target = hit
      ? { doc: hit.doc, range: hit.range }
      : passage
        ? { doc: passage.doc, range: passage.span.range }
        : markSheet?.kind === 'pending'
          ? { doc: markSheet.doc, range: markSheet.span.range }
          : null
    for (const doc of docs.current.keys()) markRange(doc, doc === target?.doc ? target.range : null)
  }, [hit, passage, markSheet])

  // redraw the marks whenever they change (here or by a sync)
  useEffect(() => {
    highlightsRef.current = highlights ?? []
    for (const [doc, index] of docs.current) {
      if (!doc.defaultView) docs.current.delete(doc)
      else paint(doc, index)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlights])

  /** closes the word sheet and the passage sheet */
  function closeLookup() {
    ;(hitRef.current?.doc ?? passageRef.current?.doc)?.getSelection()?.removeAllRanges()
    hitRef.current = null
    passageRef.current = null
    setHit(null)
    setPassage(null)
  }

  useEffect(() => {
    let cancelled = false
    let view: FoliateView | null = null
    let saveTimer: ReturnType<typeof setTimeout> | undefined

    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement | null)?.closest?.('input, textarea, select')) return
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') void view?.goLeft()
      else if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') void view?.goRight()
      else if (e.key === 'Escape') {
        closeLookup()
        setMarkSheet(null)
        setListOpen(false)
      } else {
        const m = modeForKey(e)
        if (m) switchMode(m)
      }
    }

    const cfiOf = (index: number, range: Range) => {
      try {
        return view?.getCFI(index, range)
      } catch {
        return undefined
      }
    }

    async function saveMark(doc: Document, index: number, span: MarkSpan, color?: HighlightColor, note?: string) {
      const b = await db.books.get(bookId)
      const h = await addHighlight({
        bookId,
        bookTitle: b?.title ?? '',
        section: index,
        start: span.start,
        end: span.end,
        text: span.text,
        cfi: cfiOf(index, span.range),
        color: color ?? (await getSettings()).highlightColor,
        ...(note?.trim() ? { note: note.trim() } : {}),
      })
      doc.getSelection()?.removeAllRanges()
      setMarkSheet({ kind: 'saved', id: h.id })
    }
    saveMarkRef.current = saveMark

    const onTurnTap = (x: number) => {
      const rect = host.current?.getBoundingClientRect()
      if (!rect) return
      const zone = tapZone(x, rect.left, rect.width)
      if (zone === 'left') void view?.goLeft()
      else if (zone === 'right') void view?.goRight()
    }

    const onHit = (doc: Document, index: number, h: LookupHit) => {
      const prev = hitRef.current
      if (prev && prev.surface === h.surface && prev.sentence === h.sentence) return
      let location: string | undefined
      try {
        location = view?.getCFI(index, h.range)
      } catch {
        location = undefined
      }
      const next: ActiveHit = { surface: h.surface, sentence: h.sentence, cfi: location, doc, range: h.range }
      hitRef.current = next
      setHit(next)
      passageRef.current = null
      setPassage(null)
      setMarkSheet(null)
    }
    lookupRef.current = onHit

    // the selection stays: its handles can still be dragged while the sheet is open
    const onPassage = (doc: Document, index: number, p: PassageHit) => {
      const prev = passageRef.current
      if (prev && prev.doc === doc && prev.text === p.text) return
      hitRef.current = null
      setHit(null)
      const next: ActivePassage = { ...p, doc, index }
      passageRef.current = next
      setPassage(next)
      setMarkSheet(null)
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
          docs.current.set(doc, index)
          paint(doc, index)
          // PDF text layers are filled in (and redrawn on zoom) after "load"
          let repaint: ReturnType<typeof setTimeout> | undefined
          new MutationObserver(() => {
            clearTimeout(repaint)
            repaint = setTimeout(() => paint(doc, index), 150)
          }).observe(doc.body ?? doc.documentElement, { childList: true, subtree: true })
          attachReaderHandlers(doc, {
            mode: () => modeRef.current,
            onLookup: h => onHit(doc, index, h),
            onPassage: p => onPassage(doc, index, p),
            onMarkWord: h => {
              closeLookup()
              const span = markFromRange(doc, h.range)
              if (span) void saveMark(doc, index, span)
            },
            onMarkSelection: touchSpan => {
              closeLookup()
              const span = touchSpan ?? markFromSelection(doc)
              if (span) setMarkSheet({ kind: 'pending', doc, index, span })
            },
            onTapMark: (x, y) => {
              const found = highlightAt(doc, x, y)
              if (!found) return false
              closeLookup()
              setMarkSheet({ kind: 'saved', id: found.id })
              return true
            },
            onTap: onTurnTap,
            onCycleMode: () => switchMode(nextMode(modeRef.current)),
          })
          doc.addEventListener('keydown', onKey)
        })
        // progressAt only when the position really moved: merely opening the book on a
        // second device must not beat the position synced from the first one
        let savedCfi = b.lastLocation
        view.addEventListener('relocate', e => {
          const detail = (e as CustomEvent<RelocateDetail>).detail
          setLoc(detail)
          clearTimeout(saveTimer)
          saveTimer = setTimeout(() => {
            const moved = detail.cfi !== savedCfi
            savedCfi = detail.cfi
            void db.books.update(bookId, {
              lastLocation: detail.cfi,
              progress: detail.fraction ?? 0,
              ...(moved ? { progressAt: Date.now() } : {}),
            })
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
      docs.current.clear()
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
  const info = modeInfo(mode)

  function pickPending(color: HighlightColor) {
    if (markSheet?.kind !== 'pending') return
    void setSetting('highlightColor', color)
    // the selection may have changed since the sheet opened (dragged handles)
    const span = markFromSelection(markSheet.doc) ?? markSheet.span
    void saveMarkRef.current?.(markSheet.doc, markSheet.index, span, color)
  }

  /** saves the passage as a mark, its translation (if any) as the note */
  function markPassage(note?: string) {
    const p = passageRef.current
    if (!p) return
    passageRef.current = null
    setPassage(null)
    void saveMarkRef.current?.(p.doc, p.index, p.span, undefined, note)
  }

  function lookupMarked() {
    const sheet = markSheet
    setMarkSheet(null)
    if (!sheet) return
    let doc: Document | undefined
    let range: Range | null = null
    if (sheet.kind === 'pending') {
      doc = sheet.doc
      range = sheet.span.range
    } else {
      const h = highlights?.find(x => x.id === sheet.id)
      for (const [d, index] of docs.current)
        if (h && index === h.section && (range = drawnRange(d, h.id))) {
          doc = d
          break
        }
    }
    const target = range && hitFromRange(range)
    if (doc && target) lookupRef.current?.(doc, docs.current.get(doc) ?? 0, target)
  }

  return (
    <div className={`reader mode-${mode} ${hit || passage || markSheet || listOpen ? 'with-sheet' : ''}`}>
      <header className="reader-bar">
        <a className="reader-home" href={href({ name: 'library' })} title="Zur Bibliothek" aria-label="Zur Bibliothek">
          <span aria-hidden>‹</span>
          <Emblem />
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
        <button
          className="mode-switch"
          title={`Modus: ${info.label} (${info.hint}). Wechseln: antippen, Tasten l / u / m oder Zwei-Finger-Tipp`}
          aria-label={`Modus: ${info.label}, wechseln`}
          onClick={() => switchMode(nextMode(mode))}
          data-testid="mode-switch"
        >
          <span aria-hidden>{info.icon}</span>
          <span className="mode-label">{info.label}</span>
        </button>
        <button
          className="icon"
          title="Markierungen in diesem Buch"
          aria-label="Markierungen"
          onClick={() => {
            closeLookup()
            setMarkSheet(null)
            setListOpen(o => !o)
          }}
          data-testid="mark-list-button"
        >
          ☰
        </button>
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
        {state === 'loading' && (
          <div className="reader-msg reader-loading">
            <Emblem />
            <span>Öffne Buch …</span>
          </div>
        )}
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

      <div className="overlay-layer">
        {hit && book && (
          <LookupSheet target={hit} book={{ id: book.id, title: book.title }} onClose={closeLookup} onSaved={setToast} />
        )}
        {passage && <PassageSheet text={passage.text} context={passage.context} onMark={markPassage} onClose={closeLookup} />}
        {!hit && !passage && markSheet && (
          <HighlightSheet
            id={markSheet.kind === 'saved' ? markSheet.id : undefined}
            pendingText={markSheet.kind === 'pending' ? markSheet.span.text : undefined}
            onPickPending={pickPending}
            onLookup={lookupMarked}
            onClose={() => {
              if (markSheet.kind === 'pending') markSheet.doc.getSelection()?.removeAllRanges()
              setMarkSheet(null)
            }}
          />
        )}
        {!hit && !passage && !markSheet && listOpen && (
          <HighlightList
            list={highlights ?? []}
            onPick={h => {
              setListOpen(false)
              void view?.goTo(h.cfi ?? h.section)
              setMarkSheet({ kind: 'saved', id: h.id })
            }}
            onClose={() => setListOpen(false)}
          />
        )}
        <div className="reader-toast" role="status" aria-live="polite">
          {toast && <span data-testid="reader-toast">{toast}</span>}
        </div>
      </div>
    </div>
  )
}
