// Downloads every new book file from the Google Drive books folder into the library.
// After the download the book lives in IndexedDB like any imported file: readable
// offline and independent of Drive. Files the user removed from the library are
// remembered as "dismissed" and not downloaded again.
import { db, type Book } from '../db/schema'
import { formatOf, importBook } from '../library/importBook'
import { DriveError, sizeOf, type DriveClient, type DriveFile } from './driveApi'

export interface BookSyncProgress {
  done: number
  total: number
  name?: string
}

export interface BookSyncResult {
  imported: number
  failed: number
  /** message of the last failure */
  lastError?: string
}

/** EPUB, PDF and the other formats the reader opens; no Google Docs, shortcuts or other files. */
export const isBookFile = (f: DriveFile) => !f.mimeType.startsWith('application/vnd.google-apps.') && formatOf(f.name) !== 'other'

async function enoughSpace(bytes: number): Promise<boolean> {
  const e = await navigator.storage?.estimate?.().catch(() => undefined)
  if (!e?.quota || e.usage === undefined) return true
  return e.quota - e.usage > bytes * 1.2 + 20e6
}

export async function syncDriveBooks(opts: {
  drive: DriveClient
  folderId: string
  importFn?: (file: File) => Promise<Book>
  onProgress?: (p: BookSyncProgress) => void
  hasSpace?: (bytes: number) => Promise<boolean>
}): Promise<BookSyncResult> {
  const { drive, folderId, onProgress, importFn = importBook, hasSpace = enoughSpace } = opts
  const known = new Set((await db.driveFiles.toCollection().primaryKeys()) as string[])
  const todo = (await drive.listFolderTree(folderId)).filter(f => isBookFile(f) && !known.has(f.id))
  const result: BookSyncResult = { imported: 0, failed: 0 }

  for (const [i, f] of todo.entries()) {
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
      // offline or logged out: stop, the next sync tries again
      if (!(e instanceof DriveError) || e.status === 0 || e.reconnect) throw e
      result.failed++
      result.lastError = `„${f.name}“: ${e.message}`
      continue
    }
    const row = { id: f.id, name: f.name, size, md5: f.md5Checksum, updatedAt: Date.now() }
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
