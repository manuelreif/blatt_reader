// Takes over a new deployment without the user having to close the app. The plain registerSW.js
// that vite-plugin-pwa injects only registers the service worker: a new one installs and takes
// control in the background, but the open page keeps running the old code until it is loaded
// again, and Android keeps a tab or installed app alive for days. So we check for updates when
// the app comes back to the screen (and hourly) and reload once the new version is active, at a
// moment that costs nothing: in the background, or right after opening/returning.

import { registerSW } from 'virtual:pwa-register'

/** after opening or returning to the app, a reload is still harmless for this long */
export const FRESH_MS = 10_000
/** lets the reader's debounced position save (600 ms) land before the page goes */
export const RELOAD_DELAY_MS = 1_000
const CHECK_EVERY_MS = 60 * 60_000
const MIN_CHECK_GAP_MS = 60_000

export interface ReloadEnv {
  doc: Document
  now: () => number
  reload: () => void
  setTimeout: (fn: () => void, ms: number) => unknown
}

/** Decides when to reload once a new version has taken control (`needReload`). */
export function createReloadPolicy(env: ReloadEnv) {
  const { doc } = env
  let visibleSince = env.now()
  let pending = false
  let scheduled = false
  const schedule = () => {
    if (scheduled) return
    scheduled = true
    env.setTimeout(env.reload, RELOAD_DELAY_MS)
  }
  const typing = () => {
    const a = doc.activeElement as HTMLElement | null
    return !!a && (a.isContentEditable || a.matches('input, textarea, select'))
  }
  doc.addEventListener('visibilitychange', () => {
    if (doc.visibilityState === 'hidden') {
      if (pending) schedule()
    } else visibleSince = env.now()
  })
  return {
    needReload() {
      if (doc.visibilityState === 'hidden' || (env.now() - visibleSince < FRESH_MS && !typing())) schedule()
      // in the middle of reading or typing: wait until the app goes to the background
      else pending = true
    },
  }
}

export function initAutoUpdate() {
  if (!('serviceWorker' in navigator)) return
  const policy = createReloadPolicy({
    doc: document,
    now: Date.now,
    reload: () => location.reload(),
    setTimeout: (fn, ms) => window.setTimeout(fn, ms),
  })
  let lastCheck = Date.now() // registering checks once by itself
  registerSW({
    immediate: true,
    onNeedReload: policy.needReload,
    onRegisteredSW(_url, registration) {
      if (!registration) return
      const check = () => {
        if (document.visibilityState !== 'visible' || !navigator.onLine) return
        if (Date.now() - lastCheck < MIN_CHECK_GAP_MS) return
        lastCheck = Date.now()
        // offline or logged out (sw.js sits behind the password gate): try again next time
        registration.update().catch(() => {})
      }
      document.addEventListener('visibilitychange', check)
      setInterval(check, CHECK_EVERY_MS)
    },
  })
}
