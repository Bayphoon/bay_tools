// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { BAYTOOLS_NOTICE_EVENT, copyFilePath, type AppNotice } from './clipboard'

describe('file path clipboard feedback', () => {
  const originalClipboard = navigator.clipboard

  afterEach(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: originalClipboard })
  })

  it('copies the resolved path and emits success feedback', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    const notices: AppNotice[] = []
    const listener: EventListener = (event) => {
      notices.push((event as CustomEvent<AppNotice>).detail)
    }
    window.addEventListener(BAYTOOLS_NOTICE_EVENT, listener, { once: true })
    await copyFilePath(async () => 'D:\\docs\\guide.md')
    expect(writeText).toHaveBeenCalledWith('D:\\docs\\guide.md')
    expect(notices).toEqual([{ message: '文件路径已复制', kind: 'success' }])
  })

  it('emits error feedback when the path cannot be resolved', async () => {
    const notices: AppNotice[] = []
    const listener: EventListener = (event) => {
      notices.push((event as CustomEvent<AppNotice>).detail)
    }
    window.addEventListener(BAYTOOLS_NOTICE_EVENT, listener, { once: true })
    await copyFilePath(async () => { throw new Error('文件不存在') })
    expect(notices).toEqual([{ message: '复制失败：文件不存在', kind: 'error' }])
  })
})
