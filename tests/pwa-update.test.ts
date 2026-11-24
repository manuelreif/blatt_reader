// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('virtual:pwa-register', () => ({ registerSW: vi.fn() }))
const { createReloadPolicy, FRESH_MS, RELOAD_DELAY_MS } = await import('../src/pwa/update')

let visibility: DocumentVisibilityState = 'visible'
Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility })

function setVisibility(v: DocumentVisibilityState) {
  visibility = v
  document.dispatchEvent(new Event('visibilitychange'))
}

function setup() {
  let now = 0
  const timers: { fn: () => void; ms: number }[] = []
  const reload = vi.fn()
  const policy = createReloadPolicy({
    doc: document,
    now: () => now,
    reload,
    setTimeout: (fn, ms) => timers.push({ fn, ms }),
  })
  const runTimers = () => timers.splice(0).forEach(t => t.fn())
  return { policy, reload, timers, runTimers, advance: (ms: number) => (now += ms) }
}

describe('reload into a new version', () => {
  beforeEach(() => {
    visibility = 'visible'
    document.body.innerHTML = ''
    ;(document.activeElement as HTMLElement | null)?.blur()
  })

  it('reloads right after opening, a moment later so the reading position gets saved', () => {
    const { policy, reload, timers, runTimers } = setup()
    policy.needReload()
    expect(timers).toEqual([{ fn: reload, ms: RELOAD_DELAY_MS }])
    runTimers()
    expect(reload).toHaveBeenCalledOnce()
  })

  it('reloads right after returning to the app', () => {
    const { policy, reload, runTimers, advance } = setup()
    advance(FRESH_MS * 10)
    setVisibility('hidden')
    advance(60_000)
    setVisibility('visible')
    advance(2_000)
    policy.needReload()
    runTimers()
    expect(reload).toHaveBeenCalledOnce()
  })

  it('in the middle of reading, waits until the app goes to the background', () => {
    const { policy, reload, timers, runTimers, advance } = setup()
    advance(FRESH_MS + 1)
    policy.needReload()
    expect(timers).toEqual([])
    setVisibility('hidden')
    runTimers()
    expect(reload).toHaveBeenCalledOnce()
  })

  it('never reloads while a text field has the focus', () => {
    const { policy, timers } = setup()
    const input = document.createElement('input')
    document.body.append(input)
    input.focus()
    policy.needReload()
    expect(timers).toEqual([])
    setVisibility('hidden')
    expect(timers).toHaveLength(1)
  })

  it('reloads at once when the update lands in the background, and only once', () => {
    const { policy, timers, advance } = setup()
    advance(FRESH_MS * 10)
    setVisibility('hidden')
    policy.needReload()
    policy.needReload()
    expect(timers).toHaveLength(1)
  })
})
