export type MarkdownFormatAction =
  | 'heading1'
  | 'heading2'
  | 'heading3'
  | 'bold'
  | 'italic'
  | 'strike'
  | 'inlineCode'
  | 'codeBlock'
  | 'quote'
  | 'unorderedList'
  | 'orderedList'
  | 'taskList'
  | 'link'
  | 'image'
  | 'table'
  | 'horizontalRule'

export interface MarkdownEdit {
  rangeStart: number
  rangeEnd: number
  replacement: string
  selectionStart: number
  selectionEnd: number
}

interface MarkdownEditOptions {
  url?: string
}

function clampOffset(value: number, text: string): number {
  return Math.max(0, Math.min(text.length, value))
}

function edit(rangeStart: number, rangeEnd: number, replacement: string, relativeSelectionStart: number, relativeSelectionEnd: number): MarkdownEdit {
  return {
    rangeStart,
    rangeEnd,
    replacement,
    selectionStart: rangeStart + relativeSelectionStart,
    selectionEnd: rangeStart + relativeSelectionEnd,
  }
}

function wrap(text: string, start: number, end: number, prefix: string, suffix: string, placeholder: string): MarkdownEdit {
  const selected = text.slice(start, end)
  if (selected && selected.startsWith(prefix) && selected.endsWith(suffix) && selected.length >= prefix.length + suffix.length) {
    const unwrapped = selected.slice(prefix.length, selected.length - suffix.length)
    return edit(start, end, unwrapped, 0, unwrapped.length)
  }
  const value = selected || placeholder
  const replacement = `${prefix}${value}${suffix}`
  return edit(start, end, replacement, prefix.length, prefix.length + value.length)
}

function getLineRange(text: string, start: number, end: number): { start: number; end: number; value: string } {
  const rangeStart = start === 0 ? 0 : text.lastIndexOf('\n', start - 1) + 1
  const effectiveEnd = end > start && text[end - 1] === '\n' ? end - 1 : end
  const nextBreak = text.indexOf('\n', effectiveEnd)
  const rangeEnd = nextBreak < 0 ? text.length : nextBreak
  return { start: rangeStart, end: rangeEnd, value: text.slice(rangeStart, rangeEnd) }
}

function transformLines(text: string, start: number, end: number, action: 'heading1' | 'heading2' | 'heading3' | 'quote' | 'unorderedList' | 'orderedList' | 'taskList'): MarkdownEdit {
  const range = getLineRange(text, start, end)
  const placeholders = {
    heading1: '标题',
    heading2: '标题',
    heading3: '标题',
    quote: '引用内容',
    unorderedList: '列表项',
    orderedList: '列表项',
    taskList: '待办事项',
  } as const
  const lines = range.value.split('\n')
  if (lines.every((line) => !line.trim())) {
    const prefixes = { heading1: '# ', heading2: '## ', heading3: '### ', quote: '> ', unorderedList: '- ', orderedList: '1. ', taskList: '- [ ] ' } as const
    const prefix = prefixes[action]
    const placeholder = placeholders[action]
    return edit(range.start, range.end, `${prefix}${placeholder}`, prefix.length, prefix.length + placeholder.length)
  }

  const exactPatterns: Record<typeof action, RegExp> = {
    heading1: /^#\s+/,
    heading2: /^##\s+/,
    heading3: /^###\s+/,
    quote: /^>\s+/,
    unorderedList: /^[-+*]\s+(?!\[[ xX]\]\s+)/,
    orderedList: /^\d+\.\s+/,
    taskList: /^[-+*]\s+\[[ xX]\]\s+/,
  }
  const meaningful = lines.filter((line) => line.trim())
  const allAlreadyFormatted = meaningful.every((line) => {
    const body = line.match(/^\s*(.*)$/)?.[1] ?? line
    return exactPatterns[action].test(body)
  })
  let orderedIndex = 0
  const replacement = lines.map((line) => {
    if (!line.trim()) return line
    const [, indentation = '', body = line] = line.match(/^(\s*)(.*)$/) ?? []
    if (allAlreadyFormatted) return `${indentation}${body.replace(exactPatterns[action], '')}`

    let normalized = body
    if (action.startsWith('heading')) normalized = normalized.replace(/^#{1,6}\s+/, '')
    else if (action === 'quote') normalized = normalized.replace(/^>\s+/, '')
    else normalized = normalized.replace(/^(?:[-+*]\s+(?:\[[ xX]\]\s+)?|\d+\.\s+)/, '')

    if (action === 'heading1') return `${indentation}# ${normalized}`
    if (action === 'heading2') return `${indentation}## ${normalized}`
    if (action === 'heading3') return `${indentation}### ${normalized}`
    if (action === 'quote') return `${indentation}> ${normalized}`
    if (action === 'unorderedList') return `${indentation}- ${normalized}`
    if (action === 'taskList') return `${indentation}- [ ] ${normalized}`
    orderedIndex += 1
    return `${indentation}${orderedIndex}. ${normalized}`
  }).join('\n')
  return edit(range.start, range.end, replacement, 0, replacement.length)
}

function block(text: string, start: number, end: number, body: string, selectionStart: number, selectionEnd: number): MarkdownEdit {
  const leading = start > 0 && text[start - 1] !== '\n' ? '\n\n' : ''
  const trailing = end < text.length && text[end] !== '\n' ? '\n\n' : ''
  const replacement = `${leading}${body}${trailing}`
  return edit(start, end, replacement, leading.length + selectionStart, leading.length + selectionEnd)
}

export function createMarkdownEdit(text: string, rawStart: number, rawEnd: number, action: MarkdownFormatAction, options: MarkdownEditOptions = {}): MarkdownEdit {
  const first = clampOffset(Math.min(rawStart, rawEnd), text)
  const last = clampOffset(Math.max(rawStart, rawEnd), text)
  const selected = text.slice(first, last)

  if (action === 'bold') return wrap(text, first, last, '**', '**', '粗体文字')
  if (action === 'italic') return wrap(text, first, last, '*', '*', '斜体文字')
  if (action === 'strike') return wrap(text, first, last, '~~', '~~', '删除线文字')
  if (action === 'inlineCode') {
    const fence = selected.includes('`') ? '``' : '`'
    return wrap(text, first, last, fence, fence, '代码')
  }
  if (action === 'heading1' || action === 'heading2' || action === 'heading3' || action === 'quote' || action === 'unorderedList' || action === 'orderedList' || action === 'taskList') {
    return transformLines(text, first, last, action)
  }
  if (action === 'codeBlock') {
    const value = selected || '代码'
    const replacement = `\`\`\`\n${value}\n\`\`\``
    return block(text, first, last, replacement, 4, 4 + value.length)
  }
  if (action === 'link' || action === 'image') {
    const label = selected || (action === 'link' ? '链接文字' : '图片描述')
    const url = options.url?.trim() || (action === 'link' ? 'https://' : './image.png')
    const prefix = action === 'image' ? '![' : '['
    const replacement = `${prefix}${label}](${url})`
    return edit(first, last, replacement, prefix.length, prefix.length + label.length)
  }
  if (action === 'table') {
    const value = '| 标题 1 | 标题 2 | 标题 3 |\n| --- | --- | --- |\n| 内容 | 内容 | 内容 |\n| 内容 | 内容 | 内容 |'
    return block(text, first, last, value, 2, 6)
  }
  const value = '---'
  return block(text, first, last, value, value.length, value.length)
}
