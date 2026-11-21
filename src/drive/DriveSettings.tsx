import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState } from 'react'
import { statusText } from './DriveBar'
import {
  APP_FOLDER_NAME,
  disconnectDrive,
  reloadSkippedBooks,
  setBooksFolder,
  syncDrive,
  useDriveState,
  useDriveStatus,
} from './driveSync'
import { driveConfigured, preloadGis } from './googleAuth'
import { countSkippedDriveFiles } from './syncBooks'
import { SYNC_FILE } from './syncVocab'

const when = (ms: number) => new Date(ms).toLocaleString('de-AT', { dateStyle: 'medium', timeStyle: 'short' })

/** Settings section "Google Drive": connect, books folder, sync, disconnect. */
export function DriveSettings() {
  const state = useDriveState()
  const status = useDriveStatus()
  const skipped = useLiveQuery(countSkippedDriveFiles, [], 0)
  const [link, setLink] = useState('')
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

  async function changeFolder(value: string | null) {
    setFolderError('')
    setBusy(true)
    try {
      await setBooksFolder(value)
      setLink('')
    } catch (e) {
      setFolderError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div data-testid="drive-settings">
      <p>
        Bücherordner: <strong>{state.booksFolderName ?? APP_FOLDER_NAME}</strong>
        {!state.booksFolderId && <span className="muted"> (in „Meine Ablage“, von der App angelegt)</span>}
      </p>
      <p className="muted">
        Neue EPUBs und PDFs in diesem Ordner (auch in Unterordnern) lädt die App beim Abgleich herunter. Der Lernstand liegt als{' '}
        <code>{SYNC_FILE}</code> im Ordner „{APP_FOLDER_NAME}“.
      </p>
      <form
        className="row"
        onSubmit={e => {
          e.preventDefault()
          if (link.trim()) void changeFolder(link)
        }}
      >
        <input
          className="drive-link"
          type="text" // not "url": a bare folder id is fine too
          inputMode="url"
          autoComplete="off"
          placeholder="Link zu einem anderen Drive-Ordner"
          value={link}
          onChange={e => setLink(e.target.value)}
          aria-label="Link zu einem anderen Drive-Ordner"
        />
        <button type="submit" disabled={busy || !link.trim()}>
          Ordner übernehmen
        </button>
        {state.booksFolderId && (
          <button type="button" disabled={busy} onClick={() => void changeFolder(null)}>
            Zurück auf „{APP_FOLDER_NAME}“
          </button>
        )}
      </form>
      {folderError && <p className="warn">{folderError}</p>}

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
