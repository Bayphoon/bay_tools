import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { BayToolsStore } from './store.js'
import { ConflictError } from './errors.js'

describe('BayToolsStore', () => {
  let root: string
  let store: BayToolsStore

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'baytools-test-'))
    store = new BayToolsStore(root)
    await store.init()
  })

  afterEach(async () => { await rm(root, { recursive: true, force: true }) })

  it('initializes durable files and detects revision conflicts', async () => {
    const settings = await store.getSettings()
    await store.updateSettings(settings)
    await expect(store.updateSettings(settings)).rejects.toBeInstanceOf(ConflictError)
    expect(JSON.parse(await readFile(join(root, 'Doc', 'settings.json'), 'utf8')).schemaVersion).toBe(1)
  })

  it('persists the home JSON scratchpad including incomplete JSON text', async () => {
    const scratchpad = await store.getJsonScratchpad()
    expect(scratchpad.mode).toBe('text')
    const saved = await store.updateJsonScratchpad({ ...scratchpad, text: '{', mode: 'tree', autoFormat: true })
    expect(saved.revision).toBe(scratchpad.revision + 1)
    expect(await store.getJsonScratchpad()).toMatchObject({ text: '{', mode: 'tree', autoFormat: true })
    expect(JSON.parse(await readFile(join(root, 'Doc', 'json', 'home-scratchpad.json'), 'utf8'))).toMatchObject({ schemaVersion: 1, text: '{' })
    await expect(store.updateJsonScratchpad(scratchpad)).rejects.toBeInstanceOf(ConflictError)
  })

  it('creates, trashes, and restores JSON workspaces', async () => {
    const workspace = await store.createJsonWorkspace('Compare')
    await store.trashJsonWorkspace(workspace.id)
    expect(await store.listJsonWorkspaces()).toEqual([])
    const item = (await store.listTrash())[0]!
    const restored = await store.restoreTrash(item.id)
    expect(restored.workspaceId).toBe(workspace.id)
    expect((await store.listJsonWorkspaces())[0]?.title).toBe('Compare')
  })

  it('migrates legacy two-column JSON workspaces without losing content', async () => {
    const workspace = await store.createJsonWorkspace('Legacy')
    const path = join(root, 'Doc', 'json', 'workspaces', `${workspace.id}.json`)
    await writeFile(path, JSON.stringify({
      schemaVersion: 1,
      id: workspace.id,
      title: workspace.title,
      createdAt: workspace.createdAt,
      updatedAt: workspace.updatedAt,
      revision: workspace.revision,
      leftText: '{"side":"left"}',
      rightText: '{"side":"right"}',
      leftView: 'text',
      rightView: 'tree',
    }), 'utf8')

    const migrated = await store.getJsonWorkspace(workspace.id)
    expect(migrated.schemaVersion).toBe(2)
    expect(migrated.panes.map((pane) => pane.text)).toEqual(['{"side":"left"}', '{"side":"right"}'])
    expect(migrated.panes.map((pane) => pane.view)).toEqual(['text', 'tree'])
    expect(JSON.parse(await readFile(path, 'utf8')).schemaVersion).toBe(2)
  })

  it('persists and duplicates multi-pane JSON workspaces', async () => {
    const workspace = await store.createJsonWorkspace('Multi')
    const third = { id: randomUUID(), title: '接口响应', text: '{"ok":true}', view: 'text' as const }
    const updated = await store.updateJsonWorkspace({
      ...workspace,
      panes: [...workspace.panes, third],
      diffSelection: { basePaneId: workspace.panes[0]!.id, targetPaneId: third.id },
    })
    expect((await store.getJsonWorkspace(workspace.id)).panes).toHaveLength(3)

    const duplicate = await store.duplicateJsonWorkspace(updated.id)
    expect(duplicate.panes.map((pane) => pane.title)).toEqual(updated.panes.map((pane) => pane.title))
    expect(duplicate.panes.map((pane) => pane.text)).toEqual(updated.panes.map((pane) => pane.text))
    expect(duplicate.panes.map((pane) => pane.id)).not.toEqual(updated.panes.map((pane) => pane.id))
  })

  it('scans, saves, trashes, and restores markdown safely', async () => {
    const docs = join(root, 'external-docs')
    await mkdir(join(docs, 'guide'), { recursive: true })
    await mkdir(join(docs, '.git'), { recursive: true })
    await writeFile(join(docs, 'guide', 'readme.md'), '# Hello', 'utf8')
    await writeFile(join(docs, '.git', 'ignored.md'), 'ignored', 'utf8')
    const source = await store.addMarkdownSource(docs)
    const noted = await store.updateMarkdownSourceNote(source.id, '项目文档')
    expect(noted.note).toBe('项目文档')
    const tree = await store.scanMarkdownSources()
    expect(tree[0]?.children[0]?.name).toBe('guide')
    const document = await store.getMarkdownDocument(source.id, 'guide/readme.md')
    const saved = await store.saveMarkdownDocument({ ...document, content: '# Updated' })
    await store.trashMarkdownDocument(source.id, saved.relativePath, saved.hash)
    expect(await readFile(join(docs, 'guide', 'readme.md'), 'utf8').catch(() => null)).toBeNull()
    await store.restoreTrash((await store.listTrash())[0]!.id)
    expect(await readFile(join(docs, 'guide', 'readme.md'), 'utf8')).toBe('# Updated')
  })

  it('creates folders and auto-save ready managed Markdown documents', async () => {
    const folder = await store.createManagedMarkdownFolder('接口记录')
    const document = await store.createManagedMarkdownDocument('登录接口', folder.id)
    const saved = await store.updateManagedMarkdownDocument({ ...document, content: '# 登录\n\n成功。' })
    expect((await store.getManagedMarkdownDocument(saved.id)).content).toContain('成功')
    await expect(store.deleteManagedMarkdownFolder(folder.id)).rejects.toMatchObject({ code: 'FOLDER_NOT_EMPTY' })

    const duplicate = await store.duplicateManagedMarkdownDocument(saved.id)
    expect(duplicate.title).toBe('登录接口 副本')
    expect(duplicate.content).toBe(saved.content)

    await store.trashManagedMarkdownDocument(saved.id)
    expect((await store.getManagedMarkdownLibrary()).documents.some((item) => item.id === saved.id)).toBe(false)
    const trash = (await store.listTrash()).find((item) => item.kind === 'managed-markdown')!
    await store.restoreTrash(trash.id)
    expect((await store.getManagedMarkdownDocument(saved.id)).content).toBe(saved.content)
  })

  it('rejects traversal and markdown write conflicts', async () => {
    const docs = join(root, 'docs')
    await mkdir(docs)
    await writeFile(join(docs, 'a.md'), 'one')
    const source = await store.addMarkdownSource(docs)
    const document = await store.getMarkdownDocument(source.id, 'a.md')
    await writeFile(join(docs, 'a.md'), 'two')
    await expect(store.saveMarkdownDocument({ ...document, content: 'three' })).rejects.toBeInstanceOf(ConflictError)
    await expect(store.getMarkdownDocument(source.id, '../outside.md')).rejects.toMatchObject({ code: 'INVALID_PATH' })
  })
})
