import { describe, expect, it } from 'vitest'
import { createMarkdownEdit } from './markdownFormat'

function apply(text: string, start: number, end: number, action: Parameters<typeof createMarkdownEdit>[3], url?: string) {
  const value = createMarkdownEdit(text, start, end, action, { url })
  return {
    ...value,
    text: `${text.slice(0, value.rangeStart)}${value.replacement}${text.slice(value.rangeEnd)}`,
  }
}

describe('createMarkdownEdit', () => {
  it('wraps a selection and selects a placeholder when the selection is empty', () => {
    expect(apply('hello', 0, 5, 'bold')).toMatchObject({ text: '**hello**', selectionStart: 2, selectionEnd: 7 })
    expect(apply('', 0, 0, 'italic')).toMatchObject({ text: '*斜体文字*', selectionStart: 1, selectionEnd: 5 })
  })

  it('formats and toggles multiple list lines', () => {
    const formatted = apply('one\ntwo', 0, 7, 'unorderedList')
    expect(formatted.text).toBe('- one\n- two')
    expect(apply(formatted.text, 0, formatted.text.length, 'unorderedList').text).toBe('one\ntwo')
  })

  it('keeps the first empty line addressable', () => {
    expect(apply('\nsecond', 0, 0, 'heading1').text).toBe('# 标题\nsecond')
  })

  it('replaces competing list markers and numbers ordered items', () => {
    expect(apply('- one\n- two', 0, 11, 'orderedList').text).toBe('1. one\n2. two')
    expect(apply('1. one\n2. two', 0, 13, 'taskList').text).toBe('- [ ] one\n- [ ] two')
  })

  it('creates links, code blocks, and table templates', () => {
    expect(apply('BayTools', 0, 8, 'link', 'https://example.com').text).toBe('[BayTools](https://example.com)')
    expect(apply('', 0, 0, 'codeBlock').text).toBe('```\n代码\n```')
    expect(apply('', 0, 0, 'table').text).toContain('| 标题 1 | 标题 2 | 标题 3 |')
  })
})
