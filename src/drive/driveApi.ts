// Thin client for the Google Drive REST API v3, called straight from the browser
// (Google allows CORS). `fetchImpl` is injectable for tests, like src/translate/deepl.ts.

const API = 'https://www.googleapis.com/drive/v3'
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3'
export const FOLDER_MIME = 'application/vnd.google-apps.folder'
const FILE_FIELDS = 'id,name,mimeType,size,md5Checksum,appProperties,trashed'
/** what the folder browser shows */
const BROWSE_FIELDS = 'id,name,mimeType,ownedByMe,owners(displayName)'
/** subfolders of the books folder are searched this deep */
const MAX_DEPTH = 5

export interface DriveFile {
  id: string
  name: string
  mimeType: string
  /** bytes; Drive sends int64 values as strings */
  size?: number | string
  md5Checksum?: string
  appProperties?: Record<string, string>
  trashed?: boolean
  ownedByMe?: boolean
  owners?: { displayName?: string }[]
}

/** A shared drive (Google Workspace); its id is also the id of its top folder. */
export interface SharedDrive {
  id: string
  name: string
}

export class DriveError extends Error {
  constructor(
    message: string,
    readonly status = 0,
    /** the token is missing, expired or lacks a permission: the user has to connect again */
    readonly reconnect = false,
  ) {
    super(message)
  }
}

async function errorFor(res: Response): Promise<DriveError> {
  const body = (await res.json().catch(() => null)) as {
    error?: { message?: string; errors?: { reason?: string }[]; details?: { reason?: string }[] }
  } | null
  const reasons = [...(body?.error?.errors ?? []), ...(body?.error?.details ?? [])].map(e => e.reason ?? '')
  const has = (...r: string[]) => reasons.some(x => r.includes(x))
  if (res.status === 401) return new DriveError('Google-Anmeldung abgelaufen – bitte neu verbinden', 401, true)
  if (has('insufficientPermissions', 'ACCESS_TOKEN_SCOPE_INSUFFICIENT'))
    return new DriveError('Google-Drive-Berechtigung fehlt – bitte neu verbinden und beide Häkchen setzen', res.status, true)
  if (has('accessNotConfigured', 'SERVICE_DISABLED'))
    return new DriveError('Die Google Drive API ist im Google-Cloud-Projekt nicht aktiviert (siehe README)', res.status)
  if (res.status === 429 || has('rateLimitExceeded', 'userRateLimitExceeded', 'RATE_LIMIT_EXCEEDED'))
    return new DriveError('Zu viele Anfragen an Google Drive, bitte kurz warten', res.status)
  if (res.status === 404) return new DriveError('In Google Drive nicht gefunden (gelöscht oder kein Zugriff?)', 404)
  if (res.status === 403) return new DriveError('Kein Zugriff auf diese Datei in Google Drive', 403)
  return new DriveError(`Google-Drive-Fehler ${res.status}`, res.status)
}

