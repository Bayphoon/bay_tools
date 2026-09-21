import { access, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BookmarkStore, normalizeBookmarkUrl } from './bookmarkStore.js'
import { ConflictError } from './errors.js'

describe('BookmarkStore', () => {
  let root: string
  let store: BookmarkStore

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'baytools-bookmarks-'))
    store = new BookmarkStore(root)
    await store.init()
  })

  afterEach(async () => { await rm(root, { recursive: true, force: true }) })

  it('creates, favorites, lays out and deletes bookmarks with revision checks', async () => {
    const initial = await store.getLibrary()
    const created = await store.create({ title: '  BayTools 文档  ', url: 'example.com/docs', builtinIcon: 'book', revision: initial.revision })
    expect(created.items[0]).toMatchObject({ title: 'BayTools 文档', url: 'https://example.com/docs', favorite: false, icon: { kind: 'builtin', name: 'book' } })

    const item = created.items[0]!
    const updated = await store.update(item.id, { title: item.title, url: item.url, favorite: true, revision: created.revision })
    expect(updated.items[0]?.favorite).toBe(true)

    const laidOut = await store.updateLayout('large', updated.revision)
    expect(laidOut.layout).toBe('large')
    await expect(store.delete(item.id, updated.revision)).rejects.toBeInstanceOf(ConflictError)
    await expect(store.delete(item.id, laidOut.revision)).resolves.toMatchObject({ items: [] })
  })

  it('stores a local icon and removes it after switching back to a built-in icon', async () => {
    const initial = await store.getLibrary()
    const created = await store.create({ title: '图标测试', url: 'https://example.com', builtinIcon: 'link', revision: initial.revision })
    const item = created.items[0]!
    const bytes = Buffer.from('fake-png-image')
    const uploaded = await store.uploadIcon(item.id, Readable.from(bytes), { mimeType: 'image/png', size: bytes.length, revision: created.revision })
    expect(uploaded.items[0]?.icon).toMatchObject({ kind: 'local', mimeType: 'image/png', size: bytes.length })
    const icon = await store.getIcon(item.id)
    expect(await readFile(icon.path)).toEqual(bytes)

    const switched = await store.update(item.id, { title: item.title, url: item.url, favorite: false, builtinIcon: 'globe', revision: uploaded.revision })
    expect(switched.items[0]?.icon).toEqual({ kind: 'builtin', name: 'globe' })
    await expect(access(icon.path)).rejects.toThrow()
  })

  it('rejects unsafe links and unsupported image formats', async () => {
    expect(() => normalizeBookmarkUrl('javascript:alert(1)')).toThrowError('书签链接只支持 HTTP 或 HTTPS')
    expect(() => normalizeBookmarkUrl('https://user:secret@example.com')).toThrowError('书签链接不能包含账号或密码')

    const initial = await store.getLibrary()
    const created = await store.create({ title: '安全测试', url: 'https://example.com', builtinIcon: 'link', revision: initial.revision })
    await expect(store.uploadIcon(created.items[0]!.id, Readable.from('svg'), { mimeType: 'image/svg+xml', size: 3, revision: created.revision })).rejects.toMatchObject({ code: 'BOOKMARK_ICON_TYPE_UNSUPPORTED' })
  })
})
