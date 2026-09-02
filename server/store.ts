import {
  copyFile,
  lstat,
  mkdir,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
} from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { basename, dirname, extname, isAbsolute, join, normalize, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import type {
  AppSettings,
  ColorState,
  JsonPane,
  JsonViewMode,
  JsonWorkspace,
  JsonWorkspaceSummary,
  ManagedMarkdownDocument,
  ManagedMarkdownDocumentSummary,
  ManagedMarkdownFolder,
  ManagedMarkdownLibrary,
  MarkdownDocument,
  MarkdownSource,
  MarkdownSourceTree,
  MarkdownTreeNode,
  MarkdownUiState,
  RestoreResult,
  TrashItem,
} from '../shared/types.js'
import { JSON_WORKSPACE_MAX_PANES, JSON_WORKSPACE_MIN_PANES } from '../shared/types.js'
import { AppError, ConflictError } from './errors.js'
import { atomicWrite, exists, readJson, recoverAtomicArtifacts, writeJson } from './filesystem.js'

interface JsonIndex {
  schemaVersion: 1
  updatedAt: string
  revision: number
  items: JsonWorkspaceSummary[]
}

interface LegacyJsonWorkspace extends JsonWorkspaceSummary {
  schemaVersion: 1
  revision: number
  leftText: string
  rightText: string
  leftView: JsonViewMode
  rightView: JsonViewMode
}

interface MarkdownSourceFile {
  schemaVersion: 1
  updatedAt: string
  revision: number
  sources: MarkdownSource[]
}

interface TrashIndex {
  schemaVersion: 1
  updatedAt: string
  revision: number
  items: TrashItem[]
}

const now = () => new Date().toISOString()
const hashBuffer = (value: Buffer | string) => createHash('sha256').update(value).digest('hex')

function createJsonPane(title: string, text = '{\n  \n}', view: JsonViewMode = 'text'): JsonPane {
  return { id: randomUUID(), title, text, view }
}

function migrateJsonWorkspace(value: JsonWorkspace | LegacyJsonWorkspace): { workspace: JsonWorkspace; migrated: boolean } {
  if (value.schemaVersion === 2) return { workspace: value, migrated: false }
  const left = createJsonPane('JSON 1', value.leftText, value.leftView)
  const right = createJsonPane('JSON 2', value.rightText, value.rightView)
  return {
    migrated: true,
    workspace: {
      schemaVersion: 2,
      id: value.id,
      title: value.title,
      createdAt: value.createdAt,
      updatedAt: value.updatedAt,
      revision: value.revision,
      panes: [left, right],
      diffSelection: { basePaneId: left.id, targetPaneId: right.id },
    },
  }
}

function validateJsonWorkspace(workspace: JsonWorkspace): JsonWorkspace {
  if (workspace.schemaVersion !== 2 || !Array.isArray(workspace.panes)) {
    throw new AppError(400, 'INVALID_JSON_WORKSPACE', 'JSON 工作区数据格式无效')
  }
  if (workspace.panes.length < JSON_WORKSPACE_MIN_PANES || workspace.panes.length > JSON_WORKSPACE_MAX_PANES) {
    throw new AppError(400, 'INVALID_JSON_PANE_COUNT', `JSON 面板数量必须为 ${JSON_WORKSPACE_MIN_PANES}～${JSON_WORKSPACE_MAX_PANES} 个`)
  }
  const ids = new Set<string>()
  const panes = workspace.panes.map((pane, index) => {
    if (!pane || typeof pane.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(pane.id) || ids.has(pane.id)) {
      throw new AppError(400, 'INVALID_JSON_PANE', 'JSON 面板 ID 无效或重复')
    }
    if (typeof pane.text !== 'string' || (pane.view !== 'text' && pane.view !== 'tree')) {
      throw new AppError(400, 'INVALID_JSON_PANE', 'JSON 面板内容或视图无效')
    }
    ids.add(pane.id)
    return { ...pane, title: pane.title?.trim() || `JSON ${index + 1}` }
  })
  const { basePaneId, targetPaneId } = workspace.diffSelection ?? {}
  if (!ids.has(basePaneId) || !ids.has(targetPaneId) || basePaneId === targetPaneId) {
    throw new AppError(400, 'INVALID_JSON_DIFF_SELECTION', 'JSON Diff 面板选择无效')
  }
  return { ...workspace, panes }
}

function copyJsonWorkspaceContent(source: JsonWorkspace, target: JsonWorkspace): JsonWorkspace {
  const idMap = new Map<string, string>()
  const panes = source.panes.map((pane) => {
    const id = randomUUID()
    idMap.set(pane.id, id)
    return { ...pane, id }
  })
  return {
    ...target,
    panes,
    diffSelection: {
      basePaneId: idMap.get(source.diffSelection.basePaneId) ?? panes[0]!.id,
      targetPaneId: idMap.get(source.diffSelection.targetPaneId) ?? panes[1]!.id,
    },
  }
}

function defaultSettings(): AppSettings {
  return {
    schemaVersion: 1,
    updatedAt: now(),
    revision: 1,
    theme: {
      mode: 'dark',
      lightAccent: '#2563EB',
      darkAccent: '#60A5FA',
      manualBlend: 0,
      sunrise: '06:00',
      sunset: '19:00',
      transitionMinutes: 30,
    },
    sidebar: { collapsedGroups: [], width: 252 },
    workSchedule: {
      workDays: [1, 2, 3, 4, 5],
      start: '10:00',
      lunchStart: '12:30',
      lunchEnd: '14:00',
      dinnerStart: '18:30',
      end: '19:30',
    },
  }
}

function ensureSafeRelative(input: string): string {
  if (!input || isAbsolute(input)) throw new AppError(400, 'INVALID_PATH', '路径必须是相对路径')
  const normalized = normalize(input).replaceAll('\\', '/')
  if (normalized === '..' || normalized.startsWith('../') || normalized.includes('/../')) {
    throw new AppError(400, 'INVALID_PATH', '路径超出扫描目录')
  }
  return normalized
}

function pathInside(root: string, candidate: string): boolean {
  const value = relative(root, candidate)
  return value === '' || (!value.startsWith('..') && !isAbsolute(value))
}

export class BayToolsStore {
  readonly root: string
  readonly docRoot: string
  private readonly settingsPath: string
  private readonly jsonIndexPath: string
  private readonly workspaceRoot: string
  private readonly recentColorsPath: string
  private readonly savedColorsPath: string
  private readonly markdownSourcesPath: string
  private readonly markdownUiPath: string
  private readonly managedMarkdownIndexPath: string
  private readonly managedMarkdownFilesRoot: string
  private readonly trashIndexPath: string
  private readonly trashItemsRoot: string

  constructor(root = resolve(dirname(fileURLToPath(import.meta.url)), '..')) {
    this.root = root
    this.docRoot = join(root, 'Doc')
    this.settingsPath = join(this.docRoot, 'settings.json')
    this.jsonIndexPath = join(this.docRoot, 'json', 'index.json')
    this.workspaceRoot = join(this.docRoot, 'json', 'workspaces')
    this.recentColorsPath = join(this.docRoot, 'color', 'recent.json')
    this.savedColorsPath = join(this.docRoot, 'color', 'saved.json')
    this.markdownSourcesPath = join(this.docRoot, 'markdown', 'sources.json')
    this.markdownUiPath = join(this.docRoot, 'markdown', 'ui-state.json')
    this.managedMarkdownIndexPath = join(this.docRoot, 'markdown', 'documents', 'index.json')
    this.managedMarkdownFilesRoot = join(this.docRoot, 'markdown', 'documents', 'files')
    this.trashIndexPath = join(this.docRoot, 'trash', 'index.json')
    this.trashItemsRoot = join(this.docRoot, 'trash', 'items')
  }

  async init(): Promise<void> {
    await Promise.all([
      mkdir(this.workspaceRoot, { recursive: true }),
      mkdir(this.trashItemsRoot, { recursive: true }),
      mkdir(dirname(this.recentColorsPath), { recursive: true }),
      mkdir(dirname(this.markdownSourcesPath), { recursive: true }),
      mkdir(this.managedMarkdownFilesRoot, { recursive: true }),
    ])
    await recoverAtomicArtifacts(this.docRoot)
    await this.ensureJson(this.settingsPath, defaultSettings())
    await this.ensureJson(this.jsonIndexPath, { schemaVersion: 1, updatedAt: now(), revision: 1, items: [] } satisfies JsonIndex)
    await this.ensureJson(this.recentColorsPath, { schemaVersion: 1, updatedAt: now(), revision: 1, recent: [] })
    await this.ensureJson(this.savedColorsPath, { schemaVersion: 1, updatedAt: now(), revision: 1, saved: [] })
    await this.ensureJson(this.markdownSourcesPath, { schemaVersion: 1, updatedAt: now(), revision: 1, sources: [] } satisfies MarkdownSourceFile)
    await this.ensureJson(this.markdownUiPath, { schemaVersion: 1, updatedAt: now(), revision: 1, mode: 'split' } satisfies MarkdownUiState)
    await this.ensureJson(this.managedMarkdownIndexPath, { schemaVersion: 1, updatedAt: now(), revision: 1, folders: [], documents: [] } satisfies ManagedMarkdownLibrary)
    await this.ensureJson(this.trashIndexPath, { schemaVersion: 1, updatedAt: now(), revision: 1, items: [] } satisfies TrashIndex)
  }

  private async ensureJson(path: string, value: unknown): Promise<void> {
    if (!(await exists(path))) await writeJson(path, value)
  }

  async getSettings(): Promise<AppSettings> {
    return readJson<AppSettings>(this.settingsPath)
  }

  async updateSettings(next: AppSettings): Promise<AppSettings> {
    const current = await this.getSettings()
    if (current.revision !== next.revision) throw new ConflictError('设置已在其他窗口中修改', current)
    const value = { ...next, schemaVersion: 1 as const, revision: next.revision + 1, updatedAt: now() }
    await writeJson(this.settingsPath, value)
    return value
  }

  async listJsonWorkspaces(): Promise<JsonWorkspaceSummary[]> {
    return (await readJson<JsonIndex>(this.jsonIndexPath)).items
  }

  async createJsonWorkspace(title = '未命名 JSON'): Promise<JsonWorkspace> {
    const createdAt = now()
    const left = createJsonPane('JSON 1')
    const right = createJsonPane('JSON 2')
    const workspace: JsonWorkspace = {
      schemaVersion: 2,
      id: randomUUID(),
      title: title.trim() || '未命名 JSON',
      createdAt,
      updatedAt: createdAt,
      revision: 1,
      panes: [left, right],
      diffSelection: { basePaneId: left.id, targetPaneId: right.id },
    }
    await writeJson(this.workspacePath(workspace.id), workspace)
    const index = await readJson<JsonIndex>(this.jsonIndexPath)
    index.items.push(this.summary(workspace))
    index.revision += 1
    index.updatedAt = now()
    await writeJson(this.jsonIndexPath, index)
    return workspace
  }

  private workspacePath(id: string): string {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new AppError(400, 'INVALID_ID', '工作区 ID 无效')
    return join(this.workspaceRoot, `${id}.json`)
  }

  private summary(workspace: JsonWorkspace): JsonWorkspaceSummary {
    const { id, title, createdAt, updatedAt } = workspace
    return { id, title, createdAt, updatedAt }
  }

  async getJsonWorkspace(id: string): Promise<JsonWorkspace> {
    const path = this.workspacePath(id)
    if (!(await exists(path))) throw new AppError(404, 'NOT_FOUND', 'JSON 工作区不存在')
    const result = migrateJsonWorkspace(await readJson<JsonWorkspace | LegacyJsonWorkspace>(path))
    if (result.migrated) await writeJson(path, result.workspace)
    return result.workspace
  }

  async getJsonWorkspaceLocation(id: string): Promise<string> {
    await this.getJsonWorkspace(id)
    return this.workspacePath(id)
  }

  async updateJsonWorkspace(next: JsonWorkspace): Promise<JsonWorkspace> {
    const current = await this.getJsonWorkspace(next.id)
    if (current.revision !== next.revision) throw new ConflictError('JSON 工作区已在其他窗口中修改', current)
    const normalized = validateJsonWorkspace(next)
    const value = { ...normalized, schemaVersion: 2 as const, revision: next.revision + 1, updatedAt: now() }
    await writeJson(this.workspacePath(next.id), value)
    await this.updateJsonSummary(value)
    return value
  }

  private async updateJsonSummary(workspace: JsonWorkspace): Promise<void> {
    const index = await readJson<JsonIndex>(this.jsonIndexPath)
    const position = index.items.findIndex((item) => item.id === workspace.id)
    if (position >= 0) index.items[position] = this.summary(workspace)
    else index.items.push(this.summary(workspace))
    index.revision += 1
    index.updatedAt = now()
    await writeJson(this.jsonIndexPath, index)
  }

  async renameJsonWorkspace(id: string, title: string): Promise<JsonWorkspaceSummary> {
    const workspace = await this.getJsonWorkspace(id)
    const value = await this.updateJsonWorkspace({ ...workspace, title: title.trim() || workspace.title })
    return this.summary(value)
  }

  async duplicateJsonWorkspace(id: string): Promise<JsonWorkspace> {
    const source = await this.getJsonWorkspace(id)
    const duplicate = await this.createJsonWorkspace(`${source.title} 副本`)
    return this.updateJsonWorkspace(copyJsonWorkspaceContent(source, duplicate))
  }

  async trashJsonWorkspace(id: string): Promise<void> {
    const workspace = await this.getJsonWorkspace(id)
    const source = this.workspacePath(id)
    const itemId = randomUUID()
    const itemRoot = join(this.trashItemsRoot, itemId)
    await mkdir(itemRoot, { recursive: true })
    const payload = join(itemRoot, 'payload.json')
    await rename(source, payload)
    const buffer = await readFile(payload)
    const item: TrashItem = {
      id: itemId,
      kind: 'json-workspace',
      displayName: workspace.title,
      originalLocation: source,
      deletedAt: now(),
      size: buffer.byteLength,
      sha256: hashBuffer(buffer),
    }
    await writeJson(join(itemRoot, 'metadata.json'), item)
    await this.addTrashItem(item)
    const index = await readJson<JsonIndex>(this.jsonIndexPath)
    index.items = index.items.filter((entry) => entry.id !== id)
    index.revision += 1
    index.updatedAt = now()
    await writeJson(this.jsonIndexPath, index)
  }

  async getColors(): Promise<ColorState> {
    const recentFile = await readJson<{ revision: number; updatedAt: string; recent: ColorState['recent'] }>(this.recentColorsPath)
    const savedFile = await readJson<{ revision: number; updatedAt: string; saved: ColorState['saved'] }>(this.savedColorsPath)
    return {
      schemaVersion: 1,
      revision: Math.max(recentFile.revision, savedFile.revision),
      updatedAt: recentFile.updatedAt > savedFile.updatedAt ? recentFile.updatedAt : savedFile.updatedAt,
      recent: recentFile.recent,
      saved: savedFile.saved,
    }
  }

  async updateColors(next: ColorState): Promise<ColorState> {
    const current = await this.getColors()
    if (current.revision !== next.revision) throw new ConflictError('颜色数据已在其他窗口中修改', current)
    const value = { ...next, schemaVersion: 1 as const, revision: next.revision + 1, updatedAt: now() }
    await Promise.all([
      writeJson(this.recentColorsPath, { schemaVersion: 1, updatedAt: value.updatedAt, revision: value.revision, recent: value.recent.slice(0, 10) }),
      writeJson(this.savedColorsPath, { schemaVersion: 1, updatedAt: value.updatedAt, revision: value.revision, saved: value.saved }),
    ])
    return value
  }

  async listMarkdownSources(): Promise<MarkdownSource[]> {
    return (await readJson<MarkdownSourceFile>(this.markdownSourcesPath)).sources
  }

  async addMarkdownSource(inputPath: string): Promise<MarkdownSource> {
    const canonical = await realpath(resolve(inputPath))
    if (!(await stat(canonical)).isDirectory()) throw new AppError(400, 'NOT_DIRECTORY', '选择的路径不是目录')
    const file = await readJson<MarkdownSourceFile>(this.markdownSourcesPath)
    const duplicate = file.sources.find((source) => source.path.toLowerCase() === canonical.toLowerCase())
    if (duplicate) return duplicate
    const source = { id: randomUUID(), label: basename(canonical), path: canonical, createdAt: now() }
    file.sources.push(source)
    file.revision += 1
    file.updatedAt = now()
    await writeJson(this.markdownSourcesPath, file)
    return source
  }

  async updateMarkdownSourceNote(id: string, note: string): Promise<MarkdownSource> {
    const file = await readJson<MarkdownSourceFile>(this.markdownSourcesPath)
    const position = file.sources.findIndex((source) => source.id === id)
    if (position < 0) throw new AppError(404, 'SOURCE_NOT_FOUND', 'Markdown 扫描目录不存在')
    const source = { ...file.sources[position]!, note: note.trim() || undefined }
    file.sources[position] = source
    file.revision += 1
    file.updatedAt = now()
    await writeJson(this.markdownSourcesPath, file)
    return source
  }

  async removeMarkdownSource(id: string): Promise<void> {
    const file = await readJson<MarkdownSourceFile>(this.markdownSourcesPath)
    file.sources = file.sources.filter((source) => source.id !== id)
    file.revision += 1
    file.updatedAt = now()
    await writeJson(this.markdownSourcesPath, file)
  }

  async getMarkdownUiState(): Promise<MarkdownUiState> {
    return readJson<MarkdownUiState>(this.markdownUiPath)
  }

  async updateMarkdownUiState(next: MarkdownUiState): Promise<MarkdownUiState> {
    const current = await this.getMarkdownUiState()
    if (current.revision !== next.revision) throw new ConflictError('Markdown 视图状态已在其他窗口中修改', current)
    const value = { ...next, schemaVersion: 1 as const, revision: next.revision + 1, updatedAt: now() }
    await writeJson(this.markdownUiPath, value)
    return value
  }

  async getManagedMarkdownLibrary(): Promise<ManagedMarkdownLibrary> {
    return readJson<ManagedMarkdownLibrary>(this.managedMarkdownIndexPath)
  }

  private managedMarkdownDocumentPath(id: string): string {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new AppError(400, 'INVALID_ID', 'Markdown 文档 ID 无效')
    return join(this.managedMarkdownFilesRoot, `${id}.md`)
  }

  async createManagedMarkdownFolder(name = '未命名文件夹'): Promise<ManagedMarkdownFolder> {
    const library = await this.getManagedMarkdownLibrary()
    const createdAt = now()
    const folder: ManagedMarkdownFolder = { id: randomUUID(), name: name.trim() || '未命名文件夹', createdAt, updatedAt: createdAt }
    library.folders.push(folder)
    library.revision += 1
    library.updatedAt = now()
    await writeJson(this.managedMarkdownIndexPath, library)
    return folder
  }

  async renameManagedMarkdownFolder(id: string, name: string): Promise<ManagedMarkdownFolder> {
    const library = await this.getManagedMarkdownLibrary()
    const position = library.folders.findIndex((folder) => folder.id === id)
    if (position < 0) throw new AppError(404, 'NOT_FOUND', 'Markdown 文件夹不存在')
    const folder = { ...library.folders[position]!, name: name.trim() || library.folders[position]!.name, updatedAt: now() }
    library.folders[position] = folder
    library.revision += 1
    library.updatedAt = now()
    await writeJson(this.managedMarkdownIndexPath, library)
    return folder
  }

  async deleteManagedMarkdownFolder(id: string): Promise<void> {
    const library = await this.getManagedMarkdownLibrary()
    if (library.documents.some((document) => document.folderId === id)) {
      throw new AppError(409, 'FOLDER_NOT_EMPTY', '文件夹中还有 Markdown 文档')
    }
    if (!library.folders.some((folder) => folder.id === id)) throw new AppError(404, 'NOT_FOUND', 'Markdown 文件夹不存在')
    library.folders = library.folders.filter((folder) => folder.id !== id)
    library.revision += 1
    library.updatedAt = now()
    await writeJson(this.managedMarkdownIndexPath, library)
  }

  async createManagedMarkdownDocument(title = '未命名 Markdown', folderId?: string): Promise<ManagedMarkdownDocument> {
    const library = await this.getManagedMarkdownLibrary()
    if (folderId && !library.folders.some((folder) => folder.id === folderId)) throw new AppError(404, 'FOLDER_NOT_FOUND', 'Markdown 文件夹不存在')
    const createdAt = now()
    const summary: ManagedMarkdownDocumentSummary = {
      id: randomUUID(),
      title: title.trim() || '未命名 Markdown',
      ...(folderId ? { folderId } : {}),
      createdAt,
      updatedAt: createdAt,
      revision: 1,
    }
    await atomicWrite(this.managedMarkdownDocumentPath(summary.id), '')
    library.documents.push(summary)
    library.revision += 1
    library.updatedAt = now()
    await writeJson(this.managedMarkdownIndexPath, library)
    return { ...summary, content: '' }
  }

  async getManagedMarkdownDocument(id: string): Promise<ManagedMarkdownDocument> {
    const library = await this.getManagedMarkdownLibrary()
    const summary = library.documents.find((document) => document.id === id)
    if (!summary) throw new AppError(404, 'NOT_FOUND', 'BayTools Markdown 文档不存在')
    const path = this.managedMarkdownDocumentPath(id)
    if (!(await exists(path))) throw new AppError(404, 'NOT_FOUND', 'BayTools Markdown 文档文件不存在')
    return { ...summary, content: await readFile(path, 'utf8') }
  }

  async updateManagedMarkdownDocument(next: ManagedMarkdownDocument): Promise<ManagedMarkdownDocument> {
    const library = await this.getManagedMarkdownLibrary()
    const position = library.documents.findIndex((document) => document.id === next.id)
    if (position < 0) throw new AppError(404, 'NOT_FOUND', 'BayTools Markdown 文档不存在')
    const current = library.documents[position]!
    if (current.revision !== next.revision) throw new ConflictError('Markdown 文档已在其他窗口中修改', await this.getManagedMarkdownDocument(next.id))
    if (next.folderId && !library.folders.some((folder) => folder.id === next.folderId)) throw new AppError(404, 'FOLDER_NOT_FOUND', 'Markdown 文件夹不存在')
    const summary: ManagedMarkdownDocumentSummary = {
      id: current.id,
      title: next.title.trim() || current.title,
      ...(next.folderId ? { folderId: next.folderId } : {}),
      createdAt: current.createdAt,
      updatedAt: now(),
      revision: current.revision + 1,
    }
    await atomicWrite(this.managedMarkdownDocumentPath(next.id), next.content)
    library.documents[position] = summary
    library.revision += 1
    library.updatedAt = now()
    await writeJson(this.managedMarkdownIndexPath, library)
    return { ...summary, content: next.content }
  }

  async duplicateManagedMarkdownDocument(id: string): Promise<ManagedMarkdownDocument> {
    const source = await this.getManagedMarkdownDocument(id)
    const duplicate = await this.createManagedMarkdownDocument(`${source.title} 副本`, source.folderId)
    return this.updateManagedMarkdownDocument({ ...duplicate, content: source.content })
  }

  async getManagedMarkdownDocumentLocation(id: string): Promise<string> {
    await this.getManagedMarkdownDocument(id)
    return this.managedMarkdownDocumentPath(id)
  }

  async trashManagedMarkdownDocument(id: string): Promise<void> {
    const document = await this.getManagedMarkdownDocument(id)
    const library = await this.getManagedMarkdownLibrary()
    const source = this.managedMarkdownDocumentPath(id)
    const itemId = randomUUID()
    const itemRoot = join(this.trashItemsRoot, itemId)
    await mkdir(itemRoot, { recursive: true })
    const payload = join(itemRoot, 'payload.md')
    await rename(source, payload)
    const buffer = await readFile(payload)
    const managedDocument: ManagedMarkdownDocumentSummary = {
      id: document.id,
      title: document.title,
      ...(document.folderId ? { folderId: document.folderId } : {}),
      createdAt: document.createdAt,
      updatedAt: document.updatedAt,
      revision: document.revision,
    }
    const item: TrashItem = {
      id: itemId,
      kind: 'managed-markdown',
      displayName: document.title,
      originalLocation: source,
      managedDocument,
      deletedAt: now(),
      size: buffer.byteLength,
      sha256: hashBuffer(buffer),
    }
    await writeJson(join(itemRoot, 'metadata.json'), item)
    library.documents = library.documents.filter((entry) => entry.id !== id)
    library.revision += 1
    library.updatedAt = now()
    await writeJson(this.managedMarkdownIndexPath, library)
    await this.addTrashItem(item)
  }

  private async sourceById(id: string): Promise<MarkdownSource> {
    const source = (await this.listMarkdownSources()).find((value) => value.id === id)
    if (!source) throw new AppError(404, 'SOURCE_NOT_FOUND', 'Markdown 扫描目录不存在')
    return source
  }

  async getMarkdownSourceLocation(id: string): Promise<string> {
    return (await this.sourceById(id)).path
  }

  async scanMarkdownSources(): Promise<MarkdownSourceTree[]> {
    return Promise.all((await this.listMarkdownSources()).map(async (source) => {
      try {
        return { ...source, children: await this.scanDirectory(source.path, source.path) }
      } catch (error) {
        return { ...source, children: [], error: error instanceof Error ? error.message : '扫描失败' }
      }
    }))
  }

  private async scanDirectory(root: string, current: string): Promise<MarkdownTreeNode[]> {
    const entries = await readdir(current, { withFileTypes: true })
    const nodes: MarkdownTreeNode[] = []
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
      const fullPath = join(current, entry.name)
      if (entry.isSymbolicLink()) continue
      const relativePath = relative(root, fullPath).replaceAll(sep, '/')
      if (entry.isDirectory()) {
        const children = await this.scanDirectory(root, fullPath)
        if (children.length) nodes.push({ name: entry.name, relativePath, type: 'directory', children })
      } else if (entry.isFile() && extname(entry.name).toLowerCase() === '.md') {
        nodes.push({ name: entry.name, relativePath, type: 'file' })
      }
    }
    return nodes.sort((a, b) => a.type === b.type ? a.name.localeCompare(b.name, 'zh-CN') : a.type === 'directory' ? -1 : 1)
  }

  private async resolveSourcePath(sourceId: string, relativePath: string, extension?: string): Promise<{ source: MarkdownSource; fullPath: string }> {
    const source = await this.sourceById(sourceId)
    const safe = ensureSafeRelative(relativePath)
    if (extension && extname(safe).toLowerCase() !== extension) throw new AppError(400, 'INVALID_EXTENSION', `仅支持 ${extension} 文件`)
    const root = await realpath(source.path)
    const candidate = join(root, safe)
    const info = await lstat(candidate)
    if (info.isSymbolicLink()) throw new AppError(400, 'SYMLINK_DENIED', '不允许访问符号链接')
    const canonical = await realpath(candidate)
    if (!pathInside(root, canonical)) throw new AppError(403, 'PATH_OUTSIDE_SOURCE', '路径超出扫描目录')
    return { source, fullPath: canonical }
  }

  async getMarkdownDocument(sourceId: string, relativePath: string): Promise<MarkdownDocument> {
    const resolved = await this.resolveSourcePath(sourceId, relativePath, '.md')
    const content = await readFile(resolved.fullPath, 'utf8')
    const info = await stat(resolved.fullPath)
    return { sourceId, relativePath: ensureSafeRelative(relativePath), content, hash: hashBuffer(content), updatedAt: info.mtime.toISOString() }
  }

  async getMarkdownDocumentLocation(sourceId: string, relativePath: string): Promise<string> {
    return (await this.resolveSourcePath(sourceId, relativePath, '.md')).fullPath
  }

  async saveMarkdownDocument(document: MarkdownDocument): Promise<MarkdownDocument> {
    const current = await this.getMarkdownDocument(document.sourceId, document.relativePath)
    if (current.hash !== document.hash) throw new ConflictError('Markdown 文件已被其他程序修改', current)
    await atomicWrite((await this.resolveSourcePath(document.sourceId, document.relativePath, '.md')).fullPath, document.content)
    return this.getMarkdownDocument(document.sourceId, document.relativePath)
  }

  async renameMarkdownDocument(sourceId: string, relativePath: string, nextName: string, expectedHash: string): Promise<MarkdownDocument> {
    if (basename(nextName) !== nextName || extname(nextName).toLowerCase() !== '.md') {
      throw new AppError(400, 'INVALID_NAME', '文件名必须是不含路径的 .md 文件名')
    }
    const current = await this.getMarkdownDocument(sourceId, relativePath)
    if (current.hash !== expectedHash) throw new ConflictError('Markdown 文件已被其他程序修改', current)
    const { fullPath } = await this.resolveSourcePath(sourceId, relativePath, '.md')
    const target = join(dirname(fullPath), nextName)
    if (await exists(target)) throw new AppError(409, 'NAME_CONFLICT', '同名文件已经存在')
    await rename(fullPath, target)
    const nextRelative = join(dirname(ensureSafeRelative(relativePath)), nextName).replaceAll('\\', '/')
    return this.getMarkdownDocument(sourceId, nextRelative.startsWith('./') ? nextRelative.slice(2) : nextRelative)
  }

  async trashMarkdownDocument(sourceId: string, relativePath: string, expectedHash: string): Promise<void> {
    const document = await this.getMarkdownDocument(sourceId, relativePath)
    if (document.hash !== expectedHash) throw new ConflictError('Markdown 文件已被其他程序修改', document)
    const { fullPath } = await this.resolveSourcePath(sourceId, relativePath, '.md')
    const itemId = randomUUID()
    const itemRoot = join(this.trashItemsRoot, itemId)
    await mkdir(itemRoot, { recursive: true })
    const payload = join(itemRoot, 'payload.md')
    await copyFile(fullPath, payload)
    const buffer = await readFile(payload)
    if (hashBuffer(buffer) !== expectedHash) {
      await rm(itemRoot, { recursive: true, force: true })
      throw new AppError(500, 'TRASH_VERIFY_FAILED', '垃圾箱副本校验失败，原文件未删除')
    }
    const item: TrashItem = {
      id: itemId,
      kind: 'markdown',
      displayName: basename(fullPath),
      originalLocation: fullPath,
      originalRelativePath: ensureSafeRelative(relativePath),
      sourceId,
      deletedAt: now(),
      size: buffer.byteLength,
      sha256: expectedHash,
    }
    await writeJson(join(itemRoot, 'metadata.json'), item)
    await rm(fullPath)
    await this.addTrashItem(item)
  }

  async readAsset(sourceId: string, relativePath: string): Promise<{ buffer: Buffer; extension: string }> {
    const allowed = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'])
    const extension = extname(relativePath).toLowerCase()
    if (!allowed.has(extension)) throw new AppError(400, 'ASSET_DENIED', '不支持该资源类型')
    const { fullPath } = await this.resolveSourcePath(sourceId, relativePath)
    return { buffer: await readFile(fullPath), extension }
  }

  private async getTrashIndex(): Promise<TrashIndex> {
    return readJson<TrashIndex>(this.trashIndexPath)
  }

  async listTrash(): Promise<TrashItem[]> {
    return (await this.getTrashIndex()).items.sort((a, b) => b.deletedAt.localeCompare(a.deletedAt))
  }

  private async addTrashItem(item: TrashItem): Promise<void> {
    const index = await this.getTrashIndex()
    index.items.push(item)
    index.revision += 1
    index.updatedAt = now()
    await writeJson(this.trashIndexPath, index)
  }

  async restoreTrash(id: string, asCopy = false, targetDirectory?: string): Promise<RestoreResult> {
    const index = await this.getTrashIndex()
    const item = index.items.find((value) => value.id === id)
    if (!item) throw new AppError(404, 'NOT_FOUND', '垃圾项不存在')
    const itemRoot = join(this.trashItemsRoot, id)
    if (item.kind === 'json-workspace') {
      const { workspace } = migrateJsonWorkspace(await readJson<JsonWorkspace | LegacyJsonWorkspace>(join(itemRoot, 'payload.json')))
      let restored = workspace
      let target = this.workspacePath(workspace.id)
      if (await exists(target)) {
        if (!asCopy) throw new AppError(409, 'RESTORE_CONFLICT', '同 ID 工作区已经存在')
        const created = await this.createJsonWorkspace(`${workspace.title}（已恢复）`)
        restored = await this.updateJsonWorkspace(copyJsonWorkspaceContent(workspace, created))
        target = this.workspacePath(restored.id)
      } else {
        await writeJson(target, workspace)
        await this.updateJsonSummary(restored)
      }
      await this.removeTrashItem(index, item)
      return { restoredLocation: target, workspaceId: restored.id }
    }

    if (item.kind === 'managed-markdown') {
      if (!item.managedDocument) throw new AppError(500, 'INVALID_TRASH_ITEM', 'Markdown 垃圾项缺少文档信息')
      const payload = join(itemRoot, 'payload.md')
      const content = await readFile(payload, 'utf8')
      const library = await this.getManagedMarkdownLibrary()
      const target = this.managedMarkdownDocumentPath(item.managedDocument.id)
      if (await exists(target) || library.documents.some((document) => document.id === item.managedDocument!.id)) {
        if (!asCopy) throw new AppError(409, 'RESTORE_CONFLICT', '同 ID Markdown 文档已经存在')
        const folderId = item.managedDocument.folderId && library.folders.some((folder) => folder.id === item.managedDocument!.folderId)
          ? item.managedDocument.folderId
          : undefined
        const created = await this.createManagedMarkdownDocument(`${item.managedDocument.title}（已恢复）`, folderId)
        const restored = await this.updateManagedMarkdownDocument({ ...created, content })
        await this.removeTrashItem(index, item)
        return { restoredLocation: this.managedMarkdownDocumentPath(restored.id) }
      }
      const folderId = item.managedDocument.folderId && library.folders.some((folder) => folder.id === item.managedDocument!.folderId)
        ? item.managedDocument.folderId
        : undefined
      const restored: ManagedMarkdownDocumentSummary = { ...item.managedDocument, ...(folderId ? { folderId } : {}), updatedAt: now() }
      if (!folderId) delete restored.folderId
      await copyFile(payload, target)
      if (hashBuffer(await readFile(target)) !== item.sha256) {
        await rm(target, { force: true })
        throw new AppError(500, 'RESTORE_VERIFY_FAILED', '恢复文件校验失败')
      }
      library.documents.push(restored)
      library.revision += 1
      library.updatedAt = now()
      await writeJson(this.managedMarkdownIndexPath, library)
      await this.removeTrashItem(index, item)
      return { restoredLocation: target }
    }

    const payload = join(itemRoot, 'payload.md')
    let target = targetDirectory ? join(await realpath(targetDirectory), item.displayName) : item.originalLocation
    if (!(await exists(dirname(target)))) throw new AppError(409, 'RESTORE_DIRECTORY_MISSING', '原目录不存在，请选择新的恢复目录')
    if (await exists(target)) {
      if (!asCopy) throw new AppError(409, 'RESTORE_CONFLICT', '原位置已经存在同名文件')
      const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16)
      target = join(dirname(target), `${basename(target, '.md')}.restored-${stamp}.md`)
    }
    await copyFile(payload, target)
    if (hashBuffer(await readFile(target)) !== item.sha256) {
      await rm(target, { force: true })
      throw new AppError(500, 'RESTORE_VERIFY_FAILED', '恢复文件校验失败')
    }
    await this.removeTrashItem(index, item)
    return { restoredLocation: target }
  }

  private async removeTrashItem(index: TrashIndex, item: TrashItem): Promise<void> {
    await rm(join(this.trashItemsRoot, item.id), { recursive: true, force: true })
    index.items = index.items.filter((value) => value.id !== item.id)
    index.revision += 1
    index.updatedAt = now()
    await writeJson(this.trashIndexPath, index)
  }

  async deleteTrash(id: string): Promise<void> {
    const index = await this.getTrashIndex()
    const item = index.items.find((value) => value.id === id)
    if (!item) throw new AppError(404, 'NOT_FOUND', '垃圾项不存在')
    await this.removeTrashItem(index, item)
  }

  async emptyTrash(): Promise<void> {
    const index = await this.getTrashIndex()
    await Promise.all(index.items.map((item) => rm(join(this.trashItemsRoot, item.id), { recursive: true, force: true })))
    index.items = []
    index.revision += 1
    index.updatedAt = now()
    await writeJson(this.trashIndexPath, index)
  }
}
