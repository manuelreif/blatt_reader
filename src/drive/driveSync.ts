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

/** created by the app in "My Drive": holds the sync file and is always one of the books folders */
export const APP_FOLDER_NAME = 'Blatt-Reader'
const APP_TAG = { key: 'vokabelReader', value: 'root' }

/** A books folder the user added (the app folder is always one, too). */
export interface BookSource {
  id: string
  name: string
  /** could not be searched at the last sync, e.g. deleted or no longer shared */
  error?: string
}

/** This device's Drive connection: db.settings key `drive`, never part of a backup (LOCAL_SETTING_KEYS). */
export interface DriveState {
  /** connected once on this device: background syncs run and the library shows the sync button */
  connected?: boolean
  appFolderId?: string
  /** the app folder's name in Drive (folders created before the rename are called "Vokabel-Reader") */
  appFolderName?: string
  syncFileId?: string
  /** books folders besides the app folder, by name; the list itself lives in the app folder's appProperties */
  sources?: BookSource[]
  lastSync?: number
  /** e.g. "2 neue Bücher, 5 neue Wörter" */
  lastResult?: string
}

/** before several books folders: one chosen folder instead of the app folder */
interface LegacyDriveState extends DriveState {
  booksFolderId?: string
  booksFolderName?: string
}

const STATE_KEY = 'drive'

export async function getDriveState(): Promise<DriveState> {
  const state = ((await db.settings.get(STATE_KEY))?.value as LegacyDriveState | undefined) ?? {}
  const { booksFolderId, booksFolderName, ...rest } = state
  // stored by an older version; the next sync writes `sources`
  if (!rest.sources && booksFolderId) return { ...rest, sources: [{ id: booksFolderId, name: booksFolderName ?? 'Bücherordner' }] }
  return rest
}