/** Quotes a value for a Drive search query. */
const quote = (s: string) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`

/** Folder id from a Drive link (drive.google.com/drive/folders/<id>, …/open?id=<id>) or a bare id. */
export function folderIdFromLink(input: string): string | null {
  const s = input.trim()
  const m = s.match(/\/folders\/([\w-]{10,})/) ?? s.match(/[?&]id=([\w-]{10,})/)
  if (m) return m[1]
  return /^[\w-]{10,}$/.test(s) ? s : null
}

export function sizeOf(f: DriveFile): number | undefined {
  const n = Number(f.size)
  return f.size !== undefined && Number.isFinite(n) ? n : undefined
}

export type DriveClient = ReturnType<typeof driveClient>

export function driveClient(token: string, fetchImpl: typeof fetch = fetch) {
  async function call(url: string, init: RequestInit & { headers?: Record<string, string> } = {}): Promise<Response> {
    let res: Response
    try {
      res = await fetchImpl(url, { ...init, headers: { Authorization: `Bearer ${token}`, ...init.headers } })
    } catch {
      throw new DriveError('Google Drive ist nicht erreichbar (offline?)')
    }
    if (!res.ok) throw await errorFor(res)
    return res
  }

  const json = <T>(res: Response) => res.json() as Promise<T>
  const common = 'supportsAllDrives=true'

  /** All results of a search, page by page. */
  async function search(q: string, opts: { fields?: string; orderBy?: string } = {}): Promise<DriveFile[]> {
    const out: DriveFile[] = []
    let pageToken: string | undefined
    do {
      const params = new URLSearchParams({
        q,
        fields: `nextPageToken,files(${opts.fields ?? FILE_FIELDS})`,
        pageSize: '1000',
        supportsAllDrives: 'true',
        includeItemsFromAllDrives: 'true',
      })
      if (opts.orderBy) params.set('orderBy', opts.orderBy)
      if (pageToken) params.set('pageToken', pageToken)
      const data = await json<{ files?: DriveFile[]; nextPageToken?: string }>(await call(`${API}/files?${params}`))
      out.push(...(data.files ?? []))
      pageToken = data.nextPageToken
    } while (pageToken)
    return out
  }

  /** Starts a resumable upload (no 5 MB limit like the simple upload) and sends the content. */
  async function upload(method: 'POST' | 'PATCH', url: string, metadata: object, content: Blob): Promise<DriveFile> {
    const session = await call(url, {
      method,
      headers: { 'content-type': 'application/json; charset=UTF-8' },
      body: JSON.stringify(metadata),
    })
    const location = session.headers.get('location')
    if (!location) throw new DriveError('Upload zu Google Drive fehlgeschlagen (keine Upload-Adresse)')
    // bytes instead of the Blob: a Blob body is invisible to request interception in the E2E tests
    return json<DriveFile>(await call(location, { method: 'PUT', body: await content.arrayBuffer() }))
  }

  return {
    search,

    getFile: async (id: string, fields = FILE_FIELDS): Promise<DriveFile> =>
      json<DriveFile>(await call(`${API}/files/${encodeURIComponent(id)}?fields=${encodeURIComponent(fields)}&${common}`)),

    /**
     * All files below a folder (subfolders included), without the folders themselves.
     * Folders in `skip` are left out with everything below them (books folders of their own).
     */
    async listFolderTree(folderId: string, skip: ReadonlySet<string> = new Set()): Promise<DriveFile[]> {
      const files: DriveFile[] = []
      const seen = new Set([folderId, ...skip])
      const queue = [{ id: folderId, depth: 0 }]
      while (queue.length) {
        const { id, depth } = queue.shift()!
        for (const f of await search(`${quote(id)} in parents and trashed = false`)) {
          if (f.mimeType !== FOLDER_MIME) files.push(f)
          else if (depth < MAX_DEPTH && !seen.has(f.id)) {
            seen.add(f.id)
            queue.push({ id: f.id, depth: depth + 1 })
          }
        }
      }
      return files
    },

    /** Folders the app created and tagged with appProperties (visible only to this app). */
    findTaggedFolders: (key: string, value: string) =>
      search(`mimeType = ${quote(FOLDER_MIME)} and appProperties has { key=${quote(key)} and value=${quote(value)} } and trashed = false`, {
        orderBy: 'createdTime',
      }),

    /** One level of a folder for the folder browser: subfolders first, then files, each by name. */
    listChildren: (folderId: string) =>
      search(`${quote(folderId)} in parents and trashed = false`, { fields: BROWSE_FIELDS, orderBy: 'folder,name' }),

    /** Folders others shared with the user ("Für mich freigegeben"). */
    sharedFolders: () =>
      search(`sharedWithMe = true and mimeType = ${quote(FOLDER_MIME)} and trashed = false`, { fields: BROWSE_FIELDS, orderBy: 'name' }),

    /** Folders whose name contains a word starting with `text` (Drive matches name terms by prefix). */
    searchFolders: (text: string) =>
      search(`mimeType = ${quote(FOLDER_MIME)} and name contains ${quote(text)} and trashed = false`, { fields: BROWSE_FIELDS, orderBy: 'name' }),

    /** Shared drives the user is a member of; usually none outside Google Workspace. */
    async sharedDrives(): Promise<SharedDrive[]> {
      const out: SharedDrive[] = []
      let pageToken: string | undefined
      do {
        const params = new URLSearchParams({ pageSize: '100', fields: 'nextPageToken,drives(id,name)' })
        if (pageToken) params.set('pageToken', pageToken)
        const data = await json<{ drives?: SharedDrive[]; nextPageToken?: string }>(await call(`${API}/drives?${params}`))
        out.push(...(data.drives ?? []))
        pageToken = data.nextPageToken
      } while (pageToken)
      return out
    },

    findFile: async (name: string, parentId: string): Promise<DriveFile | undefined> =>
      (await search(`name = ${quote(name)} and ${quote(parentId)} in parents and trashed = false`, { orderBy: 'createdTime' }))[0],

    createFolder: async (name: string, appProperties: Record<string, string>): Promise<DriveFile> =>
      json<DriveFile>(
        await call(`${API}/files?fields=${encodeURIComponent(FILE_FIELDS)}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json; charset=UTF-8' },
          body: JSON.stringify({ name, mimeType: FOLDER_MIME, appProperties }),
        }),
      ),

    /** Sets app properties; `null` removes one. */
    setAppProperties: async (id: string, appProperties: Record<string, string | null>): Promise<DriveFile> =>
      json<DriveFile>(
        await call(`${API}/files/${encodeURIComponent(id)}?fields=${encodeURIComponent(FILE_FIELDS)}&${common}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json; charset=UTF-8' },
          body: JSON.stringify({ appProperties }),
        }),
      ),

    download: async (id: string): Promise<Blob> => (await call(`${API}/files/${encodeURIComponent(id)}?alt=media&${common}`)).blob(),

    readText: async (id: string): Promise<string> => (await call(`${API}/files/${encodeURIComponent(id)}?alt=media&${common}`)).text(),

    createFile: (metadata: { name: string; parents: string[]; mimeType: string }, content: Blob) =>
      upload('POST', `${UPLOAD}/files?uploadType=resumable&fields=id,name&${common}`, metadata, content),

    updateContent: (id: string, content: Blob) =>
      upload('PATCH', `${UPLOAD}/files/${encodeURIComponent(id)}?uploadType=resumable&fields=id,name&${common}`, {}, content),
  }
}
