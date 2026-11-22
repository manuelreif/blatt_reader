import { expect, test, type Frame, type Page, type Route } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { E2E_PASSWORD } from '../playwright.config'
import { FakeDrive } from '../tests/fake-drive'

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

/** How many ranges the CSS highlight `name` has in the book frame (0 if none). */
const highlightSize = (frame: Frame, name: string) =>
  frame.evaluate(n => (CSS as unknown as { highlights: Map<string, Set<Range>> }).highlights.get(n)?.size ?? 0, name)

test('EPUB: reader modes – read mode looks nothing up, marks are kept with color and note', async ({ page }) => {
  await page.setInputFiles('[data-testid=book-input]', fixture('sample.epub'))
  let frame = await bookFrame(page, 'splendid')
  const modeSwitch = page.getByTestId('mode-switch')
  await expect(modeSwitch).toContainText('Übersetzen')

  // read mode: a tap on a word does not open the lookup
  await page.keyboard.press('l')
  await expect(modeSwitch).toContainText('Lesen')
  await expect(page.getByTestId('mode-toast')).toContainText('Modus: 📖 Lesen')
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
    await expect(section).toContainText('Bücherordner: Vokabel-Reader')
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
})
