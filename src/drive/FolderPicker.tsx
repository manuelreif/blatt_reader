import { useEffect, useRef, useState } from 'react'
import { DriveError, FOLDER_MIME, type DriveClient, type DriveFile } from './driveApi'
import { browseClient, findFolders } from './driveSync'
import { forgetToken } from './googleAuth'
import { isBookFile } from './syncBooks'

/** One step in the folder browser. */
type Level =
  | { kind: 'start' }
  | { kind: 'mine' | 'shared' | 'drives'; name: string }
  | { kind: 'folder'; id: string; name: string }
  | { kind: 'search'; query: string; name: string }

const START: Level = { kind: 'start' }
const MINE: Level = { kind: 'mine', name: 'Meine Ablage' }
const SHARED: Level = { kind: 'shared', name: 'Für mich freigegeben' }
const DRIVES: Level = { kind: 'drives', name: 'Geteilte Ablagen' }

const looksLikeLink = (s: string) => /^https?:\/\//i.test(s) || /drive\.google\./i.test(s)
const keyOf = (l: Level) => (l.kind === 'folder' ? `folder:${l.id}` : l.kind === 'search' ? `search:${l.query}` : l.kind)

async function load(client: DriveClient, level: Level): Promise<DriveFile[]> {
  switch (level.kind) {
    case 'start':
      return []
    case 'mine':
      return client.listChildren('root')
    case 'shared':
      return client.sharedFolders()
    case 'drives':
      return (await client.sharedDrives()).map(d => ({ id: d.id, name: d.name, mimeType: FOLDER_MIME }))
    case 'folder':
      return client.listChildren(level.id)
    case 'search':
      return findFolders(client, level.query)
  }
}

const EMPTY: Record<Level['kind'], string> = {
  start: '',
  mine: 'Keine Ordner in „Meine Ablage“.',
  shared: 'Niemand hat bisher einen Ordner mit dir geteilt.',
  drives: 'Keine geteilten Ablagen.',
  folder: 'Keine Unterordner.',
  search: 'Nichts gefunden.',
}

function sharedBy(f: DriveFile): string | undefined {
  if (f.ownedByMe !== false) return undefined
  const owner = f.owners?.[0]?.displayName
  return owner ? `geteilt von ${owner}` : 'geteilt'
}

/**
 * Browses Google Drive for a books folder: My Drive, shared with me, shared drives, or a search
 * by name or link. Only for choosing; nothing is downloaded here.
 */
