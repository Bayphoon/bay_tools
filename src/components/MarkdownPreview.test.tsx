// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MarkdownPreview, interpolateSourceOffset } from './MarkdownPreview'

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, writable: true, value: vi.fn() })
})

afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('MarkdownPreview', () => {
  it('builds a nested table of contents from rendered headings and navigates by source line', async () => {
    const onHeadingCountChange = vi.fn()
    const onHeadingNavigate = vi.fn()
    render(<MarkdownPreview
      content={'# 概述\n\n正文\n\n## 安装\n\n```md\n# 代码块不是标题\n```'}
      tocOpen
      onHeadingCountChange={onHeadingCountChange}
      onHeadingNavigate={onHeadingNavigate}
    />)

    const navigation = screen.getByRole('navigation', { name: '文档目录' })
    expect(navigation.textContent).toContain('概述')
    expect(navigation.textContent).toContain('安装')
    expect(navigation.textContent).not.toContain('代码块不是标题')
    await waitFor(() => expect(onHeadingCountChange).toHaveBeenLastCalledWith(2))

    fireEvent.click(screen.getByRole('button', { name: '安装' }))
    expect(onHeadingNavigate).toHaveBeenCalledWith(5)
    expect(HTMLElement.prototype.scrollTo).toHaveBeenCalled()
  })

  it('keeps headings available while the table of contents is collapsed', async () => {
    const onHeadingCountChange = vi.fn()
    render(<MarkdownPreview content="# 标题" tocOpen={false} onHeadingCountChange={onHeadingCountChange} />)
    expect(screen.queryByRole('navigation', { name: '文档目录' })).toBeNull()
    await waitFor(() => expect(onHeadingCountChange).toHaveBeenLastCalledWith(1))
  })
})

describe('interpolateSourceOffset', () => {
  it('aligns exact lines and interpolates between rendered source anchors', () => {
    const anchors = [{ line: 10, top: 100 }, { line: 20, top: 360 }, { line: 40, top: 600 }]
    expect(interpolateSourceOffset(anchors, 5)).toBe(100)
    expect(interpolateSourceOffset(anchors, 15)).toBe(230)
    expect(interpolateSourceOffset(anchors, 20)).toBe(360)
    expect(interpolateSourceOffset(anchors, 50)).toBe(600)
  })
})
