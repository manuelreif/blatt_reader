import { EMBLEM, LETTERING } from './logoPaths'

export const APP_NAME = 'Blatt-Reader'

/**
 * The round emblem. Colors come from CSS (--logo-disc, --logo-ink), so it follows
 * the light/dark theme; `.emblem.bare` drops the disc for use on a navy surface.
 */
export function Emblem({ className = '', title }: { className?: string; title?: string }) {
  return (
    <svg
      className={`emblem ${className}`}
      viewBox="0 0 512 512"
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <circle className="emblem-disc" cx="256" cy="256" r="256" />
      <circle className="emblem-ring" cx="256" cy="256" r={EMBLEM.ringR} fill="none" strokeWidth={EMBLEM.ringW} />
      <path className="emblem-glyph" d={EMBLEM.glyph} />
    </svg>
  )
}

/** Just the book turning into a leaf, without disc and ring (cover placeholders). */
export function Glyph({ className = '' }: { className?: string }) {
  return (
    <svg className={`glyph ${className}`} viewBox="104 125 304 262" aria-hidden>
      <path d={EMBLEM.glyph} fill="currentColor" />
    </svg>
  )
}

/** "Blatt - Reader" lettering in currentColor. */
export function Lettering({ className = '' }: { className?: string }) {
  return (
    <svg className={`lettering ${className}`} viewBox={`0 0 ${LETTERING.width} 100`} role="img" aria-label={APP_NAME}>
      <path d={LETTERING.d} fill="currentColor" fillRule="evenodd" />
    </svg>
  )
}

/** Emblem and lettering side by side; the CSS hides the lettering on narrow screens. */
export function Lockup({ className = '' }: { className?: string }) {
  return (
    <span className={`lockup ${className}`}>
      <Emblem />
      <Lettering />
    </span>
  )
}
