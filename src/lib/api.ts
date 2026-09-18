import type {
  ApiFailure,
  AppSettings,
  CodeCardFolder,
  CodeCardLibrary,
  CodeCardSearchPage,
  CodeCardWorkspace,
  CodeCardWorkspaceSummary,
  ColorState,
  ConfigTableCellMatch,
  ConfigTableFilePage,
  ConfigTableRange,
  ConfigTableSearchMode,
  ConfigTableState,
  ConfigTableWorkbook,
  FileWorkbenchItem,
  FileWorkbenchLibrary,
  FileWorkbenchMetadataPatch,
  FileWorkbenchTextDocument,
  JsonFolder,
  JsonScratchpad,
  JsonWorkspace,
  JsonWorkspaceSummary,
  LanguageEntryPage,
  LanguageSource,
  LanguageSourceSummary,
  LocalBridge,
  ManagedMarkdownDocument,
  ManagedMarkdownDocumentSummary,
  ManagedMarkdownFolder,
  ManagedMarkdownLibrary,
  MarkdownDocument,
  MarkdownSource,
  MarkdownSourceTree,
  MarkdownUiState,
  PersonalDataStatus,
  PersonalDataPublishResult,
  PersonalDataSyncResult,
  RestoreResult,
  ServiceRestartResult,
  ServiceSession,
  ServerStatusState,
  ShortcutResult,
  TrashItem,
} from '../../shared/types'
import type { TranslationConfig, TranslationEntry, TranslationEvent, TranslationInput } from '../../shared/translation'

export class ApiError extends Error {
  constructor(public readonly status: number, public readonly code?: string, public readonly details?: unknown, message = '请求失败') {
    super(message)
  }
}

let tokenPromise: Promise<string> | undefined

