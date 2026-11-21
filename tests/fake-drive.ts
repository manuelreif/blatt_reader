// In-memory stand-in for the parts of the Google Drive REST API v3 that src/drive/
// uses. Shared by the unit tests (as fetchImpl) and the E2E tests (via page.route).

export interface FakeFile {
  id: string
  name: string
  mimeType: string
  parents: string[]
  content?: Uint8Array
  appProperties?: Record<string, string>
  trashed?: boolean
}

export interface FakeRequest {
  method: string
  url: string
  body?: Uint8Array | null
  authorization?: string | null
}

export interface FakeResponse {
  status: number
  headers: Record<string, string>
  body: Uint8Array | string
}

const FOLDER = 'application/vnd.google-apps.folder'
const enc = new TextEncoder()
const dec = new TextDecoder()
const unquote = (s: string) => s.replace(/\\(.)/g, '$1')

export class FakeDrive {
  files = new Map<string, FakeFile>()
  token = 'test-token'
  /** results per page of a search */
  pageSize = 1000
  /** "METHOD /path" of every request */
  log: string[] = []
  private sessions = new Map<string, { fileId?: string; metadata: Partial<FakeFile> }>()
  private seq = 0

  add(f: Partial<Omit<FakeFile, 'content'>> & { name: string; content?: string | Uint8Array }): FakeFile {
    const file: FakeFile = {
      // as long as real ids, so folderIdFromLink accepts them
      id: f.id ?? `fake${String(++this.seq).padStart(8, '0')}`,
      name: f.name,
      mimeType: f.mimeType ?? 'application/octet-stream',
      parents: f.parents ?? ['root'],
      content: typeof f.content === 'string' ? enc.encode(f.content) : f.content,
      appProperties: f.appProperties,
      trashed: f.trashed,
    }
    this.files.set(file.id, file)
    return file
  }

  folder(name: string, parent = 'root', appProperties?: Record<string, string>): FakeFile {
    return this.add({ name, mimeType: FOLDER, parents: [parent], appProperties })
  }

  text(id: string): string {
    return dec.decode(this.files.get(id)?.content ?? new Uint8Array())
  }

  find(name: string): FakeFile | undefined {
    return [...this.files.values()].find(f => f.name === name && !f.trashed)
  }

  /** what the API returns for a file */
  private meta(f: FakeFile) {
    return {
      id: f.id,
      name: f.name,
      mimeType: f.mimeType,
      parents: f.parents,
      trashed: !!f.trashed,
      ...(f.mimeType === FOLDER ? {} : { size: String(f.content?.length ?? 0) }),
      ...(f.appProperties ? { appProperties: f.appProperties } : {}),
    }
  }

  handle(req: FakeRequest): FakeResponse {
    const url = new URL(req.url)
    const path = url.pathname
    const p = url.searchParams
    this.log.push(`${req.method} ${path}`)
    const json = (body: unknown, status = 200, headers: Record<string, string> = {}): FakeResponse => ({
      status,
      headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
      body: JSON.stringify(body),
    })
    const error = (status: number, reason: string) => json({ error: { code: status, message: reason, errors: [{ reason }] } }, status)
    const bodyJson = () => (req.body?.length ? JSON.parse(dec.decode(req.body)) : {}) as Record<string, unknown>

    if (req.authorization !== `Bearer ${this.token}`) return error(401, 'authError')

    if (req.method === 'GET' && path === '/drive/v3/files') {
      const q = p.get('q') ?? ''
      const parent = q.match(/'((?:[^'\\]|\\.)*)' in parents/)?.[1]
      const name = q.match(/name = '((?:[^'\\]|\\.)*)'/)?.[1]
      const mime = q.match(/mimeType = '([^']+)'/)?.[1]
      const prop = q.match(/appProperties has \{ key='([^']+)' and value='([^']+)' \}/)
      const all = [...this.files.values()].filter(
        f =>
          !f.trashed &&
          (!parent || f.parents.includes(unquote(parent))) &&
          (!name || f.name === unquote(name)) &&
          (!mime || f.mimeType === mime) &&
          (!prop || f.appProperties?.[prop[1]] === prop[2]),
      )
      const start = Number(p.get('pageToken') ?? 0)
      const size = Math.min(Number(p.get('pageSize') ?? 100), this.pageSize)
      const page = all.slice(start, start + size)
      return json({ files: page.map(f => this.meta(f)), ...(start + size < all.length ? { nextPageToken: String(start + size) } : {}) })
    }

    if (req.method === 'POST' && path === '/drive/v3/files') {
      const m = bodyJson() as Partial<FakeFile>
      return json(this.meta(this.add({ name: m.name ?? 'Unbenannt', mimeType: m.mimeType, parents: m.parents, appProperties: m.appProperties })))
    }

    const one = path.match(/^\/drive\/v3\/files\/([^/]+)$/)
    if (one) {
      const f = this.files.get(decodeURIComponent(one[1]))
      if (!f) return error(404, 'notFound')
      if (req.method === 'GET')
        return p.get('alt') === 'media'
          ? { status: 200, headers: { 'content-type': f.mimeType }, body: f.content ?? new Uint8Array() }
          : json(this.meta(f))
      if (req.method === 'PATCH') {
        const props = (bodyJson().appProperties ?? {}) as Record<string, string | null>
        const next = { ...f.appProperties }
        for (const [k, v] of Object.entries(props)) {
          if (v === null) delete next[k]
          else next[k] = v
        }
        f.appProperties = next
        return json(this.meta(f))
      }
    }

    const uploadOne = path.match(/^\/upload\/drive\/v3\/files(?:\/([^/]+))?$/)
    if (uploadOne && p.get('uploadType') === 'resumable') {
      const sessionUrl = (sid: string) => `https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=${sid}`
      if (req.method === 'PUT') {
        const session = this.sessions.get(p.get('upload_id') ?? '')
        if (!session) return error(404, 'notFound')
        const file = session.fileId
          ? this.files.get(session.fileId)!
          : this.add({ name: session.metadata.name ?? 'Unbenannt', mimeType: session.metadata.mimeType, parents: session.metadata.parents })
        file.content = req.body ?? new Uint8Array()
        return json({ id: file.id, name: file.name })
      }
      const fileId = uploadOne[1] ? decodeURIComponent(uploadOne[1]) : undefined
      if (fileId && !this.files.has(fileId)) return error(404, 'notFound')
      const sid = `s${++this.seq}`
      this.sessions.set(sid, { fileId, metadata: bodyJson() as Partial<FakeFile> })
      return { status: 200, headers: { location: sessionUrl(sid) }, body: '' }
    }

    return error(400, 'badRequest')
  }

  /** Drive as a fetch function (unit tests). */
  fetch: typeof fetch = async (input, init) => {
    const body = init?.body
    const bytes =
      body === undefined || body === null
        ? null
        : typeof body === 'string'
          ? enc.encode(body)
          : body instanceof Blob
            ? new Uint8Array(await body.arrayBuffer())
            : new Uint8Array(body as ArrayBuffer)
    const headers = new Headers(init?.headers)
    const res = this.handle({ method: init?.method ?? 'GET', url: String(input), body: bytes, authorization: headers.get('authorization') })
    return new Response(res.status === 204 ? null : (res.body as BodyInit), { status: res.status, headers: res.headers })
  }
}
