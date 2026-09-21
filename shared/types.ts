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
  folderId?: string
  createdAt: string
  updatedAt: string
}

export interface JsonFolder {
  id: string
  name: string
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
  extension?: string
  previewKind?: FileWorkbenchPreviewKind
  size?: number
  updatedAt?: string
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
  extension: string
  previewKind: FileWorkbenchPreviewKind
  size: number
  editable: boolean
}

export interface MarkdownUiState {
  schemaVersion: 1
  updatedAt: string
  revision: number
  mode: 'source' | 'preview' | 'split'
  tocOpen: boolean
  syncScroll: boolean
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
  extension: string
  previewKind: 'markdown' | 'text'
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

export interface ServerStatusRecord {
  server_id: string
  running_status: string
  season_days: Record<string, number>
  config_branch: string
  code_branch: string
}

export interface ServerStatusState {
  schemaVersion: 1
  updatedAt: string
  revision: number
  url: string
  lastSyncedAt?: string
  servers: ServerStatusRecord[]
}

export type ConfigTableSearchMode = 'tokens' | 'exact'

export interface ConfigTableBranch {
  name: string
  local: boolean
  remote: boolean
  pinned: boolean
  fileCount?: number
  lastScannedAt?: string
}

export interface ConfigTableState {
  schemaVersion: 1
  updatedAt: string
  revision: number
  rootPath: string
  localRefreshedAt?: string
  remoteSyncedAt?: string
  branches: ConfigTableBranch[]
}

export interface ConfigTableFile {
  branch: string
  name: string
  relativePath: string
  size: number
  updatedAt: string
}

export interface ConfigTableFilePage {
  items: ConfigTableFile[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

export interface ConfigTableSheet {
  name: string
  rowCount: number
  columnCount: number
}

export interface ConfigTableWorkbook {
  branch: string
  name: string
  relativePath: string
  size: number
  updatedAt: string
  sheets: ConfigTableSheet[]
}

export interface ConfigTableRange {
  sheet: string
  startRow: number
  startColumn: number
  rowCount: number
  columnCount: number
  values: string[][]
}

export interface ConfigTableCellMatch {
  row: number
  column: number
  address: string
  text: string
}

export type FileWorkbenchPreviewKind = 'text' | 'markdown' | 'pdf' | 'image' | 'binary'
export const FILE_WORKBENCH_TEXT_EDIT_LIMIT = 10 * 1024 * 1024
export const FILE_WORKBENCH_MAX_UPLOAD_SIZE = 512 * 1024 * 1024

export interface FileWorkbenchItem {
  schemaVersion: 1
  id: string
  importedName: string
  name: string
  description: string
  favorite: boolean
  favoritedAt?: string
  mimeType: string
  extension: string
  previewKind: FileWorkbenchPreviewKind
  size: number
  sha256: string
  createdAt: string
  updatedAt: string
  sourceLastModified?: string
  contentRevision: number
  metadataRevision: number
}

export interface FileWorkbenchLibrary {
  schemaVersion: 1
  updatedAt: string
  revision: number
  items: FileWorkbenchItem[]
}

export interface FileWorkbenchTextDocument {
  id: string
  content: string
  sha256: string
  contentRevision: number
  updatedAt: string
}

export interface FileWorkbenchMetadataPatch {
  name?: string
  description?: string
  favorite?: boolean
  metadataRevision: number
}

export interface CodeCardFolder {
  id: string
  name: string
  createdAt: string
  updatedAt: string
}

export interface CodeCardWorkspaceSummary {
  id: string
  title: string
  folderId?: string
  createdAt: string
  updatedAt: string
}

export interface CodeCardImage {
  fileName: string
  mimeType: 'image/webp' | 'image/png' | 'image/jpeg'
  size: number
  width: number
  height: number
  updatedAt: string
}

export interface CodeCard {
  id: string
  title: string
  code: string
  collapsed: boolean
  height: number
  splitRatio: number
  image?: CodeCardImage
  createdAt: string
  updatedAt: string
}

export interface CodeCardWorkspace extends CodeCardWorkspaceSummary {
  schemaVersion: 1
  revision: number
  cards: CodeCard[]
}

export interface CodeCardLibrary {
  schemaVersion: 1
  revision: number
  updatedAt: string
  folders: CodeCardFolder[]
  workspaces: CodeCardWorkspaceSummary[]
}

export type CodeCardSearchMode = 'fuzzy' | 'exact'

export interface CodeCardSearchResult {
  workspaceId: string
  workspaceTitle: string
  cardId: string
  cardTitle: string
  excerpt: string
  matchField: 'title' | 'code'
  line?: number
}

export interface CodeCardSearchPage {
  items: CodeCardSearchResult[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

export const CODE_CARD_IMAGE_MAX_UPLOAD_SIZE = 4 * 1024 * 1024

export type TrashKind = 'markdown' | 'scanned-document' | 'managed-markdown' | 'json-workspace' | 'file-workbench' | 'code-card'

export interface TrashItem {
  id: string
  kind: TrashKind
  displayName: string
  originalLocation: string
  originalRelativePath?: string
  sourceId?: string
  jsonWorkspace?: JsonWorkspaceSummary
  managedDocument?: ManagedMarkdownDocumentSummary
  fileWorkbenchItem?: FileWorkbenchItem
  codeCardWorkspace?: CodeCardWorkspaceSummary
  deletedAt: string
  size: number
  sha256: string
}

export interface RestoreResult {
  restoredLocation: string
  workspaceId?: string
  fileWorkbenchId?: string
}

export type ShortcutLocation = 'desktop' | 'start-menu'

export interface ShortcutResult {
  location: ShortcutLocation
  path: string
  replaced: boolean
}

export interface ServiceSession {
  apiVersion: number
  sourceVersion: string | null
  serviceId: string
}

export interface ServiceRestartResult {
  previousServiceId: string
}

export type PersonalDataSyncState = 'unavailable' | 'ready' | 'runtime-newer' | 'snapshot-newer' | 'diverged'

export interface PersonalDataStatus {
  branch: string | null
  user?: string
  remoteName?: string
  remoteUrl?: string
  eligible: boolean
  state: PersonalDataSyncState
  runtimeHasData: boolean
  snapshotExists: boolean
  snapshotPath?: string
  fileCount: number
  totalBytes: number
  lastSyncedAt?: string
}

export interface PersonalDataSyncResult {
  changed: boolean
  status: PersonalDataStatus
}

export interface PersonalDataPublishResult {
  syncChanged: boolean
  commitCreated: boolean
  commit: string
  pushed: boolean
  branch: string
  remoteName: string
  remoteUrl: string
  status: PersonalDataStatus
}

export interface LocalBridge {
  getSettings(): Promise<AppSettings>
  updateSettings(settings: AppSettings): Promise<AppSettings>
  listJsonWorkspaces(): Promise<JsonWorkspaceSummary[]>
  listJsonFolders(): Promise<JsonFolder[]>
  createJsonWorkspace(title?: string, folderId?: string): Promise<JsonWorkspace>
  getJsonWorkspace(id: string): Promise<JsonWorkspace>
  updateJsonWorkspace(workspace: JsonWorkspace): Promise<JsonWorkspace>
  renameJsonWorkspace(id: string, title: string): Promise<JsonWorkspaceSummary>
  duplicateJsonWorkspace(id: string): Promise<JsonWorkspace>
  moveJsonWorkspace(id: string, folderId?: string): Promise<JsonWorkspaceSummary>
  trashJsonWorkspace(id: string): Promise<void>
  revealJsonWorkspace(id: string): Promise<void>
  getJsonWorkspaceFilePath(id: string): Promise<string>
  createJsonFolder(name?: string): Promise<JsonFolder>
  renameJsonFolder(id: string, name: string): Promise<JsonFolder>
  deleteJsonFolder(id: string): Promise<void>
  getJsonScratchpad(): Promise<JsonScratchpad>
  updateJsonScratchpad(scratchpad: JsonScratchpad): Promise<JsonScratchpad>
  getColors(): Promise<ColorState>
  updateColors(state: ColorState): Promise<ColorState>
  selectDirectory(): Promise<string | null>
  createShortcut(location: ShortcutLocation): Promise<ShortcutResult>
  getServiceSession(): Promise<ServiceSession>
  restartService(): Promise<ServiceRestartResult>
  getPersonalDataStatus(): Promise<PersonalDataStatus>
  syncPersonalData(force?: boolean): Promise<PersonalDataSyncResult>
  restorePersonalData(confirm: boolean): Promise<PersonalDataSyncResult>
  publishPersonalData(confirm: boolean, force?: boolean): Promise<PersonalDataPublishResult>
  listMarkdownSources(): Promise<MarkdownSource[]>
  addMarkdownSource(path: string): Promise<MarkdownSource>
  updateMarkdownSourceNote(id: string, note: string): Promise<MarkdownSource>
  removeMarkdownSource(id: string): Promise<void>
  revealMarkdownSource(id: string): Promise<void>
  scanMarkdownSources(): Promise<MarkdownSourceTree[]>
  createMarkdownDocument(sourceId: string, relativeDirectory: string, name: string): Promise<MarkdownDocument>
  getMarkdownDocument(sourceId: string, relativePath: string): Promise<MarkdownDocument>
  saveMarkdownDocument(document: MarkdownDocument): Promise<MarkdownDocument>
  renameMarkdownDocument(sourceId: string, relativePath: string, nextName: string, hash: string): Promise<MarkdownDocument>
  trashMarkdownDocument(sourceId: string, relativePath: string, hash: string): Promise<void>
  revealMarkdownDocument(sourceId: string, relativePath: string): Promise<void>
  getMarkdownDocumentFilePath(sourceId: string, relativePath: string): Promise<string>
  getManagedMarkdownLibrary(): Promise<ManagedMarkdownLibrary>
  createManagedMarkdownDocument(title?: string, folderId?: string): Promise<ManagedMarkdownDocument>
  getManagedMarkdownDocument(id: string): Promise<ManagedMarkdownDocument>
  updateManagedMarkdownDocument(document: ManagedMarkdownDocument): Promise<ManagedMarkdownDocument>
  duplicateManagedMarkdownDocument(id: string): Promise<ManagedMarkdownDocument>
  moveManagedMarkdownDocument(id: string, folderId?: string): Promise<ManagedMarkdownDocumentSummary>
  trashManagedMarkdownDocument(id: string): Promise<void>
  revealManagedMarkdownDocument(id: string): Promise<void>
  getManagedMarkdownDocumentFilePath(id: string): Promise<string>
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
  getServerStatus(): Promise<ServerStatusState>
  syncServerStatus(url: string): Promise<ServerStatusState>
  getConfigTableState(): Promise<ConfigTableState>
  setConfigTableRoot(path: string): Promise<ConfigTableState>
  refreshConfigTableLocal(): Promise<ConfigTableState>
  syncConfigTableRemote(): Promise<ConfigTableState>
  setConfigTableBranchPinned(branch: string, pinned: boolean): Promise<ConfigTableState>
  scanConfigTableBranch(branch: string): Promise<ConfigTableState>
  updateConfigTableBranch(branch: string): Promise<ConfigTableState>
  downloadConfigTableBranch(branch: string): Promise<ConfigTableState>
  searchConfigTableFiles(branch: string, includeDev: boolean, search: string, mode: ConfigTableSearchMode, page: number): Promise<ConfigTableFilePage>
  getConfigTableWorkbook(branch: string, relativePath: string): Promise<ConfigTableWorkbook>
  refreshConfigTableWorkbook(branch: string, relativePath: string): Promise<ConfigTableWorkbook>
  getConfigTableRange(branch: string, relativePath: string, sheet: string, startRow: number, rowCount: number, startColumn: number, columnCount: number): Promise<ConfigTableRange>
  searchConfigTableCells(branch: string, relativePath: string, sheet: string, search: string): Promise<ConfigTableCellMatch[]>
  revealConfigTableFile(branch: string, relativePath: string): Promise<void>
  revealConfigTableBranch(branch: string): Promise<void>
  openConfigTableFile(branch: string, relativePath: string): Promise<void>
  getConfigTableFilePath(branch: string, relativePath: string): Promise<string>
  listFileWorkbenchItems(): Promise<FileWorkbenchLibrary>
  uploadFileWorkbenchFile(file: File): Promise<FileWorkbenchItem>
  updateFileWorkbenchMetadata(id: string, patch: FileWorkbenchMetadataPatch): Promise<FileWorkbenchItem>
  getFileWorkbenchText(id: string): Promise<FileWorkbenchTextDocument>
  saveFileWorkbenchText(document: FileWorkbenchTextDocument): Promise<FileWorkbenchTextDocument>
  trashFileWorkbenchItem(id: string): Promise<void>
  revealFileWorkbenchItem(id: string): Promise<void>
  getFileWorkbenchItemPath(id: string): Promise<string>
  getCodeCardLibrary(): Promise<CodeCardLibrary>
  searchCodeCards(search: string, page: number, mode: CodeCardSearchMode): Promise<CodeCardSearchPage>
  createCodeCardWorkspace(title?: string, folderId?: string): Promise<CodeCardWorkspace>
  getCodeCardWorkspace(id: string): Promise<CodeCardWorkspace>
  updateCodeCardWorkspace(workspace: CodeCardWorkspace): Promise<CodeCardWorkspace>
  renameCodeCardWorkspace(id: string, title: string): Promise<CodeCardWorkspaceSummary>
  moveCodeCardWorkspace(id: string, folderId?: string): Promise<CodeCardWorkspaceSummary>
  trashCodeCardWorkspace(id: string): Promise<void>
  createCodeCardFolder(name?: string): Promise<CodeCardFolder>
  renameCodeCardFolder(id: string, name: string): Promise<CodeCardFolder>
  deleteCodeCardFolder(id: string): Promise<void>
  uploadCodeCardImage(workspaceId: string, cardId: string, image: Blob, width: number, height: number, revision: number): Promise<CodeCardWorkspace>
  deleteCodeCardImage(workspaceId: string, cardId: string, revision: number): Promise<CodeCardWorkspace>
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
