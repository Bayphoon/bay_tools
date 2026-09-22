// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import type { AppSettings } from '../../shared/types'
import { useAppStore } from '../store/appStore'
import { Sidebar } from './Sidebar'

const settings: AppSettings = {
  schemaVersion: 1,
  updatedAt: '2026-09-16T00:00:00.000Z',
  revision: 1,
  theme: { mode: 'light', lightAccent: '#3B82F6', darkAccent: '#60A5FA', manualBlend: 0, sunrise: '06:00', sunset: '19:00', transitionMinutes: 30 },
  sidebar: { collapsedGroups: [], width: 252 },
  workSchedule: { workDays: [1, 2, 3, 4, 5], start: '10:00', lunchStart: '12:30', lunchEnd: '14:00', dinnerStart: '18:30', end: '19:30' },
}

beforeEach(() => {
  useAppStore.setState({
    settings,
    jsonFolders: [{ id: 'folder-1', name: 'JSON 分组', createdAt: settings.updatedAt, updatedAt: settings.updatedAt }],
    jsonWorkspaces: [{ id: 'workspace-1', title: '分组中的 JSON', folderId: 'folder-1', createdAt: settings.updatedAt, updatedAt: settings.updatedAt }],
    languageSources: [],
    managedMarkdown: { schemaVersion: 1, updatedAt: settings.updatedAt, revision: 1, folders: [], documents: [] },
    markdownTrees: [{
      id: 'source-1', label: '扫描文档', path: 'D:\\docs', createdAt: settings.updatedAt,
      children: [{ name: '章节目录', relativePath: '章节目录', type: 'directory', children: [{ name: '说明.md', relativePath: '章节目录/说明.md', type: 'file', extension: '.md', previewKind: 'markdown', size: 10, updatedAt: settings.updatedAt }] }],
    }],
    saveSettings: vi.fn(async () => undefined),
  })
})

afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('Sidebar nested collapse state', () => {
  it('applies the saved custom order to root tool tabs while keeping home first', () => {
    useAppStore.setState({ settings: { ...settings, sidebar: { ...settings.sidebar, toolOrder: ['server-status', 'bookmarks', 'json', 'markdown', 'code-cards', 'files', 'config-tables', 'timestamp', 'color', 'translation', 'language'] } } })
    render(<MemoryRouter initialEntries={['/']}><Sidebar /></MemoryRouter>)
    expect(screen.getByRole('link', { name: '主页' }).style.order).toBe('0')
    expect(screen.getByRole('link', { name: '服务器状态' }).style.order).toBe('1')
    expect(screen.getByRole('link', { name: '书签' }).style.order).toBe('2')
    expect(screen.getByRole('button', { name: 'JSON 工具' }).closest('.nav-group')?.getAttribute('style')).toContain('order: 3')
  })

  it('keeps a JSON folder collapsed after its parent tab is closed and reopened', () => {
    render(<MemoryRouter initialEntries={['/json/workspace-1']}><Sidebar /></MemoryRouter>)
    expect(screen.getByText('分组中的 JSON')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'JSON 分组' }))
    expect(screen.queryByText('分组中的 JSON')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'JSON 工具' }))
    fireEvent.click(screen.getByRole('button', { name: 'JSON 工具' }))
    expect(screen.queryByText('分组中的 JSON')).toBeNull()
    expect(useAppStore.getState().saveSettings).toHaveBeenCalledWith(expect.objectContaining({ sidebar: expect.objectContaining({ collapsedGroups: expect.arrayContaining(['json-folder:folder-1']) }) }))
  })

  it('keeps a scanned directory collapsed after the document tab is closed and reopened', () => {
    render(<MemoryRouter initialEntries={['/markdown/source-1?path=%E7%AB%A0%E8%8A%82%E7%9B%AE%E5%BD%95%2F%E8%AF%B4%E6%98%8E.md']}><Sidebar /></MemoryRouter>)
    expect(screen.getByText('说明.md')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '章节目录' }))
    expect(screen.queryByText('说明.md')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '文档' }))
    fireEvent.click(screen.getByRole('button', { name: '文档' }))
    expect(screen.queryByText('说明.md')).toBeNull()
    expect(useAppStore.getState().saveSettings).toHaveBeenCalledWith(expect.objectContaining({ sidebar: expect.objectContaining({ collapsedGroups: expect.arrayContaining(['markdown-directory:source-1:章节目录']) }) }))
  })
})
