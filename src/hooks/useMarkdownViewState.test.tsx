// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MarkdownUiState } from '../../shared/types'
import { localBridge } from '../lib/api'
import { useMarkdownViewState } from './useMarkdownViewState'

vi.mock('../lib/api', () => ({
  ApiError: class ApiError extends Error { constructor(public readonly status: number) { super('API error') } },
  localBridge: { getMarkdownUiState: vi.fn(), updateMarkdownUiState: vi.fn() },
}))

const initialState: MarkdownUiState = {
  schemaVersion: 1,
  updatedAt: '2026-09-07T00:00:00.000Z',
  revision: 1,
  mode: 'preview',
  tocOpen: true,
  syncScroll: true,
}

beforeEach(() => {
  vi.mocked(localBridge.getMarkdownUiState).mockResolvedValue(initialState)
})

afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('useMarkdownViewState', () => {
  it('serializes rapid preference changes and persists the latest combined state', async () => {
    let finishFirst: ((state: MarkdownUiState) => void) | undefined
    vi.mocked(localBridge.updateMarkdownUiState)
      .mockImplementationOnce((state) => new Promise((resolve) => { finishFirst = () => resolve({ ...state, revision: state.revision + 1 }) }))
      .mockImplementation(async (state) => ({ ...state, revision: state.revision + 1 }))

    const { result } = renderHook(() => useMarkdownViewState())
    await waitFor(() => expect(result.current.mode).toBe('preview'))

    act(() => {
      result.current.toggleToc()
      result.current.changeMode('split')
    })
    expect(result.current).toMatchObject({ mode: 'split', tocOpen: false, syncScroll: true })
    await waitFor(() => expect(localBridge.updateMarkdownUiState).toHaveBeenCalledTimes(1))

    act(() => finishFirst?.(initialState))
    await waitFor(() => expect(localBridge.updateMarkdownUiState).toHaveBeenCalledTimes(2))
    expect(vi.mocked(localBridge.updateMarkdownUiState).mock.calls[1]?.[0]).toMatchObject({ mode: 'split', tocOpen: false, syncScroll: true, revision: 2 })
  })
})
