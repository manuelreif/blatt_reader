// Keeps vocabulary, learning state and reading positions in step across devices
// through one backup file in the app's Drive folder: download, merge (newer wins,
// see mergeBackup), upload the merged state.
import { backupJson, mergeBackup, parseBackup, type MergeStats } from '../vocab/export'
import { DriveError, type DriveClient } from './driveApi'

export const SYNC_FILE = 'vokabel-reader-sync.json'

export interface VocabSyncResult {
  fileId: string
  /** null: there was no sync file yet */
  merged: MergeStats | null
}

async function readSyncFile(drive: DriveClient, appFolderId: string, knownId?: string): Promise<{ id: string; text: string } | null> {
  if (knownId) {
    try {
      return { id: knownId, text: await drive.readText(knownId) }
    } catch (e) {
      // deleted in Drive: look it up by name, else start a new one
      if (!(e instanceof DriveError && e.status === 404)) throw e
    }
  }
  const found = await drive.findFile(SYNC_FILE, appFolderId)
  return found ? { id: found.id, text: await drive.readText(found.id) } : null
}

export async function syncVocabulary(drive: DriveClient, appFolderId: string, knownFileId?: string): Promise<VocabSyncResult> {
  const remote = await readSyncFile(drive, appFolderId, knownFileId)
  let merged: MergeStats | null = null
  if (remote) {
    let data
    try {
      data = parseBackup(remote.text)
    } catch {
      throw new DriveError(
        `Die Sync-Datei in Google Drive ist beschädigt. Lösche „${SYNC_FILE}“ im Ordner „Vokabel-Reader“, dann legt der nächste Abgleich sie neu an.`,
      )
    }
    // settings stay per device: they carry no timestamps to decide which one is newer
    merged = await mergeBackup(data, { settings: false })
  }
  const content = new Blob([await backupJson()], { type: 'application/json' })
  const file = remote
    ? await drive.updateContent(remote.id, content)
    : await drive.createFile({ name: SYNC_FILE, parents: [appFolderId], mimeType: 'application/json' }, content)
  return { fileId: file.id, merged }
}