async function patchDriveState(patch: Partial<DriveState> | ((state: DriveState) => Partial<DriveState>)) {
  await db.transaction('rw', db.settings, async () => {
    const state = await getDriveState()
    await db.settings.put({ key: STATE_KEY, value: { ...state, ...(typeof patch === 'function' ? patch(state) : patch) } })
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

/**
 * Books folders are stored in the app folder's appProperties, one key per folder: a list in one
 * value would not fit (Drive allows 124 bytes for key and value together). `booksFolderId` is
 * the single folder of older versions and still counts.
 */
const SOURCE_PREFIX = 'bookSource_'
const LEGACY_SOURCE = 'booksFolderId'

function sourceIdsOf(app: DriveFile): string[] {
  const props = app.appProperties ?? {}
  const ids = Object.keys(props)
    .filter(k => k.startsWith(SOURCE_PREFIX) && props[k])
    .map(k => k.slice(SOURCE_PREFIX.length))
  if (props[LEGACY_SOURCE]) ids.unshift(props[LEGACY_SOURCE])
  return [...new Set(ids)].filter(id => id !== app.id)
}

const byName = (a: BookSource, b: BookSource) => a.name.localeCompare(b.name, 'de')

/** Names of the books folders; one that is gone or no longer shared gets an error, the others go on. */
async function loadSources(drive: DriveClient, app: DriveFile, known: BookSource[] = []): Promise<BookSource[]> {
  const sources: BookSource[] = []
  for (const id of sourceIdsOf(app)) {
    const name = known.find(s => s.id === id)?.name ?? 'Unbekannter Ordner'
    try {
      const f = await drive.getFile(id, 'id,name,trashed')
      sources.push(f.trashed ? { id, name: f.name, error: 'liegt im Papierkorb' } : { id, name: f.name })
    } catch (e) {
      if (!(e instanceof DriveError) || (e.status !== 404 && e.status !== 403)) throw e
      sources.push({ id, name, error: 'nicht mehr erreichbar (gelöscht oder nicht mehr freigegeben?)' })
    }
  }
  return sources.sort(byName)
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

export function summarize(books: BookSyncResult, merged: MergeStats | null): string {
  const parts = [
    books.imported && plural(books.imported, 'neues Buch', 'neue Bücher'),
    merged?.added && plural(merged.added, 'neues Wort', 'neue Wörter'),
    merged?.updated && plural(merged.updated, 'Wort aktualisiert', 'Wörter aktualisiert'),
    merged?.removed && plural(merged.removed, 'Wort gelöscht', 'Wörter gelöscht'),
    merged?.highlights && plural(merged.highlights, 'Markierung abgeglichen', 'Markierungen abgeglichen'),
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
    const sources = await loadSources(drive, app, state.sources)
    await patchDriveState({ connected: true, appFolderId: app.id, appFolderName: app.name, sources })

    setStatus({ phase: 'books' })
    const books = await syncDriveBooks({
      drive,
      folders: [{ id: app.id, name: app.name }, ...sources.filter(s => !s.error)],
      importFn: opts.importFn,
      onProgress: progress => setStatus({ progress }),
    })
    const folderErrors = books.folderErrors ?? {}
    if (Object.keys(folderErrors).length)
      // against the current list: a folder may have been added or removed meanwhile
      await patchDriveState(s => ({ sources: s.sources?.map(src => (folderErrors[src.id] ? { ...src, error: folderErrors[src.id] } : src)) }))

    setStatus({ phase: 'vocab', progress: undefined })
    const vocab = await syncVocabulary(drive, app.id, state.syncFileId)
    await patchDriveState({ syncFileId: vocab.fileId, lastSync: Date.now(), lastResult: summarize(books, vocab.merged) })
    setStatus({ running: false, phase: undefined, error: books.lastError ?? folderErrors[app.id] })
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

/** Resolves once no sync runs any more, including one started meanwhile (tests, after adding a folder). */
export async function driveIdle() {
  while (running) await running
}

/** Waits for a running sync, then starts a new one (after a change that the running one would miss). */
const syncAgain = async (opts: SyncOptions) => {
  await running
  return syncDrive(opts)
}

/**
 * Folders for what the user typed into the folder browser: the folder behind a Drive link or
 * bare id, or the folders whose name matches (exact matches first).
 */
export async function findFolders(drive: DriveClient, input: string): Promise<DriveFile[]> {
  const s = input.trim()
  const isLink = /^https?:\/\//i.test(s) || /drive\.google\./i.test(s)
  const notFound = isLink
    ? 'Ordner nicht gefunden – stimmt der Link, und kannst du den Ordner mit diesem Google-Konto öffnen?'
    : `Kein Ordner namens „${s}“ gefunden`
  if (!isLink) {
    const lower = s.toLocaleLowerCase('de')
    const found = await drive.searchFolders(s)
    if (found.length) return found.sort((a, b) => Number(b.name.toLocaleLowerCase('de') === lower) - Number(a.name.toLocaleLowerCase('de') === lower))
  }
  const id = folderIdFromLink(s)
  if (!id) throw new DriveError(isLink ? 'Das ist kein Link zu einem Google-Drive-Ordner' : notFound)
  let folder: DriveFile
  try {
    folder = await drive.getFile(id, 'id,name,mimeType,ownedByMe,owners(displayName)')
  } catch (e) {
    if (e instanceof DriveError && e.status === 404) throw new DriveError(notFound, 404)
    throw e
  }
  if (folder.mimeType !== FOLDER_MIME) throw new DriveError('Der Link zeigt auf eine Datei, nicht auf einen Ordner')
  return [folder]
}

/** A Drive client, e.g. for the folder browser; must run right after a tap (may need the login popup). */
export async function browseClient(opts: SyncOptions = {}): Promise<DriveClient> {
  const token = await (opts.getToken ?? defaultGetToken)(true)
  if (!token) throw new DriveError('Google Drive ist nicht eingerichtet')
  return driveClient(token, opts.fetchImpl)
}

/** A Drive client and the app folder, after a tap. */
async function connectForChange(opts: SyncOptions) {
  const drive = await browseClient(opts)
  const app = await ensureAppFolder(drive, (await getDriveState()).appFolderId)
  return { drive, app }
}

/** Adds a books folder (for every device) and syncs. Must run right after a tap. */
export async function addBookSource(folder: { id: string; name: string }, opts: SyncOptions = {}): Promise<void> {
  const { drive, app } = await connectForChange(opts)
  if (folder.id !== app.id) {
    await drive.setAppProperties(app.id, { [SOURCE_PREFIX + folder.id]: '1' })
    await patchDriveState(s => ({
      appFolderId: app.id,
      appFolderName: app.name,
      sources: [...(s.sources ?? []).filter(x => x.id !== folder.id), { id: folder.id, name: folder.name }].sort(byName),
    }))
  }
  void syncAgain({ ...opts, interactive: true })
}

/** Stops syncing a books folder (on every device); its books stay in the library. Must run right after a tap. */
export async function removeBookSource(id: string, opts: SyncOptions = {}): Promise<void> {
  const { drive, app } = await connectForChange(opts)
  const props: Record<string, null> = { [SOURCE_PREFIX + id]: null }
  if (app.appProperties?.[LEGACY_SOURCE] === id) props[LEGACY_SOURCE] = null
  await drive.setAppProperties(app.id, props)
  await patchDriveState(s => ({ appFolderId: app.id, appFolderName: app.name, sources: s.sources?.filter(x => x.id !== id) }))
  // a sync that read the old list meanwhile must not have the last word
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
