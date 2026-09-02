import { access, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LanguageStore, paginateLanguageEntries, parseLanguageText } from './languageStore.js'

const tempRoots: string[] = []

afterEach(async () => {
  vi.unstubAllGlobals()
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('language text', () => {
  it('parses the first equals sign and ignores invalid lines', () => {
    expect(parseLanguageText('\uFEFF458015=确认时间\ninvalid\n458016=a=b\n# comment')).toEqual([
      { key: '458015', content: '确认时间' },
      { key: '458016', content: 'a=b' },
    ])
  })

  it('searches key or content and paginates by ten', () => {
    const entries = Array.from({ length: 24 }, (_, index) => ({ key: `key_${index}`, content: index === 15 ? '确认时间' : `内容 ${index}` }))
    expect(paginateLanguageEntries(entries, '', 2)).toMatchObject({ page: 2, pageSize: 10, total: 24, totalPages: 3 })
    expect(paginateLanguageEntries(entries, '确认', 1).items).toEqual([{ key: 'key_15', content: '确认时间' }])
    expect(paginateLanguageEntries(entries, 'KEY_2', 1).total).toBe(5)
    expect(paginateLanguageEntries(entries, 'KEY_2', 1, 'exact').items).toEqual([{ key: 'key_2', content: '内容 2' }])
    expect(paginateLanguageEntries(entries, '内容', 1, 'exact').total).toBe(0)
  })

  it('syncs a txt cache and persists favorites', async () => {
    const root = await mkdtemp(join(tmpdir(), 'baytools-language-'))
    tempRoots.push(root)
    const store = new LanguageStore(root)
    await store.init()
    const source = await store.createSource()
    vi.stubGlobal('fetch', vi.fn(async () => new Response('458015=确认时间\n458016=取消', { status: 200 })))

    const synced = await store.syncSource(source.id, 'example.test/language/zh_CN.txt')
    expect(synced).toMatchObject({ title: 'zh_CN.txt', entryCount: 2 })
    expect((await store.searchEntries(source.id, '确认', 1, 'fuzzy')).items).toEqual([{ key: '458015', content: '确认时间' }])

    const favorited = await store.setFavorite(source.id, '458015', true, synced.revision)
    expect(favorited.favorites).toHaveLength(1)
    expect((await store.searchFavorites(source.id, '458015', 1, 'exact')).items[0]).toMatchObject({ key: '458015', content: '确认时间' })
    await expect(store.syncSource(source.id, 'example.test/language/zh_CN.txt')).rejects.toMatchObject({ statusCode: 429, code: 'LANGUAGE_SYNC_COOLDOWN' })

    await store.deleteSource(source.id)
    expect(await store.listSources()).toEqual([])
    await expect(access(join(root, 'Doc', 'language', 'cache', `${source.id}.txt`))).rejects.toThrow()
  })
})
