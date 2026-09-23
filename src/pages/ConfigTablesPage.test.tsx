// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import type { ConfigTableFile, ConfigTableRange } from '../../shared/types'
import { localBridge } from '../lib/api'
import { useAppStore } from '../store/appStore'
import { CONFIG_TABLE_LARGE_FILE_THRESHOLD, ConfigTablesPage, LargeWorkbookDialog, requiresLargeWorkbookConfirmation, WorkbookViewer } from './ConfigTablesPage'

const file: ConfigTableFile = {
  branch: 'dev',
  name: 'sample.xlsx',
  relativePath: 'sample.xlsx',
  size: 128,
  updatedAt: '2026-09-18T00:00:00.000Z',
}

beforeEach(() => {
  window.localStorage.clear()
  useAppStore.setState({ configTables: { schemaVersion: 1, updatedAt: file.updatedAt, revision: 1, rootPath: '', defaultFrozenRows: 8, defaultFrozenColumns: 1, branches: [] } })
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: vi.fn() })
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn(async () => undefined) } })
  vi.spyOn(localBridge, 'getConfigTableWorkbook').mockResolvedValue({
    ...file,
    sheets: [{ name: 'Config', rowCount: 8, columnCount: 6 }],
  })
  vi.spyOn(localBridge, 'getConfigTableRange').mockImplementation(async (_branch, _path, sheet, startRow, rowCount, startColumn, columnCount): Promise<ConfigTableRange> => ({
    sheet,
    startRow,
    rowCount,
    startColumn,
    columnCount,
    values: Array.from({ length: rowCount }, (_, rowOffset) => Array.from({ length: columnCount }, (_, columnOffset) => startRow + rowOffset === 1 && startColumn + columnOffset === 1 ? '完整的单元格内容' : '')),
  }))
  vi.spyOn(localBridge, 'searchConfigTableCells').mockResolvedValue([{ row: 1, column: 1, address: 'A1', text: '完整的单元格内容' }])
})

afterEach(() => { cleanup(); useAppStore.setState({ configTables: undefined }); vi.restoreAllMocks() })

