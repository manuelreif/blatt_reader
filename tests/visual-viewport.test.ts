// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { trackVisualViewport } from '../src/util/visualViewport'

class FakeViewport extends EventTarget {
  offsetLeft = 0
  offsetTop = 0
  width = 400
  height = 800
  scale = 1
}

const vars = (el: HTMLElement) =>
  Object.fromEntries(['--vv-left', '--vv-top', '--vv-width', '--vv-height', '--vv-scale'].map(v => [v, el.style.getPropertyValue(v)]))

describe('trackVisualViewport', () => {
  afterEach(() => vi.useRealTimers())

  it('mirrors the visual viewport into CSS variables and follows pinch zoom', () => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] })
    const root = document.createElement('div')
    const vv = new FakeViewport()
    const stop = trackVisualViewport(root, vv as unknown as VisualViewport)
    expect(vars(root)).toEqual({ '--vv-left': '0px', '--vv-top': '0px', '--vv-width': '400px', '--vv-height': '800px', '--vv-scale': '1' })

    Object.assign(vv, { scale: 2.5, width: 160, height: 320, offsetLeft: 120, offsetTop: 300 })
    vv.dispatchEvent(new Event('resize'))
    vv.dispatchEvent(new Event('scroll'))
    vi.advanceTimersToNextFrame()
    expect(vars(root)).toEqual({ '--vv-left': '120px', '--vv-top': '300px', '--vv-width': '160px', '--vv-height': '320px', '--vv-scale': '2.5' })

    stop()
    expect(vars(root)).toEqual({ '--vv-left': '', '--vv-top': '', '--vv-width': '', '--vv-height': '', '--vv-scale': '' })
    vv.offsetLeft = 5
    vv.dispatchEvent(new Event('scroll'))
    vi.advanceTimersToNextFrame()
    expect(root.style.getPropertyValue('--vv-left')).toBe('')
  })

  it('does nothing without a visual viewport', () => {
    const root = document.createElement('div')
    trackVisualViewport(root, undefined)()
    expect(root.getAttribute('style')).toBeNull()
  })
})
