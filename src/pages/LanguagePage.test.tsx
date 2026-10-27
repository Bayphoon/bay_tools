// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LanguageSource } from '../../shared/types'
import { localBridge } from '../lib/api'
import { useAppStore } from '../store/appStore'
import { LanguagePage } from './LanguagePage'

const source: LanguageSource = {
  schemaVersion: 1, id: 'language-1', revision: 1, title: '未命名语种', url: '',
  createdAt: '2026-10-27T00:00:00.000Z', updatedAt: '2026-10-27T00:00:00.000Z', entryCount: 0, favorites: [],
}

function renderPage() {
  return render(<MemoryRouter initialEntries={['/language/language-1']}><Routes><Route path="/language/:id" element={<LanguagePage />} /></Routes></MemoryRouter>)
}

beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value() { this.setAttribute('open', '') } })
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value() { this.removeAttribute('open') } })
  vi.spyOn(localBridge, 'getLanguageSource').mockResolvedValue(source)
  vi.spyOn(localBridge, 'updateLanguageSourceUrl').mockImplementation(async (_id, url) => ({ ...source, url, revision: 2 }))
  vi.spyOn(localBridge, 'syncLanguageSource').mockResolvedValue(source)
  vi.spyOn(localBridge, 'searchLanguageEntries').mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 10, totalPages: 1 })
  vi.spyOn(localBridge, 'searchLanguageFavorites').mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 10, totalPages: 1 })
  useAppStore.setState({ refreshLanguages: vi.fn(async () => undefined) })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal')
  Reflect.deleteProperty(HTMLDialogElement.prototype, 'close')
})

describe('LanguagePage top controls', () => {
  it('saves the URL from a dialog without synchronizing, then reveals the sync button', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: '配置链接' }))
    fireEvent.change(screen.getByLabelText('TXT 文件链接'), { target: { value: 'https://example.test/zh_CN.txt' } })
    fireEvent.click(screen.getByRole('button', { name: '保存配置' }))

    await waitFor(() => expect(localBridge.updateLanguageSourceUrl).toHaveBeenCalledWith('language-1', 'https://example.test/zh_CN.txt', 1))
    expect(localBridge.syncLanguageSource).not.toHaveBeenCalled()
    expect(await screen.findByRole('button', { name: '修改配置' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '同步' })).toBeTruthy()
  })

  it('keeps the results and favorites below the centered main search', async () => {
    renderPage()
    await screen.findByRole('button', { name: '配置链接' })
    const search = screen.getByPlaceholderText('输入 key 或多语言内容')
    const hero = search.closest('.language-primary-search')!
    const results = screen.getByRole('heading', { name: '搜索结果' }).closest('.language-section')!
    const favorites = screen.getByRole('heading', { name: '收藏' }).closest('.favorites-section')!
    expect(hero.compareDocumentPosition(results) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(results.compareDocumentPosition(favorites) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByPlaceholderText('搜索收藏的 key 或内容')).toBeTruthy()
  })
})
