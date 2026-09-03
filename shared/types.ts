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

export interface JsonScratchpad {
  schemaVersion: 1
  updatedAt: string
  revision: number
  text: string
  mode: JsonViewMode
  autoFormat: boolean
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
  note?: string
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

export interface ManagedMarkdownFolder {
  id: string
  name: string
  createdAt: string
  updatedAt: string
}

export interface ManagedMarkdownDocumentSummary {
  id: string
  title: string
  folderId?: string
  createdAt: string
  updatedAt: string
  revision: number
}

export interface ManagedMarkdownDocument extends ManagedMarkdownDocumentSummary {
  content: string
}

export interface ManagedMarkdownLibrary {
  schemaVersion: 1
  updatedAt: string
  revision: number
  folders: ManagedMarkdownFolder[]
  documents: ManagedMarkdownDocumentSummary[]
}

export interface LanguageEntry {
  key: string
  content: string
}

export type LanguageSearchMode = 'fuzzy' | 'exact'

export interface LanguageFavorite extends LanguageEntry {
  favoritedAt: string
}

export interface LanguageSourceSummary {
  id: string
  title: string
  url: string
  fileName?: string
  createdAt: string
  updatedAt: string
  lastSyncedAt?: string
  entryCount: number
}

export interface LanguageSource extends LanguageSourceSummary {
  schemaVersion: 1
  revision: number
  favorites: LanguageFavorite[]
}

export interface LanguageEntryPage {
  items: LanguageEntry[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

export type TrashKind = 'markdown' | 'managed-markdown' | 'json-workspace'

export interface TrashItem {
  id: string
  kind: TrashKind
  displayName: string
  originalLocation: string
  originalRelativePath?: string
  sourceId?: string
  managedDocument?: ManagedMarkdownDocumentSummary
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
  revealJsonWorkspace(id: string): Promise<void>
  getJsonScratchpad(): Promise<JsonScratchpad>
  updateJsonScratchpad(scratchpad: JsonScratchpad): Promise<JsonScratchpad>
  getColors(): Promise<ColorState>
  updateColors(state: ColorState): Promise<ColorState>
  selectDirectory(): Promise<string | null>
  listMarkdownSources(): Promise<MarkdownSource[]>
  addMarkdownSource(path: string): Promise<MarkdownSource>
  updateMarkdownSourceNote(id: string, note: string): Promise<MarkdownSource>
  removeMarkdownSource(id: string): Promise<void>
  revealMarkdownSource(id: string): Promise<void>
  scanMarkdownSources(): Promise<MarkdownSourceTree[]>
  getMarkdownDocument(sourceId: string, relativePath: string): Promise<MarkdownDocument>
  saveMarkdownDocument(document: MarkdownDocument): Promise<MarkdownDocument>
  renameMarkdownDocument(sourceId: string, relativePath: string, nextName: string, hash: string): Promise<MarkdownDocument>
  trashMarkdownDocument(sourceId: string, relativePath: string, hash: string): Promise<void>
  revealMarkdownDocument(sourceId: string, relativePath: string): Promise<void>
  getManagedMarkdownLibrary(): Promise<ManagedMarkdownLibrary>
  createManagedMarkdownDocument(title?: string, folderId?: string): Promise<ManagedMarkdownDocument>
  getManagedMarkdownDocument(id: string): Promise<ManagedMarkdownDocument>
  updateManagedMarkdownDocument(document: ManagedMarkdownDocument): Promise<ManagedMarkdownDocument>
  duplicateManagedMarkdownDocument(id: string): Promise<ManagedMarkdownDocument>
  trashManagedMarkdownDocument(id: string): Promise<void>
  revealManagedMarkdownDocument(id: string): Promise<void>
  createManagedMarkdownFolder(name?: string): Promise<ManagedMarkdownFolder>
  renameManagedMarkdownFolder(id: string, name: string): Promise<ManagedMarkdownFolder>
  deleteManagedMarkdownFolder(id: string): Promise<void>
  getMarkdownUiState(): Promise<MarkdownUiState>
  updateMarkdownUiState(state: MarkdownUiState): Promise<MarkdownUiState>
  listLanguageSources(): Promise<LanguageSourceSummary[]>
  createLanguageSource(): Promise<LanguageSource>
  getLanguageSource(id: string): Promise<LanguageSource>
  deleteLanguageSource(id: string): Promise<void>
  syncLanguageSource(id: string, url: string): Promise<LanguageSource>
  searchLanguageEntries(id: string, search: string, page: number, mode: LanguageSearchMode): Promise<LanguageEntryPage>
  searchLanguageFavorites(id: string, search: string, page: number, mode: LanguageSearchMode): Promise<LanguageEntryPage>
  setLanguageFavorite(id: string, key: string, favorite: boolean, revision: number): Promise<LanguageSource>
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
