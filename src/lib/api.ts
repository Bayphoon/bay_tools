import type {
  ApiFailure,
  AppSettings,
  ColorState,
  JsonWorkspace,
  JsonWorkspaceSummary,
  LocalBridge,
  MarkdownDocument,
  MarkdownSource,
  MarkdownSourceTree,
  MarkdownUiState,
  RestoreResult,
  TrashItem,
} from '../../shared/types'

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
  if (options?.body) headers.set('content-type', 'application/json')
  if (!['GET', 'HEAD'].includes(method)) headers.set('x-baytools-token', await token())
  const response = await fetch(path, { ...options, headers })
  if (!response.ok) {
    const failure = await response.json().catch(() => ({ error: response.statusText })) as ApiFailure
    throw new ApiError(response.status, failure.code, failure.details, failure.error)
  }
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

const query = (values: Record<string, string>) => new URLSearchParams(values).toString()

export const localBridge: LocalBridge = {
  getSettings: () => request<AppSettings>('/api/settings'),
  updateSettings: (settings) => request<AppSettings>('/api/settings', { method: 'PUT', body: JSON.stringify(settings) }),
  listJsonWorkspaces: () => request<JsonWorkspaceSummary[]>('/api/json-workspaces'),
  createJsonWorkspace: (title) => request<JsonWorkspace>('/api/json-workspaces', { method: 'POST', body: JSON.stringify({ title }) }),
  getJsonWorkspace: (id) => request<JsonWorkspace>(`/api/json-workspaces/${id}`),
  updateJsonWorkspace: (workspace) => request<JsonWorkspace>(`/api/json-workspaces/${workspace.id}`, { method: 'PUT', body: JSON.stringify(workspace) }),
  renameJsonWorkspace: (id, title) => request<JsonWorkspaceSummary>(`/api/json-workspaces/${id}/rename`, { method: 'POST', body: JSON.stringify({ title }) }),
  duplicateJsonWorkspace: (id) => request<JsonWorkspace>(`/api/json-workspaces/${id}/duplicate`, { method: 'POST', body: '{}' }),
  trashJsonWorkspace: (id) => request<void>(`/api/json-workspaces/${id}/trash`, { method: 'POST', body: '{}' }),
  getColors: () => request<ColorState>('/api/colors'),
  updateColors: (state) => request<ColorState>('/api/colors', { method: 'PUT', body: JSON.stringify(state) }),
  selectDirectory: async () => (await request<{ path: string | null }>('/api/system/select-directory', { method: 'POST', body: '{}' })).path,
  listMarkdownSources: () => request<MarkdownSource[]>('/api/markdown/sources'),
  addMarkdownSource: (path) => request<MarkdownSource>('/api/markdown/sources', { method: 'POST', body: JSON.stringify({ path }) }),
  removeMarkdownSource: (id) => request<void>(`/api/markdown/sources/${id}`, { method: 'DELETE' }),
  scanMarkdownSources: () => request<MarkdownSourceTree[]>('/api/markdown/tree'),
  getMarkdownDocument: (sourceId, relativePath) => request<MarkdownDocument>(`/api/markdown/document?${query({ sourceId, path: relativePath })}`),
  saveMarkdownDocument: (document) => request<MarkdownDocument>('/api/markdown/document', { method: 'PUT', body: JSON.stringify(document) }),
  renameMarkdownDocument: (sourceId, relativePath, nextName, hash) => request<MarkdownDocument>('/api/markdown/document/rename', { method: 'POST', body: JSON.stringify({ sourceId, path: relativePath, nextName, hash }) }),
  trashMarkdownDocument: (sourceId, relativePath, hash) => request<void>('/api/markdown/document/trash', { method: 'POST', body: JSON.stringify({ sourceId, path: relativePath, hash }) }),
  getMarkdownUiState: () => request<MarkdownUiState>('/api/markdown/ui-state'),
  updateMarkdownUiState: (state) => request<MarkdownUiState>('/api/markdown/ui-state', { method: 'PUT', body: JSON.stringify(state) }),
  listTrash: () => request<TrashItem[]>('/api/trash'),
  restoreTrash: (id, asCopy, targetDirectory) => request<RestoreResult>(`/api/trash/${id}/restore`, { method: 'POST', body: JSON.stringify({ asCopy, targetDirectory }) }),
  deleteTrash: (id) => request<void>(`/api/trash/${id}`, { method: 'DELETE' }),
  emptyTrash: () => request<void>('/api/trash', { method: 'DELETE' }),
}

export async function assetUrl(sourceId: string, relativePath: string): Promise<string> {
  return `/api/markdown/asset?${query({ sourceId, path: relativePath, token: await token() })}`
}
