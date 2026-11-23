// Reader modes (like vim's): what a tap or a selection in the book does.

export type ReaderMode = 'read' | 'translate' | 'mark'

export const READER_MODES: { mode: ReaderMode; icon: string; label: string; hint: string }[] = [
  { mode: 'read', icon: '📖', label: 'Lesen', hint: 'Tippen links/rechts blättert' },
  { mode: 'translate', icon: '🔤', label: 'Übersetzen', hint: 'Wort antippen schlägt nach' },
  { mode: 'mark', icon: '🖍', label: 'Markieren', hint: 'Wort antippen oder Text auswählen markiert' },
]

export const modeInfo = (mode: ReaderMode) => READER_MODES.find(m => m.mode === mode) ?? READER_MODES[1]

export const nextMode = (mode: ReaderMode): ReaderMode =>
  READER_MODES[(READER_MODES.findIndex(m => m.mode === mode) + 1) % READER_MODES.length].mode

/** Keyboard shortcut → mode (l = Lesen, u/ü = Übersetzen, m = Markieren). */
export function modeForKey(e: { key: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean }): ReaderMode | null {
  if (e.ctrlKey || e.metaKey || e.altKey) return null
  switch (e.key.toLowerCase()) {
    case 'l':
      return 'read'
    case 'u':
    case 'ü':
      return 'translate'
    case 'm':
      return 'mark'
    default:
      return null
  }
}

/** Which third of the reading area a tap hit (read mode turns pages on the outer ones). */
export function tapZone(x: number, left: number, width: number): 'left' | 'middle' | 'right' {
  const f = (x - left) / width
  return f < 1 / 3 ? 'left' : f > 2 / 3 ? 'right' : 'middle'
}

export interface TouchSample {
  /** fingers on the screen after the event */
  touches: number
  /** positions of the fingers that changed */
  points: { id: number; x: number; y: number }[]
  t: number
}

const TAP_MS = 350
const TAP_MOVE = 12

/**
 * Detects a two-finger tap from touchstart/touchmove/touchend samples. Pure, so it can be
 * tested without real TouchEvents. While a gesture with more than one finger is going on
 * (and right after it), single-finger taps should be ignored: `multi` tells.
 */
export function createGestureTracker() {
  let start = 0
  let maxFingers = 0
  let moved = false
  const origin = new Map<number, { x: number; y: number }>()
  let lastMultiEnd = -Infinity

  return {
    start(s: TouchSample) {
      if (origin.size === 0) {
        start = s.t
        maxFingers = 0
        moved = false
      }
      for (const p of s.points) origin.set(p.id, { x: p.x, y: p.y })
      maxFingers = Math.max(maxFingers, s.touches, origin.size)
    },
    move(s: TouchSample) {
      for (const p of s.points) {
        const o = origin.get(p.id)
        if (o && Math.hypot(p.x - o.x, p.y - o.y) > TAP_MOVE) moved = true
      }
    },
    /** true when this touchend finishes a two-finger tap */
    end(s: TouchSample): boolean {
      for (const p of s.points) {
        const o = origin.get(p.id)
        if (o && Math.hypot(p.x - o.x, p.y - o.y) > TAP_MOVE) moved = true
      }
      if (s.touches > 0) return false
      origin.clear()
      if (maxFingers < 2) return false
      lastMultiEnd = s.t
      return maxFingers === 2 && !moved && s.t - start <= TAP_MS
    },
    /** a multi-finger gesture is running or ended just now (its pointerups are no taps) */
    multi(t: number): boolean {
      return maxFingers > 1 && (origin.size > 0 || t - lastMultiEnd < 400)
    },
  }
}

/** how long a finger rests on a word before the own touch selection starts */
export const LONG_PRESS_MS = 450
/** a finger moving further than this before LONG_PRESS_MS swipes or scrolls instead */
const PRESS_MOVE = 10

export type PressStep =
  /** one finger went down: start the LONG_PRESS_MS timer, then call fire() */
  | { kind: 'press' }
  /** the press or the running selection is off (moved too early, another finger, touchcancel) */
  | { kind: 'cancel' }
  /** the selecting finger moved */
  | { kind: 'drag'; x: number; y: number }
  /** the selecting finger lifted */
  | { kind: 'done'; x: number; y: number }

/**
 * Press and hold, then drag (the own text selection on touch screens, which replaces the native
 * one with its handles and Chrome's "Touch to Search"). Pure like createGestureTracker: the
 * caller runs the timer and calls fire() when it expires.
 */
export function createPressTracker() {
  let state: 'idle' | 'pending' | 'active' = 'idle'
  let id = -1
  let origin = { x: 0, y: 0 }
  const mine = (s: TouchSample) => s.points.find(p => p.id === id)
  const stop = (): PressStep | null => {
    const was = state
    state = 'idle'
    return was === 'idle' ? null : { kind: 'cancel' }
  }

  return {
    start(s: TouchSample): PressStep | null {
      if (s.touches !== 1 || s.points.length !== 1) return stop()
      const p = s.points[0]
      state = 'pending'
      id = p.id
      origin = { x: p.x, y: p.y }
      return { kind: 'press' }
    },
    /** the timer expired: the selection starts at the returned point (null if the press is off) */
    fire(): { x: number; y: number } | null {
      if (state !== 'pending') return null
      state = 'active'
      return origin
    },
    move(s: TouchSample): PressStep | null {
      const p = mine(s)
      if (!p || state === 'idle') return null
      if (state === 'active') return { kind: 'drag', x: p.x, y: p.y }
      return Math.hypot(p.x - origin.x, p.y - origin.y) > PRESS_MOVE ? stop() : null
    },
    end(s: TouchSample): PressStep | null {
      const p = mine(s)
      if (!p || state === 'idle') return null
      if (state === 'pending') return stop()
      state = 'idle'
      return { kind: 'done', x: p.x, y: p.y }
    },
    /** touchcancel, or the selection could not start */
    cancel: stop,
    get active() {
      return state === 'active'
    },
  }
}
