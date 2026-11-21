// Google Drive sync: app folder → new books → vocabulary. Runs on app start, when the
// device comes back online, after a quiz round and on demand. Without a valid token a
// background run only flags `needsLogin`; the library then offers a button, because a
// new token needs a tap (see googleAuth.ts).
import { useLiveQuery } from 'dexie-react-hooks'
import { useSyncExternalStore } from 'react'
import { db, type Book } from '../db/schema'
import type { MergeStats } from '../vocab/export'
import { driveClient, DriveError, folderIdFromLink, FOLDER_MIME, type DriveClient, type DriveFile } from './driveApi'
import { driveConfigured, forgetToken, requestToken, revokeToken, storedToken } from './googleAuth'
import { forgetSkippedDriveFiles, syncDriveBooks, type BookSyncProgress, type BookSyncResult } from './syncBooks'
import { syncVocabulary } from './syncVocab'

/** created by the app in "My Drive": holds the sync file and is the default books folder */
export const APP_FOLDER_NAME = 'Vokabel-Reader'
const APP_TAG = { key: 'vokabelReader', value: 'root' }

/** This device's Drive connection: db.settings key `drive`, never part of a backup (LOCAL_SETTING_KEYS). */
export interface DriveState {
  /** connected once on this device: background syncs run and the library shows the sync button */
  connected?: boolean
  appFolderId?: string
  syncFileId?: string
  /** books folder chosen by link (stored in the app folder's appProperties, so every device uses it); unset = app folder */
  booksFolderId?: string
  booksFolderName?: string
  lastSync?: number
  /** e.g. "2 neue Bücher, 5 neue Wörter" */
  lastResult?: string
}

const STATE_KEY = 'drive'

export async function getDriveState(): Promise<DriveState> {
  return ((await db.settings.get(STATE_KEY))?.value as DriveState | undefined) ?? {}
}

async function patchDriveState(patch: Partial<DriveState>) {
  await db.transaction('rw', db.settings, async () => {
    await db.settings.put({ key: STATE_KEY, value: { ...(await getDriveState()), ...patch } })
  })
}

/** undefined while loading */
export const useDriveState = (): DriveState | undefined => useLiveQuery(getDriveState, [])

export interface DriveStatus {
  running: boolean
  phase?: 'login' | 'folder' | 'books' | 'vocab'
  progress?: BookSyncProgress
  error?: string
  /** no valid token: the next sync needs a tap */
  needsLogin: boolean
}

let status: DriveStatus = { running: false, needsLogin: false }
const listeners = new Set<() => void>()

function setStatus(patch: Partial<DriveStatus>) {
  status = { ...status, ...patch }
  for (const l of listeners) l()
}

const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}

export const getDriveStatus = () => status
export const useDriveStatus = () => useSyncExternalStore(subscribe, getDriveStatus)

export interface SyncOptions {
  /** started by a tap: may open the Google login popup */
  interactive?: boolean
  // for tests
  getToken?: (interactive: boolean) => Promise<string | null>
  fetchImpl?: typeof fetch
  importFn?: (file: File) => Promise<Book>
}

export interface DriveSyncResult {
  books: BookSyncResult
  merged: MergeStats | null
}

async function defaultGetToken(interactive: boolean): Promise<string | null> {
  if (!driveConfigured()) return null
  return storedToken() ?? (interactive ? requestToken() : null)
}

