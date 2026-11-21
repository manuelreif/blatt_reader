// Thin typed wrapper around foliate-js (public/foliate-js, git submodule).
// foliate-js is loaded unbundled as native ES modules: its PDF adapter locates
// PDF.js via import.meta.url, which bundling would break.

export interface TocItem {
  label: string
  href: string
  subitems?: TocItem[] | null
}

export interface FoliateBook {
  metadata?: { title?: unknown; author?: unknown; language?: unknown }
  toc?: TocItem[]
  sections: unknown[]
  dir?: string
  rendition?: { layout?: string; spread?: string }
  getCover?(): Promise<Blob | null>
  destroy?(): void
}

export interface RelocateDetail {
  fraction?: number
  section?: { current: number; total: number }
  location?: { current: number; next: number; total: number }
  tocItem?: { label?: string; href?: string } | null
  pageItem?: { label?: string } | null
  cfi: string
  range?: Range
}

export interface FoliateRenderer extends HTMLElement {
  setStyles?(css: string): void
  getContents(): { doc: Document; index: number }[]
}

export interface FoliateView extends HTMLElement {
  book: FoliateBook
  renderer: FoliateRenderer
  isFixedLayout: boolean
  lastLocation: RelocateDetail | null
  open(book: Blob | File | string | FoliateBook): Promise<void>
  close(): void
  init(opts: { lastLocation?: string | null; showTextStart?: boolean }): Promise<void>
  goTo(target: string | number): Promise<unknown>
  goToFraction(frac: number): Promise<void>
  prev(): Promise<void>
  next(): Promise<void>
  goLeft(): Promise<void>
  goRight(): Promise<void>
  getCFI(index: number, range?: Range): string
  deselect(): void
}

interface FoliateModule {
  makeBook(file: File | Blob): Promise<FoliateBook>
}

let mod: Promise<FoliateModule> | null = null

export function loadFoliate(): Promise<FoliateModule> {
  // absolute URL: in dev, Vite appends "?import" to relative dynamic imports,
  // which breaks serving the file from public/
  const url = new URL(`${import.meta.env.BASE_URL}foliate-js/view.js`, location.href).href
  mod ??= import(/* @vite-ignore */ url) as Promise<FoliateModule>
  return mod
}

/** foliate metadata values can be strings, language maps or contributor objects. */
export function metaString(x: unknown): string {
  if (!x) return ''
  if (typeof x === 'string') return x
  if (Array.isArray(x)) return x.map(metaString).filter(Boolean).join(', ')
  if (typeof x === 'object') {
    const o = x as Record<string, unknown>
    if ('name' in o) return metaString(o.name)
    const first = Object.values(o)[0]
    return metaString(first)
  }
  return String(x)
}

export function flattenToc(items: TocItem[] | undefined, depth = 0): { label: string; href: string; depth: number }[] {
  if (!items) return []
  return items.flatMap(i => [
    { label: i.label?.trim() || '…', href: i.href, depth },
    ...flattenToc(i.subitems ?? undefined, depth + 1),
  ])
}
