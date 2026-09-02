export type ThemeMode = 'light' | 'dark' | 'manual' | 'solar'

export interface AppSettings {
  schemaVersion: 1
  updatedAt: string
  revision: number
  theme: {
    mode: ThemeMode
    lightAccent: string
    darkAccent: string
    manualBlend: number
    sunrise: string
    sunset: string
    transitionMinutes: number
  }
  sidebar: {
    collapsedGroups: string[]
    width: number
  }
  workSchedule: {
    workDays: number[]
    start: string
    lunchStart: string
    lunchEnd: string
    dinnerStart: string
    end: string
  }
}

export type JsonViewMode = 'text' | 'tree'
export const JSON_WORKSPACE_MIN_PANES = 2
export const JSON_WORKSPACE_MAX_PANES = 6

export interface JsonPane {
  id: string
  title: string
  text: string
  view: JsonViewMode
}

export interface JsonDiffSelection {
  basePaneId: string
  targetPaneId: string
}

export interface JsonWorkspaceSummary {
  id: string
  title: string
  createdAt: string
  updatedAt: string
}

export interface JsonWorkspace extends JsonWorkspaceSummary {
  schemaVersion: 2
  revision: number
  panes: JsonPane[]
  diffSelection: JsonDiffSelection
}

export interface ColorValue {
  hex: string
  rgb255: string
  rgb1: string
}

export interface SavedColor extends ColorValue {
  id: string
  name: string
  createdAt: string
}

export interface RecentColor extends ColorValue {
  lastUsedAt: string
}

export interface ColorState {
  schemaVersion: 1
  updatedAt: string
  revision: number
  recent: RecentColor[]
  saved: SavedColor[]
}

export interface MarkdownSource {
  id: string
  label: string
  path: string
  createdAt: string
}

export interface MarkdownTreeNode {
  name: string
  relativePath: string
  type: 'directory' | 'file'
  children?: MarkdownTreeNode[]
}

export interface MarkdownSourceTree extends MarkdownSource {
  children: MarkdownTreeNode[]
  error?: string
}

export interface MarkdownDocument {
  sourceId: string
  relativePath: string
  content: string
  hash: string
  updatedAt: string
}

export interface MarkdownUiState {
  schemaVersion: 1
  updatedAt: string
  revision: number
  mode: 'source' | 'preview' | 'split'
}

export type TrashKind = 'markdown' | 'json-workspace'

export interface TrashItem {
  id: string
  kind: TrashKind
  displayName: string
  originalLocation: string
  originalRelativePath?: string
  sourceId?: string
  deletedAt: string
  size: number
  sha256: string
}

export interface RestoreResult {
  restoredLocation: string
  workspaceId?: string
}

export interface LocalBridge {
  getSettings(): Promise<AppSettings>
  updateSettings(settings: AppSettings): Promise<AppSettings>
  listJsonWorkspaces(): Promise<JsonWorkspaceSummary[]>
  createJsonWorkspace(title?: string): Promise<JsonWorkspace>
  getJsonWorkspace(id: string): Promise<JsonWorkspace>
  updateJsonWorkspace(workspace: JsonWorkspace): Promise<JsonWorkspace>
  renameJsonWorkspace(id: string, title: string): Promise<JsonWorkspaceSummary>
  duplicateJsonWorkspace(id: string): Promise<JsonWorkspace>
  trashJsonWorkspace(id: string): Promise<void>
  getColors(): Promise<ColorState>
  updateColors(state: ColorState): Promise<ColorState>
  selectDirectory(): Promise<string | null>
  listMarkdownSources(): Promise<MarkdownSource[]>
  addMarkdownSource(path: string): Promise<MarkdownSource>
  removeMarkdownSource(id: string): Promise<void>
  scanMarkdownSources(): Promise<MarkdownSourceTree[]>
  getMarkdownDocument(sourceId: string, relativePath: string): Promise<MarkdownDocument>
  saveMarkdownDocument(document: MarkdownDocument): Promise<MarkdownDocument>
  renameMarkdownDocument(sourceId: string, relativePath: string, nextName: string, hash: string): Promise<MarkdownDocument>
  trashMarkdownDocument(sourceId: string, relativePath: string, hash: string): Promise<void>
  getMarkdownUiState(): Promise<MarkdownUiState>
  updateMarkdownUiState(state: MarkdownUiState): Promise<MarkdownUiState>
  listTrash(): Promise<TrashItem[]>
  restoreTrash(id: string, asCopy?: boolean, targetDirectory?: string): Promise<RestoreResult>
  deleteTrash(id: string): Promise<void>
  emptyTrash(): Promise<void>
}

export interface ApiFailure {
  error: string
  code?: string
  details?: unknown
}
