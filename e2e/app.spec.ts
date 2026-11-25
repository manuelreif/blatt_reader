import { expect, test, type Frame, type Page, type Route } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { E2E_PASSWORD } from '../playwright.config'
import { FakeDrive } from '../tests/fake-drive'

const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/generated/${name}`, import.meta.url))

const TRANSLATIONS: Record<string, string> = { estimator: 'Schätzer', statistical: 'statistisch', bank: 'Ufer' }

/** requests the DeepL mock answered in the current test */
let deeplRequests: { text: string; context?: string }[] = []

async function mockDeepl(page: Page) {
  deeplRequests = []
  await page.route('**/api/translate', async route => {
    const { text, context } = route.request().postDataJSON() as { text: string; context?: string }
    deeplRequests.push({ text, context })
    await route.fulfill({ json: { translation: TRANSLATIONS[text] ?? `DE:${text}`, billedCharacters: text.length } })
  })
}

async function bookFrame(page: Page, needle: string): Promise<Frame> {
  await expect
    .poll(async () => {
      for (const f of page.frames())
        if (f.url().startsWith('blob:') && (await f.evaluate(n => document.body?.textContent?.includes(n) ?? false, needle).catch(() => false)))
          return f.url()
      return ''
    })
    .not.toBe('')
  for (const f of page.frames())
    if (f.url().startsWith('blob:') && (await f.evaluate(n => document.body?.textContent?.includes(n) ?? false, needle))) return f
  throw new Error('frame not found')
}

/** The middle of `word` (n-th occurrence) inside the book frame, in page coordinates. */
async function wordPoint(frame: Frame, word: string, occurrence = 0, charOffset?: number) {
  const point = await frame.evaluate(
    ({ word, occurrence, charOffset }) => {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
      let seen = 0
      for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
        let i = n.data.indexOf(word)
        while (i >= 0) {
          if (seen++ === occurrence) {
            const r = document.createRange()
            const at = i + (charOffset ?? Math.floor(word.length / 2))
            r.setStart(n, at)
            r.setEnd(n, at + 1)
            const b = r.getBoundingClientRect()
            return { x: b.x + b.width / 2, y: b.y + b.height / 2 }
          }
          i = n.data.indexOf(word, i + 1)
        }
      }
      return null
    },
    { word, occurrence, charOffset },
  )
  if (!point) throw new Error(`word ${word} not found`)
  const box = (await (await frame.frameElement()).boundingBox())!
  return { x: box.x + point.x, y: box.y + point.y }
}

/** Clicks in the middle of `word` (n-th occurrence) inside the book frame. */
async function clickWord(page: Page, frame: Frame, word: string, occurrence = 0, charOffset?: number) {
  const { x, y } = await wordPoint(frame, word, occurrence, charOffset)
  await page.mouse.click(x, y)
}

test.beforeEach(async ({ page }) => {
  await mockDeepl(page)
  // the production build runs behind the password gate; page.request shares the page's cookies
  if (process.env.E2E_PREVIEW) await page.request.post('/login', { form: { password: E2E_PASSWORD } })
  await page.goto('/')
})

test('EPUB: tap a word, save it, enrich it with a pasted answer and review it', async ({ page }) => {
  await page.setInputFiles('[data-testid=book-input]', fixture('sample.epub'))
  await expect(page).toHaveURL(/#\/read\//)
  const frame = await bookFrame(page, 'unbiased estimator')

  await clickWord(page, frame, 'estimator', 1)
  const sheet = page.getByTestId('lookup-sheet')
  await expect(sheet).toContainText('estimator')
  await expect(sheet).toContainText('The unbiased estimator was surprisingly reliable.')
  await expect(sheet).toContainText('Schätzfunktion') // offline dictionary (Ding)
  // the dictionary comes first, DeepL only on request
  await expect(page.getByTestId('deepl-request')).toBeVisible()
  await expect(page.getByTestId('translation-input')).toHaveValue(/Kalkulationsingenieur/) // Ding's first sense
  await expect(sheet).toContainText('Übersetzung (Wörterbuch)')
  expect(deeplRequests).toEqual([])
  await page.getByTestId('deepl-request').click()
  await expect(page.getByTestId('translation-input')).toHaveValue('Schätzer')
  expect(deeplRequests).toEqual([{ text: 'estimator', context: 'The unbiased estimator was surprisingly reliable.' }])
  await page.getByTestId('save-term').click()
  // saving is impossible to miss: a green badge in place of the button and a toast
  await expect(page.getByTestId('saved-state')).toHaveText('✓ Gespeichert')
  await expect(sheet).toContainText('Neu in deinen Vokabeln')
  await expect(page.getByTestId('reader-toast')).toHaveText('✓ „estimator“ gespeichert')

  // a phrase via selection
  await page.keyboard.press('Escape')
  await expect(sheet).toBeHidden()

  // vocabulary list and detail
  await page.goto('/#/vocab')
  await expect(page.getByTestId('term-list')).toContainText('estimator')
  await page.getByTestId('term-list').getByText('estimator').click()
  await expect(page.getByTestId('term-detail')).toContainText('The unbiased estimator was surprisingly reliable.')

  // enrich with a (simulated) Claude answer
  await page.goto('/#/enrich')
  await page.getByTestId('enrich-copy').click()
  await expect(page.getByTestId('enrich-prompt')).toHaveValue(/"id": "estimator"/)
  const answer =
    'Hier ist das Ergebnis:\n```json\n' +
    JSON.stringify([
      {
        id: 'estimator',
        translation_de: 'Schätzer',
        explanation_de: 'Eine Funktion der Daten, die einen unbekannten Parameter schätzt.',
        example_en: 'The sample mean is an unbiased estimator of the population mean.',
        ipa: '/ˈɛstɪmeɪtə/',
        mnemonic_de: '',
        confusables: ['estimate'],
        distractors_de: ['Schätzung', 'Gutachten', 'Rechner'],
      },
    ]) +
    '\n```'
  await page.getByTestId('enrich-answer').fill(answer)
  await page.getByTestId('enrich-check').click()
  await expect(page.getByTestId('enrich-result')).toContainText('1 gültig')
  await page.getByTestId('enrich-apply').click()
  await expect(page.getByText('1 Wörter angereichert')).toBeVisible()

  // the library links to the book's own quiz
  await page.goto('/#/')
  await expect(page.getByTestId('book-quiz')).toHaveText('Quiz · 2 fällig')
  await page.getByTestId('book-quiz').click()
  await expect(page).toHaveURL(/#\/quiz\/.+/)
  await expect(page.getByTestId('quiz-book').locator('option:checked')).toHaveText(/\(2 fällig\)/)

  // quiz: two new cards (EN→DE and cloze)
  for (let i = 0; i < 2; i++) {
    await page.getByTestId('reveal').click()
    await expect(page.getByTestId('card-back')).toContainText('Schätzer')
    await page.getByTestId('rate-good').click()
  }
  await expect(page.getByText('Geschafft!')).toBeVisible()
  // learned through the book's quiz, so nothing is left in the quiz over all books
  await page.getByTestId('quiz-book').selectOption('')
  await expect(page).toHaveURL(/#\/quiz$/)
  await expect(page.getByText('Nichts fällig')).toBeVisible()
})

