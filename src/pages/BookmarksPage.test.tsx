// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BookmarkLibrary } from '../../shared/types'
import { localBridge } from '../lib/api'
import { BookmarksPage } from './BookmarksPage'

const initial: BookmarkLibrary = {
  schemaVersion: 1,
  revision: 3,
  updatedAt: '2026-09-21T08:00:00.000Z',
  layout: 'grid',
  items: [
    { id: '11111111-1111-4111-8111-111111111111', title: '普通链接', url: 'https://ordinary.example/', favorite: false, icon: { kind: 'builtin', name: 'link' }, createdAt: '2026-09-21T08:00:00.000Z', updatedAt: '2026-09-21T08:00:00.000Z' },
    { id: '22222222-2222-4222-8222-222222222222', title: '收藏链接', url: 'https://favorite.example/', favorite: true, icon: { kind: 'builtin', name: 'star' }, createdAt: '2026-09-20T08:00:00.000Z', updatedAt: '2026-09-20T08:00:00.000Z' },
  ],
}

describe('BookmarksPage', () => {
  beforeEach(() => {
    vi.spyOn(localBridge, 'getBookmarks').mockResolvedValue(initial)
    vi.spyOn(localBridge, 'updateBookmarkLayout').mockImplementation(async (layout) => ({ ...initial, revision: 4, layout }))
    vi.spyOn(localBridge, 'createBookmark').mockImplementation(async (input) => ({
      ...initial,
      revision: 4,
      items: [{ id: '33333333-3333-4333-8333-333333333333', title: input.title, url: input.url, favorite: false, icon: { kind: 'builtin', name: input.builtinIcon }, createdAt: initial.updatedAt, updatedAt: initial.updatedAt }, ...initial.items],
    }))
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockResolvedValue(undefined) } })
    Object.defineProperty(window, 'open', { configurable: true, value: vi.fn(() => null) })
  })

  afterEach(() => { cleanup(); vi.restoreAllMocks() })

  it('renders favorites above other bookmarks and switches layouts', async () => {
    render(<BookmarksPage />)
    await screen.findByText('收藏链接')
    const favorite = screen.getByLabelText('打开 收藏链接')
    const ordinary = screen.getByLabelText('打开 普通链接')
    expect(favorite.compareDocumentPosition(ordinary) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '列表布局' }))
    await waitFor(() => expect(localBridge.updateBookmarkLayout).toHaveBeenCalledWith('list', initial.revision))
    expect(screen.getByLabelText('打开 收藏链接').classList.contains('list')).toBe(true)
  })

  it('opens a card in a new tab and copies without opening it', async () => {
    render(<BookmarksPage />)
    await screen.findByText('普通链接')
    fireEvent.click(screen.getByLabelText('打开 普通链接'))
    expect(window.open).toHaveBeenCalledWith('https://ordinary.example/', '_blank', 'noopener,noreferrer')

    fireEvent.click(screen.getByRole('button', { name: '复制 普通链接 链接' }))
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith('https://ordinary.example/'))
    expect(window.open).toHaveBeenCalledTimes(1)
  })

  it('opens the add card and creates a bookmark with a built-in icon', async () => {
    const user = userEvent.setup()
    render(<BookmarksPage />)
    await screen.findByText('普通链接')
    await user.click(screen.getByRole('button', { name: '新增书签' }))
    expect(screen.getByRole('heading', { name: '新增书签' })).toBeTruthy()
    await user.type(screen.getByLabelText('书签标题'), '在线 JSON')
    await user.type(screen.getByLabelText('书签链接'), 'https://json.example')
    await user.click(screen.getByRole('button', { name: '使用代码图标' }))
    await user.click(screen.getByRole('button', { name: '保存书签' }))
    await waitFor(() => expect(localBridge.createBookmark).toHaveBeenCalledWith(expect.objectContaining({ title: '在线 JSON', url: 'https://json.example', builtinIcon: 'code', revision: initial.revision })))
  })
})
