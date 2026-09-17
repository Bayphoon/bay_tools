// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TranslationEntry } from '../../shared/translation'
import { translationApi } from '../lib/api'
import { ActionConfirmationHost } from '../components/ActionConfirmationHost'
import { TranslationPage } from './TranslationPage'

vi.mock('../lib/api', () => ({ translationApi: { getConfig: vi.fn(), listHistory: vi.fn(), deleteHistory: vi.fn(), translate: vi.fn() } }))
const entry: TranslationEntry = { id: 'history-1', createdAt: '2026-09-05T10:00:00.000Z', text: '你好世界', translation: 'Hello world', sourceLanguage: '简体中文', targetLanguage: '英语', model: 'deepseek-v4-flash' }
beforeEach(() => {
  vi.mocked(translationApi.getConfig).mockResolvedValue({ configured: true, source: 'local', canSaveKey: true, hasLocalKey: true })
  vi.mocked(translationApi.listHistory).mockResolvedValue([entry])
  vi.mocked(translationApi.deleteHistory).mockResolvedValue(undefined)
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.clearAllMocks() })
const mount = () => render(<MemoryRouter><TranslationPage /><ActionConfirmationHost /></MemoryRouter>)

describe('translation page', () => {
  it('searches and loads history without issuing a paid translation request', async () => {
    mount()
    const history = await screen.findByRole('button', { name: /你好世界/ })
    fireEvent.click(history)
    expect((screen.getByLabelText('待翻译文本') as HTMLTextAreaElement).value).toBe('你好世界')
    expect((screen.getByLabelText('译文') as HTMLTextAreaElement).value).toBe('Hello world')
    expect(translationApi.translate).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText('搜索翻译历史'), { target: { value: '不存在' } })
    expect(screen.queryByRole('button', { name: /你好世界/ })).toBeNull()
    fireEvent.change(screen.getByLabelText('搜索翻译历史'), { target: { value: 'HELLO' } })
    expect(screen.getByRole('button', { name: /你好世界/ })).toBeTruthy()
  })

  it('requires confirmation before clearing history, and refreshes after deletion', async () => {
    mount()
    await screen.findByRole('button', { name: /你好世界/ })
    fireEvent.click(screen.getByRole('button', { name: '清空历史' }))
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: '取消' }))
    expect(translationApi.deleteHistory).not.toHaveBeenCalled()
    vi.mocked(translationApi.listHistory).mockResolvedValue([])
    fireEvent.click(screen.getByRole('button', { name: '清空历史' }))
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: '清空历史' }))
    await waitFor(() => expect(translationApi.deleteHistory).toHaveBeenCalledWith(undefined))
    await screen.findByText('暂无翻译历史')
  })

  it('streams translation output, refreshes history, and aborts an active request on unmount', async () => {
    vi.mocked(translationApi.listHistory).mockResolvedValue([])
    vi.mocked(translationApi.translate).mockImplementation(async (_input, _signal, emit) => {
      emit({ type: 'delta', text: 'Hello' })
      emit({ type: 'complete', entry })
    })
    const view = mount()
    await screen.findByText('暂无翻译历史')
    fireEvent.change(screen.getByLabelText('待翻译文本'), { target: { value: '你好世界' } })
    fireEvent.click(screen.getByRole('button', { name: '翻译' }))
    await screen.findByText('翻译完成，已保存到本机历史')
    expect((screen.getByLabelText('译文') as HTMLTextAreaElement).value).toBe('Hello world')
    expect(translationApi.listHistory).toHaveBeenCalledTimes(2)
    let signal: AbortSignal | undefined
    vi.mocked(translationApi.translate).mockImplementation((_input, current) => {
      signal = current
      return new Promise((_resolve, reject) => current.addEventListener('abort', () => reject(new Error('cancelled'))))
    })
    fireEvent.click(screen.getByRole('button', { name: '翻译' }))
    await screen.findByRole('button', { name: '取消翻译' })
    await act(async () => view.unmount())
    expect(signal?.aborted).toBe(true)
  })

  it('guides users to local key settings when unconfigured', async () => {
    vi.mocked(translationApi.getConfig).mockResolvedValue({ configured: false, source: 'none', canSaveKey: true, hasLocalKey: false })
    mount()
    await screen.findByText('设置 → DeepSeek API')
    fireEvent.change(screen.getByLabelText('待翻译文本'), { target: { value: 'test' } })
    expect((screen.getByRole('button', { name: '翻译' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByRole('link', { name: '配置 API Key' }).getAttribute('href')).toBe('/settings?tab=deepseek')
  })
})