describe('ConfigTablesPage workbook viewer', () => {
  it('shows selected cell content between search and sheet tabs and copies it with Ctrl+C', async () => {
    render(<WorkbookViewer file={file} />)
    const cell = await screen.findByRole('button', { name: '完整的单元格内容' }, { timeout: 3000 })
    fireEvent.click(cell)

    const content = screen.getByLabelText('单元格内容') as HTMLTextAreaElement
    expect(content.value).toBe('完整的单元格内容')
    const inspector = content.closest('section') as HTMLElement
    const toolbar = document.querySelector('.config-workbook-toolbar') as HTMLElement
    const tabs = document.querySelector('.config-sheet-tabs') as HTMLElement
    expect(toolbar.compareDocumentPosition(inspector) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(inspector.compareDocumentPosition(tabs) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    fireEvent.keyDown(cell, { key: 'c', ctrlKey: true })
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith('完整的单元格内容'))
  })

  it('loads additional ranges for multiple frozen rows and columns', async () => {
    render(<WorkbookViewer file={file} />)
    await screen.findByRole('button', { name: '完整的单元格内容' }, { timeout: 3000 })
    expect((screen.getByLabelText('固定表头行数') as HTMLInputElement).value).toBe('8')
    expect((screen.getByLabelText('固定表头列数') as HTMLInputElement).value).toBe('1')
    const rangeSpy = vi.mocked(localBridge.getConfigTableRange)
    rangeSpy.mockClear()

    fireEvent.change(screen.getByLabelText('固定表头行数'), { target: { value: '3' } })
    fireEvent.change(screen.getByLabelText('固定表头列数'), { target: { value: '2' } })

    await waitFor(() => expect(rangeSpy).toHaveBeenCalled())
    expect((screen.getByLabelText('固定表头行数') as HTMLInputElement).value).toBe('3')
    expect((screen.getByLabelText('固定表头列数') as HTMLInputElement).value).toBe('2')
  })

  it('limits default frozen counts to a short sheet and saves new defaults', async () => {
    vi.mocked(localBridge.getConfigTableWorkbook).mockResolvedValueOnce({ ...file, sheets: [{ name: 'Short', rowCount: 3, columnCount: 1 }] })
    render(<WorkbookViewer file={file} />)
    await screen.findByRole('button', { name: '完整的单元格内容' }, { timeout: 3000 })
    expect((screen.getByLabelText('固定表头行数') as HTMLInputElement).value).toBe('3')
    expect((screen.getByLabelText('固定表头列数') as HTMLInputElement).value).toBe('1')
  })

  it('adjusts the table font size and keeps the preference locally', async () => {
    const { container } = render(<WorkbookViewer file={file} />)
    await screen.findByRole('button', { name: '完整的单元格内容' }, { timeout: 3000 })
    const viewer = container.querySelector('.config-workbook-viewer') as HTMLElement
    expect(viewer.style.getPropertyValue('--config-table-font-size')).toBe('12px')

    fireEvent.click(screen.getByRole('button', { name: '增大表格字号' }))
    expect(viewer.style.getPropertyValue('--config-table-font-size')).toBe('13px')
    await waitFor(() => expect(window.localStorage.getItem('baytools.config-table.font-size')).toBe('13'))
  })

  it('supports token and exact cell search modes', async () => {
    render(<WorkbookViewer file={file} />)
    await screen.findByRole('button', { name: '完整的单元格内容' }, { timeout: 3000 })
    fireEvent.change(screen.getByLabelText('表内搜索模式'), { target: { value: 'exact' } })
    fireEvent.change(screen.getByPlaceholderText('搜索单元格内容，空格分隔词元'), { target: { value: '完整的单元格内容' } })
    fireEvent.click(screen.getByRole('button', { name: '查找' }))
    await waitFor(() => expect(localBridge.searchConfigTableCells).toHaveBeenCalledWith('dev', 'sample.xlsx', 'Config', '完整的单元格内容', 'exact'))
    fireEvent.click(screen.getByRole('button', { name: '清空表内搜索' }))
    const searchInput = screen.getByPlaceholderText('搜索单元格内容，空格分隔词元') as HTMLInputElement
    expect(searchInput.value).toBe('')
    expect(screen.getByText('0/0')).toBeTruthy()
    fireEvent.change(searchInput, { target: { value: '再次搜索' } })
    fireEvent.keyDown(searchInput, { key: 'Escape' })
    expect(searchInput.value).toBe('')
  })

  it('resizes an individual column by dragging its header boundary', async () => {
    render(<WorkbookViewer file={file} />)
    const cell = await screen.findByRole('button', { name: '完整的单元格内容' }, { timeout: 3000 })
    fireEvent.pointerDown(screen.getByRole('button', { name: '调整 A 列宽' }), { button: 0, clientX: 100 })
    fireEvent.pointerMove(window, { clientX: 160 })
    fireEvent.pointerUp(window)
    expect((cell as HTMLElement).style.width).toBe('208px')
  })
})

describe('config table freeze defaults', () => {
  it('saves defaults from the tool home page', async () => {
    vi.spyOn(localBridge, 'setConfigTableFreezeDefaults').mockImplementation(async (rows, columns) => ({ ...useAppStore.getState().configTables!, defaultFrozenRows: rows, defaultFrozenColumns: columns, revision: 2 }))
    render(<MemoryRouter initialEntries={['/config-tables']}><ConfigTablesPage /></MemoryRouter>)
    expect((screen.getByLabelText('默认固定行数') as HTMLInputElement).value).toBe('8')
    expect((screen.getByLabelText('默认固定列数') as HTMLInputElement).value).toBe('1')
    fireEvent.change(screen.getByLabelText('默认固定行数'), { target: { value: '5' } })
    fireEvent.change(screen.getByLabelText('默认固定列数'), { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: '保存默认值' }))
    await waitFor(() => expect(localBridge.setConfigTableFreezeDefaults).toHaveBeenCalledWith(5, 2, 1))
    await waitFor(() => expect(useAppStore.getState().configTables).toMatchObject({ defaultFrozenRows: 5, defaultFrozenColumns: 2 }))
  })
})

describe('large config workbook confirmation', () => {
  it('requires confirmation at the size threshold and offers both open actions', () => {
    const largeFile = { ...file, size: CONFIG_TABLE_LARGE_FILE_THRESHOLD + 1 }
    expect(requiresLargeWorkbookConfirmation({ ...file, size: CONFIG_TABLE_LARGE_FILE_THRESHOLD })).toBe(false)
    expect(requiresLargeWorkbookConfirmation(largeFile)).toBe(true)
    const onOpen = vi.fn()
    const onOpenDefault = vi.fn()
    render(<LargeWorkbookDialog file={largeFile} onCancel={vi.fn()} onOpen={onOpen} onOpenDefault={onOpenDefault} />)
    expect(screen.getByText('文件较大，确认读取？')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '使用默认工具打开' }))
    expect(onOpenDefault).toHaveBeenCalledOnce()
  })
})
