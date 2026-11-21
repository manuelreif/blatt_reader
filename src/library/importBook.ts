import { db, type Book, type BookFormat } from '../db/schema'
import { loadFoliate, metaString } from '../reader/foliate'
import { fileId } from '../util/hash'

export function formatOf(name: string): BookFormat {
  const ext = name.toLowerCase().split('.').pop() ?? ''
  if (ext === 'epub') return 'epub'
  if (ext === 'pdf') return 'pdf'
  if (ext === 'mobi' || ext === 'azw3' || ext === 'azw') return 'mobi'
  if (ext === 'fb2' || ext === 'fbz') return 'fb2'
  if (ext === 'cbz') return 'cbz'
  return 'other'
}

/** Stores the file and its metadata; returns the existing entry for a known file. */
export async function importBook(file: File): Promise<Book> {
  const id = await fileId(file)
  const existing = await db.books.get(id)
  if (existing) return existing
  const { makeBook } = await loadFoliate()
  const parsed = await makeBook(file)
  let cover: Blob | undefined
  try {
    cover = (await parsed.getCover?.()) ?? undefined
  } catch {
    cover = undefined
  }
  const book: Book = {
    id,
    title: metaString(parsed.metadata?.title).trim() || file.name.replace(/\.[^.]+$/, ''),
    author: metaString(parsed.metadata?.author).trim(),
    format: formatOf(file.name),
    fileName: file.name,
    file,
    cover,
    addedAt: Date.now(),
  }
  parsed.destroy?.()
  await db.books.put(book)
  return book
}