async function token(): Promise<string> {
  tokenPromise ??= fetch('/api/session').then(async (response) => {
    if (!response.ok) throw new Error('无法建立本地会话')
    return ((await response.json()) as { token: string }).token
  })
  return tokenPromise
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const method = options?.method ?? 'GET'
  const headers = new Headers(options?.headers)
  if (options?.body && !(options.body instanceof FormData) && !(options.body instanceof Blob)) headers.set('content-type', 'application/json')
  if (!['GET', 'HEAD'].includes(method)) headers.set('x-baytools-token', await token())
  const response = await fetch(path, { ...options, headers })
  if (!response.ok) {
    const failure = await response.json().catch(() => ({ error: response.statusText })) as ApiFailure
    throw new ApiError(response.status, failure.code, failure.details, failure.error)
  }
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

async function uploadFile(file: File): Promise<FileWorkbenchItem> {
  const headers = new Headers({
    'content-type': 'application/octet-stream',
    'x-baytools-token': await token(),
    'x-file-name': encodeURIComponent(file.name),
    'x-file-type': encodeURIComponent(file.type),
    'x-file-size': String(file.size),
    'x-file-last-modified': String(file.lastModified),
  })
  const response = await fetch('/api/file-workbench', { method: 'POST', headers, body: file })
  if (!response.ok) {
    const failure = await response.json().catch(() => ({ error: response.statusText })) as ApiFailure
    throw new ApiError(response.status, failure.code, failure.details, failure.error)
  }
  return response.json() as Promise<FileWorkbenchItem>
}

async function uploadCodeCardImage(workspaceId: string, cardId: string, image: Blob, width: number, height: number, revision: number): Promise<CodeCardWorkspace> {
  const headers = new Headers({
    'content-type': 'application/octet-stream',
    'x-baytools-token': await token(),
    'x-image-type': encodeURIComponent(image.type),
    'x-image-size': String(image.size),
    'x-image-width': String(width),
    'x-image-height': String(height),
    'x-workspace-revision': String(revision),
  })
  const response = await fetch(`/api/code-cards/workspaces/${encodeURIComponent(workspaceId)}/cards/${encodeURIComponent(cardId)}/image`, { method: 'PUT', headers, body: image })
  if (!response.ok) {
    const failure = await response.json().catch(() => ({ error: response.statusText })) as ApiFailure
    throw new ApiError(response.status, failure.code, failure.details, failure.error)
  }
  return response.json() as Promise<CodeCardWorkspace>
}

const query = (values: Record<string, string>) => new URLSearchParams(values).toString()

export const translationApi = {
  getConfig: () => request<TranslationConfig>('/api/translation/config', { cache: 'no-store' }),
  saveKey: (apiKey: string) => request<TranslationConfig>('/api/translation/config', { method: 'PUT', body: JSON.stringify({ apiKey }) }),
  deleteKey: () => request<TranslationConfig>('/api/translation/config', { method: 'DELETE' }),
  testConnection: () => request<{ message: string }>('/api/translation/test', { method: 'POST', body: '{}' }),
  listHistory: () => request<TranslationEntry[]>('/api/translation/history', { cache: 'no-store' }),
  deleteHistory: (id?: string) => request<void>(`/api/translation/history${id ? `/${encodeURIComponent(id)}` : ''}`, { method: 'DELETE' }),
  async translate(input: TranslationInput, signal: AbortSignal, onEvent: (event: TranslationEvent) => void): Promise<void> {
    const response = await fetch('/api/translation/translate', {
      method: 'POST', signal, headers: { 'content-type': 'application/json', 'x-baytools-token': await token() }, body: JSON.stringify(input),
    })
    if (!response.ok) {
      const failure = await response.json().catch(() => ({ error: response.statusText })) as ApiFailure
      throw new ApiError(response.status, failure.code, failure.details, failure.error)
    }
    if (!response.body) throw new Error('翻译连接未建立，请重试')
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let pending = ''
    let complete = false
    const consume = (line: string) => {
      if (!line.trim()) return
      const event = JSON.parse(line) as TranslationEvent
      if (event.type === 'error') throw new ApiError(502, event.code, undefined, event.error)
      if (event.type === 'complete') complete = true
      onEvent(event)
    }
    try {
      while (true) {
        const { done, value } = await reader.read()
        pending += done ? decoder.decode() : decoder.decode(value, { stream: true })
        let end: number
        while ((end = pending.indexOf('\n')) >= 0) { consume(pending.slice(0, end)); pending = pending.slice(end + 1) }
        if (done) { consume(pending); break }
      }
      if (!complete) throw new Error('翻译连接中断，本次译文可能不完整，请重试')
    } finally { await reader.cancel().catch(() => undefined); reader.releaseLock() }
  },
}

export const localBridge: LocalBridge = {
  getSettings: () => request<AppSettings>('/api/settings'),
  updateSettings: (settings) => request<AppSettings>('/api/settings', { method: 'PUT', body: JSON.stringify(settings) }),
  listJsonWorkspaces: () => request<JsonWorkspaceSummary[]>('/api/json-workspaces'),
  listJsonFolders: () => request<JsonFolder[]>('/api/json-folders'),
  createJsonWorkspace: (title, folderId) => request<JsonWorkspace>('/api/json-workspaces', { method: 'POST', body: JSON.stringify({ title, folderId }) }),
  getJsonWorkspace: (id) => request<JsonWorkspace>(`/api/json-workspaces/${id}`),
  updateJsonWorkspace: (workspace) => request<JsonWorkspace>(`/api/json-workspaces/${workspace.id}`, { method: 'PUT', body: JSON.stringify(workspace) }),
  renameJsonWorkspace: (id, title) => request<JsonWorkspaceSummary>(`/api/json-workspaces/${id}/rename`, { method: 'POST', body: JSON.stringify({ title }) }),
  duplicateJsonWorkspace: (id) => request<JsonWorkspace>(`/api/json-workspaces/${id}/duplicate`, { method: 'POST', body: '{}' }),
  moveJsonWorkspace: (id, folderId) => request<JsonWorkspaceSummary>(`/api/json-workspaces/${id}/folder`, { method: 'PATCH', body: JSON.stringify({ folderId: folderId ?? null }) }),
  trashJsonWorkspace: (id) => request<void>(`/api/json-workspaces/${id}/trash`, { method: 'POST', body: '{}' }),
  revealJsonWorkspace: (id) => request<void>(`/api/json-workspaces/${id}/reveal`, { method: 'POST', body: '{}' }),
  getJsonWorkspaceFilePath: async (id) => (await request<{ path: string }>(`/api/json-workspaces/${id}/location`)).path,
  createJsonFolder: (name) => request<JsonFolder>('/api/json-folders', { method: 'POST', body: JSON.stringify({ name }) }),
  renameJsonFolder: (id, name) => request<JsonFolder>(`/api/json-folders/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) }),
  deleteJsonFolder: (id) => request<void>(`/api/json-folders/${id}`, { method: 'DELETE' }),
  getJsonScratchpad: () => request<JsonScratchpad>('/api/json-scratchpad'),
  updateJsonScratchpad: (scratchpad) => request<JsonScratchpad>('/api/json-scratchpad', { method: 'PUT', body: JSON.stringify(scratchpad) }),
  getColors: () => request<ColorState>('/api/colors'),
  updateColors: (state) => request<ColorState>('/api/colors', { method: 'PUT', body: JSON.stringify(state) }),
  selectDirectory: async () => (await request<{ path: string | null }>('/api/system/select-directory', { method: 'POST', body: '{}' })).path,
  createShortcut: (location) => request<ShortcutResult>('/api/system/shortcut', { method: 'POST', body: JSON.stringify({ location }) }),
  getServiceSession: () => request<ServiceSession>('/api/session', { cache: 'no-store' }),
  restartService: () => request<ServiceRestartResult>('/api/system/restart', { method: 'POST', body: '{}' }),
  getPersonalDataStatus: () => request<PersonalDataStatus>('/api/personal-data/status'),
  syncPersonalData: (force) => request<PersonalDataSyncResult>('/api/personal-data/sync', { method: 'POST', body: JSON.stringify({ force }) }),
  restorePersonalData: (confirm) => request<PersonalDataSyncResult>('/api/personal-data/restore', { method: 'POST', body: JSON.stringify({ confirm }) }),
  publishPersonalData: (confirm, force) => request<PersonalDataPublishResult>('/api/personal-data/publish', { method: 'POST', body: JSON.stringify({ confirm, force }) }),
  listMarkdownSources: () => request<MarkdownSource[]>('/api/markdown/sources'),
  addMarkdownSource: (path) => request<MarkdownSource>('/api/markdown/sources', { method: 'POST', body: JSON.stringify({ path }) }),
  updateMarkdownSourceNote: (id, note) => request<MarkdownSource>(`/api/markdown/sources/${id}`, { method: 'PATCH', body: JSON.stringify({ note }) }),
  removeMarkdownSource: (id) => request<void>(`/api/markdown/sources/${id}`, { method: 'DELETE' }),
  revealMarkdownSource: (id) => request<void>(`/api/markdown/sources/${id}/reveal`, { method: 'POST', body: '{}' }),
  scanMarkdownSources: () => request<MarkdownSourceTree[]>('/api/markdown/tree'),
  createMarkdownDocument: (sourceId, relativeDirectory, name) => request<MarkdownDocument>('/api/markdown/document/create', { method: 'POST', body: JSON.stringify({ sourceId, relativeDirectory, name }) }),
  getMarkdownDocument: (sourceId, relativePath) => request<MarkdownDocument>(`/api/markdown/document?${query({ sourceId, path: relativePath })}`),
  saveMarkdownDocument: (document) => request<MarkdownDocument>('/api/markdown/document', { method: 'PUT', body: JSON.stringify(document) }),
  renameMarkdownDocument: (sourceId, relativePath, nextName, hash) => request<MarkdownDocument>('/api/markdown/document/rename', { method: 'POST', body: JSON.stringify({ sourceId, path: relativePath, nextName, hash }) }),
  trashMarkdownDocument: (sourceId, relativePath, hash) => request<void>('/api/markdown/document/trash', { method: 'POST', body: JSON.stringify({ sourceId, path: relativePath, hash }) }),
  revealMarkdownDocument: (sourceId, relativePath) => request<void>('/api/markdown/document/reveal', { method: 'POST', body: JSON.stringify({ sourceId, path: relativePath }) }),
  getMarkdownDocumentFilePath: async (sourceId, relativePath) => (await request<{ path: string }>(`/api/markdown/document/location?${query({ sourceId, path: relativePath })}`)).path,
  getManagedMarkdownLibrary: () => request<ManagedMarkdownLibrary>('/api/markdown/managed'),
  createManagedMarkdownDocument: (title, folderId) => request<ManagedMarkdownDocument>('/api/markdown/managed/documents', { method: 'POST', body: JSON.stringify({ title, folderId }) }),
  getManagedMarkdownDocument: (id) => request<ManagedMarkdownDocument>(`/api/markdown/managed/documents/${id}`),
  updateManagedMarkdownDocument: (document) => request<ManagedMarkdownDocument>(`/api/markdown/managed/documents/${document.id}`, { method: 'PUT', body: JSON.stringify(document) }),
  duplicateManagedMarkdownDocument: (id) => request<ManagedMarkdownDocument>(`/api/markdown/managed/documents/${id}/duplicate`, { method: 'POST', body: '{}' }),
  moveManagedMarkdownDocument: (id, folderId) => request<ManagedMarkdownDocumentSummary>(`/api/markdown/managed/documents/${id}/folder`, { method: 'PATCH', body: JSON.stringify({ folderId: folderId ?? null }) }),
  trashManagedMarkdownDocument: (id) => request<void>(`/api/markdown/managed/documents/${id}/trash`, { method: 'POST', body: '{}' }),
  revealManagedMarkdownDocument: (id) => request<void>(`/api/markdown/managed/documents/${id}/reveal`, { method: 'POST', body: '{}' }),
  getManagedMarkdownDocumentFilePath: async (id) => (await request<{ path: string }>(`/api/markdown/managed/documents/${id}/location`)).path,
  createManagedMarkdownFolder: (name) => request<ManagedMarkdownFolder>('/api/markdown/managed/folders', { method: 'POST', body: JSON.stringify({ name }) }),
  renameManagedMarkdownFolder: (id, name) => request<ManagedMarkdownFolder>(`/api/markdown/managed/folders/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) }),
  deleteManagedMarkdownFolder: (id) => request<void>(`/api/markdown/managed/folders/${id}`, { method: 'DELETE' }),
  getMarkdownUiState: () => request<MarkdownUiState>('/api/markdown/ui-state'),
  updateMarkdownUiState: (state) => request<MarkdownUiState>('/api/markdown/ui-state', { method: 'PUT', body: JSON.stringify(state) }),
  listLanguageSources: () => request<LanguageSourceSummary[]>('/api/languages'),
  createLanguageSource: () => request<LanguageSource>('/api/languages', { method: 'POST', body: '{}' }),
  getLanguageSource: (id) => request<LanguageSource>(`/api/languages/${id}`),
  deleteLanguageSource: (id) => request<void>(`/api/languages/${id}`, { method: 'DELETE' }),
  syncLanguageSource: (id, url) => request<LanguageSource>(`/api/languages/${id}/sync`, { method: 'POST', body: JSON.stringify({ url }) }),
  searchLanguageEntries: (id, search, page, mode) => request<LanguageEntryPage>(`/api/languages/${id}/search?${query({ search, page: String(page), mode })}`),
  searchLanguageFavorites: (id, search, page, mode) => request<LanguageEntryPage>(`/api/languages/${id}/favorites?${query({ search, page: String(page), mode })}`),
  setLanguageFavorite: (id, key, favorite, revision) => request<LanguageSource>(`/api/languages/${id}/favorites`, { method: 'PUT', body: JSON.stringify({ key, favorite, revision }) }),
  getServerStatus: () => request<ServerStatusState>('/api/server-status'),
  syncServerStatus: (url) => request<ServerStatusState>('/api/server-status/sync', { method: 'POST', body: JSON.stringify({ url }) }),
  getConfigTableState: () => request<ConfigTableState>('/api/config-tables'),
  setConfigTableRoot: (path) => request<ConfigTableState>('/api/config-tables/root', { method: 'PUT', body: JSON.stringify({ path }) }),
  refreshConfigTableLocal: () => request<ConfigTableState>('/api/config-tables/refresh-local', { method: 'POST', body: '{}' }),
  syncConfigTableRemote: () => request<ConfigTableState>('/api/config-tables/sync-remote', { method: 'POST', body: '{}' }),
  setConfigTableBranchPinned: (branch, pinned) => request<ConfigTableState>(`/api/config-tables/branches/${encodeURIComponent(branch)}/pin`, { method: 'PATCH', body: JSON.stringify({ pinned }) }),
  scanConfigTableBranch: (branch) => request<ConfigTableState>(`/api/config-tables/branches/${encodeURIComponent(branch)}/scan`, { method: 'POST', body: '{}' }),
  updateConfigTableBranch: (branch) => request<ConfigTableState>(`/api/config-tables/branches/${encodeURIComponent(branch)}/update`, { method: 'POST', body: '{}' }),
  downloadConfigTableBranch: (branch) => request<ConfigTableState>(`/api/config-tables/branches/${encodeURIComponent(branch)}/download`, { method: 'POST', body: '{}' }),
  searchConfigTableFiles: (branch, includeDev, search, mode: ConfigTableSearchMode, page) => request<ConfigTableFilePage>(`/api/config-tables/files?${query({ branch, includeDev: includeDev ? '1' : '0', search, mode, page: String(page) })}`),
  getConfigTableWorkbook: (branch, relativePath) => request<ConfigTableWorkbook>(`/api/config-tables/workbook?${query({ branch, path: relativePath })}`),
  refreshConfigTableWorkbook: (branch, relativePath) => request<ConfigTableWorkbook>('/api/config-tables/workbook/refresh', { method: 'POST', body: JSON.stringify({ branch, path: relativePath }) }),
  getConfigTableRange: (branch, relativePath, sheet, startRow, rowCount, startColumn, columnCount) => request<ConfigTableRange>(`/api/config-tables/range?${query({ branch, path: relativePath, sheet, startRow: String(startRow), rowCount: String(rowCount), startColumn: String(startColumn), columnCount: String(columnCount) })}`),
  searchConfigTableCells: (branch, relativePath, sheet, search) => request<ConfigTableCellMatch[]>(`/api/config-tables/cell-search?${query({ branch, path: relativePath, sheet, search })}`),
  revealConfigTableFile: (branch, relativePath) => request<void>('/api/config-tables/file/reveal', { method: 'POST', body: JSON.stringify({ branch, path: relativePath }) }),
  revealConfigTableBranch: (branch) => request<void>('/api/config-tables/branch/reveal', { method: 'POST', body: JSON.stringify({ branch }) }),
  openConfigTableFile: (branch, relativePath) => request<void>('/api/config-tables/file/open', { method: 'POST', body: JSON.stringify({ branch, path: relativePath }) }),
  getConfigTableFilePath: async (branch, relativePath) => (await request<{ path: string }>(`/api/config-tables/file/location?${query({ branch, path: relativePath })}`)).path,
  listFileWorkbenchItems: () => request<FileWorkbenchLibrary>('/api/file-workbench'),
  uploadFileWorkbenchFile: uploadFile,
  updateFileWorkbenchMetadata: (id: string, patch: FileWorkbenchMetadataPatch) => request<FileWorkbenchItem>(`/api/file-workbench/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  getFileWorkbenchText: (id: string) => request<FileWorkbenchTextDocument>(`/api/file-workbench/${id}/text`),
  saveFileWorkbenchText: (document: FileWorkbenchTextDocument) => request<FileWorkbenchTextDocument>(`/api/file-workbench/${document.id}/text`, { method: 'PUT', body: JSON.stringify(document) }),
  trashFileWorkbenchItem: (id: string) => request<void>(`/api/file-workbench/${id}/trash`, { method: 'POST', body: '{}' }),
  revealFileWorkbenchItem: (id: string) => request<void>(`/api/file-workbench/${id}/reveal`, { method: 'POST', body: '{}' }),
  getFileWorkbenchItemPath: async (id: string) => (await request<{ path: string }>(`/api/file-workbench/${id}/location`)).path,
  getCodeCardLibrary: () => request<CodeCardLibrary>('/api/code-cards'),
  searchCodeCards: (search, page, mode) => {
    const query = new URLSearchParams({ search, page: String(page), mode })
    return request<CodeCardSearchPage>(`/api/code-cards/search?${query}`)
  },
  createCodeCardWorkspace: (title, folderId) => request<CodeCardWorkspace>('/api/code-cards/workspaces', { method: 'POST', body: JSON.stringify({ title, folderId }) }),
  getCodeCardWorkspace: (id) => request<CodeCardWorkspace>(`/api/code-cards/workspaces/${id}`),
  updateCodeCardWorkspace: (workspace) => request<CodeCardWorkspace>(`/api/code-cards/workspaces/${workspace.id}`, { method: 'PUT', body: JSON.stringify(workspace) }),
  renameCodeCardWorkspace: (id, title) => request<CodeCardWorkspaceSummary>(`/api/code-cards/workspaces/${id}/title`, { method: 'PATCH', body: JSON.stringify({ title }) }),
  moveCodeCardWorkspace: (id, folderId) => request<CodeCardWorkspaceSummary>(`/api/code-cards/workspaces/${id}/folder`, { method: 'PATCH', body: JSON.stringify({ folderId: folderId ?? null }) }),
  trashCodeCardWorkspace: (id) => request<void>(`/api/code-cards/workspaces/${id}/trash`, { method: 'POST', body: '{}' }),
  createCodeCardFolder: (name) => request<CodeCardFolder>('/api/code-cards/folders', { method: 'POST', body: JSON.stringify({ name }) }),
  renameCodeCardFolder: (id, name) => request<CodeCardFolder>(`/api/code-cards/folders/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) }),
  deleteCodeCardFolder: (id) => request<void>(`/api/code-cards/folders/${id}`, { method: 'DELETE' }),
  uploadCodeCardImage,
  deleteCodeCardImage: (workspaceId, cardId, revision) => request<CodeCardWorkspace>(`/api/code-cards/workspaces/${workspaceId}/cards/${cardId}/image`, { method: 'DELETE', body: JSON.stringify({ revision }) }),
  listTrash: () => request<TrashItem[]>('/api/trash'),
  restoreTrash: (id, asCopy, targetDirectory) => request<RestoreResult>(`/api/trash/${id}/restore`, { method: 'POST', body: JSON.stringify({ asCopy, targetDirectory }) }),
  deleteTrash: (id) => request<void>(`/api/trash/${id}`, { method: 'DELETE' }),
  emptyTrash: () => request<void>('/api/trash', { method: 'DELETE' }),
}

export function fileWorkbenchContentUrl(id: string, download = false): string {
  return `/api/file-workbench/${encodeURIComponent(id)}/content${download ? '?download=1' : ''}`
}

export function codeCardImageUrl(workspaceId: string, cardId: string, updatedAt?: string): string {
  const base = `/api/code-cards/workspaces/${encodeURIComponent(workspaceId)}/cards/${encodeURIComponent(cardId)}/image`
  return updatedAt ? `${base}?v=${encodeURIComponent(updatedAt)}` : base
}

export function scannedDocumentContentUrl(sourceId: string, relativePath: string, download = false): string {
  return `/api/markdown/content?${query({ sourceId, path: relativePath, ...(download ? { download: '1' } : {}) })}`
}

export function scannedDocumentResourceBaseUrl(sourceId: string, relativePath: string): string {
  const directory = relativePath.replaceAll('\\', '/').split('/').slice(0, -1).filter(Boolean).map(encodeURIComponent).join('/')
  return `/api/markdown/resource/${encodeURIComponent(sourceId)}/${directory ? `${directory}/` : ''}`
}

export async function assetUrl(sourceId: string, relativePath: string): Promise<string> {
  return `/api/markdown/asset?${query({ sourceId, path: relativePath, token: await token() })}`
}
