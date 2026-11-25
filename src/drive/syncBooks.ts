// Downloads every new book file from the Google Drive books folders into the library.
// After the download the book lives in IndexedDB like any imported file: readable
// offline and independent of Drive. Files the user removed from the library are
// remembered as "dismissed" and not downloaded again.
import { db, type Book } from '../db/schema'
import { formatOf, importBook } from '../library/importBook'
import { DriveError, sizeOf, type DriveClient, type DriveFile } from './driveApi'

export interface BookSyncProgress {
  done: number
  total: number
  /** the book being downloaded */
  name?: string
  /** the books folder being searched */
  folder?: string
}

export interface BookSyncResult {
  imported: number
  failed: number
  /** message of the last failure */
  lastError?: string
  /** books folders that could not be searched: folder id → message */
  folderErrors?: Record<string, string>
}

/** A books folder to search: the app folder or one the user added. */
export interface BookFolder {
  id: string
  name: string
}

/** EPUB, PDF and the other formats the reader opens; no Google Docs, shortcuts or other files. */
export const isBookFile = (f: DriveFile) => !f.mimeType.startsWith('application/vnd.google-apps.') && formatOf(f.name) !== 'other'

async function enoughSpace(bytes: number): Promise<boolean> {
  const e = await navigator.storage?.estimate?.().catch(() => undefined)
  if (!e?.quota || e.usage === undefined) return true
  return e.quota - e.usage > bytes * 1.2 + 20e6
}

/** offline or logged out: the whole sync stops, the next one tries again */
const stopsSync = (e: unknown) => !(e instanceof DriveError) || e.status === 0 || e.reconnect

export async function syncDriveBooks(opts: {
  drive: DriveClient
  folders: BookFolder[]
  importFn?: (file: File) => Promise<Book>
  onProgress?: (p: BookSyncProgress) => void
  hasSpace?: (bytes: number) => Promise<boolean>
}): Promise<BookSyncResult> {
  const { drive, folders, onProgress, importFn = importBook, hasSpace = enoughSpace } = opts
  const result: BookSyncResult = { imported: 0, failed: 0 }

  // Book files per folder. A books folder inside another one is searched on its own, so every
  // file belongs to the closest books folder (the library filter shows that one).
  const found = new Map<string, { file: DriveFile; sourceId: string }>()
  for (const folder of folders) {
    onProgress?.({ done: 0, total: 0, folder: folder.name })
    const others = new Set(folders.map(f => f.id).filter(id => id !== folder.id))
    let files: DriveFile[]
    try {
      files = await drive.listFolderTree(folder.id, others)
    } catch (e) {
      if (stopsSync(e)) throw e
      // e.g. no longer shared: the other folders go on
      result.folderErrors = { ...result.folderErrors, [folder.id]: (e as Error).message }
      continue
    }
    for (const file of files) if (isBookFile(file) && !found.has(file.id)) found.set(file.id, { file, sourceId: folder.id })
  }

  const ids = [...found.keys()]
  const rows = await db.driveFiles.bulkGet(ids)
  const todo: { file: DriveFile; sourceId: string }[] = []
  const moved: { key: string; changes: { sourceId: string } }[] = []
  rows.forEach((row, i) => {
    const entry = found.get(ids[i])!
    if (!row) todo.push(entry)
    // known file: note where it is now (also fills rows from before there were several folders)
    else if (row.sourceId !== entry.sourceId) moved.push({ key: row.id, changes: { sourceId: entry.sourceId } })
  })
  if (moved.length) await db.driveFiles.bulkUpdate(moved)

  for (const [i, { file: f, sourceId }] of todo.entries()) {
    onProgress?.({ done: i, total: todo.length, name: f.name })
    const size = sizeOf(f)
    if (size && !(await hasSpace(size))) {
      result.failed++
      result.lastError = `Nicht genug Speicherplatz für „${f.name}“`
      continue
    }
    let blob: Blob
    try {
      blob = await drive.download(f.id)
    } catch (e) {
      if (stopsSync(e)) throw e
      result.failed++
      result.lastError = `„${f.name}“: ${(e as Error).message}`
      continue
    }
    const row = { id: f.id, name: f.name, size, md5: f.md5Checksum, sourceId, updatedAt: Date.now() }
    try {
      const book = await importFn(new File([blob], f.name, { type: blob.type || f.mimeType }))
      await db.driveFiles.put({ ...row, bookId: book.id, state: 'imported' })
      result.imported++
    } catch (e) {
      // not readable as a book: remembered, so it is not downloaded again and again
      await db.driveFiles.put({ ...row, state: 'error', error: (e as Error).message })
      result.failed++
      result.lastError = `„${f.name}“ konnte nicht geöffnet werden: ${(e as Error).message}`
    }
  }
  onProgress?.({ done: todo.length, total: todo.length })
  return result
}

/** Books removed from the library or unreadable: count for the settings page. */
export const countSkippedDriveFiles = () => db.driveFiles.where('state').anyOf('dismissed', 'error').count()

/** Lets the next sync download dismissed and failed files again. */
export async function forgetSkippedDriveFiles() {
  await db.driveFiles.where('state').anyOf('dismissed', 'error').delete()
}

/** Books in the library per books folder (folder id → book ids); a book can come from several folders. */
export async function booksBySource(): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>()
  for (const row of await db.driveFiles.where('state').equals('imported').toArray()) {
    if (!row.sourceId || !row.bookId) continue
    let set = out.get(row.sourceId)
    if (!set) out.set(row.sourceId, (set = new Set()))
    set.add(row.bookId)
  }
  return out
}
