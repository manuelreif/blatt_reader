// Mirrors the visual viewport (the part of the page on screen when pinch-zoomed, or above the
// on-screen keyboard) into CSS variables, so overlays like the reader's sheets can stay in view
// at their normal size (.overlay-layer in styles.css).

const VARS = ['--vv-left', '--vv-top', '--vv-width', '--vv-height', '--vv-scale'] as const

/** Keeps the --vv-* variables on `root` up to date; returns a function that stops and removes them. */
export function trackVisualViewport(
  root: HTMLElement = document.documentElement,
  vv: VisualViewport | null | undefined = globalThis.visualViewport,
): () => void {
  if (!vv) return () => {}
  let frame = 0
  const update = () => {
    frame = 0
    root.style.setProperty('--vv-left', `${vv.offsetLeft}px`)
    root.style.setProperty('--vv-top', `${vv.offsetTop}px`)
    root.style.setProperty('--vv-width', `${vv.width}px`)
    root.style.setProperty('--vv-height', `${vv.height}px`)
    root.style.setProperty('--vv-scale', String(vv.scale || 1))
  }
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(update)
  }
  update()
  vv.addEventListener('resize', schedule)
  vv.addEventListener('scroll', schedule)
  return () => {
    if (frame) cancelAnimationFrame(frame)
    vv.removeEventListener('resize', schedule)
    vv.removeEventListener('scroll', schedule)
    for (const v of VARS) root.style.removeProperty(v)
  }
}
