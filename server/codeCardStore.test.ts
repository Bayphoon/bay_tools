import { access, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ConflictError } from './errors.js'
import { CodeCardStore } from './codeCardStore.js'
import { BayToolsStore } from './store.js'

describe('CodeCardStore', () => {
  let root: string
  let store: CodeCardStore

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'baytools-code-cards-'))
    store = new CodeCardStore(root)
    await store.init()
  })

  afterEach(async () => { await rm(root, { recursive: true, force: true }) })

  it('creates groups and moves renamed workspaces', async () => {
    const folder = await store.createFolder('战斗片段')
    const workspace = await store.createWorkspace('Lua 代码段', folder.id)
    expect(workspace.cards).toHaveLength(1)
    expect(workspace.cards[0]?.height).toBe(240)
    expect((await store.getLibrary()).workspaces[0]).toMatchObject({ title: 'Lua 代码段', folderId: folder.id })

    await store.renameWorkspace(workspace.id, '界面片段')
    await store.moveWorkspace(workspace.id, undefined)
    expect((await store.getLibrary()).workspaces[0]).toMatchObject({ title: '界面片段' })
    expect((await store.getLibrary()).workspaces[0]).not.toHaveProperty('folderId')
    await store.deleteFolder(folder.id)
    expect((await store.getLibrary()).folders).toEqual([])
  })

  it('persists card layout and rejects stale revisions', async () => {
    const workspace = await store.createWorkspace()
    const card = workspace.cards[0]!
    const saved = await store.updateWorkspace({ ...workspace, title: '常用 Lua', cards: [{ ...card, code: 'return true', height: 520, splitRatio: 63 }] })
    expect(saved).toMatchObject({ title: '常用 Lua', revision: 2 })
    expect(saved.cards[0]).toMatchObject({ code: 'return true', height: 520, splitRatio: 63 })
    await expect(store.updateWorkspace(workspace)).rejects.toBeInstanceOf(ConflictError)
  })

  it('searches card titles and code using Project-style terms and phrase matching', async () => {
    const first = await store.createWorkspace('配置工具')
    const second = await store.createWorkspace('玩家工具')
    await store.updateWorkspace({
      ...first,
      cards: [{ ...first.cards[0]!, title: '读取配置', code: '-- 配置状态\nlocal function GetConfigState()\n  return true\nend' }],
    })
    await store.updateWorkspace({
      ...second,
      cards: [{ ...second.cards[0]!, title: '查找玩家', code: 'local player = FindPlayerById(playerId)' }],
    })

    const projectTerms = await store.searchWorkspaces('state get', 1, 'fuzzy')
    expect(projectTerms.items).toHaveLength(1)
    expect(projectTerms.items[0]).toMatchObject({ workspaceId: first.id, cardTitle: '读取配置', matchField: 'code', line: 2 })

    const acrossTitleAndCode = await store.searchWorkspaces('读取 "GetConfigState"', 1, 'fuzzy')
    expect(acrossTitleAndCode.items).toHaveLength(1)
    expect(acrossTitleAndCode.items[0]).toMatchObject({ workspaceId: first.id, matchField: 'code', line: 2 })

    const quotedPhrase = await store.searchWorkspaces('配置 "local function"', 1, 'fuzzy')
    expect(quotedPhrase.items).toHaveLength(1)
    expect(quotedPhrase.items[0]).toMatchObject({ workspaceId: first.id, matchField: 'code', line: 2 })

    const phrase = await store.searchWorkspaces('LOCAL PLAYER', 1, 'exact')
    expect(phrase.items).toHaveLength(1)
    expect(phrase.items[0]).toMatchObject({ workspaceId: second.id, cardTitle: '查找玩家', excerpt: 'local player = FindPlayerById(playerId)' })

    expect((await store.searchWorkspaces('gcs', 1, 'fuzzy')).total).toBe(0)
    expect((await store.searchWorkspaces('gcs', 1, 'exact')).total).toBe(0)
    expect((await store.searchWorkspaces('读取配', 1, 'exact')).items[0]).toMatchObject({ matchField: 'title' })
    expect((await store.searchWorkspaces('player config', 1, 'fuzzy')).total).toBe(0)
  })

  it('stores a card thumbnail and removes it with the card', async () => {
    const workspace = await store.createWorkspace()
    const card = workspace.cards[0]!
    const bytes = Buffer.from('fake-webp-thumbnail')
    const withImage = await store.uploadImage(workspace.id, card.id, Readable.from(bytes), {
      mimeType: 'image/webp', size: bytes.length, width: 640, height: 360, revision: workspace.revision,
    })
    const result = await store.getImage(workspace.id, card.id)
    expect(result.image).toMatchObject({ mimeType: 'image/webp', size: bytes.length, width: 640, height: 360 })
    await access(result.path)

    await store.updateWorkspace({ ...withImage, cards: [] })
    await expect(access(result.path)).rejects.toBeDefined()
  })

  it('moves a code workspace with its images to trash and restores it', async () => {
    const workspace = await store.createWorkspace('可恢复代码段')
    const card = workspace.cards[0]!
    const bytes = Buffer.from('restorable-webp-thumbnail')
    await store.uploadImage(workspace.id, card.id, Readable.from(bytes), {
      mimeType: 'image/webp', size: bytes.length, width: 800, height: 450, revision: workspace.revision,
    })

    await store.trashWorkspace(workspace.id)
    expect((await store.getLibrary()).workspaces).toEqual([])
    await expect(store.getWorkspace(workspace.id)).rejects.toMatchObject({ code: 'NOT_FOUND' })

    const mainStore = new BayToolsStore(root)
    await mainStore.init()
    const trash = await mainStore.listTrash()
    expect(trash[0]).toMatchObject({ kind: 'code-card', displayName: '可恢复代码段' })
    await mainStore.restoreTrash(trash[0]!.id)
    expect(await store.getWorkspace(workspace.id)).toMatchObject({ id: workspace.id, title: '可恢复代码段' })
    expect((await store.getImage(workspace.id, card.id)).image.size).toBe(bytes.length)
    expect(await mainStore.listTrash()).toEqual([])
  })
})
