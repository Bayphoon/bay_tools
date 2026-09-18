import { execFile } from 'node:child_process'
import { readdir, realpath, stat } from 'node:fs/promises'
import { basename, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { promisify } from 'node:util'
import ExcelJS from 'exceljs'
import type { Cell, Workbook, Worksheet } from 'exceljs'
import type {
  ConfigTableBranch,
  ConfigTableCellMatch,
  ConfigTableFile,
  ConfigTableFilePage,
  ConfigTableRange,
  ConfigTableSearchMode,
  ConfigTableState,
  ConfigTableWorkbook,
} from '../shared/types.js'
import { AppError } from './errors.js'
import { exists, readJson, writeJson } from './filesystem.js'

const execFileAsync = promisify(execFile)
const now = () => new Date().toISOString()
const FILE_PAGE_SIZE = 100
const MAX_SEARCH_LENGTH = 200
const MAX_WORKBOOK_BYTES = 256 * 1024 * 1024
const MAX_RANGE_ROWS = 200
const MAX_RANGE_COLUMNS = 50
const MAX_CELL_MATCHES = 200
const CACHE_LIMIT = 3
const DEFAULT_ROOTS = [
  'D:\\repo\\trunk_top_lords\\trunk',
  'D:\\repo\\trunk\\_top\\_lords\\trunk',
]

interface PersistedConfigTableState {
  schemaVersion: 1
  updatedAt: string
  revision: number
  rootPath: string
  localRefreshedAt?: string
  remoteSyncedAt?: string
  remoteBranches: string[]
}

interface ConfigTableBranchIndex {
  scannedAt: string
  files: ConfigTableFile[]
}

interface ConfigTableIndex {
  schemaVersion: 1
  updatedAt: string
  branches: Record<string, ConfigTableBranchIndex>
}

interface CachedWorkbook {
  key: string
  size: number
  modifiedMs: number
  accessedAt: number
  workbook: Workbook
}

export type SvnRunner = (args: string[], cwd: string) => Promise<{ stdout: string; stderr: string }>

function defaultSvnRunner(args: string[], cwd: string): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync('svn.exe', args, {
    cwd,
    windowsHide: true,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  })
}

function normalizeBranchName(value: string): string {
  const name = value.trim()
  if (!name || name === '.' || name === '..' || /[\\/:*?"<>|]/.test(name)) {
    throw new AppError(400, 'INVALID_CONFIG_BRANCH', '配置表分支名称无效')
  }
  return name
}

function normalizedName(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/[_-]+/g, ' ')
}

export function tokenizeConfigTableSearch(value: string): string[] {
  return normalizedName(value).split(/\s+/).filter(Boolean)
}

export function configTableFileMatches(fileName: string, search: string, mode: ConfigTableSearchMode): boolean {
  const stem = fileName.toLocaleLowerCase().replace(/\.xlsx$/i, '')
  const query = search.trim().toLocaleLowerCase()
  if (!query) return true
  if (mode === 'exact') return stem === query.replace(/\.xlsx$/i, '') || fileName.toLocaleLowerCase() === query
  const haystack = normalizedName(stem)
  const terms = tokenizeConfigTableSearch(search)
  return terms.length > 0 && terms.every((term) => haystack.includes(term))
}

function isInside(parent: string, child: string): boolean {
  const result = relative(parent, child)
  return result === '' || (!result.startsWith(`..${sep}`) && result !== '..' && !isAbsolute(result))
}