/** The app folder: known id, else found by its tag (another device created it), else created now. */
async function ensureAppFolder(drive: DriveClient, knownId?: string): Promise<DriveFile> {
  if (knownId) {
    try {
      const f = await drive.getFile(knownId)
      if (!f.trashed) return f
    } catch (e) {
      if (!(e instanceof DriveError && e.status === 404)) throw e
    }
  }
  const [found] = await drive.findTaggedFolders(APP_TAG.key, APP_TAG.value)
  return found ?? drive.createFolder(APP_FOLDER_NAME, { [APP_TAG.key]: APP_TAG.value })
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

export function summarize(books: BookSyncResult, merged: MergeStats | null): string {
  const parts = [
    books.imported && plural(books.imported, 'neues Buch', 'neue Bücher'),
    merged?.added && plural(merged.added, 'neues Wort', 'neue Wörter'),
    merged?.updated && plural(merged.updated, 'Wort aktualisiert', 'Wörter aktualisiert'),
    merged?.removed && plural(merged.removed, 'Wort gelöscht', 'Wörter gelöscht'),
  ].filter(Boolean)
  return parts.length ? parts.join(', ') : 'alles aktuell'
}

async function run(opts: SyncOptions): Promise<DriveSyncResult | null> {
  if (!opts.getToken && !driveConfigured()) return null
  const getToken = opts.getToken ?? defaultGetToken
  const state = await getDriveState()
  if (!opts.interactive && !state.connected) return null

  let token: string | null
  if (opts.interactive) {
    setStatus({ running: true, phase: 'login', error: undefined, progress: undefined })
    try {
      token = await getToken(true)
    } catch (e) {
      setStatus({ running: false, phase: undefined, error: (e as Error).message })
      return null
    }
  } else token = await getToken(false)
  if (!token) {
    setStatus({ running: false, phase: undefined, needsLogin: true })
    return null
  }

  setStatus({ running: true, phase: 'folder', needsLogin: false, error: undefined, progress: undefined })
  try {
    const drive = driveClient(token, opts.fetchImpl)
    const app = await ensureAppFolder(drive, state.appFolderId)
    const booksFolderId = app.appProperties?.booksFolderId
    let booksFolderName = APP_FOLDER_NAME
    if (booksFolderId) {
      try {
        booksFolderName = (await drive.getFile(booksFolderId, 'id,name')).name
      } catch (e) {
        if (e instanceof DriveError && e.status === 404)
          throw new DriveError('Der Bücherordner ist in Google Drive nicht mehr erreichbar – bitte in den Einstellungen einen anderen wählen', 404)
        throw e
      }
    }
    await patchDriveState({ connected: true, appFolderId: app.id, booksFolderId, booksFolderName })

    setStatus({ phase: 'books' })
    const books = await syncDriveBooks({
      drive,
      folderId: booksFolderId ?? app.id,
      importFn: opts.importFn,
      onProgress: progress => setStatus({ progress }),
    })

    setStatus({ phase: 'vocab', progress: undefined })
    const vocab = await syncVocabulary(drive, app.id, state.syncFileId)
    await patchDriveState({ syncFileId: vocab.fileId, lastSync: Date.now(), lastResult: summarize(books, vocab.merged) })
    setStatus({ running: false, phase: undefined, error: books.lastError })
    return { books, merged: vocab.merged }
  } catch (e) {
    const reconnect = e instanceof DriveError && e.reconnect
    if (reconnect) forgetToken()
    setStatus({ running: false, phase: undefined, progress: undefined, needsLogin: reconnect, error: (e as Error).message })
    return null
  }
}

let running: Promise<DriveSyncResult | null> | null = null

/** One sync at a time; a call during a run shares its result. Never throws: errors end up in the status. */
export function syncDrive(opts: SyncOptions = {}): Promise<DriveSyncResult | null> {
  running ??= run(opts).finally(() => {
    running = null
  })
  return running
}

/** Waits for a running sync, then starts a new one (after a change that the running one would miss). */
const syncAgain = async (opts: SyncOptions) => {
  await running
  return syncDrive(opts)
}

/**
 * Switches the books folder (Drive link or id; null = back to the app folder) and syncs.
 * Must run right after a tap: it may need the login popup.
 */
export async function setBooksFolder(link: string | null, opts: SyncOptions = {}): Promise<void> {
  const token = await (opts.getToken ?? defaultGetToken)(true)
  if (!token) throw new DriveError('Google Drive ist nicht eingerichtet')
  const drive = driveClient(token, opts.fetchImpl)
  const app = await ensureAppFolder(drive, (await getDriveState()).appFolderId)
  if (link === null) {
    await drive.setAppProperties(app.id, { booksFolderId: null })
    await patchDriveState({ appFolderId: app.id, booksFolderId: undefined, booksFolderName: APP_FOLDER_NAME })
  } else {
    const id = folderIdFromLink(link)
    if (!id) throw new DriveError('Das ist kein Link zu einem Google-Drive-Ordner')
    let folder: DriveFile
    try {
      folder = await drive.getFile(id, 'id,name,mimeType')
    } catch (e) {
      if (e instanceof DriveError && e.status === 404)
        throw new DriveError('Ordner nicht gefunden – stimmt der Link, und kannst du den Ordner mit diesem Google-Konto öffnen?', 404)
      throw e
    }
    if (folder.mimeType !== FOLDER_MIME) throw new DriveError('Der Link zeigt auf eine Datei, nicht auf einen Ordner')
    await drive.setAppProperties(app.id, { booksFolderId: folder.id })
    await patchDriveState({ appFolderId: app.id, booksFolderId: folder.id, booksFolderName: folder.name })
  }
  void syncAgain({ ...opts, interactive: true })
}

/** Downloads books removed from the library (or unreadable ones) again. */
export async function reloadSkippedBooks(opts: SyncOptions = {}) {
  await forgetSkippedDriveFiles()
  return syncAgain({ ...opts, interactive: true })
}

/** Forgets the connection on this device. Books and vocabulary stay. */
export async function disconnectDrive() {
  await revokeToken()
  await db.settings.delete(STATE_KEY)
  setStatus({ running: false, phase: undefined, progress: undefined, error: undefined, needsLogin: false })
}
