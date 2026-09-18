// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConfigTableFile, ConfigTableRange } from '../../shared/types'
import { localBridge } from '../lib/api'
import { WorkbookViewer } from './ConfigTablesPage'

const file: ConfigTableFile = {
  branch: 'dev',
  name: 'sample.xlsx',
  relativePath: 'sample.xlsx',
  size: 128,
  updatedAt: '2026-09-18T00:00:00.000Z',
}

beforeEach(() => {
  window.localStorage.clear()
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
})

afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('ConfigTablesPage workbook viewer', () => {
  it('shows selected cell content between search and sheet tabs and copies it with Ctrl+C', async () => {
    render(<WorkbookViewer file={file} />)
    const cell = await screen.findByRole('button', { name: '完整的单元格内容' })
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
    await screen.findByRole('button', { name: '完整的单元格内容' })
    const rangeSpy = vi.mocked(localBridge.getConfigTableRange)
    rangeSpy.mockClear()

    fireEvent.change(screen.getByLabelText('固定表头行数'), { target: { value: '3' } })
    fireEvent.change(screen.getByLabelText('固定表头列数'), { target: { value: '2' } })

    await waitFor(() => expect(rangeSpy).toHaveBeenCalled())
    expect((screen.getByLabelText('固定表头行数') as HTMLInputElement).value).toBe('3')
    expect((screen.getByLabelText('固定表头列数') as HTMLInputElement).value).toBe('2')
  })

  it('adjusts the table font size and keeps the preference locally', async () => {
    const { container } = render(<WorkbookViewer file={file} />)
    await screen.findByRole('button', { name: '完整的单元格内容' })
    const viewer = container.querySelector('.config-workbook-viewer') as HTMLElement
    expect(viewer.style.getPropertyValue('--config-table-font-size')).toBe('12px')

    fireEvent.click(screen.getByRole('button', { name: '增大表格字号' }))
    expect(viewer.style.getPropertyValue('--config-table-font-size')).toBe('13px')
    await waitFor(() => expect(window.localStorage.getItem('baytools.config-table.font-size')).toBe('13'))
  })
})
