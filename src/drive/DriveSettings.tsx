import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState } from 'react'
import type { DriveClient } from './driveApi'
import { FolderLink, statusText } from './DriveBar'
import {
  addBookSource,
  APP_FOLDER_NAME,
  browseClient,
  disconnectDrive,
  reloadSkippedBooks,
  removeBookSource,
  syncDrive,
  useDriveState,
  useDriveStatus,
  type BookSource,
} from './driveSync'
import { FolderPicker } from './FolderPicker'
import { driveConfigured, preloadGis } from './googleAuth'
import { booksBySource, countSkippedDriveFiles } from './syncBooks'
import { SYNC_FILE } from './syncVocab'

const when = (ms: number) => new Date(ms).toLocaleString('de-AT', { dateStyle: 'medium', timeStyle: 'short' })

const bookCount = (n: number) => (n === 1 ? '1 Buch' : `${n} Bücher`)

/** Settings section "Google Drive": connect, books folders, sync, disconnect. */
export function DriveSettings() {
  const state = useDriveState()
  const status = useDriveStatus()
  const skipped = useLiveQuery(countSkippedDriveFiles, [], 0)
  const counts = useLiveQuery(booksBySource, [])
  const [picker, setPicker] = useState<DriveClient | null>(null)
  const [folderError, setFolderError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => preloadGis(), [])

  if (!driveConfigured())
    return (
      <p className="muted" data-testid="drive-settings">
        Nicht eingerichtet: Für den Abgleich mit Google Drive braucht die App eine eigene Google-Client-ID
        (<code>VITE_GOOGLE_CLIENT_ID</code>, Anleitung in der README unter „Google Drive“).
      </p>
    )
  if (!state) return null

  if (!state.connected)
    return (
      <div data-testid="drive-settings">
        <p className="muted">
          Bücher aus einem Google-Drive-Ordner landen automatisch in der Bibliothek, und Vokabeln, Lernstand und Lesefortschritt
          bleiben zwischen deinen Geräten gleich. Die Bücher werden komplett auf dieses Gerät geladen und bleiben auch ohne Drive
          lesbar. Die Anmeldung gilt nur für dieses Gerät.
        </p>
        <div className="row">
          <button className="primary" disabled={status.running} onClick={() => void syncDrive({ interactive: true })}>
            Mit Google verbinden
          </button>
          {status.running && <span>{statusText(status)}</span>}
          {status.error && <span className="warn">{status.error}</span>}
        </div>
      </div>
    )

  const appFolder = state.appFolderName ?? APP_FOLDER_NAME
  const sources = state.sources ?? []
  const countOf = (id?: string) => (id && counts?.get(id)?.size) || 0
  const added = new Set([state.appFolderId, ...sources.map(s => s.id)].filter((id): id is string => !!id))

  async function openPicker() {
    setFolderError('')
    try {
      // right in the tap: the login popup may open
      setPicker(await browseClient())
    } catch (e) {
      setFolderError((e as Error).message)
    }
  }

  async function remove(source: BookSource) {
    const n = countOf(source.id)
    const kept = n ? ` ${n === 1 ? 'Das Buch' : `Die ${n} Bücher`} von dort ${n === 1 ? 'bleibt' : 'bleiben'} in der Bibliothek.` : ''
    if (!confirm(`„${source.name}“ nicht mehr abgleichen?${kept}`)) return
    setFolderError('')
    setBusy(true)
    try {
      await removeBookSource(source.id)
    } catch (e) {
      setFolderError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div data-testid="drive-settings">
      <p className="label">Bücherordner</p>
      <ul className="source-list" data-testid="book-sources">
        <li>
          <FolderLink id={state.appFolderId} name={appFolder} />
          <span className="muted">
            in „Meine Ablage“, immer dabei{countOf(state.appFolderId) ? ` · ${bookCount(countOf(state.appFolderId))}` : ''}
          </span>
        </li>
        {sources.map(s => (
          <li key={s.id}>
            <FolderLink id={s.id} name={s.name} />
            {s.error ? <span className="warn">{s.error}</span> : <span className="muted">{bookCount(countOf(s.id))}</span>}
            <button type="button" className="source-remove" disabled={busy} onClick={() => void remove(s)}>
              Entfernen
            </button>
          </li>
        ))}
      </ul>
      {picker ? (
        <FolderPicker
          client={picker}
          added={added}
          onAdd={folder => addBookSource(folder)}
          onClose={() => setPicker(null)}
        />
      ) : (
        <div className="row">
          <button type="button" disabled={busy} onClick={() => void openPicker()}>
            + Ordner hinzufügen
          </button>
        </div>
      )}
      {folderError && <p className="warn">{folderError}</p>}
      <p className="muted">
        Neue EPUBs und PDFs in diesen Ordnern (auch in Unterordnern) lädt die App beim Abgleich herunter. Die Liste gilt für alle
        deine Geräte. Der Lernstand liegt als <code>{SYNC_FILE}</code> im Ordner „{appFolder}“.
      </p>

      <div className="row">
        <button disabled={status.running} onClick={() => void syncDrive({ interactive: true })}>
          Jetzt abgleichen
        </button>
        <span data-testid="drive-sync-status">
          {status.running
            ? statusText(status)
            : state.lastSync
              ? `Letzter Abgleich: ${when(state.lastSync)}${state.lastResult ? ` – ${state.lastResult}` : ''}`
              : 'Noch nicht abgeglichen'}
        </span>
      </div>
      {!status.running && status.error && <p className="warn">{status.error}</p>}

      {skipped > 0 && (
        <div className="row">
          <span>
            {skipped === 1 ? '1 Buch aus Drive wird' : `${skipped} Bücher aus Drive werden`} nicht geladen (aus der Bibliothek
            entfernt oder nicht lesbar).
          </span>
          <button disabled={status.running} onClick={() => void reloadSkippedBooks()}>
            Wieder laden
          </button>
        </div>
      )}

      <div className="row">
        <button
          className="danger"
          onClick={() => {
            if (confirm('Google Drive auf diesem Gerät trennen? Bücher und Vokabeln bleiben hier gespeichert.')) void disconnectDrive()
          }}
        >
          Trennen
        </button>
        <span className="muted">
          Ganz entziehen kannst du den Zugriff unter <a href="https://myaccount.google.com/connections" target="_blank" rel="noreferrer">myaccount.google.com</a>.
        </span>
      </div>
    </div>
  )
}