test('EPUB: selecting a phrase looks up the phrase', async ({ page }) => {
  await page.setInputFiles('[data-testid=book-input]', fixture('sample.epub'))
  const frame = await bookFrame(page, 'gave up')
  await frame.evaluate(() => {
    const p = document.getElementById('p3')!.firstChild as Text
    const i = p.data.indexOf('gave up')
    const r = document.createRange()
    r.setStart(p, i)
    r.setEnd(p, i + 'gave up'.length)
    document.getSelection()!.removeAllRanges()
    document.getSelection()!.addRange(r)
  })
  const sheet = page.getByTestId('lookup-sheet')
  await expect(sheet).toContainText('gave up')
  await expect(sheet).toContainText('Grundform: give up')
})

/** Selects the whole paragraph `id` in the book frame, as dragging the selection handles would. */
const selectParagraph = (frame: Frame, id: string) =>
  frame.evaluate(pid => {
    const r = document.createRange()
    r.selectNodeContents(document.getElementById(pid)!)
    document.getSelection()!.removeAllRanges()
    document.getSelection()!.addRange(r)
  }, id)

const P2 = 'Every estimator has a variance. The unbiased estimator was surprisingly reliable.'

test('EPUB: selecting sentences translates them on request and keeps the translation as a mark note', async ({ page }) => {
  await page.setInputFiles('[data-testid=book-input]', fixture('sample.epub'))
  const frame = await bookFrame(page, 'unbiased estimator')
  await selectParagraph(frame, 'p2')
  const sheet = page.getByTestId('passage-sheet')
  await expect(sheet).toContainText(P2)
  await expect(page.getByTestId('lookup-sheet')).toHaveCount(0)
  await expect(page.getByTestId('passage-deepl')).toBeVisible()
  expect(deeplRequests).toEqual([])

  await page.getByTestId('passage-deepl').click()
  await expect(page.getByTestId('passage-translation')).toHaveText(`DE:${P2}`)
  expect(deeplRequests).toHaveLength(1)
  expect(deeplRequests[0].text).toBe(P2)
  expect(deeplRequests[0].context).toContain('splendid') // the text before goes along as context

  await expect(page.getByTestId('passage-mark')).toHaveText('Markieren mit Übersetzung als Notiz')
  await page.getByTestId('passage-mark').click()
  await expect(page.getByTestId('mark-sheet')).toBeVisible()
  await expect(page.getByTestId('mark-note')).toHaveValue(`DE:${P2}`)
  await expect.poll(() => highlightSize(frame, 'vr-hl-yellow')).toBe(1)
  await expect.poll(() => highlightSize(frame, 'vr-hl-note')).toBe(1)

  // nothing went into the vocabulary
  await page.goto('/#/vocab')
  await expect(page.getByText('Noch keine Vokabeln')).toBeVisible()
})

/** How many ranges the CSS highlight `name` has in the book frame (0 if none). */
const highlightSize = (frame: Frame, name: string) =>
  frame.evaluate(n => (CSS as unknown as { highlights: Map<string, Set<Range>> }).highlights.get(n)?.size ?? 0, name)

