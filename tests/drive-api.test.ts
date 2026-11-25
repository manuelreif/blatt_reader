import { describe, expect, it } from 'vitest'
import { driveClient, DriveError, folderIdFromLink, FOLDER_MIME } from '../src/drive/driveApi'
import { FakeDrive } from './fake-drive'

const ID = '1AbCdEfGhIjKlMnOpQrStUvWxYz012345'

describe('folderIdFromLink', () => {
  it('reads the id from the usual Drive links and accepts a bare id', () => {
    expect(folderIdFromLink(`https://drive.google.com/drive/folders/${ID}?usp=sharing`)).toBe(ID)
    expect(folderIdFromLink(`https://drive.google.com/drive/u/0/folders/${ID}`)).toBe(ID)
    expect(folderIdFromLink(`https://drive.google.com/open?id=${ID}`)).toBe(ID)
    expect(folderIdFromLink(`  ${ID} `)).toBe(ID)
    expect(folderIdFromLink('https://example.com/folder')).toBeNull()
    expect(folderIdFromLink('')).toBeNull()
  })
})

describe('driveClient', () => {
  it('lists a folder with its subfolders, page by page, without trashed files', async () => {
    const fake = new FakeDrive()
    fake.pageSize = 2
    const books = fake.folder('Bücher')
    const sub = fake.folder('Paper', books.id)
    fake.add({ name: 'a.epub', parents: [books.id], content: 'a' })
    fake.add({ name: 'b.pdf', parents: [books.id], content: 'bb' })
    fake.add({ name: 'c.epub', parents: [books.id], content: 'c' })
    fake.add({ name: 'old.epub', parents: [books.id], trashed: true })
    fake.add({ name: 'd.pdf', parents: [sub.id], content: 'd' })
    fake.add({ name: 'elsewhere.epub' })

    const drive = driveClient(fake.token, fake.fetch)
    const files = await drive.listFolderTree(books.id)
    expect(files.map(f => f.name).sort()).toEqual(['a.epub', 'b.pdf', 'c.epub', 'd.pdf'])
    expect(files.find(f => f.name === 'b.pdf')?.size).toBe('2')
    // root folder: 2 pages; subfolder: 1 page
    expect(fake.log.filter(l => l === 'GET /drive/v3/files')).toHaveLength(3)
  })

  it('leaves out folders to skip, with everything below them', async () => {
    const fake = new FakeDrive()
    const books = fake.folder('Bücher')
    const own = fake.folder('Uni', books.id) // a books folder of its own
    fake.add({ name: 'a.epub', parents: [books.id] })
    fake.add({ name: 'b.epub', parents: [fake.folder('2025', own.id).id] })
    const drive = driveClient(fake.token, fake.fetch)
    expect((await drive.listFolderTree(books.id, new Set([own.id]))).map(f => f.name)).toEqual(['a.epub'])
  })

  it('lists what the folder browser shows: one level, shared folders, a search, shared drives', async () => {
    const fake = new FakeDrive()
    const uni = fake.folder('Uni')
    fake.add({ name: 'z.epub', parents: [uni.id] })
    fake.folder('Paper', uni.id)
    fake.folder('Alt', uni.id)
    fake.add({ name: 'Romane von Anna', mimeType: FOLDER_MIME, parents: ['annas-root'], sharedWithMe: true, owner: 'Anna' })
    fake.drives.push({ id: 'drive0000001', name: 'Team' })
    const drive = driveClient(fake.token, fake.fetch)

    // folders first, then by name
    expect((await drive.listChildren(uni.id)).map(f => f.name)).toEqual(['Alt', 'Paper', 'z.epub'])
    expect(await drive.sharedFolders()).toMatchObject([{ name: 'Romane von Anna', ownedByMe: false, owners: [{ displayName: 'Anna' }] }])
    expect((await drive.searchFolders('roman')).map(f => f.name)).toEqual(['Romane von Anna'])
    expect(await drive.sharedDrives()).toEqual([{ id: 'drive0000001', name: 'Team' }])
  })

  it('uploads in two steps (resumable) and replaces the content later', async () => {
    const fake = new FakeDrive()
    const folder = fake.folder('Vokabel-Reader')
    const drive = driveClient(fake.token, fake.fetch)
    const created = await drive.createFile({ name: 'sync.json', parents: [folder.id], mimeType: 'application/json' }, new Blob(['{"v":1}']))
    expect(fake.text(created.id)).toBe('{"v":1}')
    expect(await drive.findFile('sync.json', folder.id)).toMatchObject({ id: created.id })

    await drive.updateContent(created.id, new Blob(['{"v":2}']))
    expect(await drive.readText(created.id)).toBe('{"v":2}')
    expect(fake.log).toEqual([
      'POST /upload/drive/v3/files',
      'PUT /upload/drive/v3/files',
      'GET /drive/v3/files',
      `PATCH /upload/drive/v3/files/${created.id}`,
      'PUT /upload/drive/v3/files',
      `GET /drive/v3/files/${created.id}`,
    ])
  })

  it('finds folders by app property and sets or removes properties', async () => {
    const fake = new FakeDrive()
    fake.folder('Vokabel-Reader', 'root', { vokabelReader: 'root' })
    fake.folder('Vokabel-Reader') // same name, created by hand: not ours
    const drive = driveClient(fake.token, fake.fetch)
    const [ours, ...rest] = await drive.findTaggedFolders('vokabelReader', 'root')
    expect(rest).toEqual([])
    expect((await drive.setAppProperties(ours.id, { booksFolderId: 'x' })).appProperties).toEqual({ vokabelReader: 'root', booksFolderId: 'x' })
    expect((await drive.setAppProperties(ours.id, { booksFolderId: null })).appProperties).toEqual({ vokabelReader: 'root' })
  })

  it('turns failures into German messages and flags the ones that need a new login', async () => {
    const fake = new FakeDrive()
    const expired = driveClient('old-token', fake.fetch)
    await expect(expired.getFile('x')).rejects.toMatchObject({ status: 401, reconnect: true, message: expect.stringContaining('neu verbinden') })

    const drive = driveClient(fake.token, fake.fetch)
    await expect(drive.getFile('missing')).rejects.toMatchObject({ status: 404, reconnect: false })

    const scope = driveClient('t', async () =>
      Response.json({ error: { code: 403, errors: [{ reason: 'insufficientPermissions' }] } }, { status: 403 }),
    )
    await expect(scope.download('x')).rejects.toMatchObject({ status: 403, reconnect: true })

    const offline = driveClient('t', async () => {
      throw new TypeError('Failed to fetch')
    })
    const e = await offline.download('x').catch(err => err)
    expect(e).toBeInstanceOf(DriveError)
    expect(e).toMatchObject({ status: 0, message: expect.stringContaining('offline') })
  })
})
