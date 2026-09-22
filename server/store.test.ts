import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHash, randomUUID } from 'node:crypto'
import { access, mkdtemp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Readable } from 'node:stream'
import { BayToolsStore, getFileWorkbenchPreviewKind, moveDirectoryWithVerifiedFile, validateFileWorkbenchName } from './store.js'
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
    expect(settings.sidebar.toolOrder).toContain('bookmarks')
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

  it('creates JSON groups, moves workspaces, and preserves groups through updates and trash restore', async () => {
    const first = await store.createJsonFolder('接口')
    const second = await store.createJsonFolder('配置')
    const workspace = await store.createJsonWorkspace('登录', first.id)
    expect((await store.listJsonWorkspaces())[0]?.folderId).toBe(first.id)

    const duplicate = await store.duplicateJsonWorkspace(workspace.id)
    expect((await store.listJsonWorkspaces()).find((item) => item.id === duplicate.id)?.folderId).toBe(first.id)
    await expect(store.deleteJsonFolder(first.id)).rejects.toMatchObject({ code: 'FOLDER_NOT_EMPTY' })

    await store.moveJsonWorkspace(workspace.id, second.id)
    const updated = await store.updateJsonWorkspace({ ...workspace, title: '登录接口' })
    expect((await store.listJsonWorkspaces()).find((item) => item.id === updated.id)).toMatchObject({ title: '登录接口', folderId: second.id })

    await store.trashJsonWorkspace(updated.id)
    const trash = (await store.listTrash()).find((item) => item.kind === 'json-workspace')!
    await store.restoreTrash(trash.id)
    expect((await store.listJsonWorkspaces()).find((item) => item.id === updated.id)?.folderId).toBe(second.id)

    await store.moveJsonWorkspace(duplicate.id)
    await store.deleteJsonFolder(first.id)
    expect((await store.listJsonFolders()).map((folder) => folder.name)).toEqual(['配置'])
  })

  it('migrates the legacy JSON index before using groups', async () => {
    await store.createJsonWorkspace('Legacy index')
    const indexPath = join(root, 'Doc', 'json', 'index.json')
    const legacy = JSON.parse(await readFile(indexPath, 'utf8'))
    legacy.schemaVersion = 1
    delete legacy.folders
    await writeFile(indexPath, JSON.stringify(legacy), 'utf8')

    expect(await store.listJsonFolders()).toEqual([])
    expect(JSON.parse(await readFile(indexPath, 'utf8'))).toMatchObject({ schemaVersion: 2, folders: [] })
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

  it('scans multiple document types and only loads supported text into the editor', async () => {
    const docs = join(root, 'mixed-docs')
    await mkdir(docs)
    await writeFile(join(docs, 'notes.txt'), 'hello', 'utf8')
    await writeFile(join(docs, 'config.json'), '{"ok":true}', 'utf8')
    await writeFile(join(docs, 'picture.png'), Buffer.from([137, 80, 78, 71]))
    await writeFile(join(docs, 'manual.pdf'), Buffer.from('%PDF-1.4'))
    await writeFile(join(docs, 'archive.zip'), Buffer.from([80, 75, 3, 4]))
    const source = await store.addMarkdownSource(docs)

    const tree = await store.scanMarkdownSources()
    const files = tree[0]!.children.filter((node) => node.type === 'file')
    expect(files.map((node) => [node.name, node.previewKind])).toEqual([
      ['archive.zip', 'binary'],
      ['config.json', 'text'],
      ['manual.pdf', 'pdf'],
      ['notes.txt', 'text'],
      ['picture.png', 'image'],
    ])

    const created = await store.createMarkdownDocument(source.id, '', 'scratch.lua')
    expect(created).toMatchObject({ relativePath: 'scratch.lua', content: '', editable: true, extension: '.lua', previewKind: 'text' })
    await expect(store.createMarkdownDocument(source.id, '', 'scratch.lua')).rejects.toMatchObject({ code: 'NAME_CONFLICT' })
    await expect(store.createMarkdownDocument(source.id, '', 'empty.png')).rejects.toMatchObject({ code: 'INVALID_DOCUMENT_TYPE' })

    const text = await store.getMarkdownDocument(source.id, 'notes.txt')
    expect(text).toMatchObject({ content: 'hello', editable: true, extension: '.txt', previewKind: 'text' })
    const saved = await store.saveMarkdownDocument({ ...text, content: 'updated' })
    expect(await readFile(join(docs, 'notes.txt'), 'utf8')).toBe('updated')

    const image = await store.getMarkdownDocument(source.id, 'picture.png')
    expect(image).toMatchObject({ content: '', editable: false, extension: '.png', previewKind: 'image' })
    await expect(store.saveMarkdownDocument({ ...image, content: 'bad' })).rejects.toMatchObject({ code: 'DOCUMENT_READ_ONLY' })

    const renamed = await store.renameMarkdownDocument(source.id, saved.relativePath, 'memo.txt', saved.hash)
    expect(renamed.relativePath).toBe('memo.txt')
    await expect(store.renameMarkdownDocument(source.id, renamed.relativePath, 'memo.md', renamed.hash)).rejects.toMatchObject({ code: 'INVALID_EXTENSION' })
  })

  it('migrates and persists Markdown table-of-contents preferences', async () => {
    const statePath = join(root, 'Doc', 'markdown', 'ui-state.json')
    const legacy = await store.getMarkdownUiState()
    await writeFile(statePath, JSON.stringify({ schemaVersion: 1, updatedAt: legacy.updatedAt, revision: legacy.revision, mode: 'preview' }), 'utf8')

    const migrated = await store.getMarkdownUiState()
    expect(migrated).toMatchObject({ mode: 'preview', tocOpen: true, syncScroll: true })
    const saved = await store.updateMarkdownUiState({ ...migrated, tocOpen: false, syncScroll: false })
    expect(await store.getMarkdownUiState()).toMatchObject({ revision: saved.revision, tocOpen: false, syncScroll: false })
  })

  it('creates folders and auto-save ready managed Markdown documents', async () => {
    const folder = await store.createManagedMarkdownFolder('接口记录')
    const archive = await store.createManagedMarkdownFolder('归档')
    const document = await store.createManagedMarkdownDocument('登录接口', folder.id)
    expect(await store.getManagedMarkdownDocumentLocation(document.id)).toBe(join(root, 'Doc', 'markdown', 'documents', 'files', `${document.id}.md`))
    const saved = await store.updateManagedMarkdownDocument({ ...document, content: '# 登录\n\n成功。' })
    expect((await store.getManagedMarkdownDocument(saved.id)).content).toContain('成功')
    await expect(store.deleteManagedMarkdownFolder(folder.id)).rejects.toMatchObject({ code: 'FOLDER_NOT_EMPTY' })

    await store.moveManagedMarkdownDocument(saved.id, archive.id)
    const savedAfterMove = await store.updateManagedMarkdownDocument({ ...saved, content: `${saved.content}\n\n移动后保存。` })
    expect((await store.getManagedMarkdownLibrary()).documents.find((item) => item.id === saved.id)?.folderId).toBe(archive.id)
    expect(savedAfterMove.folderId).toBe(archive.id)
    await store.deleteManagedMarkdownFolder(folder.id)

    const duplicate = await store.duplicateManagedMarkdownDocument(saved.id)
    expect(duplicate.title).toBe('登录接口 副本')
    expect(duplicate.content).toBe(savedAfterMove.content)
    expect(duplicate.folderId).toBe(archive.id)

    await store.trashManagedMarkdownDocument(saved.id)
    expect((await store.getManagedMarkdownLibrary()).documents.some((item) => item.id === saved.id)).toBe(false)
    const trash = (await store.listTrash()).find((item) => item.kind === 'managed-markdown')!
    await store.restoreTrash(trash.id)
    expect(await store.getManagedMarkdownDocument(saved.id)).toMatchObject({ content: savedAfterMove.content, folderId: archive.id })
  })

  it('creates BayTools text and code documents while preserving their extensions', async () => {
    const document = await store.createManagedMarkdownDocument('临时脚本.lua')
    expect(document).toMatchObject({ title: '临时脚本.lua', extension: '.lua', previewKind: 'text', content: '' })
    expect(await store.getManagedMarkdownDocumentLocation(document.id)).toBe(join(root, 'Doc', 'markdown', 'documents', 'files', `${document.id}.lua`))

    const saved = await store.updateManagedMarkdownDocument({ ...document, content: 'return true' })
    expect((await store.getManagedMarkdownDocument(saved.id)).content).toBe('return true')
    const duplicate = await store.duplicateManagedMarkdownDocument(saved.id)
    expect(duplicate).toMatchObject({ title: '临时脚本 副本.lua', extension: '.lua', previewKind: 'text', content: 'return true' })

    await store.trashManagedMarkdownDocument(saved.id)
    const trash = (await store.listTrash()).find((item) => item.managedDocument?.id === saved.id)!
    await store.restoreTrash(trash.id)
    expect(await store.getManagedMarkdownDocument(saved.id)).toMatchObject({ extension: '.lua', previewKind: 'text', content: 'return true' })

    await expect(store.createManagedMarkdownDocument('图片.png')).rejects.toMatchObject({ code: 'INVALID_DOCUMENT_TYPE' })
    await expect(store.updateManagedMarkdownDocument({ ...saved, title: '临时脚本.txt' })).rejects.toMatchObject({ code: 'INVALID_EXTENSION' })
  })

  it('treats legacy BayTools documents without type metadata as Markdown', async () => {
    const document = await store.createManagedMarkdownDocument('旧文档')
    const indexPath = join(root, 'Doc', 'markdown', 'documents', 'index.json')
    const index = JSON.parse(await readFile(indexPath, 'utf8'))
    delete index.documents[0].extension
    delete index.documents[0].previewKind
    await writeFile(indexPath, JSON.stringify(index), 'utf8')

    expect((await store.getManagedMarkdownLibrary()).documents[0]).toMatchObject({ id: document.id, extension: '.md', previewKind: 'markdown' })
    expect((await store.getManagedMarkdownDocument(document.id)).content).toBe('')
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

  it('copies, verifies, and removes a workbench item when Windows blocks the directory rename', async () => {
    const source = join(root, 'locked-item')
    const target = join(root, 'trash-payload')
    const content = Buffer.from('clipboard image bytes')
    await mkdir(join(source, 'content'), { recursive: true })
    await writeFile(join(source, 'content', 'clipboard.png'), content)
    await writeFile(join(source, 'metadata.json'), '{}')
    const blockedRename: typeof rename = async () => {
      throw Object.assign(new Error('operation not permitted'), { code: 'EPERM' })
    }

    await moveDirectoryWithVerifiedFile(
      source,
      target,
      join('content', 'clipboard.png'),
      createHash('sha256').update(content).digest('hex'),
      blockedRename,
    )

    expect(await readFile(join(target, 'content', 'clipboard.png'))).toEqual(content)
    await expect(access(join(source, 'content', 'clipboard.png'))).rejects.toThrow()
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