test.describe('touch screen', () => {
  test.use({ hasTouch: true })

  /** Presses `from`, holds it, drags to `to` and lifts the finger, as when selecting on a phone. */
  async function pressAndDrag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [from] })
    await page.waitForTimeout(700)
    for (let i = 1; i <= 4; i++) {
      const point = { x: from.x + ((to.x - from.x) * i) / 4, y: from.y + ((to.y - from.y) * i) / 4 }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [point] })
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await cdp.detach()
  }

  test('EPUB: press and drag selects words without a native selection (no handles, no Touch to Search)', async ({ page }) => {
    await page.setInputFiles('[data-testid=book-input]', fixture('sample.epub'))
    const frame = await bookFrame(page, 'gave up')
    const nativeSelection = () => frame.evaluate(() => document.getSelection()!.toString())

    // translate mode: a phrase
    await pressAndDrag(page, await wordPoint(frame, 'gave'), await wordPoint(frame, 'up', 1))
    const lookup = page.getByTestId('lookup-sheet')
    await expect(lookup).toContainText('gave up')
    await expect(lookup).toContainText('Grundform: give up')
    expect(await nativeSelection()).toBe('')
    expect(await highlightSize(frame, 'vr-lookup')).toBe(1)
    await page.keyboard.press('Escape')
    await expect(lookup).toHaveCount(0)
    await expect.poll(() => highlightSize(frame, 'vr-lookup')).toBe(0)

    // translate mode: a whole sentence opens the passage sheet
    await pressAndDrag(page, await wordPoint(frame, 'Every'), await wordPoint(frame, 'reliable'))
    // up to the word under the finger (here without the full stop after it)
    await expect(page.getByTestId('passage-sheet')).toContainText(`„${P2.slice(0, -1)}“`)
    expect(await nativeSelection()).toBe('')
    await page.keyboard.press('Escape')

    // mark mode: the selection waits for a color
    await page.keyboard.press('m')
    await expect(page.getByTestId('mode-switch')).toContainText('Markieren')
    await pressAndDrag(page, await wordPoint(frame, 'looked'), await wordPoint(frame, 'dictionary'))
    const mark = page.getByTestId('mark-sheet')
    await expect(mark).toContainText('looked the word up in a dictionary')
    expect(await nativeSelection()).toBe('')
    await mark.getByRole('button', { name: 'Grün' }).click()
    await expect.poll(() => highlightSize(frame, 'vr-hl-green')).toBe(1)
    await expect.poll(() => highlightSize(frame, 'vr-lookup')).toBe(0)

    // the browser's own selection (and long-press menu) by finger is refused outside read mode;
    // headless Chromium does not select on a long press, so the events are sent directly
    const refused = (pointerType: string) =>
      frame.evaluate(type => {
        const p = document.getElementById('p1')!
        p.dispatchEvent(new PointerEvent('pointerdown', { pointerType: type, bubbles: true }))
        p.dispatchEvent(new PointerEvent('pointercancel', { pointerType: type, bubbles: true }))
        const select = new Event('selectstart', { bubbles: true, cancelable: true })
        p.firstChild!.dispatchEvent(select)
        const menu = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
        p.dispatchEvent(menu)
        return [select.defaultPrevented, menu.defaultPrevented]
      }, pointerType)
    expect(await refused('touch')).toEqual([true, true])
    expect(await refused('mouse')).toEqual([false, false])
    await page.keyboard.press('l')
    await expect(page.getByTestId('mode-switch')).toContainText('Lesen')
    expect(await refused('touch')).toEqual([false, false])
  })
})

test('EPUB: pinch-zoomed in, the lookup sheet shows completely and at normal size', async ({ page }) => {
  await page.setInputFiles('[data-testid=book-input]', fixture('sample.epub'))
  const frame = await bookFrame(page, 'splendid')
  await clickWord(page, frame, 'splendid')
  await expect(page.getByTestId('lookup-sheet')).toBeVisible()
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 2 })
  await expect.poll(() => page.evaluate(() => window.visualViewport?.scale)).toBe(2)
  await expect
    .poll(() =>
      page.evaluate(() => {
        const r = document.querySelector('[data-testid=lookup-sheet]')!.getBoundingClientRect()
        const vv = window.visualViewport!
        const inside =
          r.left >= vv.offsetLeft - 1 &&
          r.top >= vv.offsetTop - 1 &&
          r.right <= vv.offsetLeft + vv.width + 1 &&
          r.bottom <= vv.offsetTop + vv.height + 1
        // on screen as wide as without zoom (380 px next to the book on a wide screen)
        return { inside, width: Math.round(r.width * vv.scale) }
      }),
    )
    .toEqual({ inside: true, width: 380 })
  await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1 })
  await cdp.detach()
})

test('install button: appears when the browser offers installation and replays its dialog', async ({ page }) => {
  // Chrome's real beforeinstallprompt needs an installable, engaged page; a synthetic one behaves the same for the app
  const offerInstall = (outcome: 'accepted' | 'dismissed') =>
    page.evaluate(o => {
      const e = new Event('beforeinstallprompt', { cancelable: true }) as Event & Record<string, unknown>
      e.prompt = async () => void ((window as unknown as Record<string, number>).promptCalls = ((window as unknown as Record<string, number>).promptCalls ?? 0) + 1)
      e.userChoice = Promise.resolve({ outcome: o })
      window.dispatchEvent(e)
    }, outcome)
  const promptCalls = () => page.evaluate(() => (window as unknown as Record<string, number>).promptCalls ?? 0)

  await expect(page.getByText('Noch keine Bücher')).toBeVisible()
  await expect(page.getByTestId('install-app')).toHaveCount(0)
  await offerInstall('dismissed')
  await page.getByTestId('install-app').click()
  expect(await promptCalls()).toBe(1)
  await expect(page.getByTestId('install-app')).toHaveCount(0)

  await page.goto('/#/settings')
  await offerInstall('accepted')
  await page.getByTestId('install-app').click()
  expect(await promptCalls()).toBe(2)
  await expect(page.getByText('Läuft als installierte App')).toBeVisible()
})

