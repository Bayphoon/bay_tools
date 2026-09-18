import { ChevronLeft, ChevronRight, ClipboardCopy, Download, ExternalLink, FileSpreadsheet, FolderOpen, RefreshCw, Search, Table2 } from 'lucide-react'
import { useDeferredValue, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import type { ConfigTableCellMatch, ConfigTableFile, ConfigTableFilePage, ConfigTableRange, ConfigTableSearchMode, ConfigTableSheet, ConfigTableWorkbook } from '../../shared/types'
import { EmptyState, PageHeader, Spinner, ToolButton } from '../components/ui'
import { copyFilePath, showAppNotice } from '../lib/clipboard'
import { localBridge } from '../lib/api'
import { useAppStore } from '../store/appStore'

const ROW_HEIGHT = 28
const COLUMN_WIDTH = 148
const ROW_HEADER_WIDTH = 54
const COLUMN_HEADER_HEIGHT = 30

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

function VirtualSheet({ branch, relativePath, sheet, refreshKey, target, onSelect }: {
  branch: string
  relativePath: string
  sheet: ConfigTableSheet
  refreshKey: number
  target?: ConfigTableCellMatch
  onSelect: (cell: { address: string; text: string }) => void
}) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ top: 0, left: 0 })
  const [range, setRange] = useState<ConfigTableRange>()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>()
  const startRow = Math.max(1, Math.floor(Math.max(0, position.top - COLUMN_HEADER_HEIGHT) / ROW_HEIGHT) + 1 - 12)
  const startColumn = Math.max(1, Math.floor(Math.max(0, position.left - ROW_HEADER_WIDTH) / COLUMN_WIDTH) + 1 - 3)

  useEffect(() => {
    setRange(undefined)
    setPosition({ top: 0, left: 0 })
    if (viewportRef.current) viewportRef.current.scrollTo({ top: 0, left: 0 })
  }, [branch, relativePath, sheet.name])

  useEffect(() => {
    let cancelled = false
    const timer = window.setTimeout(() => {
      setLoading(true)
      void localBridge.getConfigTableRange(branch, relativePath, sheet.name, startRow, 100, startColumn, 30).then((next) => {
        if (!cancelled) { setRange(next); setError(undefined) }
      }).catch((nextError) => {
        if (!cancelled) setError(errorMessage(nextError))
      }).finally(() => {
        if (!cancelled) setLoading(false)
      })
    }, 80)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [branch, relativePath, sheet.name, startRow, startColumn, refreshKey])

  useEffect(() => {
    if (!target || !viewportRef.current) return
    viewportRef.current.scrollTo({
      top: Math.max(0, (target.row - 1) * ROW_HEIGHT - ROW_HEIGHT * 3),
      left: Math.max(0, (target.column - 1) * COLUMN_WIDTH - COLUMN_WIDTH * 2),
      behavior: 'smooth',
    })
    onSelect({ address: target.address, text: target.text })
  }, [target, onSelect])

  const visibleStartRow = Math.max(1, Math.floor(Math.max(0, position.top - COLUMN_HEADER_HEIGHT) / ROW_HEIGHT) + 1)
  const visibleStartColumn = Math.max(1, Math.floor(Math.max(0, position.left - ROW_HEADER_WIDTH) / COLUMN_WIDTH) + 1)
  const visibleRows = Array.from({ length: Math.max(0, Math.min(46, sheet.rowCount - visibleStartRow + 1)) }, (_, index) => visibleStartRow + index)
  const visibleColumns = Array.from({ length: Math.max(0, Math.min(18, sheet.columnCount - visibleStartColumn + 1)) }, (_, index) => visibleStartColumn + index)
  const valueAt = (row: number, column: number) => {
    if (!range) return ''
    const rowOffset = row - range.startRow
    const columnOffset = column - range.startColumn
    return range.values[rowOffset]?.[columnOffset] ?? ''
  }

  if (!sheet.rowCount || !sheet.columnCount) return <EmptyState title="工作表为空"><span>该 Sheet 没有可显示的单元格。</span></EmptyState>

  return <div className="config-grid-wrap">
    {error && <div className="config-grid-error">{error}</div>}
    <div ref={viewportRef} className="config-grid-viewport" onScroll={(event) => setPosition({ top: event.currentTarget.scrollTop, left: event.currentTarget.scrollLeft })}>
      <div className="config-grid-canvas" style={{ width: ROW_HEADER_WIDTH + sheet.columnCount * COLUMN_WIDTH, height: COLUMN_HEADER_HEIGHT + sheet.rowCount * ROW_HEIGHT }}>
        <div className="config-grid-corner" style={{ top: position.top, left: position.left }} />
        {visibleColumns.map((column) => <div key={`header-${column}`} className="config-grid-column-header" style={{ top: position.top, left: ROW_HEADER_WIDTH + (column - 1) * COLUMN_WIDTH }}>{columnLabel(column)}</div>)}
        {visibleRows.map((row) => <div key={`row-${row}`} className="config-grid-row-header" style={{ top: COLUMN_HEADER_HEIGHT + (row - 1) * ROW_HEIGHT, left: position.left }}>{row}</div>)}
        {visibleRows.flatMap((row) => visibleColumns.map((column) => {
          const text = valueAt(row, column)
          const address = `${columnLabel(column)}${row}`
          const selected = target?.row === row && target.column === column
          return <button key={`${row}-${column}`} className={`config-grid-cell ${selected ? 'search-match' : ''}`} style={{ top: COLUMN_HEADER_HEIGHT + (row - 1) * ROW_HEIGHT, left: ROW_HEADER_WIDTH + (column - 1) * COLUMN_WIDTH }} title={text} onClick={() => onSelect({ address, text })}>{text}</button>
        }))}
      </div>
    </div>
    {loading && <div className="config-grid-loading">读取中…</div>}
  </div>
}

