import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { deleteBook, saveLookup } from '../src/db/repo'
import { db, type Book } from '../src/db/schema'
import { driveClient } from '../src/drive/driveApi'
import { getDriveState, getDriveStatus, setBooksFolder, summarize, syncDrive, type SyncOptions } from '../src/drive/driveSync'
import { countSkippedDriveFiles, forgetSkippedDriveFiles, syncDriveBooks } from '../src/drive/syncBooks'
import { SYNC_FILE } from '../src/drive/syncVocab'
import { FakeDrive } from './fake-drive'

const reset = () => Promise.all(db.tables.map(t => t.clear()))
beforeEach(reset)

/** Stand-in for importBook (foliate-js needs a browser): the file name becomes the book id. */
async function fakeImport(file: File): Promise<Book> {
  const text = await file.text()
  if (text === 'broken') throw new Error('kein gültiges EPUB')
  const book: Book = { id: `book:${file.name}`, title: file.name, author: '', format: 'epub', fileName: file.name, file, addedAt: Date.now() }
  await db.books.put(book)
  return book
}

const ids = async () => (await db.books.toCollection().primaryKeys()).sort()

describe('syncDriveBooks', () => {
  function setup() {
    const fake = new FakeDrive()
    const folder = fake.folder('Bücher')
    const sub = fake.folder('Paper', folder.id)
    fake.add({ name: 'a.epub', parents: [folder.id], content: 'A', mimeType: 'application/epub+zip' })
    fake.add({ name: 'b.pdf', parents: [sub.id], content: 'B', mimeType: 'application/pdf' })
    fake.add({ name: 'notes.txt', parents: [folder.id], content: 'n' })
    fake.add({ name: 'Notizen', parents: [folder.id], mimeType: 'application/vnd.google-apps.document' })
    fake.add({ name: SYNC_FILE, parents: [folder.id], content: '{}' })
    const opts = { drive: driveClient(fake.token, fake.fetch), folderId: folder.id, importFn: fakeImport }
    return { fake, folder, opts }
  }

  it('downloads new book files once, also from subfolders, and skips everything else', async () => {
    const { fake, opts } = setup()
    const progress: string[] = []
    expect(await syncDriveBooks({ ...opts, onProgress: p => progress.push(`${p.done}/${p.total}`) })).toEqual({ imported: 2, failed: 0 })
    expect(await ids()).toEqual(['book:a.epub', 'book:b.pdf'])
    expect(progress).toEqual(['0/2', '1/2', '2/2'])

    fake.log = []
    expect(await syncDriveBooks(opts)).toEqual({ imported: 0, failed: 0 })
    expect(fake.log.some(l => l.startsWith('GET /drive/v3/files/'))).toBe(false) // nothing downloaded
  })

  it('does not download a book again that was removed from the library, until asked to', async () => {
    const { opts } = setup()
    await syncDriveBooks(opts)
    await deleteBook('book:a.epub')
    expect(await countSkippedDriveFiles()).toBe(1)
    expect(await syncDriveBooks(opts)).toMatchObject({ imported: 0 })
    expect(await ids()).toEqual(['book:b.pdf'])

    await forgetSkippedDriveFiles()
    expect(await syncDriveBooks(opts)).toMatchObject({ imported: 1 })
    expect(await ids()).toEqual(['book:a.epub', 'book:b.pdf'])
  })

  it('remembers unreadable files, retries files that did not fit and stops when logged out', async () => {
    const { fake, folder, opts } = setup()
    fake.add({ name: 'kaputt.epub', parents: [folder.id], content: 'broken' })
    const r = await syncDriveBooks({ ...opts, hasSpace: async bytes => bytes < 1 })
    // A and B do not "fit", the broken file is too big as well: nothing downloaded, nothing remembered
    expect(r).toMatchObject({ imported: 0, failed: 3, lastError: expect.stringContaining('Speicherplatz') })
    expect(await db.driveFiles.count()).toBe(0)

    const r2 = await syncDriveBooks(opts)
    expect(r2).toMatchObject({ imported: 2, failed: 1, lastError: expect.stringContaining('kein gültiges EPUB') })
    expect((await db.driveFiles.where('state').equals('error').toArray()).map(f => f.name)).toEqual(['kaputt.epub'])
    expect(await syncDriveBooks(opts)).toEqual({ imported: 0, failed: 0 })

    fake.add({ name: 'neu.epub', parents: [folder.id], content: 'N' })
    fake.token = 'rotated'
    await expect(syncDriveBooks(opts)).rejects.toMatchObject({ reconnect: true })
  })
})