test('settings: an own DeepL key goes along with every request and is kept on the device', async ({ page }) => {
  const keys: (string | undefined)[] = []
  await page.route('**/api/translate', async route => {
    const key = route.request().headers()['x-deepl-key']
    keys.push(key)
    await route.fulfill({ json: { translation: 'Ufer', billedCharacters: 4, keySource: key ? 'own' : 'server' } })
  })
  await page.goto('/#/settings')
  await page.getByRole('button', { name: 'DeepL testen' }).click()
  await expect(page.getByText('Key des Servers')).toBeVisible()

  await page.getByTestId('deepl-key').fill('1234abcd-ef:fx')
  await page.getByRole('button', { name: 'DeepL testen' }).click()
  await expect(page.getByText('(abgerechnet: 4 Zeichen, eigener Key)')).toBeVisible()
  expect(keys).toEqual([undefined, '1234abcd-ef:fx'])

  await page.reload()
  await expect(page.getByTestId('deepl-key')).toHaveValue('1234abcd-ef:fx')
})

test('Gemini: with an own key the words are enriched in one step, straight from the browser', async ({ page }) => {
  const requests: { key?: string; url: string; prompt: string }[] = []
  await page.route('https://generativelanguage.googleapis.com/**', async route => {
    const req = route.request()
    const prompt = (req.postDataJSON() as { contents: { parts: { text: string }[] }[] }).contents[0].parts[0].text
    requests.push({ key: req.headers()['x-goog-api-key'], url: req.url(), prompt })
    const items = prompt.includes('"id": "estimator"')
      ? [
          {
            id: 'estimator',
            translation_de: 'Schätzer',
            explanation_de: 'Eine Funktion der Daten, die einen unbekannten Parameter schätzt.',
            example_en: 'The sample mean is an unbiased estimator.',
            ipa: '/ˈɛstɪmeɪtə/',
            mnemonic_de: '',
            confusables: [],
            distractors_de: ['Schätzung', 'Gutachten', 'Rechner'],
          },
        ]
      : []
    await route.fulfill({
      json: { candidates: [{ content: { parts: [{ text: JSON.stringify(items) }] }, finishReason: 'STOP' }] },
      headers: { 'access-control-allow-origin': '*' },
    })
  })
  await page.setInputFiles('[data-testid=book-input]', fixture('sample.epub'))
  const frame = await bookFrame(page, 'unbiased estimator')
  await clickWord(page, frame, 'estimator', 1)
  await page.getByTestId('save-term').click()
  await expect(page.getByTestId('saved-state')).toBeVisible()

  // without a key there is no Gemini button
  await page.goto('/#/enrich')
  await expect(page.getByTestId('enrich-copy')).toBeVisible()
  await expect(page.getByTestId('enrich-gemini')).toHaveCount(0)

  await page.goto('/#/settings')
  await page.getByTestId('gemini-key').fill('AIza-e2e')
  await page.getByRole('button', { name: 'Gemini testen' }).click()
  await expect(page.getByText(/^OK: „bank“/)).toBeVisible()

  await page.goto('/#/enrich')
  await page.getByTestId('enrich-gemini').click()
  await expect(page.getByTestId('enrich-result')).toContainText('1 gültig')
  await page.getByTestId('enrich-apply').click()
  await expect(page.getByText('1 Wörter angereichert')).toBeVisible()
  expect(requests).toHaveLength(2)
  expect(requests.every(r => r.key === 'AIza-e2e' && !r.url.includes('AIza'))).toBe(true)
  expect(requests[1].url).toContain('/models/gemini-flash-lite-latest:generateContent')
  expect(requests[1].prompt).toContain('The unbiased estimator was surprisingly reliable.')

  await page.goto('/#/vocab')
  await page.getByTestId('term-list').getByText('estimator').click()
  await expect(page.getByTestId('term-detail')).toContainText('Eine Funktion der Daten')
})

test('settings: "always" asks DeepL at once, for words and for sentences', async ({ page }) => {
  await page.goto('/#/settings')
  await page.getByTestId('deepl-mode').selectOption('always')
  await page.goto('/#/')
  await page.setInputFiles('[data-testid=book-input]', fixture('sample.epub'))
  const frame = await bookFrame(page, 'unbiased estimator')
  await clickWord(page, frame, 'estimator', 1)
  await expect(page.getByTestId('translation-input')).toHaveValue('Schätzer')
  await expect(page.getByTestId('deepl-request')).toHaveCount(0)

  await page.keyboard.press('Escape')
  await selectParagraph(frame, 'p2')
  await expect(page.getByTestId('passage-translation')).toHaveText(`DE:${P2}`)
})