function WorkbookViewer({ file }: { file: ConfigTableFile }) {
  const [workbook, setWorkbook] = useState<ConfigTableWorkbook>()
  const [sheetName, setSheetName] = useState('')
  const [refreshKey, setRefreshKey] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()
  const [cellSearch, setCellSearch] = useState('')
  const [matches, setMatches] = useState<ConfigTableCellMatch[]>([])
  const [matchIndex, setMatchIndex] = useState(-1)
  const [selectedCell, setSelectedCell] = useState<{ address: string; text: string }>()

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
    void load()
    // The file identity is the intended reload boundary.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file.branch, file.relativePath])

  const activeSheet = workbook?.sheets.find((sheet) => sheet.name === sheetName)
  const runCellSearch = async () => {
    if (!workbook || !sheetName || !cellSearch.trim()) { setMatches([]); setMatchIndex(-1); return }
    try {
      const next = await localBridge.searchConfigTableCells(file.branch, file.relativePath, sheetName, cellSearch)
      setMatches(next)
      setMatchIndex(next.length ? 0 : -1)
      showAppNotice({ message: next.length ? `找到 ${next.length} 个结果` : '当前 Sheet 未找到结果', kind: 'success' })
    } catch (nextError) {
      showAppNotice({ message: errorMessage(nextError), kind: 'error' })
    }
  }

  if (loading && !workbook) return <div className="config-viewer-loading"><Spinner label="正在读取配置表" /></div>
  if (error || !workbook) return <div className="config-viewer-loading"><EmptyState title="配置表读取失败"><span>{error ?? '文件不可用'}</span><ToolButton onClick={() => void load()}>重试</ToolButton></EmptyState></div>

  return <section className="config-workbook-viewer">
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
      <div className="config-cell-search"><Search size={14} /><input value={cellSearch} onChange={(event) => setCellSearch(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void runCellSearch() }} placeholder="搜索当前 Sheet 的单元格内容" /><button onClick={() => void runCellSearch()}>查找</button></div>
      <button disabled={!matches.length} onClick={() => setMatchIndex((value) => value <= 0 ? matches.length - 1 : value - 1)}><ChevronLeft size={14} /></button>
      <span>{matches.length ? `${matchIndex + 1}/${matches.length}` : '0/0'}</span>
      <button disabled={!matches.length} onClick={() => setMatchIndex((value) => value >= matches.length - 1 ? 0 : value + 1)}><ChevronRight size={14} /></button>
      {selectedCell && <button className="config-selected-cell" title="复制单元格内容" onClick={async () => { await navigator.clipboard.writeText(selectedCell.text); showAppNotice({ message: `${selectedCell.address} 已复制`, kind: 'success' }) }}><strong>{selectedCell.address}</strong><span>{selectedCell.text || '（空）'}</span><ClipboardCopy size={13} /></button>}
    </div>
    <div className="config-sheet-tabs">
      {workbook.sheets.map((sheet) => <button key={sheet.name} className={sheet.name === sheetName ? 'active' : ''} onClick={() => { setSheetName(sheet.name); setMatches([]); setMatchIndex(-1) }}>{sheet.name}<span>{sheet.rowCount} × {sheet.columnCount}</span></button>)}
    </div>
    <div className="config-sheet-area">
      {activeSheet ? <VirtualSheet branch={file.branch} relativePath={file.relativePath} sheet={activeSheet} refreshKey={refreshKey} target={matches[matchIndex]} onSelect={setSelectedCell} /> : <EmptyState title="没有可用的工作表" />}
    </div>
  </section>
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
  const [loadingFiles, setLoadingFiles] = useState(false)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState<string>()
  const branchState = configTables?.branches.find((item) => item.name === branch)
  const hasLocalDev = configTables?.branches.some((item) => item.name === 'dev' && item.local) ?? false

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
    setIncludeDev(false)
  }, [branch])

  useEffect(() => {
    if (!branch || !branchState?.local) return
    let cancelled = false
    setLoadingFiles(true)
    void localBridge.searchConfigTableFiles(branch, includeDev, deferredSearch, mode, page).then((next) => {
      if (cancelled) return
      setFiles(next)
      setSelected((current) => current && next.items.some((item) => item.branch === current.branch && item.relativePath === current.relativePath) ? current : next.items[0])
      setError(undefined)
    }).catch((nextError) => {
      if (!cancelled) setError(errorMessage(nextError))
    }).finally(() => {
      if (!cancelled) setLoadingFiles(false)
    })
    return () => { cancelled = true }
  }, [branch, branchState?.local, includeDev, deferredSearch, mode, page, configTables?.revision])

  if (!branch) return <main className="page config-table-page config-table-home">
    <PageHeader title="配置表" description="只读查看 SVN 工作副本中的 XLSX 配置表" actions={<>
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
        <div><strong>{item.name}</strong><span>{item.local ? (item.fileCount === undefined ? '尚未扫描' : `${item.fileCount} 个 XLSX`) : '远程分支，尚未下载'}</span>{item.lastScannedAt && <small>扫描于 {new Date(item.lastScannedAt).toLocaleString()}</small>}</div>
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
      <div><Link to="/config-tables">配置表</Link><ChevronRight size={13} /><h1>{branch}</h1><span>{branchState.fileCount ?? 0} 个 XLSX</span></div>
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
          {files?.items.map((file) => <div key={`${file.branch}:${file.relativePath}`} className={`config-file-row ${selected?.branch === file.branch && selected.relativePath === file.relativePath ? 'active' : ''}`} onClick={() => setSelected(file)}>
            <FileSpreadsheet size={17} />
            <div><strong>{file.name}</strong><span>{file.branch} · {file.relativePath}</span><small>{formatSize(file.size)} · {new Date(file.updatedAt).toLocaleString()}</small></div>
            <button title="打开文件所在位置" onClick={(event) => { event.stopPropagation(); void localBridge.revealConfigTableFile(file.branch, file.relativePath) }}><FolderOpen size={13} /></button>
            <button title="使用默认应用打开" onClick={(event) => { event.stopPropagation(); void localBridge.openConfigTableFile(file.branch, file.relativePath) }}><ExternalLink size={13} /></button>
          </div>)}
          {!loadingFiles && files && !files.items.length && <EmptyState title="没有匹配的配置表" />}
        </div>
        <footer className="config-file-pagination"><button disabled={!files || files.page <= 1} onClick={() => setPage((value) => value - 1)}><ChevronLeft size={14} /></button><span>{files?.page ?? 1} / {files?.totalPages ?? 1}</span><button disabled={!files || files.page >= files.totalPages} onClick={() => setPage((value) => value + 1)}><ChevronRight size={14} /></button></footer>
      </aside>
      <div className="config-viewer-panel">{selected ? <WorkbookViewer key={`${selected.branch}:${selected.relativePath}`} file={selected} /> : <EmptyState title="选择一个配置表"><span>在左侧选择 XLSX 文件后查看内容。</span></EmptyState>}</div>
    </div>
  </main>
}
