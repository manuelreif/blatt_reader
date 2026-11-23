import { describe, expect, it } from 'vitest'
import { createGestureTracker, createPressTracker, modeForKey, nextMode, tapZone, type TouchSample } from '../src/reader/modes'

const at = (t: number, touches: number, ...points: [number, number, number][]): TouchSample => ({
  t,
  touches,
  points: points.map(([id, x, y]) => ({ id, x, y })),
})

describe('reader modes', () => {
  it('cycle read → translate → mark → read', () => {
    expect(nextMode('read')).toBe('translate')
    expect(nextMode('translate')).toBe('mark')
    expect(nextMode('mark')).toBe('read')
  })

  it('have vim-like keys, not with modifiers', () => {
    expect(modeForKey({ key: 'l' })).toBe('read')
    expect(modeForKey({ key: 'U' })).toBe('translate')
    expect(modeForKey({ key: 'ü' })).toBe('translate')
    expect(modeForKey({ key: 'm' })).toBe('mark')
    expect(modeForKey({ key: 'm', ctrlKey: true })).toBeNull()
    expect(modeForKey({ key: 'x' })).toBeNull()
  })

  it('split the reading area in thirds for page turns', () => {
    expect(tapZone(10, 0, 900)).toBe('left')
    expect(tapZone(450, 0, 900)).toBe('middle')
    expect(tapZone(890, 0, 900)).toBe('right')
    expect(tapZone(150, 100, 300)).toBe('left')
  })
})

describe('gesture tracker', () => {
  it('detects a two-finger tap and suppresses the taps of its fingers', () => {
    const g = createGestureTracker()
    g.start(at(0, 1, [1, 100, 100]))
    g.start(at(30, 2, [2, 200, 100]))
    expect(g.multi(80)).toBe(true)
    expect(g.end(at(100, 1, [1, 101, 100]))).toBe(false)
    expect(g.end(at(120, 0, [2, 200, 102]))).toBe(true)
    expect(g.multi(200)).toBe(true)
    // a normal tap later is a tap again
    g.start(at(1000, 1, [3, 50, 50]))
    expect(g.multi(1050)).toBe(false)
    expect(g.end(at(1080, 0, [3, 50, 50]))).toBe(false)
  })

  it('ignores two-finger swipes and pinches, slow presses and three fingers', () => {
    const swipe = createGestureTracker()
    swipe.start(at(0, 2, [1, 100, 100], [2, 200, 100]))
    swipe.move(at(50, 2, [1, 160, 100], [2, 260, 100]))
    expect(swipe.end(at(100, 0, [1, 160, 100], [2, 260, 100]))).toBe(false)

    const slow = createGestureTracker()
    slow.start(at(0, 2, [1, 100, 100], [2, 200, 100]))
    expect(slow.end(at(900, 0, [1, 100, 100], [2, 200, 100]))).toBe(false)

    const three = createGestureTracker()
    three.start(at(0, 3, [1, 100, 100], [2, 200, 100], [3, 300, 100]))
    expect(three.end(at(100, 0, [1, 100, 100], [2, 200, 100], [3, 300, 100]))).toBe(false)
  })
})

describe('press tracker (own touch selection)', () => {
  it('starts after the timer, then follows the finger until it lifts', () => {
    const p = createPressTracker()
    expect(p.start(at(0, 1, [1, 100, 100]))).toEqual({ kind: 'press' })
    // a little jitter before the timer does not count as a swipe
    expect(p.move(at(100, 1, [1, 104, 103]))).toBeNull()
    expect(p.active).toBe(false)
    expect(p.fire()).toEqual({ x: 100, y: 100 })
    expect(p.active).toBe(true)
    expect(p.move(at(600, 1, [1, 180, 102]))).toEqual({ kind: 'drag', x: 180, y: 102 })
    expect(p.end(at(700, 0, [1, 190, 102]))).toEqual({ kind: 'done', x: 190, y: 102 })
    expect(p.active).toBe(false)
    expect(p.fire()).toBeNull()
  })

  it('gives way to swipes, taps and a second finger', () => {
    const swipe = createPressTracker()
    swipe.start(at(0, 1, [1, 100, 100]))
    expect(swipe.move(at(80, 1, [1, 130, 100]))).toEqual({ kind: 'cancel' })
    expect(swipe.fire()).toBeNull()
    expect(swipe.move(at(500, 1, [1, 160, 100]))).toBeNull()

    const tap = createPressTracker()
    tap.start(at(0, 1, [1, 100, 100]))
    expect(tap.end(at(120, 0, [1, 100, 100]))).toEqual({ kind: 'cancel' })
    expect(tap.fire()).toBeNull()

    const pinch = createPressTracker()
    pinch.start(at(0, 1, [1, 100, 100]))
    expect(pinch.fire()).not.toBeNull()
    expect(pinch.start(at(600, 2, [2, 200, 100]))).toEqual({ kind: 'cancel' })
    expect(pinch.active).toBe(false)
    expect(pinch.end(at(700, 1, [1, 100, 100]))).toBeNull()

    const cancelled = createPressTracker()
    cancelled.start(at(0, 1, [1, 100, 100]))
    cancelled.fire()
    expect(cancelled.cancel()).toEqual({ kind: 'cancel' })
    expect(cancelled.cancel()).toBeNull()
  })

  it('only follows its own finger', () => {
    const p = createPressTracker()
    p.start(at(0, 1, [7, 100, 100]))
    p.fire()
    expect(p.move(at(600, 1, [8, 300, 300]))).toBeNull()
    expect(p.end(at(650, 0, [8, 300, 300]))).toBeNull()
    expect(p.active).toBe(true)
  })
})