test('EPUB: reader modes – read mode looks nothing up, marks are kept with color and note', async ({ page }) => {
  await page.setInputFiles('[data-testid=book-input]', fixture('sample.epub'))
  let frame = await bookFrame(page, 'splendid')
  const modeSwitch = page.getByTestId('mode-switch')
  await expect(modeSwitch).toContainText('Übersetzen')

  // read mode: a tap on a word does not open the lookup
  await page.keyboard.press('l')
  await expect(modeSwitch).toContainText('Lesen')
  await expect(page.getByTestId('reader-toast')).toContainText('Modus: 📖 Lesen')
  await clickWord(page, frame, 'splendid')
  await page.waitForTimeout(400)
  await expect(page.getByTestId('lookup-sheet')).toHaveCount(0)

  // mark mode: a tap marks the word at once
  await modeSwitch.click() // read → translate
  await modeSwitch.click() // translate → mark
  await expect(modeSwitch).toContainText('Markieren')
  await clickWord(page, frame, 'splendid')
  const sheet = page.getByTestId('mark-sheet')
  await expect(sheet).toContainText('splendid')
  await expect.poll(() => highlightSize(frame, 'vr-hl-yellow')).toBe(1)
  await sheet.getByRole('button', { name: 'Grün' }).click()
  await expect.poll(() => highlightSize(frame, 'vr-hl-green')).toBe(1)
  expect(await highlightSize(frame, 'vr-hl-yellow')).toBe(0)
  await sheet.getByTestId('mark-note').fill('schönes Wort')
  await sheet.getByTitle('Schließen (Esc)').click()
  await expect(sheet).toHaveCount(0)

  // a selection over two paragraphs waits for a color
  await frame.evaluate(() => {
    const a = document.getElementById('p2')!.firstChild as Text
    const b = document.getElementById('p3')!.firstChild as Text
    const r = document.createRange()
    r.setStart(a, a.data.indexOf('unbiased'))
    r.setEnd(b, 'She looked'.length)
    document.getSelection()!.removeAllRanges()
    document.getSelection()!.addRange(r)
  })
  await expect(sheet).toContainText('Farbe antippen')
  await sheet.getByRole('button', { name: 'Blau' }).click()
  await expect.poll(() => highlightSize(frame, 'vr-hl-blue')).toBe(1)

  // after a reload: mode and marks are still there, the list shows them in reading order
  await page.reload()
  frame = await bookFrame(page, 'splendid')
  await expect(modeSwitch).toContainText('Markieren')
  await expect.poll(() => highlightSize(frame, 'vr-hl-green')).toBe(1)
  await expect.poll(() => highlightSize(frame, 'vr-hl-note')).toBe(1)
  await page.getByTestId('mark-list-button').click()
  const list = page.getByTestId('mark-list')
  await expect(list.locator('.mark-item')).toHaveCount(2)
  await expect(list.locator('.mark-item').first()).toContainText('splendid')
  await expect(list.locator('.mark-item').first()).toContainText('schönes Wort')
  await expect(list.locator('.mark-item').nth(1)).toContainText('unbiased estimator was surprisingly reliable. She looked')

  // tapping a mark opens it; deleting removes it
  await list.locator('.mark-item').nth(1).click()
  await expect(sheet.getByTestId('mark-note')).toHaveValue('')
  await sheet.getByRole('button', { name: 'Löschen' }).click()
  await expect.poll(() => highlightSize(frame, 'vr-hl-blue')).toBe(0)
  await clickWord(page, frame, 'splendid')
  await expect(sheet.getByTestId('mark-note')).toHaveValue('schönes Wort')
  await sheet.getByRole('button', { name: 'Nachschlagen' }).click()
  await expect(page.getByTestId('lookup-sheet')).toContainText('splendid')

  // translate mode: a tap on a marked word looks it up as before
  await page.keyboard.press('Escape')
  await page.keyboard.press('u')
  await clickWord(page, frame, 'splendid')
  await expect(page.getByTestId('lookup-sheet')).toContainText('splendid')
})

