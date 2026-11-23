import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Emblem, Glyph } from '../brand/Logo'
import { InstallButton } from '../pwa/InstallButton'
import { deleteBook, quizBooks, type QuizBook } from '../db/repo'
import { db, type Book } from '../db/schema'
import { DriveBar } from '../drive/DriveBar'
import { href, navigate } from '../router'
import { importBook } from './importBook'

const ACCEPT = '.epub,.pdf,.mobi,.azw3,.azw,.fb2,.fbz,.cbz'

function Cover({ book }: { book: Book }) {
  const url = useMemo(() => (book.cover ? URL.createObjectURL(book.cover) : null), [book.cover])
  useEffect(() => () => {
    if (url) URL.revokeObjectURL(url)
  }, [url])
  if (url) return <img src={url} alt="" className="cover" />
  return (
    <div className="cover cover-placeholder">
      <Glyph />
      <span>{book.format.toUpperCase()}</span>
    </div>
  )
}

/** The book's own quiz: only words saved while reading it. */
function BookQuizLink({ quiz }: { quiz?: QuizBook }) {
  if (!quiz) return null
  return (
    <a className="book-quiz" href={href({ name: 'quiz', bookId: quiz.bookId })} data-testid="book-quiz">
      Quiz · {quiz.due ? `${quiz.due} fällig` : `${quiz.terms} Wörter`}
    </a>
  )
}

export function LibraryView() {
  const books = useLiveQuery(() => db.books.orderBy('addedAt').reverse().toArray(), [])
  const quiz = useLiveQuery(async () => new Map((await quizBooks()).map(q => [q.bookId, q])), [])
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [dragging, setDragging] = useState(false)

  async function handleFiles(fileList: FileList | File[]) {
    // copy first: resetting the <input> empties its FileList
    const files = Array.from(fileList)
    setError('')
    setBusy(true)
    let last: Book | undefined
    for (const file of files) {
      try {
        last = await importBook(file)
      } catch (e) {
        console.error(e)
        setError(`„${file.name}“ konnte nicht geöffnet werden: ${(e as Error).message}`)
      }
    }
    setBusy(false)
    if (last && files.length === 1) navigate({ name: 'read', bookId: last.id })
  }

  return (
    <section
      className={`library ${dragging ? 'dragging' : ''}`}
      onDragOver={e => {
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={e => {
        e.preventDefault()
        setDragging(false)
        if (e.dataTransfer.files.length) void handleFiles(e.dataTransfer.files)
      }}
    >
      <header className="page-head">
        <h1>Bibliothek</h1>
        <button className="primary" onClick={() => input.current?.click()} disabled={busy}>
          {busy ? 'Importiere …' : '+ Buch öffnen'}
        </button>
        <input
          ref={input}
          type="file"
          accept={ACCEPT}
          multiple
          hidden
          data-testid="book-input"
          onChange={e => {
            if (e.target.files?.length) void handleFiles(e.target.files)
            e.target.value = ''
          }}
        />
      </header>
      <DriveBar />
      {error && <p className="error">{error}</p>}
      {books && books.length === 0 && (
        <div className="empty">
          <Emblem />
          <p>Noch keine Bücher. Öffne eine EPUB- oder PDF-Datei (oder zieh sie hierher).</p>
          <p className="muted">Die Dateien bleiben auf diesem Gerät, im Speicher des Browsers.</p>
          <InstallButton className="primary" />
        </div>
      )}
      <ul className="book-grid">
        {books?.map(book => (
          <li key={book.id} className="book">
            <button className="book-open" onClick={() => navigate({ name: 'read', bookId: book.id })}>
              <Cover book={book} />
              <span className="book-title">{book.title}</span>
              {book.author && <span className="book-author">{book.author}</span>}
              <span className="progress-bar">
                <span style={{ width: `${Math.round((book.progress ?? 0) * 100)}%` }} />
              </span>
            </button>
            <BookQuizLink quiz={quiz?.get(book.id)} />
            <button
              className="icon danger"
              title="Buch entfernen"
              onClick={async () => {
                const fromDrive = await db.driveFiles.where('bookId').equals(book.id).count()
                const note = fromDrive ? ' Aus Google Drive wird es nicht wieder geladen (Einstellungen → Google Drive → Wieder laden).' : ''
                if (confirm(`„${book.title}“ aus der Bibliothek entfernen? Deine Vokabeln bleiben erhalten.${note}`)) void deleteBook(book.id)
              }}
            >
              ✕
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
