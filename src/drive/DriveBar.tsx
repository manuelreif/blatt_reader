import { useEffect } from 'react'
import { syncDrive, useDriveState, useDriveStatus, type DriveStatus } from './driveSync'
import { driveConfigured, preloadGis } from './googleAuth'

export function statusText(s: DriveStatus): string {
  switch (s.phase) {
    case 'login':
      return 'Anmeldung bei Google …'
    case 'folder':
      return 'verbinde …'
    case 'books':
      return s.progress && s.progress.total > s.progress.done
        ? `lade Buch ${s.progress.done + 1} von ${s.progress.total}${s.progress.name ? ` („${s.progress.name}“)` : ''} …`
        : 'prüfe den Bücherordner …'
    case 'vocab':
      return 'gleiche den Lernstand ab …'
    default:
      return ''
  }
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
  return null
}
