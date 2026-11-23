// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { initInstallPrompt, promptInstall, resetInstallPrompt, useInstallPrompt } from '../src/pwa/install'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/** Minimal renderHook (no testing-library in this project). */
function renderHook<T>(hook: () => T) {
  const result = { current: undefined as T, unmount: () => {} }
  function Probe() {
    result.current = hook()
    return null
  }
  const root = createRoot(document.createElement('div'))
  act(() => root.render(createElement(Probe)))
  result.unmount = () => act(() => root.unmount())
  return result
}

function fakePrompt(outcome: 'accepted' | 'dismissed') {
  const e = new Event('beforeinstallprompt', { cancelable: true }) as Event & {
    prompt: () => Promise<void>
    userChoice: Promise<{ outcome: string }>
  }
  e.prompt = vi.fn(async () => {})
  e.userChoice = Promise.resolve({ outcome })
  return e
}

describe('install prompt', () => {
  beforeEach(() => {
    resetInstallPrompt()
    window.matchMedia = ((q: string) => ({ matches: false, media: q })) as unknown as typeof window.matchMedia
  })

  it('keeps the browser event, suppresses the mini-infobar and replays it on request', async () => {
    initInstallPrompt(window)
    const hook = renderHook(useInstallPrompt)
    expect(hook.current).toEqual({ canInstall: false, installed: false })

    const e = fakePrompt('accepted')
    act(() => void window.dispatchEvent(e))
    expect(e.defaultPrevented).toBe(true)
    expect(hook.current.canInstall).toBe(true)

    let ok = false
    await act(async () => {
      ok = await promptInstall()
    })
    expect(e.prompt).toHaveBeenCalledOnce()
    expect(ok).toBe(true)
    expect(hook.current).toEqual({ canInstall: false, installed: true })
    hook.unmount()
  })

  it('declining hides the button until the browser offers it again', async () => {
    initInstallPrompt(window)
    window.dispatchEvent(fakePrompt('dismissed'))
    expect(await promptInstall()).toBe(false)
    expect(await promptInstall()).toBe(false) // event used up
    window.dispatchEvent(fakePrompt('accepted'))
    expect(await promptInstall()).toBe(true)
  })

  it('knows when it already runs as installed app', () => {
    window.matchMedia = ((q: string) => ({ matches: q === '(display-mode: standalone)', media: q })) as unknown as typeof window.matchMedia
    initInstallPrompt(window)
    const hook = renderHook(useInstallPrompt)
    expect(hook.current.installed).toBe(true)
    hook.unmount()
  })

  it('appinstalled (e.g. installed via the browser menu) hides the button', () => {
    initInstallPrompt(window)
    window.dispatchEvent(fakePrompt('accepted'))
    const hook = renderHook(useInstallPrompt)
    act(() => void window.dispatchEvent(new Event('appinstalled')))
    expect(hook.current).toEqual({ canInstall: false, installed: true })
    hook.unmount()
  })
})
