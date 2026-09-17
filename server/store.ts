import {
  cp,
  copyFile,
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
} from 'node:fs/promises'
import { createReadStream, createWriteStream } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { basename, dirname, extname, isAbsolute, join, normalize, relative, resolve, sep } from 'node:path'
import { Transform, type Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import type {
  AppSettings,
  CodeCardLibrary,
  CodeCardWorkspace,
  ColorState,
  FileWorkbenchItem,
  FileWorkbenchLibrary,
  FileWorkbenchMetadataPatch,
  FileWorkbenchPreviewKind,
  FileWorkbenchTextDocument,
  JsonPane,
  JsonFolder,
  JsonScratchpad,
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
import { FILE_WORKBENCH_MAX_UPLOAD_SIZE, FILE_WORKBENCH_TEXT_EDIT_LIMIT, JSON_WORKSPACE_MAX_PANES, JSON_WORKSPACE_MIN_PANES } from '../shared/types.js'
import { AppError, ConflictError } from './errors.js'
import { atomicWrite, exists, readJson, recoverAtomicArtifacts, writeJson } from './filesystem.js'

interface JsonIndex {
  schemaVersion: 2
  updatedAt: string
  revision: number
  folders: JsonFolder[]
  items: JsonWorkspaceSummary[]
}

interface LegacyJsonIndex {
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

interface FileWorkbenchUploadMetadata {
  name: string
  mimeType?: string
  size: number
  sourceLastModified?: string
}

const now = () => new Date().toISOString()
const hashBuffer = (value: Buffer | string) => createHash('sha256').update(value).digest('hex')

const textExtensions = new Set(['.txt', '.log', '.lua', '.js', '.jsx', '.ts', '.tsx', '.css', '.scss', '.html', '.htm', '.xml', '.csv', '.ini', '.cfg', '.conf', '.yaml', '.yml', '.toml', '.sql', '.sh', '.ps1', '.bat', '.cmd', '.py', '.java', '.cs', '.cpp', '.c', '.h', '.go', '.rs'])
const imageExtensions = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'])

export function validateFileWorkbenchName(value: string): string {
  const name = value.trim()
  if (!name || name === '.' || name === '..' || basename(name) !== name || /[<>:"/\\|?*\u0000-\u001f]/.test(name) || /[. ]$/.test(name) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name) || name.length > 200) {
    throw new AppError(400, 'INVALID_NAME', '文件名为空、过长或包含 Windows 不允许的字符')
  }
  return name
}

export function getFileWorkbenchPreviewKind(name: string, mimeType = ''): FileWorkbenchPreviewKind {
  const extension = extname(name).toLowerCase()
  if (extension === '.md' || extension === '.markdown') return 'markdown'
  if (extension === '.pdf' || mimeType === 'application/pdf') return 'pdf'
  if (imageExtensions.has(extension)) return 'image'
  if (extension === '.json' || textExtensions.has(extension) || mimeType.startsWith('text/')) return 'text'
  return 'binary'
}

function managedDocumentType(name: string): { extension: string; previewKind: 'markdown' | 'text' } {
  const explicitExtension = extname(name).toLowerCase()
  const extension = explicitExtension || '.md'
  if (!/^\.[a-z0-9]+$/i.test(extension)) throw new AppError(400, 'INVALID_EXTENSION', '文件扩展名无效')
  const previewKind = getFileWorkbenchPreviewKind(`document${extension}`)
  if (previewKind !== 'text' && previewKind !== 'markdown') {
    throw new AppError(400, 'INVALID_DOCUMENT_TYPE', '只能新建 Markdown、文本或代码文件')
  }
  return { extension, previewKind }
}

function normalizeManagedDocumentSummary(document: ManagedMarkdownDocumentSummary): ManagedMarkdownDocumentSummary {
  const rawExtension = (document as Partial<ManagedMarkdownDocumentSummary>).extension
  const type = managedDocumentType(typeof rawExtension === 'string' ? `document${rawExtension}` : 'document.md')
  return { ...document, ...type }
}

function managedDocumentCopyTitle(title: string, extension: string, suffix: string): string {
  return title.toLowerCase().endsWith(extension)
    ? `${title.slice(0, -extension.length)}${suffix}${extension}`
    : `${title}${suffix}`
}

async function hashFile(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer)
  return hash.digest('hex')
}

function isBlockedDirectoryRename(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code
  return code === 'EPERM' || code === 'EACCES' || code === 'EBUSY'
}

export async function moveDirectoryWithVerifiedFile(
  source: string,
  target: string,
  relativeFile: string,
  expectedHash: string,
  renamePath: typeof rename = rename,
): Promise<void> {
  try {
    await renamePath(source, target)
    return
  } catch (error) {
    if (!isBlockedDirectoryRename(error) || await exists(target)) throw error
  }

  const sourceFile = join(source, relativeFile)
  const targetFile = join(target, relativeFile)
  try {
    await cp(source, target, { recursive: true, force: false, errorOnExist: true })
    if (await hashFile(targetFile) !== expectedHash) {
      throw new AppError(500, 'TRASH_VERIFY_FAILED', '复制到垃圾箱后的文件校验失败')
    }
    await rm(sourceFile, { force: true, maxRetries: 10, retryDelay: 100 })
    if (await exists(sourceFile)) throw new AppError(500, 'SOURCE_DELETE_FAILED', '源文件仍被占用，无法完成删除')
  } catch (error) {
    await rm(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }).catch(() => undefined)
    throw error
  }

  // Windows 文件监控器可能暂时占用空目录；核心文件已校验复制并删除后，残留空目录不影响垃圾箱事务。
  await rm(source, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }).catch(() => undefined)
}

function createJsonPane(title: string, text = '{\n  \n}', view: JsonViewMode = 'text'): JsonPane {
  return { id: randomUUID(), title, text, view }
}

function defaultJsonScratchpad(): JsonScratchpad {
  return {
    schemaVersion: 1,
    updatedAt: now(),
    revision: 1,
    text: '{\n  "project": "BayTools",\n  "local": true\n}',
    mode: 'text',
    autoFormat: false,
  }
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

function validateCodeCardImageName(value: string): string {
  if (!/^[0-9a-f-]{36}-[0-9a-f-]{36}\.(webp|png|jpg)$/i.test(value)) throw new AppError(400, 'INVALID_IMAGE_NAME', '代码段图片文件名无效')
  return value
}

export class BayToolsStore {
  readonly root: string
  readonly docRoot: string
  private readonly settingsPath: string
  private readonly jsonIndexPath: string
  private readonly jsonScratchpadPath: string
  private readonly workspaceRoot: string
  private readonly recentColorsPath: string
  private readonly savedColorsPath: string
  private readonly markdownSourcesPath: string
  private readonly markdownUiPath: string
  private readonly managedMarkdownIndexPath: string
  private readonly managedMarkdownFilesRoot: string
  private readonly fileWorkbenchIndexPath: string
  private readonly fileWorkbenchItemsRoot: string
  private readonly codeCardIndexPath: string
  private readonly codeCardWorkspaceRoot: string
  private readonly codeCardImagesRoot: string
  private readonly trashIndexPath: string
  private readonly trashItemsRoot: string

  constructor(root = resolve(dirname(fileURLToPath(import.meta.url)), '..')) {
    this.root = root
    this.docRoot = join(root, 'Doc')
    this.settingsPath = join(this.docRoot, 'settings.json')
    this.jsonIndexPath = join(this.docRoot, 'json', 'index.json')
    this.jsonScratchpadPath = join(this.docRoot, 'json', 'home-scratchpad.json')
    this.workspaceRoot = join(this.docRoot, 'json', 'workspaces')
    this.recentColorsPath = join(this.docRoot, 'color', 'recent.json')
    this.savedColorsPath = join(this.docRoot, 'color', 'saved.json')
    this.markdownSourcesPath = join(this.docRoot, 'markdown', 'sources.json')
    this.markdownUiPath = join(this.docRoot, 'markdown', 'ui-state.json')
    this.managedMarkdownIndexPath = join(this.docRoot, 'markdown', 'documents', 'index.json')
    this.managedMarkdownFilesRoot = join(this.docRoot, 'markdown', 'documents', 'files')
    this.fileWorkbenchIndexPath = join(this.docRoot, 'file-workbench', 'index.json')
    this.fileWorkbenchItemsRoot = join(this.docRoot, 'file-workbench', 'items')
    this.codeCardIndexPath = join(this.docRoot, 'code-cards', 'index.json')
    this.codeCardWorkspaceRoot = join(this.docRoot, 'code-cards', 'workspaces')
    this.codeCardImagesRoot = join(this.docRoot, 'code-cards', 'images')
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
      mkdir(this.fileWorkbenchItemsRoot, { recursive: true }),
      mkdir(this.codeCardWorkspaceRoot, { recursive: true }),
      mkdir(this.codeCardImagesRoot, { recursive: true }),
    ])
    await recoverAtomicArtifacts(this.docRoot)
    await this.ensureJson(this.settingsPath, defaultSettings())
    await this.ensureJson(this.jsonIndexPath, { schemaVersion: 2, updatedAt: now(), revision: 1, folders: [], items: [] } satisfies JsonIndex)
    await this.ensureJson(this.jsonScratchpadPath, defaultJsonScratchpad())
    await this.ensureJson(this.recentColorsPath, { schemaVersion: 1, updatedAt: now(), revision: 1, recent: [] })
    await this.ensureJson(this.savedColorsPath, { schemaVersion: 1, updatedAt: now(), revision: 1, saved: [] })
    await this.ensureJson(this.markdownSourcesPath, { schemaVersion: 1, updatedAt: now(), revision: 1, sources: [] } satisfies MarkdownSourceFile)
    await this.ensureJson(this.markdownUiPath, { schemaVersion: 1, updatedAt: now(), revision: 1, mode: 'split', tocOpen: true, syncScroll: true } satisfies MarkdownUiState)
    await this.ensureJson(this.managedMarkdownIndexPath, { schemaVersion: 1, updatedAt: now(), revision: 1, folders: [], documents: [] } satisfies ManagedMarkdownLibrary)
    await this.ensureJson(this.fileWorkbenchIndexPath, { schemaVersion: 1, updatedAt: now(), revision: 1, items: [] } satisfies FileWorkbenchLibrary)
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

  async getJsonScratchpad(): Promise<JsonScratchpad> {
    const value = await readJson<JsonScratchpad>(this.jsonScratchpadPath)
    if (value.schemaVersion !== 1 || typeof value.text !== 'string' || !['text', 'tree'].includes(value.mode) || typeof value.autoFormat !== 'boolean') {
      throw new AppError(500, 'INVALID_JSON_SCRATCHPAD', '主页 JSON 草稿文件格式无效')
    }
    return value
  }

  async updateJsonScratchpad(next: JsonScratchpad): Promise<JsonScratchpad> {
    const current = await this.getJsonScratchpad()
    if (current.revision !== next.revision) throw new ConflictError('主页 JSON 草稿已在其他窗口中修改', current)
    if (typeof next.text !== 'string' || !['text', 'tree'].includes(next.mode) || typeof next.autoFormat !== 'boolean') {
      throw new AppError(400, 'INVALID_JSON_SCRATCHPAD', '主页 JSON 草稿内容或视图无效')
    }
    const value = { ...next, schemaVersion: 1 as const, revision: next.revision + 1, updatedAt: now() }
    await writeJson(this.jsonScratchpadPath, value)
    return value
  }

  private async getJsonIndex(): Promise<JsonIndex> {
    const current = await readJson<JsonIndex | LegacyJsonIndex>(this.jsonIndexPath)
    if (current.schemaVersion === 2 && Array.isArray(current.folders)) return current
    const migrated: JsonIndex = { ...current, schemaVersion: 2, folders: [] }
    await writeJson(this.jsonIndexPath, migrated)
    return migrated
  }

  async listJsonWorkspaces(): Promise<JsonWorkspaceSummary[]> {
    return (await this.getJsonIndex()).items
  }

  async listJsonFolders(): Promise<JsonFolder[]> {
    return (await this.getJsonIndex()).folders
  }

  async createJsonFolder(name = '未命名分组'): Promise<JsonFolder> {
    const index = await this.getJsonIndex()
    const createdAt = now()
    const folder: JsonFolder = { id: randomUUID(), name: name.trim() || '未命名分组', createdAt, updatedAt: createdAt }
    index.folders.push(folder)
    index.revision += 1
    index.updatedAt = now()
    await writeJson(this.jsonIndexPath, index)
    return folder
  }

  async renameJsonFolder(id: string, name: string): Promise<JsonFolder> {
    const index = await this.getJsonIndex()
    const position = index.folders.findIndex((folder) => folder.id === id)
    if (position < 0) throw new AppError(404, 'NOT_FOUND', 'JSON 分组不存在')
    const folder = { ...index.folders[position]!, name: name.trim() || index.folders[position]!.name, updatedAt: now() }
    index.folders[position] = folder
    index.revision += 1
    index.updatedAt = now()
    await writeJson(this.jsonIndexPath, index)
    return folder
  }

  async deleteJsonFolder(id: string): Promise<void> {
    const index = await this.getJsonIndex()
    if (index.items.some((workspace) => workspace.folderId === id)) throw new AppError(409, 'FOLDER_NOT_EMPTY', '分组中还有 JSON 文件')
    if (!index.folders.some((folder) => folder.id === id)) throw new AppError(404, 'NOT_FOUND', 'JSON 分组不存在')
    index.folders = index.folders.filter((folder) => folder.id !== id)
    index.revision += 1
    index.updatedAt = now()
    await writeJson(this.jsonIndexPath, index)
  }

  async createJsonWorkspace(title = '未命名 JSON', folderId?: string): Promise<JsonWorkspace> {
    const index = await this.getJsonIndex()
    if (folderId && !index.folders.some((folder) => folder.id === folderId)) throw new AppError(404, 'FOLDER_NOT_FOUND', 'JSON 分组不存在')
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
    index.items.push(this.summary(workspace, folderId))
    index.revision += 1
    index.updatedAt = now()
    await writeJson(this.jsonIndexPath, index)
    return workspace
  }

  private workspacePath(id: string): string {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new AppError(400, 'INVALID_ID', '工作区 ID 无效')
    return join(this.workspaceRoot, `${id}.json`)
  }

  private summary(workspace: JsonWorkspace, folderId?: string): JsonWorkspaceSummary {
    const { id, title, createdAt, updatedAt } = workspace
    return { id, title, ...(folderId ? { folderId } : {}), createdAt, updatedAt }
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
    const index = await this.getJsonIndex()
    const position = index.items.findIndex((item) => item.id === workspace.id)
    if (position >= 0) index.items[position] = this.summary(workspace, index.items[position]!.folderId)
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
    const folderId = (await this.getJsonIndex()).items.find((item) => item.id === id)?.folderId
    const duplicate = await this.createJsonWorkspace(`${source.title} 副本`, folderId)
    return this.updateJsonWorkspace(copyJsonWorkspaceContent(source, duplicate))
  }

  async moveJsonWorkspace(id: string, folderId?: string): Promise<JsonWorkspaceSummary> {
    const index = await this.getJsonIndex()
    const position = index.items.findIndex((workspace) => workspace.id === id)
    if (position < 0) throw new AppError(404, 'NOT_FOUND', 'JSON 工作区不存在')
    if (folderId && !index.folders.some((folder) => folder.id === folderId)) throw new AppError(404, 'FOLDER_NOT_FOUND', 'JSON 分组不存在')
    const current = index.items[position]!
    const moved = { ...current, ...(folderId ? { folderId } : {}), updatedAt: now() }
    if (!folderId) delete moved.folderId
    index.items[position] = moved
    index.revision += 1
    index.updatedAt = now()
    await writeJson(this.jsonIndexPath, index)
    return moved
  }

  async trashJsonWorkspace(id: string): Promise<void> {
    const workspace = await this.getJsonWorkspace(id)
    const index = await this.getJsonIndex()
    const summary = index.items.find((entry) => entry.id === id)
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
      ...(summary ? { jsonWorkspace: summary } : {}),
      deletedAt: now(),
      size: buffer.byteLength,
      sha256: hashBuffer(buffer),
    }
    await writeJson(join(itemRoot, 'metadata.json'), item)
    await this.addTrashItem(item)
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
    if (position < 0) throw new AppError(404, 'SOURCE_NOT_FOUND', '文档扫描目录不存在')
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
    const value = await readJson<MarkdownUiState>(this.markdownUiPath)
    return { ...value, tocOpen: value.tocOpen ?? true, syncScroll: value.syncScroll ?? true }
  }

  async updateMarkdownUiState(next: MarkdownUiState): Promise<MarkdownUiState> {
    const current = await this.getMarkdownUiState()
    if (current.revision !== next.revision) throw new ConflictError('Markdown 视图状态已在其他窗口中修改', current)
    const value = {
      ...next,
      schemaVersion: 1 as const,
      tocOpen: next.tocOpen ?? true,
      syncScroll: next.syncScroll ?? true,
      revision: next.revision + 1,
      updatedAt: now(),
    }
    await writeJson(this.markdownUiPath, value)
    return value
  }

  async getManagedMarkdownLibrary(): Promise<ManagedMarkdownLibrary> {
    const library = await readJson<ManagedMarkdownLibrary>(this.managedMarkdownIndexPath)
    const documents = library.documents.map(normalizeManagedDocumentSummary)
    const migrated = documents.some((document, index) => document.extension !== library.documents[index]!.extension || document.previewKind !== library.documents[index]!.previewKind)
    if (!migrated) return library
    const normalized = { ...library, documents }
    await writeJson(this.managedMarkdownIndexPath, normalized)
    return normalized
  }

  private managedMarkdownDocumentPath(id: string, extension = '.md'): string {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new AppError(400, 'INVALID_ID', '文档 ID 无效')
    const type = managedDocumentType(`document${extension}`)
    return join(this.managedMarkdownFilesRoot, `${id}${type.extension}`)
  }

  async createManagedMarkdownFolder(name = '未命名分组'): Promise<ManagedMarkdownFolder> {
    const library = await this.getManagedMarkdownLibrary()
    const createdAt = now()
    const folder: ManagedMarkdownFolder = { id: randomUUID(), name: name.trim() || '未命名分组', createdAt, updatedAt: createdAt }
    library.folders.push(folder)
    library.revision += 1
    library.updatedAt = now()
    await writeJson(this.managedMarkdownIndexPath, library)
    return folder
  }

  async renameManagedMarkdownFolder(id: string, name: string): Promise<ManagedMarkdownFolder> {
    const library = await this.getManagedMarkdownLibrary()
    const position = library.folders.findIndex((folder) => folder.id === id)
    if (position < 0) throw new AppError(404, 'NOT_FOUND', 'Markdown 分组不存在')
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
      throw new AppError(409, 'FOLDER_NOT_EMPTY', '分组中还有文档')
    }
    if (!library.folders.some((folder) => folder.id === id)) throw new AppError(404, 'NOT_FOUND', 'Markdown 分组不存在')
    library.folders = library.folders.filter((folder) => folder.id !== id)
    library.revision += 1
    library.updatedAt = now()
    await writeJson(this.managedMarkdownIndexPath, library)
  }

  async createManagedMarkdownDocument(title = '未命名文档.md', folderId?: string): Promise<ManagedMarkdownDocument> {
    const library = await this.getManagedMarkdownLibrary()
    if (folderId && !library.folders.some((folder) => folder.id === folderId)) throw new AppError(404, 'FOLDER_NOT_FOUND', '文档分组不存在')
    const safeTitle = validateFileWorkbenchName(title || '未命名文档.md')
    const type = managedDocumentType(safeTitle)
    const createdAt = now()
    const summary: ManagedMarkdownDocumentSummary = {
      id: randomUUID(),
      title: safeTitle,
      ...type,
      ...(folderId ? { folderId } : {}),
      createdAt,
      updatedAt: createdAt,
      revision: 1,
    }
    await atomicWrite(this.managedMarkdownDocumentPath(summary.id, summary.extension), '')
    library.documents.push(summary)
    library.revision += 1
    library.updatedAt = now()
    await writeJson(this.managedMarkdownIndexPath, library)
    return { ...summary, content: '' }
  }

  async getManagedMarkdownDocument(id: string): Promise<ManagedMarkdownDocument> {
    const library = await this.getManagedMarkdownLibrary()
    const summary = library.documents.find((document) => document.id === id)
    if (!summary) throw new AppError(404, 'NOT_FOUND', 'BayTools 文档不存在')
    const path = this.managedMarkdownDocumentPath(id, summary.extension)
    if (!(await exists(path))) throw new AppError(404, 'NOT_FOUND', 'BayTools 文档文件不存在')
    return { ...summary, content: await readFile(path, 'utf8') }
  }

  async updateManagedMarkdownDocument(next: ManagedMarkdownDocument): Promise<ManagedMarkdownDocument> {
    const library = await this.getManagedMarkdownLibrary()
    const position = library.documents.findIndex((document) => document.id === next.id)
    if (position < 0) throw new AppError(404, 'NOT_FOUND', 'BayTools 文档不存在')
    const current = library.documents[position]!
    if (current.revision !== next.revision) throw new ConflictError('文档已在其他窗口中修改', await this.getManagedMarkdownDocument(next.id))
    const title = validateFileWorkbenchName(next.title || current.title)
    const requestedExtension = extname(title).toLowerCase()
    const currentTitleHasExtension = extname(current.title).toLowerCase() === current.extension
    if ((requestedExtension && requestedExtension !== current.extension) || (currentTitleHasExtension && !requestedExtension)) {
      throw new AppError(400, 'INVALID_EXTENSION', `重命名时不能修改或移除 ${current.extension} 扩展名`)
    }
    const summary: ManagedMarkdownDocumentSummary = {
      id: current.id,
      title,
      extension: current.extension,
      previewKind: current.previewKind,
      ...(current.folderId ? { folderId: current.folderId } : {}),
      createdAt: current.createdAt,
      updatedAt: now(),
      revision: current.revision + 1,
    }
    await atomicWrite(this.managedMarkdownDocumentPath(next.id, current.extension), next.content)
    library.documents[position] = summary
    library.revision += 1
    library.updatedAt = now()
    await writeJson(this.managedMarkdownIndexPath, library)
    return { ...summary, content: next.content }
  }

  async duplicateManagedMarkdownDocument(id: string): Promise<ManagedMarkdownDocument> {
    const source = await this.getManagedMarkdownDocument(id)
    const duplicate = await this.createManagedMarkdownDocument(managedDocumentCopyTitle(source.title, source.extension, ' 副本'), source.folderId)
    return this.updateManagedMarkdownDocument({ ...duplicate, content: source.content })
  }

  async moveManagedMarkdownDocument(id: string, folderId?: string): Promise<ManagedMarkdownDocumentSummary> {
    const library = await this.getManagedMarkdownLibrary()
    const position = library.documents.findIndex((document) => document.id === id)
    if (position < 0) throw new AppError(404, 'NOT_FOUND', 'BayTools 文档不存在')
    if (folderId && !library.folders.some((folder) => folder.id === folderId)) throw new AppError(404, 'FOLDER_NOT_FOUND', 'Markdown 分组不存在')
    const current = library.documents[position]!
    const moved = { ...current, ...(folderId ? { folderId } : {}), updatedAt: now() }
    if (!folderId) delete moved.folderId
    library.documents[position] = moved
    library.revision += 1
    library.updatedAt = now()
    await writeJson(this.managedMarkdownIndexPath, library)
    return moved
  }

  async getManagedMarkdownDocumentLocation(id: string): Promise<string> {
    const document = await this.getManagedMarkdownDocument(id)
    return this.managedMarkdownDocumentPath(id, document.extension)
  }

  async trashManagedMarkdownDocument(id: string): Promise<void> {
    const document = await this.getManagedMarkdownDocument(id)
    const library = await this.getManagedMarkdownLibrary()
    const source = this.managedMarkdownDocumentPath(id, document.extension)
    const itemId = randomUUID()
    const itemRoot = join(this.trashItemsRoot, itemId)
    await mkdir(itemRoot, { recursive: true })
    const payload = join(itemRoot, `payload${document.extension}`)
    await rename(source, payload)
    const buffer = await readFile(payload)
    const managedDocument: ManagedMarkdownDocumentSummary = {
      id: document.id,
      title: document.title,
      extension: document.extension,
      previewKind: document.previewKind,
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
    if (!source) throw new AppError(404, 'SOURCE_NOT_FOUND', '文档扫描目录不存在')
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
      } else if (entry.isFile()) {
        const info = await stat(fullPath)
        nodes.push({
          name: entry.name,
          relativePath,
          type: 'file',
          extension: extname(entry.name).toLowerCase(),
          previewKind: getFileWorkbenchPreviewKind(entry.name),
          size: info.size,
          updatedAt: info.mtime.toISOString(),
        })
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

  async createMarkdownDocument(sourceId: string, relativeDirectory: string, name: string): Promise<MarkdownDocument> {
    const safeName = validateFileWorkbenchName(name)
    const previewKind = getFileWorkbenchPreviewKind(safeName)
    if (previewKind !== 'text' && previewKind !== 'markdown') {
      throw new AppError(400, 'INVALID_DOCUMENT_TYPE', '只能新建 Markdown、文本或代码文件')
    }
    const source = await this.sourceById(sourceId)
    const root = await realpath(source.path)
    let directory = root
    let safeDirectory = ''
    if (relativeDirectory.trim()) {
      safeDirectory = ensureSafeRelative(relativeDirectory)
      const resolved = await this.resolveSourcePath(sourceId, safeDirectory)
      if (!(await stat(resolved.fullPath)).isDirectory()) throw new AppError(400, 'NOT_DIRECTORY', '新建位置不是目录')
      directory = resolved.fullPath
    }
    const target = join(directory, safeName)
    if (!pathInside(root, target)) throw new AppError(403, 'PATH_OUTSIDE_SOURCE', '新建文件位置超出扫描目录')
    let handle
    try {
      handle = await open(target, 'wx')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new AppError(409, 'NAME_CONFLICT', '同名文件已经存在')
      throw error
    } finally {
      await handle?.close()
    }
    const relativePath = safeDirectory ? `${safeDirectory.replaceAll('\\', '/')}/${safeName}` : safeName
    return this.getMarkdownDocument(sourceId, relativePath)
  }

  async getMarkdownDocument(sourceId: string, relativePath: string): Promise<MarkdownDocument> {
    const resolved = await this.resolveSourcePath(sourceId, relativePath)
    const info = await stat(resolved.fullPath)
    if (!info.isFile()) throw new AppError(400, 'NOT_A_FILE', '所选路径不是文件')
    const extension = extname(resolved.fullPath).toLowerCase()
    const previewKind = getFileWorkbenchPreviewKind(resolved.fullPath)
    const editable = (previewKind === 'text' || previewKind === 'markdown') && info.size <= FILE_WORKBENCH_TEXT_EDIT_LIMIT
    return {
      sourceId,
      relativePath: ensureSafeRelative(relativePath),
      content: editable ? await readFile(resolved.fullPath, 'utf8') : '',
      hash: await hashFile(resolved.fullPath),
      updatedAt: info.mtime.toISOString(),
      extension,
      previewKind,
      size: info.size,
      editable,
    }
  }

  async getMarkdownDocumentLocation(sourceId: string, relativePath: string): Promise<string> {
    const resolved = await this.resolveSourcePath(sourceId, relativePath)
    if (!(await stat(resolved.fullPath)).isFile()) throw new AppError(400, 'NOT_A_FILE', '所选路径不是文件')
    return resolved.fullPath
  }

  async saveMarkdownDocument(document: MarkdownDocument): Promise<MarkdownDocument> {
    const current = await this.getMarkdownDocument(document.sourceId, document.relativePath)
    if (!current.editable) throw new AppError(400, 'DOCUMENT_READ_ONLY', '该文件类型只支持预览，不能在文档工具中编辑')
    if (Buffer.byteLength(document.content, 'utf8') > FILE_WORKBENCH_TEXT_EDIT_LIMIT) throw new AppError(413, 'TEXT_TOO_LARGE', '编辑后的文本超过 10 MiB 限制')
    if (current.hash !== document.hash) throw new ConflictError('文件已被其他程序修改', current)
    await atomicWrite((await this.resolveSourcePath(document.sourceId, document.relativePath)).fullPath, document.content)
    return this.getMarkdownDocument(document.sourceId, document.relativePath)
  }

  async renameMarkdownDocument(sourceId: string, relativePath: string, nextName: string, expectedHash: string): Promise<MarkdownDocument> {
    const safeName = validateFileWorkbenchName(nextName)
    const current = await this.getMarkdownDocument(sourceId, relativePath)
    if (extname(safeName).toLowerCase() !== current.extension) throw new AppError(400, 'INVALID_EXTENSION', '重命名时不能修改文件扩展名')
    if (current.hash !== expectedHash) throw new ConflictError('文件已被其他程序修改', current)
    const { fullPath } = await this.resolveSourcePath(sourceId, relativePath)
    const target = join(dirname(fullPath), safeName)
    if (await exists(target)) throw new AppError(409, 'NAME_CONFLICT', '同名文件已经存在')
    await rename(fullPath, target)
    const nextRelative = join(dirname(ensureSafeRelative(relativePath)), safeName).replaceAll('\\', '/')
    return this.getMarkdownDocument(sourceId, nextRelative.startsWith('./') ? nextRelative.slice(2) : nextRelative)
  }

  async trashMarkdownDocument(sourceId: string, relativePath: string, expectedHash: string): Promise<void> {
    const document = await this.getMarkdownDocument(sourceId, relativePath)
    if (document.hash !== expectedHash) throw new ConflictError('文件已被其他程序修改', document)
    const { fullPath } = await this.resolveSourcePath(sourceId, relativePath)
    const itemId = randomUUID()
    const itemRoot = join(this.trashItemsRoot, itemId)
    await mkdir(itemRoot, { recursive: true })
    const payload = join(itemRoot, 'payload')
    await copyFile(fullPath, payload)
    if (await hashFile(payload) !== expectedHash) {
      await rm(itemRoot, { recursive: true, force: true })
      throw new AppError(500, 'TRASH_VERIFY_FAILED', '垃圾箱副本校验失败，原文件未删除')
    }
    const item: TrashItem = {
      id: itemId,
      kind: 'scanned-document',
      displayName: basename(fullPath),
      originalLocation: fullPath,
      originalRelativePath: ensureSafeRelative(relativePath),
      sourceId,
      deletedAt: now(),
      size: document.size,
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

  private fileWorkbenchItemRoot(id: string): string {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new AppError(400, 'INVALID_ID', '文件工作台 ID 无效')
    return join(this.fileWorkbenchItemsRoot, id)
  }

  private fileWorkbenchContentPath(item: FileWorkbenchItem): string {
    return join(this.fileWorkbenchItemRoot(item.id), 'content', validateFileWorkbenchName(item.name))
  }

  async listFileWorkbenchItems(): Promise<FileWorkbenchLibrary> {
    return readJson<FileWorkbenchLibrary>(this.fileWorkbenchIndexPath)
  }

  async getFileWorkbenchItem(id: string): Promise<FileWorkbenchItem> {
    const item = (await this.listFileWorkbenchItems()).items.find((value) => value.id === id)
    if (!item) throw new AppError(404, 'NOT_FOUND', '工作台文件不存在')
    if (!(await exists(this.fileWorkbenchContentPath(item)))) throw new AppError(404, 'FILE_MISSING', '工作台文件内容不存在')
    return item
  }

  async importFileWorkbenchFile(stream: Readable, metadata: FileWorkbenchUploadMetadata): Promise<FileWorkbenchItem> {
    const name = validateFileWorkbenchName(metadata.name)
    if (!Number.isSafeInteger(metadata.size) || metadata.size < 0 || metadata.size > FILE_WORKBENCH_MAX_UPLOAD_SIZE) {
      throw new AppError(413, 'FILE_TOO_LARGE', `单个文件不能超过 ${FILE_WORKBENCH_MAX_UPLOAD_SIZE / 1024 / 1024} MiB`)
    }
    const id = randomUUID()
    const itemRoot = this.fileWorkbenchItemRoot(id)
    const temporary = join(itemRoot, `upload.tmp-${randomUUID()}`)
    const target = join(itemRoot, 'content', name)
    const hash = createHash('sha256')
    let received = 0
    await mkdir(itemRoot, { recursive: true })
    try {
      const counter = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          received += chunk.byteLength
          if (received > FILE_WORKBENCH_MAX_UPLOAD_SIZE || received > metadata.size) {
            callback(new AppError(413, 'FILE_TOO_LARGE', '接收的文件大小超过声明值或限制'))
            return
          }
          hash.update(chunk)
          callback(null, chunk)
        },
      })
      await pipeline(stream, counter, createWriteStream(temporary, { flags: 'wx' }))
      if (received !== metadata.size) throw new AppError(400, 'SIZE_MISMATCH', '文件上传不完整，大小校验失败')
      await mkdir(dirname(target), { recursive: true })
      await rename(temporary, target)
      const createdAt = now()
      const mimeType = (metadata.mimeType ?? '').slice(0, 160)
      const item: FileWorkbenchItem = {
        schemaVersion: 1,
        id,
        importedName: name,
        name,
        description: '',
        favorite: false,
        mimeType,
        extension: extname(name).toLowerCase(),
        previewKind: getFileWorkbenchPreviewKind(name, mimeType),
        size: received,
        sha256: hash.digest('hex'),
        createdAt,
        updatedAt: createdAt,
        ...(metadata.sourceLastModified ? { sourceLastModified: metadata.sourceLastModified } : {}),
        contentRevision: 1,
        metadataRevision: 1,
      }
      await writeJson(join(itemRoot, 'metadata.json'), item)
      const library = await this.listFileWorkbenchItems()
      library.items.push(item)
      library.revision += 1
      library.updatedAt = now()
      await writeJson(this.fileWorkbenchIndexPath, library)
      return item
    } catch (error) {
      await rm(itemRoot, { recursive: true, force: true })
      throw error
    }
  }

  async updateFileWorkbenchMetadata(id: string, patch: FileWorkbenchMetadataPatch): Promise<FileWorkbenchItem> {
    const library = await this.listFileWorkbenchItems()
    const position = library.items.findIndex((value) => value.id === id)
    if (position < 0) throw new AppError(404, 'NOT_FOUND', '工作台文件不存在')
    const current = library.items[position]!
    if (current.metadataRevision !== patch.metadataRevision) throw new ConflictError('文件元数据已在其他窗口中修改', current)
    let name = current.name
    if (patch.name !== undefined) name = validateFileWorkbenchName(patch.name)
    if (patch.description !== undefined && patch.description.length > 1000) throw new AppError(400, 'DESCRIPTION_TOO_LONG', '文件描述不能超过 1000 个字符')
    if (name !== current.name) {
      const source = this.fileWorkbenchContentPath(current)
      const target = join(this.fileWorkbenchItemRoot(id), 'content', name)
      if (await exists(target)) throw new AppError(409, 'NAME_CONFLICT', '同名文件已经存在')
      await rename(source, target)
    }
    const updatedAt = now()
    const next: FileWorkbenchItem = {
      ...current,
      name,
      description: patch.description ?? current.description,
      favorite: patch.favorite ?? current.favorite,
      ...(patch.favorite === true && !current.favorite ? { favoritedAt: updatedAt } : current.favoritedAt ? { favoritedAt: current.favoritedAt } : {}),
      extension: extname(name).toLowerCase(),
      previewKind: getFileWorkbenchPreviewKind(name, current.mimeType),
      updatedAt,
      metadataRevision: current.metadataRevision + 1,
    }
    if (!next.favorite) delete next.favoritedAt
    library.items[position] = next
    library.revision += 1
    library.updatedAt = updatedAt
    await writeJson(join(this.fileWorkbenchItemRoot(id), 'metadata.json'), next)
    await writeJson(this.fileWorkbenchIndexPath, library)
    return next
  }

  async getFileWorkbenchText(id: string): Promise<FileWorkbenchTextDocument> {
    const item = await this.getFileWorkbenchItem(id)
    if (item.previewKind !== 'text' && item.previewKind !== 'markdown') throw new AppError(400, 'NOT_TEXT', '该文件不是可编辑文本')
    if (item.size > FILE_WORKBENCH_TEXT_EDIT_LIMIT) throw new AppError(413, 'TEXT_TOO_LARGE', '文件过大，已禁止在浏览器中完整载入编辑器')
    const path = this.fileWorkbenchContentPath(item)
    const content = await readFile(path, 'utf8')
    return { id, content, sha256: await hashFile(path), contentRevision: item.contentRevision, updatedAt: item.updatedAt }
  }

  async saveFileWorkbenchText(document: FileWorkbenchTextDocument): Promise<FileWorkbenchTextDocument> {
    if (Buffer.byteLength(document.content, 'utf8') > FILE_WORKBENCH_TEXT_EDIT_LIMIT) throw new AppError(413, 'TEXT_TOO_LARGE', '编辑后的文本超过大小限制')
    const library = await this.listFileWorkbenchItems()
    const position = library.items.findIndex((value) => value.id === document.id)
    if (position < 0) throw new AppError(404, 'NOT_FOUND', '工作台文件不存在')
    const item = library.items[position]!
    const path = this.fileWorkbenchContentPath(item)
    const currentHash = await hashFile(path)
    if (item.contentRevision !== document.contentRevision || currentHash !== document.sha256) {
      throw new ConflictError('工作台文件内容已经改变', await this.getFileWorkbenchText(document.id))
    }
    await atomicWrite(path, document.content)
    const updatedAt = now()
    const info = await stat(path)
    const next: FileWorkbenchItem = { ...item, size: info.size, sha256: await hashFile(path), updatedAt, contentRevision: item.contentRevision + 1 }
    library.items[position] = next
    library.revision += 1
    library.updatedAt = updatedAt
    await writeJson(join(this.fileWorkbenchItemRoot(item.id), 'metadata.json'), next)
    await writeJson(this.fileWorkbenchIndexPath, library)
    return { id: item.id, content: document.content, sha256: next.sha256, contentRevision: next.contentRevision, updatedAt }
  }

  async getFileWorkbenchItemLocation(id: string): Promise<string> {
    return this.fileWorkbenchContentPath(await this.getFileWorkbenchItem(id))
  }

  async trashFileWorkbenchItem(id: string): Promise<void> {
    const item = await this.getFileWorkbenchItem(id)
    const library = await this.listFileWorkbenchItems()
    const trashId = randomUUID()
    const trashRoot = join(this.trashItemsRoot, trashId)
    const payload = join(trashRoot, 'payload')
    const sourceRoot = this.fileWorkbenchItemRoot(id)
    await mkdir(trashRoot, { recursive: true })
    const trashItem: TrashItem = {
      id: trashId,
      kind: 'file-workbench',
      displayName: item.name,
      originalLocation: this.fileWorkbenchContentPath(item),
      fileWorkbenchItem: item,
      deletedAt: now(),
      size: item.size,
      sha256: item.sha256,
    }
    await writeJson(join(trashRoot, 'metadata.json'), trashItem)
    try {
      await moveDirectoryWithVerifiedFile(sourceRoot, payload, join('content', validateFileWorkbenchName(item.name)), item.sha256)
    } catch (error) {
      await rm(trashRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }).catch(() => undefined)
      throw error
    }
    library.items = library.items.filter((value) => value.id !== id)
    library.revision += 1
    library.updatedAt = now()
    await writeJson(this.fileWorkbenchIndexPath, library)
    await this.addTrashItem(trashItem)
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
    if (item.kind === 'code-card') {
      if (!item.codeCardWorkspace) throw new AppError(500, 'INVALID_TRASH_ITEM', '代码段垃圾项缺少页签信息')
      const payloadRoot = join(itemRoot, 'payload')
      const payloadWorkspace = join(payloadRoot, 'workspace.json')
      if (await hashFile(payloadWorkspace) !== item.sha256) throw new AppError(500, 'RESTORE_VERIFY_FAILED', '垃圾箱中的代码段校验失败')
      const source = await readJson<CodeCardWorkspace>(payloadWorkspace)
      const library = await readJson<CodeCardLibrary>(this.codeCardIndexPath)
      const folderId = source.folderId && library.folders.some((folder) => folder.id === source.folderId) ? source.folderId : undefined
      const conflict = library.workspaces.some((workspace) => workspace.id === source.id)
        || await exists(join(this.codeCardWorkspaceRoot, `${source.id}.json`))
        || await exists(join(this.codeCardImagesRoot, source.id))
      if (conflict && !asCopy) throw new AppError(409, 'RESTORE_CONFLICT', '同 ID 代码段已经存在')
      const restoredAt = now()
      const restored: CodeCardWorkspace = conflict ? {
        ...source,
        id: randomUUID(),
        title: `${source.title}（已恢复）`,
        ...(folderId ? { folderId } : {}),
        revision: 1,
        createdAt: restoredAt,
        updatedAt: restoredAt,
      } : { ...source, ...(folderId ? { folderId } : {}), updatedAt: restoredAt }
      if (!folderId) delete restored.folderId
      const targetWorkspace = join(this.codeCardWorkspaceRoot, `${restored.id}.json`)
      const targetImages = join(this.codeCardImagesRoot, restored.id)
      try {
        await writeJson(targetWorkspace, restored)
        const payloadImages = join(payloadRoot, 'images')
        if (await exists(payloadImages)) await cp(payloadImages, targetImages, { recursive: true })
        for (const card of restored.cards) {
          if (!card.image) continue
          const fileName = validateCodeCardImageName(card.image.fileName)
          const image = join(targetImages, fileName)
          if (!(await exists(image)) || (await stat(image)).size !== card.image.size) throw new AppError(500, 'RESTORE_VERIFY_FAILED', '代码段图片恢复校验失败')
        }
        library.workspaces.push({ id: restored.id, title: restored.title, ...(folderId ? { folderId } : {}), createdAt: restored.createdAt, updatedAt: restored.updatedAt })
        library.revision += 1
        library.updatedAt = restoredAt
        await writeJson(this.codeCardIndexPath, library)
      } catch (error) {
        await Promise.all([rm(targetWorkspace, { force: true }), rm(targetImages, { recursive: true, force: true })])
        throw error
      }
      await this.removeTrashItem(index, item)
      return { restoredLocation: targetWorkspace, workspaceId: restored.id }
    }
    if (item.kind === 'json-workspace') {
      const { workspace } = migrateJsonWorkspace(await readJson<JsonWorkspace | LegacyJsonWorkspace>(join(itemRoot, 'payload.json')))
      const jsonIndex = await this.getJsonIndex()
      const folderId = item.jsonWorkspace?.folderId && jsonIndex.folders.some((folder) => folder.id === item.jsonWorkspace!.folderId)
        ? item.jsonWorkspace.folderId
        : undefined
      let restored = workspace
      let target = this.workspacePath(workspace.id)
      if (await exists(target)) {
        if (!asCopy) throw new AppError(409, 'RESTORE_CONFLICT', '同 ID 工作区已经存在')
        const created = await this.createJsonWorkspace(`${workspace.title}（已恢复）`, folderId)
        restored = await this.updateJsonWorkspace(copyJsonWorkspaceContent(workspace, created))
        target = this.workspacePath(restored.id)
      } else {
        await writeJson(target, workspace)
        await this.updateJsonSummary(restored)
        if (folderId) await this.moveJsonWorkspace(restored.id, folderId)
      }
      await this.removeTrashItem(index, item)
      return { restoredLocation: target, workspaceId: restored.id }
    }

    if (item.kind === 'file-workbench') {
      if (!item.fileWorkbenchItem) throw new AppError(500, 'INVALID_TRASH_ITEM', '文件工作台垃圾项缺少元数据')
      const library = await this.listFileWorkbenchItems()
      const payload = join(itemRoot, 'payload')
      const payloadFile = join(payload, 'content', validateFileWorkbenchName(item.fileWorkbenchItem.name))
      if (await hashFile(payloadFile) !== item.sha256) throw new AppError(500, 'RESTORE_VERIFY_FAILED', '垃圾箱中的工作台文件校验失败')
      let restored = item.fileWorkbenchItem
      let targetRoot = this.fileWorkbenchItemRoot(restored.id)
      if (await exists(targetRoot) || library.items.some((value) => value.id === restored.id)) {
        if (!asCopy) throw new AppError(409, 'RESTORE_CONFLICT', '同 ID 工作台文件已经存在')
        restored = { ...restored, id: randomUUID(), name: `${basename(restored.name, restored.extension)}（已恢复）${restored.extension}`, createdAt: now(), updatedAt: now(), metadataRevision: 1 }
        targetRoot = this.fileWorkbenchItemRoot(restored.id)
      }
      await moveDirectoryWithVerifiedFile(payload, targetRoot, join('content', validateFileWorkbenchName(item.fileWorkbenchItem.name)), item.sha256)
      if (restored.id !== item.fileWorkbenchItem.id || restored.name !== item.fileWorkbenchItem.name) {
        await rename(join(targetRoot, 'content', item.fileWorkbenchItem.name), join(targetRoot, 'content', restored.name))
      }
      await writeJson(join(targetRoot, 'metadata.json'), restored)
      library.items.push(restored)
      library.revision += 1
      library.updatedAt = now()
      await writeJson(this.fileWorkbenchIndexPath, library)
      await this.removeTrashItem(index, item)
      return { restoredLocation: join(targetRoot, 'content', restored.name), fileWorkbenchId: restored.id }
    }

    if (item.kind === 'managed-markdown') {
      if (!item.managedDocument) throw new AppError(500, 'INVALID_TRASH_ITEM', 'Markdown 垃圾项缺少文档信息')
      const managedDocument = normalizeManagedDocumentSummary(item.managedDocument)
      const typedPayload = join(itemRoot, `payload${managedDocument.extension}`)
      const payload = await exists(typedPayload) ? typedPayload : join(itemRoot, 'payload.md')
      const content = await readFile(payload, 'utf8')
      const library = await this.getManagedMarkdownLibrary()
      const target = this.managedMarkdownDocumentPath(managedDocument.id, managedDocument.extension)
      if (await exists(target) || library.documents.some((document) => document.id === managedDocument.id)) {
        if (!asCopy) throw new AppError(409, 'RESTORE_CONFLICT', '同 ID 文档已经存在')
        const folderId = managedDocument.folderId && library.folders.some((folder) => folder.id === managedDocument.folderId)
          ? managedDocument.folderId
          : undefined
        const created = await this.createManagedMarkdownDocument(managedDocumentCopyTitle(managedDocument.title, managedDocument.extension, '（已恢复）'), folderId)
        const restored = await this.updateManagedMarkdownDocument({ ...created, content })
        await this.removeTrashItem(index, item)
        return { restoredLocation: this.managedMarkdownDocumentPath(restored.id, restored.extension) }
      }
      const folderId = managedDocument.folderId && library.folders.some((folder) => folder.id === managedDocument.folderId)
        ? managedDocument.folderId
        : undefined
      const restored: ManagedMarkdownDocumentSummary = { ...managedDocument, ...(folderId ? { folderId } : {}), updatedAt: now() }
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

    if (item.kind === 'scanned-document') {
      const payload = join(itemRoot, 'payload')
      if (await hashFile(payload) !== item.sha256) throw new AppError(500, 'RESTORE_VERIFY_FAILED', '垃圾箱中的文档校验失败')
      let target = targetDirectory ? join(await realpath(targetDirectory), item.displayName) : item.originalLocation
      if (!(await exists(dirname(target)))) throw new AppError(409, 'RESTORE_DIRECTORY_MISSING', '原目录不存在，请选择新的恢复目录')
      if (await exists(target)) {
        if (!asCopy) throw new AppError(409, 'RESTORE_CONFLICT', '原位置已经存在同名文件')
        const extension = extname(target)
        const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16)
        target = join(dirname(target), `${basename(target, extension)}.restored-${stamp}${extension}`)
      }
      await copyFile(payload, target)
      if (await hashFile(target) !== item.sha256) {
        await rm(target, { force: true })
        throw new AppError(500, 'RESTORE_VERIFY_FAILED', '恢复文件校验失败')
      }
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