describe('syncDrive (two devices)', () => {
  const device = (fake: FakeDrive): SyncOptions => ({
    interactive: true,
    getToken: async () => fake.token,
    fetchImpl: fake.fetch,
    importFn: fakeImport,
  })
  const word = (lemma: string) =>
    saveLookup({ lemma, surface: lemma, sentence: `A ${lemma}.`, dictSenses: [], book: { id: 'b', title: 'B' }, cardTypes: ['en-de'] })

  it('creates the app folder once, brings books and words to the second device', async () => {
    const fake = new FakeDrive()
    // device A, first connect: the app folder is created and the vocabulary uploaded
    await word('estimator')
    const first = await syncDrive(device(fake))
    expect(first).toMatchObject({ books: { imported: 0 }, merged: null })
    const app = fake.find('Vokabel-Reader')!
    expect(app.appProperties).toEqual({ vokabelReader: 'root' })
    expect(JSON.parse(fake.text(fake.find(SYNC_FILE)!.id)).terms.map((t: { id: string }) => t.id)).toEqual(['estimator'])
    expect(await getDriveState()).toMatchObject({ connected: true, appFolderId: app.id, lastResult: 'alles aktuell' })

    // a book is put into the folder (e.g. on the desktop), A syncs again
    fake.add({ name: 'paper.pdf', parents: [app.id], content: 'P' })
    expect(await syncDrive(device(fake))).toMatchObject({ books: { imported: 1 } })

    // device B: empty, connects, finds the same folder
    await reset()
    const second = await syncDrive(device(fake))
    expect(second).toMatchObject({ books: { imported: 1 }, merged: { added: 1 } })
    expect([...fake.files.values()].filter(f => f.name === 'Vokabel-Reader')).toHaveLength(1)
    expect(await ids()).toEqual(['book:paper.pdf'])
    expect(await db.terms.get('estimator')).toBeDefined()
    expect((await getDriveState()).lastResult).toBe('1 neues Buch, 1 neues Wort')
  })

  it('uses the books folder chosen on another device', async () => {
    const fake = new FakeDrive()
    const mine = fake.folder('Meine Bücher')
    fake.add({ name: 'novel.epub', parents: [mine.id], content: 'N' })
    await syncDrive(device(fake))
    await setBooksFolder(`https://drive.google.com/drive/folders/${mine.id}?usp=sharing`, device(fake))
    await syncDrive(device(fake))
    expect(await ids()).toEqual(['book:novel.epub'])
    expect(await getDriveState()).toMatchObject({ booksFolderId: mine.id, booksFolderName: 'Meine Bücher' })

    await reset() // other device
    await syncDrive(device(fake))
    expect(await ids()).toEqual(['book:novel.epub'])

    await expect(setBooksFolder('https://example.com', device(fake))).rejects.toThrow('kein Link')
    const file = fake.add({ name: 'x.pdf', id: 'aFileIdThatIsLongEnough' })
    await expect(setBooksFolder(file.id, device(fake))).rejects.toThrow('nicht auf einen Ordner')
  })

  it('finds the books folder by its name', async () => {
    const fake = new FakeDrive()
    const mine = fake.folder('book-app-folder')
    fake.add({ name: 'novel.epub', parents: [mine.id], content: 'N' })
    await syncDrive(device(fake))
    await setBooksFolder('  book-app-folder ', device(fake))
    await syncDrive(device(fake))
    expect(await ids()).toEqual(['book:novel.epub'])
    expect(await getDriveState()).toMatchObject({ booksFolderId: mine.id, booksFolderName: 'book-app-folder' })

    await expect(setBooksFolder('no-such-folder', device(fake))).rejects.toThrow('Kein Ordner namens „no-such-folder“')
    fake.folder('Bücher')
    fake.folder('Bücher', mine.id)
    await expect(setBooksFolder('Bücher', device(fake))).rejects.toThrow('2 Ordner namens „Bücher“')
  })

  it('in the background only runs with a valid token and asks for a tap otherwise', async () => {
    const fake = new FakeDrive()
    const background = { ...device(fake), interactive: false }
    expect(await syncDrive(background)).toBeNull() // never connected on this device
    expect(fake.log).toEqual([])

    await syncDrive(device(fake))
    expect(await syncDrive({ ...background, getToken: async () => null })).toBeNull()
    expect(getDriveStatus()).toMatchObject({ running: false, needsLogin: true })

    expect(await syncDrive(background)).not.toBeNull()
    expect(getDriveStatus().needsLogin).toBe(false)

    fake.token = 'revoked'
    expect(await syncDrive({ ...background, getToken: async () => 'stale' })).toBeNull()
    expect(getDriveStatus()).toMatchObject({ needsLogin: true, error: expect.stringContaining('neu verbinden') })
  })

  it('reports a damaged sync file instead of overwriting it', async () => {
    const fake = new FakeDrive()
    await syncDrive(device(fake))
    const file = fake.find(SYNC_FILE)!
    file.content = new TextEncoder().encode('{ broken')
    expect(await syncDrive(device(fake))).toBeNull()
    expect(getDriveStatus().error).toContain('beschädigt')
    expect(fake.text(file.id)).toBe('{ broken')
  })
})

describe('summarize', () => {
  it('says what changed', () => {
    expect(summarize({ imported: 0, failed: 0 }, null)).toBe('alles aktuell')
    expect(summarize({ imported: 2, failed: 0 }, { terms: 9, added: 3, updated: 1, removed: 2, highlights: 0 })).toBe(
      '2 neue Bücher, 3 neue Wörter, 1 Wort aktualisiert, 2 Wörter gelöscht',
    )
    expect(summarize({ imported: 0, failed: 0 }, { terms: 9, added: 0, updated: 0, removed: 0, highlights: 1 })).toBe(
      '1 Markierung abgeglichen',
    )
  })
})
