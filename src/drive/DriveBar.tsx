import { useEffect } from 'react'
import { href } from '../router'
import { APP_FOLDER_NAME, syncDrive, useDriveState, useDriveStatus, type DriveState, type DriveStatus } from './driveSync'
import { driveConfigured, preloadGis } from './googleAuth'

/** A folder's name, linked to the folder in Google Drive once its id is known. */
export function FolderLink({ id, name }: { id?: string; name: string }) {
  if (!id) return <strong>{name}</strong>
  return (
    <a href={`https://drive.google.com/drive/folders/${encodeURIComponent(id)}`} target="_blank" rel="noopener noreferrer">
      <strong>{name}</strong>
    </a>
  )
}

/** The app folder first, then the folders the user added. */
export function booksFolders(state: DriveState): { id?: string; name: string; error?: string }[] {
  return [{ id: state.appFolderId, name: state.appFolderName ?? APP_FOLDER_NAME }, ...(state.sources ?? [])]
}

export function statusText(s: DriveStatus): string {
  switch (s.phase) {
    case 'login':
      return 'Anmeldung bei Google …'
    case 'folder':
      return 'verbinde …'
    case 'books':
      if (s.progress && s.progress.total > s.progress.done)
        return `lade Buch ${s.progress.done + 1} von ${s.progress.total}${s.progress.name ? ` („${s.progress.name}“)` : ''} …`
      return s.progress?.folder ? `prüfe „${s.progress.folder}“ …` : 'prüfe die Bücherordner …'
    case 'vocab':
      return 'gleiche den Lernstand ab …'
    default:
      return ''
  }
}

/** "Bücher aus A", "Bücher aus A und B", "Bücher aus 3 Ordnern" (then linked to the settings). */
function FoldersText({ state }: { state: DriveState }) {
  const folders = booksFolders(state)
  if (folders.length > 2) return <a href={href({ name: 'settings' })}>{folders.length} Ordnern</a>
  return (
    <>
      {folders.map((f, i) => (
        <span key={f.id ?? i}>
          {i > 0 && ' und '}
          <FolderLink id={f.id} name={f.name} />
        </span>
      ))}
    </>
  )
}

/** Sync status above the library; shows the button when the next sync needs a tap. */
export function DriveBar() {
  const state = useDriveState()
  const status = useDriveStatus()
  const visible = driveConfigured() && !!state?.connected
  useEffect(() => {
    // the popup only opens without delay if the Google script is already there
    if (visible) preloadGis()
  }, [visible])
  if (!visible) return null

  if (status.running)
    return (
      <div className="drive-bar" data-testid="drive-bar" aria-live="polite">
        <span>Google Drive: {statusText(status)}</span>
        {status.phase === 'books' && status.progress && status.progress.total > 0 && (
          <progress value={status.progress.done} max={status.progress.total} />
        )}
      </div>
    )
  if (status.needsLogin)
    return (
      <div className="drive-bar" data-testid="drive-bar">
        <button className="primary" onClick={() => void syncDrive({ interactive: true })}>
          Mit Google Drive abgleichen
        </button>
        {status.error && <span className="warn">{status.error}</span>}
      </div>
    )
  if (status.error)
    return (
      <div className="drive-bar" data-testid="drive-bar">
        <span className="warn">Google Drive: {status.error}</span>
        <button onClick={() => void syncDrive({ interactive: true })}>Erneut versuchen</button>
      </div>
    )
  const broken = (state.sources ?? []).filter(s => s.error)
  return (
    <div className="drive-bar drive-bar-idle" data-testid="drive-bar">
      <span>
        Google Drive: Bücher aus <FoldersText state={state} />
      </span>
      {broken.length > 0 && (
        <span className="warn">
          {broken.length === 1 ? `„${broken[0].name}“ ist` : `${broken.length} Ordner sind`} nicht erreichbar ·{' '}
          <a href={href({ name: 'settings' })}>Einstellungen</a>
        </span>
      )}
      {state.lastSync && (
        <span className="muted">
          abgeglichen {new Date(state.lastSync).toLocaleString('de-AT', { dateStyle: 'short', timeStyle: 'short' })}
        </span>
      )}
    </div>
  )
}