test('PDF: a word hyphenated across lines is joined', async ({ page }) => {
  await page.setInputFiles('[data-testid=book-input]', fixture('sample.pdf'))
  await expect(page).toHaveURL(/#\/read\//)
  const frame = await bookFrame(page, 'tical model')
  await clickWord(page, frame, 'tical model', 0, 2)
  const sheet = page.getByTestId('lookup-sheet')
  await expect(sheet).toContainText('statistical')
  await expect(sheet).toContainText('We fit a statistical model to the survey data.')
  await page.getByTestId('deepl-request').click()
  await expect(page.getByTestId('translation-input')).toHaveValue('statistisch')
})

test('PDF: a mark is drawn on the text layer and comes back after a reload', async ({ page }) => {
  await page.setInputFiles('[data-testid=book-input]', fixture('sample.pdf'))
  let frame = await bookFrame(page, 'tical model')
  await page.keyboard.press('m')
  await clickWord(page, frame, 'survey')
  await expect(page.getByTestId('mark-sheet')).toContainText('survey')
  await expect.poll(() => highlightSize(frame, 'vr-hl-yellow')).toBe(1)
  await page.reload()
  frame = await bookFrame(page, 'tical model')
  await expect.poll(() => highlightSize(frame, 'vr-hl-yellow')).toBe(1)
})

test('PDF: links count only in read mode, elsewhere a tap looks up the word under the link', async ({ page }) => {
  await page.context().route('https://example.org/**', r => r.fulfill({ body: 'linked page' }))
  const popups: string[] = []
  page.context().on('page', p => popups.push(p.url()))
  await page.setInputFiles('[data-testid=book-input]', fixture('sample.pdf'))
  const frame = await bookFrame(page, 'robust procedure')
  await expect.poll(() => frame.evaluate(() => document.querySelectorAll('.annotationLayer a[href]').length)).toBe(1)

  // translate mode (default): the word, not the link
  await clickWord(page, frame, 'robust')
  const sheet = page.getByTestId('lookup-sheet')
  await expect(sheet).toContainText('Heteroscedasticity was tested with a robust procedure.')
  await page.keyboard.press('Escape')
  await expect(sheet).toHaveCount(0)

  // read mode: the link opens
  await page.keyboard.press('l')
  await expect(page.getByTestId('mode-switch')).toContainText('Lesen')
  const popup = page.context().waitForEvent('page')
  await clickWord(page, frame, 'robust')
  await expect.poll(async () => (await popup).url()).toBe('https://example.org/robust')
  expect(popups).toHaveLength(1)
  await expect(sheet).toHaveCount(0)
})

test('EPUB: outside read mode a tap on a link looks the word up', async ({ page }) => {
  await page.setInputFiles('[data-testid=book-input]', fixture('sample.epub'))
  const frame = await bookFrame(page, 'glossary')
  await clickWord(page, frame, 'glossary')
  await expect(page.getByTestId('lookup-sheet')).toContainText('See the glossary for details.')
})

test('production build: scripts inside an EPUB are blocked by the CSP', async ({ page }) => {
  test.skip(!process.env.E2E_PREVIEW, 'CSP is only set in the production build')
  await page.setInputFiles('[data-testid=book-input]', fixture('scripted.epub'))
  await bookFrame(page, 'unbiased estimator')
  await page.waitForTimeout(500)
  expect(await page.evaluate(() => document.body.dataset.pwned)).toBeUndefined()
})

test('dictionary: stored completely for offline use, then found without network', async ({ page }) => {
  await page.goto('/#/settings')
  const section = page.getByTestId('dict-offline')
  await expect(section).toContainText(/Offline gespeichert: \d+ von 558 Teilen/)
  await page.getByTestId('dict-download').click()
  await expect(section).toContainText('Komplett offline gespeichert', { timeout: 45_000 })

  await page.route('**/dict/en-de/**', r => r.abort())
  await page.goto('/')
  await page.reload() // forget shards already loaded into memory
  await page.setInputFiles('[data-testid=book-input]', fixture('sample.epub'))
  const frame = await bookFrame(page, 'unbiased estimator')
  await clickWord(page, frame, 'estimator', 1)
  await expect(page.getByTestId('lookup-sheet')).toContainText('Schätzfunktion')
})

test.describe('offline (no service worker, so page.route sees every request)', () => {
  test.use({ serviceWorkers: 'block' })

  test('dictionary: a part not stored yet shows a hint instead of "no entry"', async ({ page }) => {
    await page.route(/\/dict\/en-de\/(?!index)[^/]+\.json$/, r => r.abort())
    await page.setInputFiles('[data-testid=book-input]', fixture('sample.epub'))
    const frame = await bookFrame(page, 'unbiased estimator')
    await clickWord(page, frame, 'estimator', 1)
    await expect(page.getByTestId('dict-unavailable')).toBeVisible()
    await expect(page.getByTestId('lookup-sheet')).not.toContainText('Kein Eintrag')
  })

  test('DeepL: a word saved offline gets its translation later', async ({ page }) => {
    const offline = (route: Route) => route.abort()
    await page.route('**/api/translate', offline)
    await page.setInputFiles('[data-testid=book-input]', fixture('sample.epub'))
    const frame = await bookFrame(page, 'unbiased estimator')
    await clickWord(page, frame, 'estimator', 1)
    const sheet = page.getByTestId('lookup-sheet')
    await page.getByTestId('deepl-request').click()
    await expect(sheet).toContainText('Keine Verbindung')
    await expect(page.getByTestId('translation-input')).not.toHaveValue('') // dictionary fallback
    await page.getByTestId('save-term').click()
    await expect(page.getByTestId('deepl-pending')).toBeVisible()

    await page.goto('/#/settings')
    const pending = page.getByTestId('deepl-pending-settings')
    await expect(pending).toContainText('1 gespeicherte Wörter warten')
    await page.getByRole('button', { name: 'Jetzt nachholen' }).click()
    await expect(pending).toContainText('Fehler') // still offline

    await page.unroute('**/api/translate', offline)
    await page.getByRole('button', { name: 'Jetzt nachholen' }).click()
    await expect(pending).toContainText('1 nachgeholt')

    await page.goto('/#/vocab/estimator')
    const detail = page.getByTestId('term-detail')
    await expect(detail).toContainText('DeepL: Schätzer')
    await expect(page.getByTestId('term-list')).toContainText('Schätzer')
  })
})

test('production build: password gate', async ({ browser, request }) => {
  test.skip(!process.env.E2E_PREVIEW, 'the gate runs in the preview server, started with APP_PASSWORD')
  const context = await browser.newContext({ baseURL: test.info().project.use.baseURL })
  const page = await context.newPage()
  await page.goto('/')
  await expect(page).toHaveURL(/\/login$/)
  await page.getByLabel('Passwort').fill('falsch')
  await page.getByRole('button', { name: 'Anmelden' }).click()
  await expect(page.getByRole('alert')).toContainText('Falsches Passwort')
  await page.getByLabel('Passwort').fill(E2E_PASSWORD)
  await page.getByRole('button', { name: 'Anmelden' }).click()
  await expect(page.locator('nav')).toContainText('Bibliothek')
  const cookie = (await context.cookies()).find(c => c.name === 'vr_session')
  expect(cookie?.httpOnly).toBe(true)
  expect(cookie!.expires * 1000 - Date.now()).toBeGreaterThan(390 * 24 * 60 * 60 * 1000)
  await context.close()

  // without a session: installable (manifest), but nothing else
  expect((await request.get('/manifest.webmanifest')).status()).toBe(200)
  expect((await request.get('/dict/en-de/index.json')).status()).toBe(401)
  expect((await request.post('/api/translate', { data: { text: 'bank' } })).status()).toBe(401)
})

/** Google Identity Services: hands out a token without a popup. */
const GIS_STUB = `window.google = { accounts: { oauth2: {
  initTokenClient: cfg => ({ requestAccessToken: () => setTimeout(() => cfg.callback({ access_token: 'e2e-token', expires_in: 3599, scope: cfg.scope }), 50) }),
  hasGrantedAllScopes: () => true,
  revoke: (_token, done) => done && done(),
} } }`

/** Replaces Google (login script and Drive API) with the in-memory FakeDrive from the unit tests. */
async function mockGoogle(page: Page): Promise<FakeDrive> {
  const fake = new FakeDrive()
  fake.token = 'e2e-token'
  await page.route('https://accounts.google.com/gsi/client', route => route.fulfill({ contentType: 'text/javascript', body: GIS_STUB }))
  await page.route('https://www.googleapis.com/**', async route => {
    const req = route.request()
    const cors = {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'authorization, content-type',
      'access-control-allow-methods': 'GET, POST, PATCH, PUT',
      'access-control-expose-headers': 'location',
    }
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    const res = fake.handle({
      method: req.method(),
      url: req.url(),
      body: req.postDataBuffer(),
      authorization: (await req.allHeaders())['authorization'],
    })
    await route.fulfill({ status: res.status, headers: { ...res.headers, ...cors }, body: typeof res.body === 'string' ? res.body : Buffer.from(res.body) })
  })
  return fake
}

test.describe('Google Drive (Google replaced by a stub)', () => {
  // page.route does not see requests that a service worker makes
  test.use({ serviceWorkers: 'block' })

  test('books arrive by themselves, a removed one stays away, vocabulary goes both ways', async ({ page }) => {
    const fake = await mockGoogle(page)
    // "another device" connected before: app folder with a book and the sync file holding one word;
    // it still has the name from before the rename, which stays in use
    const app = fake.folder('Vokabel-Reader', 'root', { vokabelReader: 'root' })
    fake.add({ name: 'The Test Book.epub', parents: [app.id], mimeType: 'application/epub+zip', content: readFileSync(fixture('sample.epub')) })
    const now = Date.now()
    const serendipity = { id: 'serendipity', lemma: 'serendipity', forms: ['serendipity'], translation: 'glücklicher Zufall', dictSenses: [], status: 1, tags: [], createdAt: now, updatedAt: now }
    const syncFile = fake.add({
      name: 'vokabel-reader-sync.json',
      parents: [app.id],
      mimeType: 'application/json',
      content: JSON.stringify({ app: 'vokabel-reader', version: 1, exportedAt: new Date().toISOString(), terms: [serendipity], contexts: [], cards: [], reviewLogs: [], settings: [] }),
    })
    const syncedTerms = () => (JSON.parse(fake.text(syncFile.id)).terms as { id: string }[]).map(t => t.id).sort()

    await page.goto('/#/settings')
    const section = page.getByTestId('drive-settings')
    await expect(section).toBeVisible()
    test.skip((await section.textContent())!.includes('Nicht eingerichtet'), 'built without VITE_GOOGLE_CLIENT_ID')
    await section.getByRole('button', { name: 'Mit Google verbinden' }).click()
    await expect(page.getByTestId('drive-sync-status')).toContainText('1 neues Buch, 1 neues Wort')
    await expect(page.getByTestId('book-sources')).toContainText('Vokabel-Reader')
    expect(syncedTerms()).toEqual(['serendipity'])

    await page.goto('/#/vocab')
    await expect(page.getByTestId('term-list')).toContainText('serendipity')

    // the downloaded book opens like any other; a word saved there goes to Drive with the next sync
    await page.goto('/')
    await expect(page.locator('.book-title')).toHaveText(['The Test Book'])
    await expect(page.getByTestId('drive-bar')).toContainText('Bücher aus Vokabel-Reader')
    await expect(page.getByTestId('drive-bar').getByRole('link', { name: 'Vokabel-Reader' })).toHaveAttribute(
      'href',
      `https://drive.google.com/drive/folders/${app.id}`,
    )
    await page.locator('.book-open').click()
    const frame = await bookFrame(page, 'unbiased estimator')
    await clickWord(page, frame, 'estimator', 1)
    await page.getByTestId('deepl-request').click()
    await expect(page.getByTestId('translation-input')).toHaveValue('Schätzer')
    await page.getByTestId('save-term').click()
    await expect(page.getByTestId('lookup-sheet')).toContainText('Neu in deinen Vokabeln')
    // a mark goes along, too
    await page.keyboard.press('Escape')
    await page.keyboard.press('m')
    await clickWord(page, frame, 'splendid')
    await expect(page.getByTestId('mark-sheet')).toContainText('splendid')
    await page.goto('/#/settings')
    await page.getByRole('button', { name: 'Jetzt abgleichen' }).click()
    await expect.poll(syncedTerms).toEqual(['estimator', 'serendipity'])
    expect((JSON.parse(fake.text(syncFile.id)).highlights as { text: string }[]).map(h => h.text)).toEqual(['splendid'])

    // removed from the library: not downloaded again, until asked for
    await page.goto('/')
    page.once('dialog', dialog => void dialog.accept())
    await page.getByTitle('Buch entfernen').click()
    await expect(page.locator('.book-title')).toHaveCount(0)
    await page.goto('/#/settings')
    await page.getByRole('button', { name: 'Jetzt abgleichen' }).click()
    await expect(page.getByTestId('drive-sync-status')).toContainText('Letzter Abgleich')
    await expect(section).toContainText('1 Buch aus Drive wird nicht geladen')
    await page.goto('/')
    await expect(page.locator('.book-title')).toHaveCount(0)
    await page.goto('/#/settings')
    await page.getByRole('button', { name: 'Wieder laden' }).click()
    await expect(page.getByTestId('drive-sync-status')).toContainText('1 neues Buch')
    await page.goto('/')
    await expect(page.locator('.book-title')).toHaveText(['The Test Book'])
  })

  test('several books folders: pick a shared folder in the browser, filter the library by folder', async ({ page }) => {
    const fake = await mockGoogle(page)
    const app = fake.folder('Blatt-Reader', 'root', { vokabelReader: 'root' })
    fake.add({ name: 'The Test Book.epub', parents: [app.id], mimeType: 'application/epub+zip', content: readFileSync(fixture('sample.epub')) })
    const shared = fake.add({ name: 'Paper von Anna', mimeType: 'application/vnd.google-apps.folder', parents: ['annas-root'], sharedWithMe: true, owner: 'Anna' })
    fake.add({ name: 'paper.pdf', parents: [shared.id], mimeType: 'application/pdf', content: readFileSync(fixture('sample.pdf')) })
    await page.setViewportSize({ width: 400, height: 800 })

    await page.goto('/#/settings')
    const section = page.getByTestId('drive-settings')
    await expect(section).toBeVisible()
    test.skip((await section.textContent())!.includes('Nicht eingerichtet'), 'built without VITE_GOOGLE_CLIENT_ID')
    await section.getByRole('button', { name: 'Mit Google verbinden' }).click()
    await expect(page.getByTestId('drive-sync-status')).toContainText('1 neues Buch')

    // no link to copy: tap through "Für mich freigegeben"
    await section.getByRole('button', { name: '+ Ordner hinzufügen' }).click()
    const picker = page.getByTestId('folder-picker')
    await picker.getByRole('button', { name: /Für mich freigegeben/ }).click()
    await expect(picker.getByRole('button', { name: /Paper von Anna/ })).toContainText('geteilt von Anna')
    await picker.getByRole('button', { name: /Paper von Anna/ }).click()
    await expect(picker).toContainText('1 Buch direkt hier')
    await picker.getByRole('button', { name: 'Diesen Ordner hinzufügen' }).click()
    await expect(picker).toHaveCount(0)
    const sources = page.getByTestId('book-sources')
    await expect(sources.locator('li', { hasText: 'Paper von Anna' })).toContainText('1 Buch')
    expect(fake.files.get(app.id)!.appProperties).toMatchObject({ [`bookSource_${shared.id}`]: '1' })

    await page.goto('/')
    await expect(page.getByTestId('drive-bar')).toContainText('Bücher aus Blatt-Reader und Paper von Anna')
    const filter = page.getByTestId('library-filter')
    await expect(filter.getByRole('button')).toHaveText(['Alle 2', 'Blatt-Reader 1', 'Paper von Anna 1'])
    await filter.getByRole('button', { name: /Paper von Anna/ }).click()
    await expect(page.locator('.book-title')).toHaveText(['A Statistical Paper'])
    // phone width: the chips scroll, the page does not get wider
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(400)

    // removed from the list: the book stays, now under "Sonstige"
    await page.goto('/#/settings')
    page.once('dialog', dialog => void dialog.accept())
    await sources.getByRole('button', { name: 'Entfernen' }).click()
    await expect(sources).not.toContainText('Paper von Anna')
    expect(fake.files.get(app.id)!.appProperties).toEqual({ vokabelReader: 'root' })
    await page.goto('/')
    await expect(filter.getByRole('button')).toHaveText(['Alle 2', 'Blatt-Reader 1', 'Sonstige 1'])
    // the chosen folder is gone: all books again
    await expect(filter.getByRole('button', { name: /Alle/ })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('.book-title')).toHaveCount(2)
  })
})
