import * as AlertDialog from '@radix-ui/react-alert-dialog'
import { AlertTriangle, ChevronLeft, ChevronRight, ClipboardCopy, Download, ExternalLink, FileSpreadsheet, FolderOpen, RefreshCw, Search, Table2 } from 'lucide-react'
import { useCallback, useDeferredValue, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import type { ConfigTableCellMatch, ConfigTableCellSearchMode, ConfigTableFile, ConfigTableFilePage, ConfigTableRange, ConfigTableSearchMode, ConfigTableSheet, ConfigTableWorkbook } from '../../shared/types'
import { EmptyState, PageHeader, Spinner, ToolButton } from '../components/ui'
import { copyFilePath, showAppNotice } from '../lib/clipboard'
import { clampFrozenCount, configTableRangeRequests, configTableRangeValue, gridIndexAtOffset, gridOffsetForIndex, gridTotalSize, MAX_FROZEN_COLUMNS, MAX_FROZEN_ROWS, visibleGridIndexes, type GridSizeOverrides } from '../lib/configTableViewport'
import { localBridge } from '../lib/api'
import { useAppStore } from '../store/appStore'

const ROW_HEIGHT = 28
const COLUMN_WIDTH = 148
const ROW_HEADER_WIDTH = 54
const COLUMN_HEADER_HEIGHT = 30
const CONFIG_TABLE_FONT_SIZE_KEY = 'baytools.config-table.font-size'
const MIN_CONFIG_TABLE_FONT_SIZE = 10
const MAX_CONFIG_TABLE_FONT_SIZE = 20
const DEFAULT_CONFIG_TABLE_FONT_SIZE = 12
const MIN_ROW_HEIGHT = 22
const MAX_ROW_HEIGHT = 160
const MIN_COLUMN_WIDTH = 72
const MAX_COLUMN_WIDTH = 640
export const CONFIG_TABLE_LARGE_FILE_THRESHOLD = 1024 * 1024

type SheetGridSizes = { rows: GridSizeOverrides; columns: GridSizeOverrides }

export function requiresLargeWorkbookConfirmation(file: ConfigTableFile): boolean {
  return file.size > CONFIG_TABLE_LARGE_FILE_THRESHOLD
}

function initialConfigTableFontSize(): number {
  const stored = Number(window.localStorage.getItem(CONFIG_TABLE_FONT_SIZE_KEY))
  return Number.isInteger(stored) && stored >= MIN_CONFIG_TABLE_FONT_SIZE && stored <= MAX_CONFIG_TABLE_FONT_SIZE
    ? stored
    : DEFAULT_CONFIG_TABLE_FONT_SIZE
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '操作失败'
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`
}

function columnLabel(column: number): string {
  let value = Math.max(1, column)
  let label = ''
  while (value > 0) {
    const digit = (value - 1) % 26
    label = String.fromCharCode(65 + digit) + label
    value = Math.floor((value - 1) / 26)
  }
  return label
}

function beginGridResize(event: ReactPointerEvent<HTMLElement>, axis: 'row' | 'column', startSize: number, onResize: (size: number) => void) {
  if (event.button !== 0) return
  event.preventDefault()
  event.stopPropagation()
  const startPosition = axis === 'column' ? event.clientX : event.clientY
  const minimum = axis === 'column' ? MIN_COLUMN_WIDTH : MIN_ROW_HEIGHT
  const maximum = axis === 'column' ? MAX_COLUMN_WIDTH : MAX_ROW_HEIGHT
  const previousCursor = document.body.style.cursor
  const previousUserSelect = document.body.style.userSelect
  document.body.style.cursor = axis === 'column' ? 'col-resize' : 'row-resize'
  document.body.style.userSelect = 'none'
  const move = (pointerEvent: PointerEvent) => {
    const position = axis === 'column' ? pointerEvent.clientX : pointerEvent.clientY
    onResize(Math.min(maximum, Math.max(minimum, Math.round(startSize + position - startPosition))))
  }
  const finish = () => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', finish)
    window.removeEventListener('pointercancel', finish)
    document.body.style.cursor = previousCursor
    document.body.style.userSelect = previousUserSelect
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', finish)
  window.addEventListener('pointercancel', finish)
}

function VirtualSheet({ branch, relativePath, sheet, refreshKey, target, selectedAddress, frozenRows, frozenColumns, rowHeights, columnWidths, onResizeRow, onResizeColumn, onSelect }: {
  branch: string
  relativePath: string
  sheet: ConfigTableSheet
  refreshKey: number
  target?: ConfigTableCellMatch
  selectedAddress?: string
  frozenRows: number
  frozenColumns: number
  rowHeights: GridSizeOverrides
  columnWidths: GridSizeOverrides
  onResizeRow: (row: number, height: number) => void
  onResizeColumn: (column: number, width: number) => void
  onSelect: (cell: { address: string; text: string }) => void
}) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ top: 0, left: 0 })
  const [ranges, setRanges] = useState<ConfigTableRange[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>()
  const visibleStartRow = gridIndexAtOffset(Math.max(0, position.top - COLUMN_HEADER_HEIGHT), sheet.rowCount, ROW_HEIGHT, rowHeights)
  const visibleStartColumn = gridIndexAtOffset(Math.max(0, position.left - ROW_HEADER_WIDTH), sheet.columnCount, COLUMN_WIDTH, columnWidths)
  const startRow = Math.max(1, visibleStartRow - 12)
  const startColumn = Math.max(1, visibleStartColumn - 3)

  useEffect(() => {
    setRanges([])
    setPosition({ top: 0, left: 0 })
    if (viewportRef.current) viewportRef.current.scrollTo({ top: 0, left: 0 })
  }, [branch, relativePath, sheet.name])

  useEffect(() => {
    let cancelled = false
    const timer = window.setTimeout(() => {
      setLoading(true)
      const requests = configTableRangeRequests(startRow, startColumn, frozenRows, frozenColumns)
      void Promise.all(requests.map((request) => localBridge.getConfigTableRange(branch, relativePath, sheet.name, request.startRow, request.rowCount, request.startColumn, request.columnCount))).then((next) => {
        if (!cancelled) { setRanges(next); setError(undefined) }
      }).catch((nextError) => {
        if (!cancelled) setError(errorMessage(nextError))
      }).finally(() => {
        if (!cancelled) setLoading(false)
      })
    }, 80)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [branch, relativePath, sheet.name, startRow, startColumn, frozenRows, frozenColumns, refreshKey])

  useEffect(() => {
    if (!target || !viewportRef.current) return
    viewportRef.current.scrollTo({
      top: Math.max(0, gridOffsetForIndex(target.row, ROW_HEIGHT, rowHeights) - ROW_HEIGHT * (frozenRows + 3)),
      left: Math.max(0, gridOffsetForIndex(target.column, COLUMN_WIDTH, columnWidths) - COLUMN_WIDTH * (frozenColumns + 2)),
      behavior: 'smooth',
    })
    onSelect({ address: target.address, text: target.text })
  }, [target, frozenRows, frozenColumns, onSelect])

  const visibleRows = visibleGridIndexes(startRow, 100, frozenRows, sheet.rowCount)
  const visibleColumns = visibleGridIndexes(startColumn, 50, frozenColumns, sheet.columnCount)

  if (!sheet.rowCount || !sheet.columnCount) return <EmptyState title="工作表为空"><span>该 Sheet 没有可显示的单元格。</span></EmptyState>

  return <div className="config-grid-wrap">
    {error && <div className="config-grid-error">{error}</div>}
    <div ref={viewportRef} className="config-grid-viewport" onScroll={(event) => setPosition({ top: event.currentTarget.scrollTop, left: event.currentTarget.scrollLeft })}>
      <div className="config-grid-canvas" style={{ width: ROW_HEADER_WIDTH + gridTotalSize(sheet.columnCount, COLUMN_WIDTH, columnWidths), height: COLUMN_HEADER_HEIGHT + gridTotalSize(sheet.rowCount, ROW_HEIGHT, rowHeights) }}>
        <div className="config-grid-corner" style={{ top: position.top, left: position.left }} />
        {visibleColumns.map((column) => {
          const frozen = column <= frozenColumns
          const width = columnWidths[column] ?? COLUMN_WIDTH
          return <div key={`header-${column}`} className={`config-grid-column-header ${frozen ? 'frozen-column' : ''} ${column === frozenColumns ? 'freeze-column-edge' : ''}`} style={{ top: position.top, left: (frozen ? position.left : 0) + ROW_HEADER_WIDTH + gridOffsetForIndex(column, COLUMN_WIDTH, columnWidths), width }}><span>{columnLabel(column)}</span><button aria-label={`调整 ${columnLabel(column)} 列宽`} className="config-grid-column-resizer" onPointerDown={(event) => beginGridResize(event, 'column', width, (size) => onResizeColumn(column, size))} /></div>
        })}
        {visibleRows.map((row) => {
          const frozen = row <= frozenRows
          const height = rowHeights[row] ?? ROW_HEIGHT
          return <div key={`row-${row}`} className={`config-grid-row-header ${frozen ? 'frozen-row' : ''} ${row === frozenRows ? 'freeze-row-edge' : ''}`} style={{ top: (frozen ? position.top : 0) + COLUMN_HEADER_HEIGHT + gridOffsetForIndex(row, ROW_HEIGHT, rowHeights), left: position.left, height }}><span>{row}</span><button aria-label={`调整第 ${row} 行高度`} className="config-grid-row-resizer" onPointerDown={(event) => beginGridResize(event, 'row', height, (size) => onResizeRow(row, size))} /></div>
        })}
        {visibleRows.flatMap((row) => visibleColumns.map((column) => {
          const text = configTableRangeValue(ranges, row, column)
          const address = `${columnLabel(column)}${row}`
          const frozenRow = row <= frozenRows
          const frozenColumn = column <= frozenColumns
          const searchMatch = target?.row === row && target.column === column
          const selected = selectedAddress === address
          const height = rowHeights[row] ?? ROW_HEIGHT
          const width = columnWidths[column] ?? COLUMN_WIDTH
          const className = ['config-grid-cell', frozenRow ? 'frozen-row' : '', frozenColumn ? 'frozen-column' : '', row === frozenRows ? 'freeze-row-edge' : '', column === frozenColumns ? 'freeze-column-edge' : '', searchMatch ? 'search-match' : '', selected ? 'selected' : ''].filter(Boolean).join(' ')
          return <button key={`${row}-${column}`} className={className} style={{ top: (frozenRow ? position.top : 0) + COLUMN_HEADER_HEIGHT + gridOffsetForIndex(row, ROW_HEIGHT, rowHeights), left: (frozenColumn ? position.left : 0) + ROW_HEADER_WIDTH + gridOffsetForIndex(column, COLUMN_WIDTH, columnWidths), width, height }} title={text} onClick={() => onSelect({ address, text })}>{text}</button>
        }))}
      </div>
    </div>
    {loading && <div className="config-grid-loading">读取中…</div>}
  </div>
}

export function WorkbookViewer({ file }: { file: ConfigTableFile }) {
  const [workbook, setWorkbook] = useState<ConfigTableWorkbook>()
  const [sheetName, setSheetName] = useState('')
  const [refreshKey, setRefreshKey] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()
  const [cellSearch, setCellSearch] = useState('')
  const [cellSearchMode, setCellSearchMode] = useState<ConfigTableCellSearchMode>('contains')
  const [matches, setMatches] = useState<ConfigTableCellMatch[]>([])
  const [matchIndex, setMatchIndex] = useState(-1)
  const [selectedCell, setSelectedCell] = useState<{ address: string; text: string }>()
  const [frozenBySheet, setFrozenBySheet] = useState<Record<string, { rows: number; columns: number }>>({})
  const [gridSizesBySheet, setGridSizesBySheet] = useState<Record<string, SheetGridSizes>>({})
  const [fontSize, setFontSize] = useState(initialConfigTableFontSize)

  useEffect(() => {
    window.localStorage.setItem(CONFIG_TABLE_FONT_SIZE_KEY, String(fontSize))
  }, [fontSize])

  const load = async (force = false) => {
    setLoading(true)
    try {
      const next = force
        ? await localBridge.refreshConfigTableWorkbook(file.branch, file.relativePath)
        : await localBridge.getConfigTableWorkbook(file.branch, file.relativePath)
      setWorkbook(next)
      setSheetName((current) => next.sheets.some((sheet) => sheet.name === current) ? current : next.sheets[0]?.name ?? '')
      setError(undefined)
      if (force) setRefreshKey((value) => value + 1)
    } catch (nextError) {
      setError(errorMessage(nextError))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    setWorkbook(undefined)
    setSheetName('')
    setCellSearch('')
    setMatches([])
    setMatchIndex(-1)
    setSelectedCell(undefined)
    setFrozenBySheet({})
    setGridSizesBySheet({})
    void load()
    // The file identity is the intended reload boundary.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file.branch, file.relativePath])

  const activeSheet = workbook?.sheets.find((sheet) => sheet.name === sheetName)
  const frozen = frozenBySheet[sheetName] ?? { rows: 0, columns: 0 }
  const gridSizes = gridSizesBySheet[sheetName] ?? { rows: {}, columns: {} }
  const updateFrozen = (field: 'rows' | 'columns', value: number) => {
    if (!activeSheet) return
    const maximum = field === 'rows' ? MAX_FROZEN_ROWS : MAX_FROZEN_COLUMNS
    const total = field === 'rows' ? activeSheet.rowCount : activeSheet.columnCount
    setFrozenBySheet((current) => ({ ...current, [sheetName]: { ...frozen, [field]: clampFrozenCount(value, total, maximum) } }))
  }
  const updateGridSize = (field: keyof SheetGridSizes, index: number, size: number) => {
    setGridSizesBySheet((current) => {
      const sheetSizes = current[sheetName] ?? { rows: {}, columns: {} }
      return { ...current, [sheetName]: { ...sheetSizes, [field]: { ...sheetSizes[field], [index]: size } } }
    })
  }
  const copySelectedCell = useCallback(async () => {
    if (!selectedCell) return
    try {
      await navigator.clipboard.writeText(selectedCell.text)
      showAppNotice({ message: `${selectedCell.address} 单元格内容已复制`, kind: 'success' })
    } catch (copyError) {
      showAppNotice({ message: errorMessage(copyError), kind: 'error' })
    }
  }, [selectedCell])

  useEffect(() => {
    const copyWithKeyboard = (event: KeyboardEvent) => {
      if (!selectedCell || event.key.toLocaleLowerCase() !== 'c' || (!event.ctrlKey && !event.metaKey) || event.altKey) return
      const target = event.target
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || (target instanceof HTMLElement && target.isContentEditable)) return
      if (window.getSelection()?.toString()) return
      event.preventDefault()
      void copySelectedCell()
    }
    window.addEventListener('keydown', copyWithKeyboard)
    return () => window.removeEventListener('keydown', copyWithKeyboard)
  }, [selectedCell, copySelectedCell])
  const runCellSearch = async () => {
    if (!workbook || !sheetName || !cellSearch.trim()) { setMatches([]); setMatchIndex(-1); return }
    try {
      const next = await localBridge.searchConfigTableCells(file.branch, file.relativePath, sheetName, cellSearch, cellSearchMode)
      setMatches(next)
      setMatchIndex(next.length ? 0 : -1)
      showAppNotice({ message: next.length ? `找到 ${next.length} 个结果` : '当前 Sheet 未找到结果', kind: 'success' })
    } catch (nextError) {
      showAppNotice({ message: errorMessage(nextError), kind: 'error' })
    }
  }

  if (loading && !workbook) return <div className="config-viewer-loading"><Spinner label="正在读取配置表" /></div>
  if (error || !workbook) return <div className="config-viewer-loading"><EmptyState title="配置表读取失败"><span>{error ?? '文件不可用'}</span><ToolButton onClick={() => void load()}>重试</ToolButton></EmptyState></div>

  return <section className="config-workbook-viewer" style={{ '--config-table-font-size': `${fontSize}px` } as CSSProperties}>
    <header className="config-workbook-header">
      <div><h2>{workbook.name}</h2><span>{workbook.branch} · {workbook.relativePath} · {formatSize(workbook.size)} · {new Date(workbook.updatedAt).toLocaleString()}</span></div>
      <div>
        <ToolButton onClick={() => void load(true)}><RefreshCw size={14} />刷新表格</ToolButton>
        <ToolButton title="复制文件路径" onClick={() => void copyFilePath(() => localBridge.getConfigTableFilePath(file.branch, file.relativePath))}><ClipboardCopy size={14} /></ToolButton>
        <ToolButton title="打开文件所在位置" onClick={() => void localBridge.revealConfigTableFile(file.branch, file.relativePath)}><FolderOpen size={14} /></ToolButton>
        <ToolButton title="使用默认应用打开" onClick={() => void localBridge.openConfigTableFile(file.branch, file.relativePath)}><ExternalLink size={14} /></ToolButton>
      </div>
    </header>
    <div className="config-workbook-toolbar">
      <div className="config-cell-search"><Search size={14} /><select aria-label="表内搜索模式" value={cellSearchMode} onChange={(event) => { setCellSearchMode(event.target.value as ConfigTableCellSearchMode); setMatches([]); setMatchIndex(-1) }}><option value="contains">模糊搜索</option><option value="exact">全文匹配</option></select><input value={cellSearch} onChange={(event) => setCellSearch(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void runCellSearch() }} placeholder="搜索当前 Sheet 的单元格内容" /><button onClick={() => void runCellSearch()}>查找</button></div>
      <button disabled={!matches.length} onClick={() => setMatchIndex((value) => value <= 0 ? matches.length - 1 : value - 1)}><ChevronLeft size={14} /></button>
      <span>{matches.length ? `${matchIndex + 1}/${matches.length}` : '0/0'}</span>
      <button disabled={!matches.length} onClick={() => setMatchIndex((value) => value >= matches.length - 1 ? 0 : value + 1)}><ChevronRight size={14} /></button>
      <div className="config-font-size-controls">
        <span>字号</span>
        <button aria-label="减小表格字号" disabled={fontSize <= MIN_CONFIG_TABLE_FONT_SIZE} onClick={() => setFontSize((value) => Math.max(MIN_CONFIG_TABLE_FONT_SIZE, value - 1))}>A−</button>
        <output aria-label="当前表格字号">{fontSize}px</output>
        <button aria-label="增大表格字号" disabled={fontSize >= MAX_CONFIG_TABLE_FONT_SIZE} onClick={() => setFontSize((value) => Math.min(MAX_CONFIG_TABLE_FONT_SIZE, value + 1))}>A＋</button>
      </div>
      <div className="config-freeze-controls">
        <label>固定行<input aria-label="固定表头行数" type="number" min={0} max={Math.min(activeSheet?.rowCount ?? 0, MAX_FROZEN_ROWS)} value={frozen.rows} onChange={(event) => updateFrozen('rows', event.currentTarget.valueAsNumber)} /></label>
        <label>固定列<input aria-label="固定表头列数" type="number" min={0} max={Math.min(activeSheet?.columnCount ?? 0, MAX_FROZEN_COLUMNS)} value={frozen.columns} onChange={(event) => updateFrozen('columns', event.currentTarget.valueAsNumber)} /></label>
      </div>
    </div>
    <section className={`config-cell-inspector ${selectedCell ? 'has-selection' : ''}`}>
      <header><strong>{selectedCell?.address ?? '单元格内容'}</strong><span>{selectedCell ? 'Ctrl+C 快速复制' : '选择下方单元格后在这里查看完整内容'}</span><button disabled={!selectedCell} title="复制单元格内容" onClick={() => void copySelectedCell()}><ClipboardCopy size={14} />复制</button></header>
      <textarea aria-label="单元格内容" readOnly value={selectedCell?.text ?? ''} placeholder="尚未选择单元格" onFocus={(event) => event.currentTarget.select()} />
    </section>
    <div className="config-sheet-tabs">
      {workbook.sheets.map((sheet) => <button key={sheet.name} className={sheet.name === sheetName ? 'active' : ''} onClick={() => { setSheetName(sheet.name); setMatches([]); setMatchIndex(-1); setSelectedCell(undefined) }}>{sheet.name}<span>{sheet.rowCount} × {sheet.columnCount}</span></button>)}
    </div>
    <div className="config-sheet-area">
      {activeSheet ? <VirtualSheet branch={file.branch} relativePath={file.relativePath} sheet={activeSheet} refreshKey={refreshKey} target={matches[matchIndex]} selectedAddress={selectedCell?.address} frozenRows={frozen.rows} frozenColumns={frozen.columns} rowHeights={gridSizes.rows} columnWidths={gridSizes.columns} onResizeRow={(row, height) => updateGridSize('rows', row, height)} onResizeColumn={(column, width) => updateGridSize('columns', column, width)} onSelect={setSelectedCell} /> : <EmptyState title="没有可用的工作表" />}
    </div>
  </section>
}

export function LargeWorkbookDialog({ file, onCancel, onOpen, onOpenDefault }: {
  file?: ConfigTableFile
  onCancel: () => void
  onOpen: () => void
  onOpenDefault: () => void
}) {
  return <AlertDialog.Root open={Boolean(file)} onOpenChange={(open) => { if (!open) onCancel() }}>
    <AlertDialog.Portal>
      <AlertDialog.Overlay className="config-large-file-overlay" />
      <AlertDialog.Content className="config-large-file-dialog">
        <div className="config-large-file-icon"><AlertTriangle size={22} /></div>
        <div><AlertDialog.Title>文件较大，确认读取？</AlertDialog.Title><AlertDialog.Description><strong>{file?.name}</strong> 的大小为 {file ? formatSize(file.size) : ''}。在 BayTools 中解析可能需要较长时间，并在读取期间占用较多内存。</AlertDialog.Description></div>
        <div className="config-large-file-actions">
          <AlertDialog.Cancel asChild><button>取消</button></AlertDialog.Cancel>
          <button onClick={onOpenDefault}><ExternalLink size={14} />使用默认工具打开</button>
          <AlertDialog.Action asChild><button className="primary" onClick={onOpen}>坚持打开</button></AlertDialog.Action>
        </div>
      </AlertDialog.Content>
    </AlertDialog.Portal>
  </AlertDialog.Root>
}

export function ConfigTablesPage() {
  const { branch: encodedBranch } = useParams<{ branch?: string }>()
  const branch = encodedBranch ? decodeURIComponent(encodedBranch) : undefined
  const navigate = useNavigate()
  const { configTables, refreshConfigTables } = useAppStore()
  const [search, setSearch] = useState('')
  const deferredSearch = useDeferredValue(search)
  const [mode, setMode] = useState<ConfigTableSearchMode>('tokens')
  const [includeDev, setIncludeDev] = useState(false)
  const [page, setPage] = useState(1)
  const [files, setFiles] = useState<ConfigTableFilePage>()
  const [selected, setSelected] = useState<ConfigTableFile>()
  const [largeFile, setLargeFile] = useState<ConfigTableFile>()
  const [loadingFiles, setLoadingFiles] = useState(false)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState<string>()
  const branchState = configTables?.branches.find((item) => item.name === branch)
  const hasLocalDev = configTables?.branches.some((item) => item.name === 'dev' && item.local) ?? false
  const branchFileCount = !includeDev && !deferredSearch.trim() && files ? files.total : branchState?.fileCount ?? 0

  const updateState = async (action: () => Promise<typeof configTables>, label: string) => {
    setBusy(label)
    try {
      const next = await action()
      if (next) useAppStore.setState({ configTables: next })
      setError(undefined)
      showAppNotice({ message: `${label}完成`, kind: 'success' })
      return true
    } catch (nextError) {
      const message = errorMessage(nextError)
      setError(message)
      showAppNotice({ message, kind: 'error' })
      return false
    } finally {
      setBusy('')
    }
  }

  useEffect(() => {
    setSearch('')
    setPage(1)
    setFiles(undefined)
    setSelected(undefined)
    setLargeFile(undefined)
    setIncludeDev(false)
  }, [branch])

  useEffect(() => {
    if (!branch || !branchState?.local) return
    let cancelled = false
    setLoadingFiles(true)
    void localBridge.searchConfigTableFiles(branch, includeDev, deferredSearch, mode, page).then((next) => {
      if (cancelled) return
      setFiles(next)
      setSelected((current) => current && next.items.some((item) => item.branch === current.branch && item.relativePath === current.relativePath)
        ? current
        : next.items.find((item) => !requiresLargeWorkbookConfirmation(item)))
      setError(undefined)
    }).catch((nextError) => {
      if (!cancelled) setError(errorMessage(nextError))
    }).finally(() => {
      if (!cancelled) setLoadingFiles(false)
    })
    return () => { cancelled = true }
  }, [branch, branchState?.local, includeDev, deferredSearch, mode, page, configTables?.revision])

  if (!branch) return <main className="page config-table-page config-table-home">
    <PageHeader title="配置表" description="只读查看 SVN 工作副本中的 XLSX / XLSM 配置表" actions={<>
      <ToolButton disabled={Boolean(busy) || !configTables?.rootPath} onClick={() => void updateState(() => localBridge.refreshConfigTableLocal(), '刷新本地分支列表')}><RefreshCw size={14} />刷新本地列表</ToolButton>
      <ToolButton disabled={Boolean(busy) || !configTables?.rootPath} onClick={() => void updateState(() => localBridge.syncConfigTableRemote(), '同步远程分支列表')}><Download size={14} />同步远程列表</ToolButton>
    </>} />
    {error && <div className="inline-error">{error}</div>}
    <section className="panel config-root-panel">
      <div><strong>SVN 配置表根目录</strong><span>{configTables?.rootPath || '尚未设置'}</span></div>
      <ToolButton disabled={Boolean(busy)} onClick={async () => {
        const path = await localBridge.selectDirectory()
        if (path) await updateState(() => localBridge.setConfigTableRoot(path), '设置配置表目录')
      }}><FolderOpen size={14} />选择目录</ToolButton>
    </section>
    {!configTables?.rootPath ? <EmptyState title="请先设置配置表目录"><span>选择包含各个分支子目录的 SVN 工作副本目录。</span></EmptyState> : <section className="config-branch-grid">
      {configTables.branches.length ? configTables.branches.map((item) => <article key={item.name} className={`config-branch-card ${item.local ? '' : 'remote-only'}`}>
        <div className="config-branch-icon"><Table2 size={20} /></div>
        <div><strong>{item.name}</strong><span>{item.local ? (item.fileCount === undefined ? '尚未扫描' : `${item.fileCount} 个配置表`) : '远程分支，尚未下载'}</span>{item.lastScannedAt && <small>扫描于 {new Date(item.lastScannedAt).toLocaleString()}</small>}</div>
        {item.local ? <ToolButton onClick={() => navigate(`/config-tables/${encodeURIComponent(item.name)}`)}>打开</ToolButton> : <ToolButton disabled={Boolean(busy)} onClick={async () => {
          if (await updateState(() => localBridge.downloadConfigTableBranch(item.name), `下载分支 ${item.name}`)) navigate(`/config-tables/${encodeURIComponent(item.name)}`)
        }}><Download size={14} />下载</ToolButton>}
      </article>) : <EmptyState title="没有发现分支"><span>请确认根目录正确，然后刷新本地列表或同步远程列表。</span></EmptyState>}
    </section>}
  </main>

  if (!branchState) return <main className="page config-table-page"><EmptyState title="分支不存在"><Link to="/config-tables">返回配置表主页</Link></EmptyState></main>
  if (!branchState.local) return <main className="page config-table-page"><PageHeader title={branch} description="远程分支尚未下载" /><EmptyState title="需要先下载这个分支"><ToolButton disabled={Boolean(busy)} onClick={async () => { if (await updateState(() => localBridge.downloadConfigTableBranch(branch), `下载分支 ${branch}`)) await refreshConfigTables() }}><Download size={14} />下载分支</ToolButton></EmptyState></main>

  return <main className="config-table-page config-branch-page">
    <header className="config-branch-header">
      <div><Link to="/config-tables">配置表</Link><ChevronRight size={13} /><h1>{branch}</h1><span>{branchFileCount} 个配置表</span></div>
      <div>
        <ToolButton disabled={Boolean(busy)} onClick={async () => { if (await updateState(() => localBridge.updateConfigTableBranch(branch), `SVN 更新 ${branch}`)) setPage(1) }}><Download size={14} />SVN 更新当前分支</ToolButton>
        <ToolButton disabled={Boolean(busy)} onClick={async () => { if (await updateState(() => localBridge.scanConfigTableBranch(branch), `重新扫描 ${branch}`)) setPage(1) }}><RefreshCw size={14} />重新扫描内容</ToolButton>
        <ToolButton title="打开分支目录" onClick={() => void localBridge.revealConfigTableBranch(branch)}><FolderOpen size={14} /></ToolButton>
      </div>
    </header>
    {error && <div className="config-page-error">{error}<button onClick={() => setError(undefined)}>×</button></div>}
    <div className="config-branch-shell">
      <aside className="config-file-panel">
        <div className="config-file-search">
          <select value={includeDev ? 'current-dev' : 'current'} onChange={(event) => { setIncludeDev(event.target.value === 'current-dev'); setPage(1) }}>
            <option value="current">当前分支</option>
            <option value="current-dev" disabled={!hasLocalDev || branch === 'dev'}>当前分支 + dev</option>
          </select>
          <select value={mode} onChange={(event) => { setMode(event.target.value as ConfigTableSearchMode); setPage(1) }}><option value="tokens">词元匹配</option><option value="exact">完整文件名匹配</option></select>
          <label><Search size={14} /><input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1) }} placeholder="按文件名搜索，空格分隔词元" /></label>
        </div>
        <div className="config-file-summary"><span>{files?.total ?? 0} 个文件</span>{loadingFiles && <span>读取中…</span>}</div>
        <div className="config-file-list">
          {files?.items.map((file) => <div key={`${file.branch}:${file.relativePath}`} className={`config-file-row ${selected?.branch === file.branch && selected.relativePath === file.relativePath ? 'active' : ''}`} onClick={() => { if (requiresLargeWorkbookConfirmation(file)) setLargeFile(file); else setSelected(file) }}>
            <FileSpreadsheet size={17} />
            <div><strong>{file.name}</strong><span>{file.branch} · {file.relativePath}</span><small>{formatSize(file.size)} · {new Date(file.updatedAt).toLocaleString()}</small></div>
            <button title="打开文件所在位置" onClick={(event) => { event.stopPropagation(); void localBridge.revealConfigTableFile(file.branch, file.relativePath) }}><FolderOpen size={13} /></button>
            <button title="使用默认应用打开" onClick={(event) => { event.stopPropagation(); void localBridge.openConfigTableFile(file.branch, file.relativePath) }}><ExternalLink size={13} /></button>
          </div>)}
          {!loadingFiles && files && !files.items.length && <EmptyState title="没有匹配的配置表" />}
        </div>
        <footer className="config-file-pagination"><button disabled={!files || files.page <= 1} onClick={() => setPage((value) => value - 1)}><ChevronLeft size={14} /></button><span>{files?.page ?? 1} / {files?.totalPages ?? 1}</span><button disabled={!files || files.page >= files.totalPages} onClick={() => setPage((value) => value + 1)}><ChevronRight size={14} /></button></footer>
      </aside>
      <div className="config-viewer-panel">{selected ? <WorkbookViewer key={`${selected.branch}:${selected.relativePath}`} file={selected} /> : <EmptyState title="选择一个配置表"><span>在左侧选择 XLSX 或 XLSM 文件后查看内容。</span></EmptyState>}</div>
    </div>
    <LargeWorkbookDialog file={largeFile} onCancel={() => setLargeFile(undefined)} onOpen={() => { if (largeFile) setSelected(largeFile); setLargeFile(undefined) }} onOpenDefault={() => {
      const file = largeFile
      setLargeFile(undefined)
      if (!file) return
      void localBridge.openConfigTableFile(file.branch, file.relativePath).then(() => showAppNotice({ message: `已使用默认工具打开 ${file.name}`, kind: 'success' })).catch((openError) => showAppNotice({ message: errorMessage(openError), kind: 'error' }))
    }} />
  </main>
}