function normalizeRelativeFilePath(value: string): string {
  const normalized = value.replace(/\\/g, '/').replace(/^\.\//, '')
  if (!normalized || normalized.startsWith('/') || isAbsolute(value) || normalized.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new AppError(400, 'INVALID_CONFIG_FILE_PATH', '配置表文件路径无效')
  }
  if (extname(normalized).toLocaleLowerCase() !== '.xlsx' || basename(normalized).startsWith('~$')) {
    throw new AppError(400, 'INVALID_CONFIG_FILE_TYPE', '只支持读取 .xlsx 配置表')
  }
  return normalized
}

function scalarText(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (value instanceof Date) {
    const pad = (part: number, length = 2) => String(part).padStart(length, '0')
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())} ${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}`
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    if (Array.isArray(record.richText)) {
      return record.richText.map((item) => typeof item === 'object' && item && 'text' in item ? String((item as { text: unknown }).text) : '').join('')
    }
    if ('text' in record) return String(record.text ?? '')
    if ('error' in record) return String(record.error ?? '')
    return JSON.stringify(value)
  }
  return String(value)
}

export function configTableCellText(cell: Cell): string {
  if (cell.isMerged && cell.master.address !== cell.address) return ''
  if (cell.formula) {
    const result = cell.result
    return result === undefined || result === null ? `=${cell.formula}` : scalarText(result)
  }
  return cell.text || scalarText(cell.value)
}

export class ConfigTableStore {
  private readonly root: string
  private readonly statePath: string
  private readonly indexPath: string
  private readonly runSvn: SvnRunner
  private readonly preferredRoot?: string
  private readonly branchTasks = new Map<string, Promise<unknown>>()
  private readonly workbookCache = new Map<string, CachedWorkbook>()
  private readonly workbookLoads = new Map<string, Promise<CachedWorkbook>>()

  constructor(projectRoot = process.cwd(), options?: { rootPath?: string; runSvn?: SvnRunner }) {
    this.root = join(projectRoot, 'Doc', 'config-table')
    this.statePath = join(this.root, 'state.json')
    this.indexPath = join(this.root, 'index.json')
    this.preferredRoot = options?.rootPath ?? process.env.BAYTOOLS_CONFIG_TABLE_ROOT
    this.runSvn = options?.runSvn ?? defaultSvnRunner
  }

  async init(): Promise<void> {
    if (!(await exists(this.statePath))) {
      const rootPath = await this.findDefaultRoot()
      await writeJson(this.statePath, {
        schemaVersion: 1,
        updatedAt: now(),
        revision: 1,
        rootPath,
        remoteBranches: [],
      } satisfies PersistedConfigTableState)
    }
    if (!(await exists(this.indexPath))) {
      await writeJson(this.indexPath, { schemaVersion: 1, updatedAt: now(), branches: {} } satisfies ConfigTableIndex)
    }
  }

  private async findDefaultRoot(): Promise<string> {
    const candidates = [this.preferredRoot, ...DEFAULT_ROOTS].filter((value): value is string => Boolean(value))
    for (const candidate of candidates) {
      try {
        if ((await stat(candidate)).isDirectory()) return resolve(candidate)
      } catch {
        // Continue to the next known location.
      }
    }
    return ''
  }

  private state(): Promise<PersistedConfigTableState> {
    return readJson<PersistedConfigTableState>(this.statePath)
  }

  private index(): Promise<ConfigTableIndex> {
    return readJson<ConfigTableIndex>(this.indexPath)
  }

  private async rootPath(): Promise<string> {
    const { rootPath } = await this.state()
    if (!rootPath) throw new AppError(409, 'CONFIG_TABLE_ROOT_REQUIRED', '请先设置配置表 SVN 工作副本目录')
    let info
    try {
      info = await stat(rootPath)
    } catch {
      throw new AppError(404, 'CONFIG_TABLE_ROOT_NOT_FOUND', '配置表 SVN 工作副本目录不存在，请重新设置')
    }
    if (!info.isDirectory()) throw new AppError(400, 'CONFIG_TABLE_ROOT_NOT_DIRECTORY', '配置表根路径不是目录')
    return realpath(rootPath)
  }

  private async localBranchNames(): Promise<string[]> {
    const root = await this.rootPath()
    const entries = await readdir(root, { withFileTypes: true })
    return entries
      .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink() && !entry.name.startsWith('.'))
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right, 'zh-CN', { numeric: true }))
  }

  private async publicState(input?: PersistedConfigTableState): Promise<ConfigTableState> {
    const state = input ?? await this.state()
    let localBranches: string[] = []
    if (state.rootPath) {
      try { localBranches = await this.localBranchNames() } catch { localBranches = [] }
    }
    const index = await this.index()
    const all = new Set([...localBranches, ...state.remoteBranches])
    const branches: ConfigTableBranch[] = [...all].sort((left, right) => left.localeCompare(right, 'zh-CN', { numeric: true })).map((name) => ({
      name,
      local: localBranches.includes(name),
      remote: state.remoteBranches.includes(name),
      ...(index.branches[name] ? { fileCount: index.branches[name].files.length, lastScannedAt: index.branches[name].scannedAt } : {}),
    }))
    const { remoteBranches: _remoteBranches, ...publicFields } = state
    return { ...publicFields, branches }
  }

  async getState(): Promise<ConfigTableState> {
    return this.publicState()
  }

  async setRootPath(input: string): Promise<ConfigTableState> {
    const rootPath = resolve(input.trim())
    let info
    try { info = await stat(rootPath) } catch { throw new AppError(404, 'CONFIG_TABLE_ROOT_NOT_FOUND', '选择的配置表目录不存在') }
    if (!info.isDirectory()) throw new AppError(400, 'CONFIG_TABLE_ROOT_NOT_DIRECTORY', '选择的路径不是目录')
    const state = await this.state()
    const updated: PersistedConfigTableState = {
      schemaVersion: 1,
      updatedAt: now(),
      revision: state.revision + 1,
      rootPath: await realpath(rootPath),
      localRefreshedAt: now(),
      remoteBranches: [],
    }
    await Promise.all([
      writeJson(this.statePath, updated),
      writeJson(this.indexPath, { schemaVersion: 1, updatedAt: now(), branches: {} } satisfies ConfigTableIndex),
    ])
    this.workbookCache.clear()
    return this.publicState(updated)
  }

  async refreshLocalBranches(): Promise<ConfigTableState> {
    await this.localBranchNames()
    const state = await this.state()
    const updated = { ...state, revision: state.revision + 1, updatedAt: now(), localRefreshedAt: now() }
    await writeJson(this.statePath, updated)
    return this.publicState(updated)
  }

  async syncRemoteBranches(): Promise<ConfigTableState> {
    const root = await this.rootPath()
    let url: string
    let list: string
    try {
      url = (await this.runSvn(['info', '--show-item', 'url', root, '--non-interactive'], root)).stdout.trim()
      if (!url) throw new Error('未返回 SVN URL')
      list = (await this.runSvn(['list', '--depth', 'immediates', url, '--non-interactive'], root)).stdout
    } catch (error) {
      throw new AppError(502, 'SVN_REMOTE_SYNC_FAILED', `同步 SVN 远程分支列表失败：${error instanceof Error ? error.message : '未知错误'}`)
    }
    const remoteBranches = [...new Set(list.split(/\r?\n/).map((line) => line.trim().replace(/\/$/, '')).filter((line) => Boolean(line) && !line.startsWith('.')).map(normalizeBranchName))]
      .sort((left, right) => left.localeCompare(right, 'zh-CN', { numeric: true }))
    const state = await this.state()
    const syncedAt = now()
    const updated = { ...state, revision: state.revision + 1, updatedAt: syncedAt, remoteSyncedAt: syncedAt, remoteBranches }
    await writeJson(this.statePath, updated)
    return this.publicState(updated)
  }

  private async branchPath(branch: string, requireLocal = true): Promise<string> {
    const name = normalizeBranchName(branch)
    const root = await this.rootPath()
    const path = resolve(root, name)
    if (!isInside(root, path)) throw new AppError(400, 'INVALID_CONFIG_BRANCH', '配置表分支路径越界')
    if (requireLocal) {
      let info
      try { info = await stat(path) } catch { throw new AppError(404, 'CONFIG_BRANCH_NOT_FOUND', `本地不存在分支 ${name}`) }
      if (!info.isDirectory() || info.isSymbolicLink()) throw new AppError(400, 'INVALID_CONFIG_BRANCH', '配置表分支必须是本地普通目录')
    }
    return path
  }

  private runBranchTask<T>(branch: string, task: () => Promise<T>): Promise<T> {
    const name = normalizeBranchName(branch)
    if (this.branchTasks.has(name)) throw new AppError(409, 'CONFIG_BRANCH_BUSY', `分支 ${name} 正在执行操作，请稍后再试`)
    const promise = task()
    this.branchTasks.set(name, promise)
    return promise.finally(() => {
      if (this.branchTasks.get(name) === promise) this.branchTasks.delete(name)
    })
  }

  async scanBranch(branch: string): Promise<ConfigTableState> {
    return this.runBranchTask(branch, async () => {
      await this.scanBranchFiles(normalizeBranchName(branch))
      return this.getState()
    })
  }

  async updateBranch(branch: string): Promise<ConfigTableState> {
    return this.runBranchTask(branch, async () => {
      const name = normalizeBranchName(branch)
      const path = await this.branchPath(name)
      try {
        await this.runSvn(['update', path, '--non-interactive'], path)
      } catch (error) {
        throw new AppError(502, 'SVN_BRANCH_UPDATE_FAILED', `SVN 更新分支 ${name} 失败：${error instanceof Error ? error.message : '未知错误'}`)
      }
      await this.scanBranchFiles(name)
      return this.refreshLocalBranches()
    })
  }

  async downloadBranch(branch: string): Promise<ConfigTableState> {
    return this.runBranchTask(branch, async () => {
      const name = normalizeBranchName(branch)
      const state = await this.state()
      if (!state.remoteBranches.includes(name)) throw new AppError(404, 'CONFIG_REMOTE_BRANCH_NOT_FOUND', '远程分支列表中不存在该分支，请先同步远程列表')
      const root = await this.rootPath()
      const path = await this.branchPath(name, false)
      try {
        await this.runSvn(['update', root, '--depth', 'immediates', '--non-interactive'], root)
        await this.runSvn(['update', path, '--depth', 'infinity', '--non-interactive'], root)
      } catch (error) {
        throw new AppError(502, 'SVN_BRANCH_DOWNLOAD_FAILED', `下载分支 ${name} 失败：${error instanceof Error ? error.message : '未知错误'}`)
      }
      await this.scanBranchFiles(name)
      return this.refreshLocalBranches()
    })
  }

  private async scanBranchFiles(branch: string): Promise<ConfigTableBranchIndex> {
    const branchRoot = await this.branchPath(branch)
    const files: ConfigTableFile[] = []
    const visit = async (directory: string): Promise<void> => {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (entry.name === '.svn' || entry.isSymbolicLink()) continue
        const path = join(directory, entry.name)
        if (entry.isDirectory()) {
          await visit(path)
        } else if (entry.isFile() && !entry.name.startsWith('~$') && extname(entry.name).toLocaleLowerCase() === '.xlsx') {
          const info = await stat(path)
          files.push({
            branch,
            name: entry.name,
            relativePath: relative(branchRoot, path).split(sep).join('/'),
            size: info.size,
            updatedAt: info.mtime.toISOString(),
          })
        }
      }
    }
    await visit(branchRoot)
    files.sort((left, right) => left.name.localeCompare(right.name, 'zh-CN', { numeric: true }) || left.relativePath.localeCompare(right.relativePath, 'zh-CN', { numeric: true }))
    const branchIndex = { scannedAt: now(), files }
    const index = await this.index()
    index.branches[branch] = branchIndex
    index.updatedAt = now()
    await writeJson(this.indexPath, index)
    return branchIndex
  }

  private async branchIndex(branch: string): Promise<ConfigTableBranchIndex> {
    const name = normalizeBranchName(branch)
    const index = await this.index()
    return index.branches[name] ?? this.scanBranchFiles(name)
  }

  async searchFiles(branch: string, includeDev: boolean, search: string, mode: ConfigTableSearchMode, page: number): Promise<ConfigTableFilePage> {
    const name = normalizeBranchName(branch)
    const needle = search.trim()
    if (needle.length > MAX_SEARCH_LENGTH) throw new AppError(400, 'CONFIG_SEARCH_TOO_LONG', `搜索内容不能超过 ${MAX_SEARCH_LENGTH} 个字符`)
    if (mode !== 'tokens' && mode !== 'exact') throw new AppError(400, 'INVALID_CONFIG_SEARCH_MODE', '配置表搜索模式无效')
    const localBranches = await this.localBranchNames()
    const requested = [...new Set([name, ...(includeDev && name !== 'dev' ? ['dev'] : [])])]
    for (const requestedBranch of requested) {
      if (!localBranches.includes(requestedBranch)) throw new AppError(404, 'CONFIG_BRANCH_NOT_FOUND', `本地不存在分支 ${requestedBranch}`)
    }
    const groups = await Promise.all(requested.map((requestedBranch) => this.branchIndex(requestedBranch)))
    const items = groups.flatMap((group) => group.files).filter((file) => configTableFileMatches(file.name, needle, mode))
    items.sort((left, right) => requested.indexOf(left.branch) - requested.indexOf(right.branch) || left.name.localeCompare(right.name, 'zh-CN', { numeric: true }))
    const total = items.length
    const totalPages = Math.max(1, Math.ceil(total / FILE_PAGE_SIZE))
    const safePage = Math.min(Math.max(1, Number.isFinite(page) ? Math.floor(page) : 1), totalPages)
    const start = (safePage - 1) * FILE_PAGE_SIZE
    return { items: items.slice(start, start + FILE_PAGE_SIZE), total, page: safePage, pageSize: FILE_PAGE_SIZE, totalPages }
  }

  async getFileLocation(branch: string, relativePath: string): Promise<string> {
    const branchRoot = await this.branchPath(branch)
    const normalized = normalizeRelativeFilePath(relativePath)
    const candidate = resolve(branchRoot, ...normalized.split('/'))
    if (!isInside(branchRoot, candidate)) throw new AppError(400, 'CONFIG_FILE_PATH_OUTSIDE_BRANCH', '配置表文件路径越界')
    let actual
    try { actual = await realpath(candidate) } catch { throw new AppError(404, 'CONFIG_FILE_NOT_FOUND', '配置表文件不存在，可能需要重新扫描') }
    if (!isInside(await realpath(branchRoot), actual)) throw new AppError(403, 'CONFIG_FILE_PATH_OUTSIDE_BRANCH', '配置表文件不能位于分支目录之外')
    const info = await stat(actual)
    if (!info.isFile()) throw new AppError(400, 'CONFIG_FILE_NOT_REGULAR', '配置表路径不是普通文件')
    return actual
  }

  async getBranchLocation(branch: string): Promise<string> {
    return this.branchPath(branch)
  }

  private async cachedWorkbook(branch: string, relativePath: string): Promise<CachedWorkbook> {
    const path = await this.getFileLocation(branch, relativePath)
    const info = await stat(path)
    if (info.size > MAX_WORKBOOK_BYTES) throw new AppError(413, 'CONFIG_WORKBOOK_TOO_LARGE', '单个配置表不能超过 256 MiB')
    const key = path.toLocaleLowerCase()
    const cached = this.workbookCache.get(key)
    if (cached && cached.size === info.size && cached.modifiedMs === info.mtimeMs) {
      cached.accessedAt = Date.now()
      return cached
    }
    const loading = this.workbookLoads.get(key)
    if (loading) return loading
    const promise = (async () => {
      const workbook = new ExcelJS.Workbook()
      try {
        await workbook.xlsx.readFile(path, {
          ignoreNodes: ['dataValidations', 'conditionalFormatting', 'extLst', 'drawing', 'picture', 'pageMargins', 'pageSetup', 'headerFooter', 'printOptions', 'sheetProtection', 'autoFilter'],
        })
      } catch (error) {
        throw new AppError(422, 'CONFIG_WORKBOOK_READ_FAILED', `无法读取配置表：${error instanceof Error ? error.message : '文件格式无效'}`)
      }
      const entry = { key, size: info.size, modifiedMs: info.mtimeMs, accessedAt: Date.now(), workbook }
      this.workbookCache.set(key, entry)
      if (this.workbookCache.size > CACHE_LIMIT) {
        const oldest = [...this.workbookCache.values()].filter((item) => item.key !== key).sort((left, right) => left.accessedAt - right.accessedAt)[0]
        if (oldest) this.workbookCache.delete(oldest.key)
      }
      return entry
    })()
    this.workbookLoads.set(key, promise)
    return promise.finally(() => this.workbookLoads.delete(key))
  }

  private worksheet(workbook: Workbook, name: string): Worksheet {
    const worksheet = workbook.getWorksheet(name)
    if (!worksheet) throw new AppError(404, 'CONFIG_SHEET_NOT_FOUND', `工作表 ${name} 不存在`)
    return worksheet
  }

  async getWorkbook(branch: string, relativePath: string): Promise<ConfigTableWorkbook> {
    const path = await this.getFileLocation(branch, relativePath)
    const info = await stat(path)
    const { workbook } = await this.cachedWorkbook(branch, relativePath)
    return {
      branch: normalizeBranchName(branch),
      name: basename(path),
      relativePath: normalizeRelativeFilePath(relativePath),
      size: info.size,
      updatedAt: info.mtime.toISOString(),
      sheets: workbook.worksheets.map((sheet) => ({ name: sheet.name, rowCount: sheet.actualRowCount, columnCount: sheet.actualColumnCount })),
    }
  }

  async refreshWorkbook(branch: string, relativePath: string): Promise<ConfigTableWorkbook> {
    const path = await this.getFileLocation(branch, relativePath)
    this.workbookCache.delete(path.toLocaleLowerCase())
    this.workbookLoads.delete(path.toLocaleLowerCase())
    return this.getWorkbook(branch, relativePath)
  }

  async getRange(branch: string, relativePath: string, sheetName: string, startRow: number, rowCount: number, startColumn: number, columnCount: number): Promise<ConfigTableRange> {
    const integer = (value: number, fallback: number) => Number.isFinite(value) ? Math.floor(value) : fallback
    const safeStartRow = Math.max(1, integer(startRow, 1))
    const safeStartColumn = Math.max(1, integer(startColumn, 1))
    const safeRowCount = Math.min(MAX_RANGE_ROWS, Math.max(1, integer(rowCount, 100)))
    const safeColumnCount = Math.min(MAX_RANGE_COLUMNS, Math.max(1, integer(columnCount, 20)))
    const { workbook } = await this.cachedWorkbook(branch, relativePath)
    const sheet = this.worksheet(workbook, sheetName)
    const values = Array.from({ length: safeRowCount }, (_, rowOffset) => Array.from({ length: safeColumnCount }, (_, columnOffset) => {
      const row = safeStartRow + rowOffset
      const column = safeStartColumn + columnOffset
      if (row > sheet.actualRowCount || column > sheet.actualColumnCount) return ''
      return configTableCellText(sheet.getCell(row, column))
    }))
    return { sheet: sheet.name, startRow: safeStartRow, startColumn: safeStartColumn, rowCount: safeRowCount, columnCount: safeColumnCount, values }
  }

  async searchCells(branch: string, relativePath: string, sheetName: string, search: string): Promise<ConfigTableCellMatch[]> {
    const needle = search.trim().toLocaleLowerCase()
    if (!needle) return []
    if (needle.length > MAX_SEARCH_LENGTH) throw new AppError(400, 'CONFIG_CELL_SEARCH_TOO_LONG', `单元格搜索内容不能超过 ${MAX_SEARCH_LENGTH} 个字符`)
    const { workbook } = await this.cachedWorkbook(branch, relativePath)
    const sheet = this.worksheet(workbook, sheetName)
    const matches: ConfigTableCellMatch[] = []
    sheet.eachRow({ includeEmpty: false }, (row) => {
      if (matches.length >= MAX_CELL_MATCHES) return
      row.eachCell({ includeEmpty: false }, (cell) => {
        if (matches.length >= MAX_CELL_MATCHES) return
        const text = configTableCellText(cell)
        if (text.toLocaleLowerCase().includes(needle)) matches.push({ row: Number(cell.row), column: Number(cell.col), address: cell.address, text })
      })
    })
    return matches
  }
}
