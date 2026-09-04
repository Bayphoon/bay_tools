import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Readable } from 'node:stream'
import { BayToolsStore, getFileWorkbenchPreviewKind, validateFileWorkbenchName } from './store.js'
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
    expect(await store.getJsonWorkspaceLocation(workspace.id)).toBe(join(root, 'Doc', 'json', 'workspaces', `${workspace.id}.json`))
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
    expect(await store.getMarkdownDocumentLocation(source.id, document.relativePath)).toBe(join(source.path, 'guide', 'readme.md'))
    const saved = await store.saveMarkdownDocument({ ...document, content: '# Updated' })
    await store.trashMarkdownDocument(source.id, saved.relativePath, saved.hash)
    expect(await readFile(join(docs, 'guide', 'readme.md'), 'utf8').catch(() => null)).toBeNull()
    await store.restoreTrash((await store.listTrash())[0]!.id)
    expect(await readFile(join(docs, 'guide', 'readme.md'), 'utf8')).toBe('# Updated')
  })

  it('creates folders and auto-save ready managed Markdown documents', async () => {
    const folder = await store.createManagedMarkdownFolder('接口记录')
    const document = await store.createManagedMarkdownDocument('登录接口', folder.id)
    expect(await store.getManagedMarkdownDocumentLocation(document.id)).toBe(join(root, 'Doc', 'markdown', 'documents', 'files', `${document.id}.md`))
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

  it('imports file workbench bytes unchanged and updates metadata independently', async () => {
    const bytes = Buffer.from([0, 1, 2, 250, 255, 10])
    const item = await store.importFileWorkbenchFile(Readable.from(bytes), {
      name: '原始图片.png',
      mimeType: 'image/png',
      size: bytes.byteLength,
      sourceLastModified: '2026-09-04T02:00:00.000Z',
    })
    expect(item.importedName).toBe('原始图片.png')
    expect(item.previewKind).toBe('image')
    expect(await readFile(await store.getFileWorkbenchItemLocation(item.id))).toEqual(bytes)

    const described = await store.updateFileWorkbenchMetadata(item.id, { description: '界面参考图', favorite: true, metadataRevision: item.metadataRevision })
    expect(described.description).toBe('界面参考图')
    expect(described.favorite).toBe(true)
    expect(described.metadataRevision).toBe(2)
    expect(described.contentRevision).toBe(1)
    expect(described.sha256).toBe(item.sha256)
    await expect(store.updateFileWorkbenchMetadata(item.id, { description: '过期描述', metadataRevision: item.metadataRevision })).rejects.toBeInstanceOf(ConflictError)
    await expect(store.updateFileWorkbenchMetadata(item.id, { description: 'x'.repeat(1001), metadataRevision: described.metadataRevision })).rejects.toMatchObject({ code: 'DESCRIPTION_TOO_LONG' })

    const renamed = await store.updateFileWorkbenchMetadata(item.id, { name: '界面参考.png', metadataRevision: described.metadataRevision })
    expect(renamed.name).toBe('界面参考.png')
    expect(renamed.importedName).toBe('原始图片.png')
    expect(await readFile(await store.getFileWorkbenchItemLocation(item.id))).toEqual(bytes)
  })

  it('saves text with revision conflicts and restores workbench files from trash', async () => {
    const source = Buffer.from('第一版', 'utf8')
    const item = await store.importFileWorkbenchFile(Readable.from(source), { name: 'notes.md', mimeType: 'text/markdown', size: source.byteLength })
    const document = await store.getFileWorkbenchText(item.id)
    const saved = await store.saveFileWorkbenchText({ ...document, content: '第二版' })
    expect(saved.contentRevision).toBe(2)
    await expect(store.saveFileWorkbenchText({ ...document, content: '过期写入' })).rejects.toBeInstanceOf(ConflictError)

    await store.trashFileWorkbenchItem(item.id)
    expect((await store.listFileWorkbenchItems()).items).toHaveLength(0)
    const trash = (await store.listTrash()).find((value) => value.kind === 'file-workbench')!
    const restored = await store.restoreTrash(trash.id)
    expect(restored.fileWorkbenchId).toBe(item.id)
    expect((await store.getFileWorkbenchText(item.id)).content).toBe('第二版')
  })

  it('rejects unsafe workbench names and classifies supported previews', () => {
    expect(() => validateFileWorkbenchName('../secret.txt')).toThrow()
    expect(() => validateFileWorkbenchName('bad?.txt')).toThrow()
    expect(() => validateFileWorkbenchName('CON.txt')).toThrow()
    expect(getFileWorkbenchPreviewKind('README.md')).toBe('markdown')
    expect(getFileWorkbenchPreviewKind('book.pdf')).toBe('pdf')
    expect(getFileWorkbenchPreviewKind('archive.zip')).toBe('binary')
  })
})