export function FolderPicker({
  client: initialClient,
  added,
  onAdd,
  onClose,
}: {
  client: DriveClient
  /** folders already in the list (app folder included) */
  added: ReadonlySet<string>
  onAdd: (folder: { id: string; name: string }) => Promise<void>
  onClose: () => void
}) {
  const [client, setClient] = useState(initialClient)
  const [path, setPath] = useState<Level[]>([START])
  const [items, setItems] = useState<DriveFile[] | null>([])
  const [error, setError] = useState<DriveError | Error | null>(null)
  const [hasDrives, setHasDrives] = useState(false)
  const [query, setQuery] = useState('')
  const [adding, setAdding] = useState(false)
  const cache = useRef(new Map<string, DriveFile[]>())
  const level = path[path.length - 1]

  useEffect(() => {
    let cancelled = false
    client.sharedDrives().then(
      d => !cancelled && setHasDrives(d.length > 0),
      () => {}, // not needed to choose a folder
    )
    return () => {
      cancelled = true
    }
  }, [client])

  useEffect(() => {
    let cancelled = false
    const key = keyOf(level)
    const cached = cache.current.get(key)
    setError(null)
    setItems(cached ?? null)
    if (cached) return
    load(client, level).then(
      files => {
        if (cancelled) return
        cache.current.set(key, files)
        // a pasted link leads straight into its folder
        if (level.kind === 'search' && looksLikeLink(level.query) && files.length === 1)
          setPath(p => [...p.slice(0, -1), { kind: 'folder', id: files[0].id, name: files[0].name }])
        else setItems(files)
      },
      (e: Error) => {
        if (!cancelled) setError(e)
      },
    )
    return () => {
      cancelled = true
    }
  }, [client, level])

  const open = (next: Level) => setPath(p => [...p, next])

  async function reconnect() {
    // a tap: the login popup may open
    forgetToken()
    cache.current.clear()
    try {
      setClient(await browseClient())
    } catch (e) {
      setError(e as Error)
    }
  }

  async function add(folder: { id: string; name: string }) {
    setAdding(true)
    try {
      await onAdd(folder)
      onClose()
    } catch (e) {
      setError(e as Error)
      setAdding(false)
    }
  }

  const folders = (items ?? []).filter(f => f.mimeType === FOLDER_MIME)
  const books = (items ?? []).filter(isBookFile).length
  const title = level.kind === 'start' ? 'Ordner auswählen' : level.name

  return (
    <div className="folder-picker" data-testid="folder-picker" role="region" aria-label="Ordner auswählen">
      <div className="picker-head">
        <button type="button" onClick={() => setPath(p => p.slice(0, -1))} disabled={path.length < 2} aria-label="Zurück">
          ‹
        </button>
        <strong className="picker-title">{title}</strong>
        <button type="button" onClick={onClose}>
          Abbrechen
        </button>
      </div>
      {path.length > 2 && (
        <nav className="picker-crumbs" aria-label="Pfad">
          {path.slice(1, -1).map((l, i) => (
            <span key={keyOf(l)}>
              <button type="button" className="link" onClick={() => setPath(p => p.slice(0, i + 2))}>
                {l.kind === 'start' ? '' : l.name}
              </button>
              {' › '}
            </span>
          ))}
        </nav>
      )}

      <form
        className="row picker-search"
        onSubmit={e => {
          e.preventDefault()
          const q = query.trim()
          if (q) setPath([START, { kind: 'search', query: q, name: looksLikeLink(q) ? 'Link' : `Suche: „${q}“` }])
        }}
      >
        <input
          type="search"
          inputMode="search"
          autoComplete="off"
          placeholder="Ordnername oder Link"
          aria-label="Ordner suchen oder Link einfügen"
          value={query}
          onChange={e => setQuery(e.target.value)}
        />
        <button type="submit" disabled={!query.trim()}>
          Suchen
        </button>
      </form>

      <ul className="picker-list">
        {level.kind === 'start' ? (
          <>
            <li>
              <button type="button" className="picker-row" onClick={() => open(MINE)}>
                <span className="picker-name">Meine Ablage</span>
                <span className="muted">deine eigenen Ordner</span>
              </button>
            </li>
            <li>
              <button type="button" className="picker-row" onClick={() => open(SHARED)}>
                <span className="picker-name">Für mich freigegeben</span>
                <span className="muted">Ordner, die andere mit dir teilen</span>
              </button>
            </li>
            {hasDrives && (
              <li>
                <button type="button" className="picker-row" onClick={() => open(DRIVES)}>
                  <span className="picker-name">Geteilte Ablagen</span>
                </button>
              </li>
            )}
          </>
        ) : error ? (
          <li className="picker-note">
            <span className="warn">{error.message}</span>
            {error instanceof DriveError && error.reconnect && (
              <button type="button" onClick={() => void reconnect()}>
                Neu anmelden
              </button>
            )}
          </li>
        ) : items === null ? (
          <li className="picker-note muted">lädt …</li>
        ) : folders.length === 0 ? (
          <li className="picker-note muted">{EMPTY[level.kind]}</li>
        ) : (
          folders.map(f => {
            const note = [sharedBy(f), added.has(f.id) && '✓ schon dabei'].filter(Boolean).join(' · ')
            return (
              <li key={f.id}>
                <button type="button" className="picker-row" onClick={() => open({ kind: 'folder', id: f.id, name: f.name })}>
                  <span className="picker-name">{f.name}</span>
                  {note && <span className="muted">{note}</span>}
                </button>
              </li>
            )
          })
        )}
      </ul>

      {level.kind === 'folder' && (
        <div className="picker-foot">
          <span className="muted">
            {items === null ? '…' : books ? `${books} ${books === 1 ? 'Buch' : 'Bücher'} direkt hier` : 'Keine Bücher direkt hier'}
            {folders.length > 0 && ', Unterordner kommen mit'}
          </span>
          {added.has(level.id) ? (
            <span className="ok">✓ schon dabei</span>
          ) : (
            <button type="button" className="primary" disabled={adding} onClick={() => void add({ id: level.id, name: level.name })}>
              {adding ? 'Füge hinzu …' : 'Diesen Ordner hinzufügen'}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
