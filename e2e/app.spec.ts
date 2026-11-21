import { expect, test, type Frame, type Page } from '@playwright/test'
import { fileURLToPath } from 'node:url'

const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/generated/${name}`, import.meta.url))

const TRANSLATIONS: Record<string, string> = { estimator: 'Schätzer', statistical: 'statistisch', bank: 'Ufer' }

async function mockDeepl(page: Page) {
  await page.route('**/api/translate', async route => {
    const { text } = route.request().postDataJSON() as { text: string }
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

/** Clicks in the middle of `word` (n-th occurrence) inside the book frame. */
async function clickWord(page: Page, frame: Frame, word: string, occurrence = 0, charOffset?: number) {
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
  await page.mouse.click(box.x + point.x, box.y + point.y)
}

test.beforeEach(async ({ page }) => {
  await mockDeepl(page)
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
  await expect(page.getByTestId('translation-input')).toHaveValue('Schätzer')
  await page.getByTestId('save-term').click()
  await expect(sheet).toContainText('Neu in deinen Vokabeln')

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

  // quiz: two new cards (EN→DE and cloze)
  await page.goto('/#/quiz')
  for (let i = 0; i < 2; i++) {
    await page.getByTestId('reveal').click()
    await expect(page.getByTestId('card-back')).toContainText('Schätzer')
    await page.getByTestId('rate-good').click()
  }
  await expect(page.getByText('Geschafft!')).toBeVisible()
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

test('PDF: a word hyphenated across lines is joined', async ({ page }) => {
  await page.setInputFiles('[data-testid=book-input]', fixture('sample.pdf'))
  await expect(page).toHaveURL(/#\/read\//)
  const frame = await bookFrame(page, 'tical model')
  await clickWord(page, frame, 'tical model', 0, 2)
  const sheet = page.getByTestId('lookup-sheet')
  await expect(sheet).toContainText('statistical')
  await expect(sheet).toContainText('We fit a statistical model to the survey data.')
  await expect(page.getByTestId('translation-input')).toHaveValue('statistisch')
})

test('production build: scripts inside an EPUB are blocked by the CSP', async ({ page }) => {
  test.skip(!process.env.E2E_PREVIEW, 'CSP is only set in the production build')
  await page.setInputFiles('[data-testid=book-input]', fixture('scripted.epub'))
  await bookFrame(page, 'unbiased estimator')
  await page.waitForTimeout(500)
  expect(await page.evaluate(() => document.body.dataset.pwned)).toBeUndefined()
})
