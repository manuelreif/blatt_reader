// "Install app" button: Chrome/Edge fire `beforeinstallprompt` once the page is installable.
// We keep that event and replay it on a tap, so installing does not depend on Chrome's own
// mini-infobar (which needs engagement heuristics and stays away for months once dismissed).
// Must be imported before the event fires, hence `initInstallPrompt()` in main.tsx.

import { useSyncExternalStore } from 'react'

/** Not in lib.dom: https://developer.mozilla.org/docs/Web/API/BeforeInstallPromptEvent */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export interface InstallState {
  /** the browser offers installation right now */
  canInstall: boolean
  /** running as installed app, or just installed from here */
  installed: boolean
}

let deferred: BeforeInstallPromptEvent | null = null
let state: InstallState = { canInstall: false, installed: false }
const listeners = new Set<() => void>()

function set(next: Partial<InstallState>) {
  state = { ...state, ...next }
  listeners.forEach(l => l())
}

function runningStandalone(win: Window): boolean {
  return (
    win.matchMedia?.('(display-mode: standalone)').matches ||
    win.matchMedia?.('(display-mode: fullscreen)').matches ||
    (win.navigator as Navigator & { standalone?: boolean }).standalone === true
  )
}

let initialized = false

export function initInstallPrompt(win: Window = window) {
  if (initialized) return
  initialized = true
  set({ installed: runningStandalone(win) })
  win.addEventListener('beforeinstallprompt', e => {
    e.preventDefault() // no mini-infobar; our button takes over
    deferred = e as BeforeInstallPromptEvent
    set({ canInstall: true, installed: false })
  })
  win.addEventListener('appinstalled', () => {
    deferred = null
    set({ canInstall: false, installed: true })
  })
}

/** Shows the browser's install dialog. Returns true if the user accepted. */
export async function promptInstall(): Promise<boolean> {
  const e = deferred
  if (!e) return false
  // an event can be prompted only once; Chrome fires a new one if the user declines
  deferred = null
  set({ canInstall: false })
  await e.prompt()
  const { outcome } = await e.userChoice
  if (outcome === 'accepted') set({ installed: true })
  return outcome === 'accepted'
}

function subscribe(l: () => void) {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function useInstallPrompt(): InstallState {
  return useSyncExternalStore(subscribe, () => state)
}

/** for tests */
export function resetInstallPrompt() {
  initialized = false
  deferred = null
  state = { canInstall: false, installed: false }
  listeners.clear()
}
