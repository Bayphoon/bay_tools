// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import { applyFileExtension, candidatesFromClipboardData, classifyDragTypes, clipboardReadErrorMessage, createImportFile, imageImportExtension, isEditableTarget, isJsonText, readCurrentClipboard, resolvedTextFormat, suggestedImportName, textImportExtension, validateImportFileName } from './clipboardImport'

describe('file workbench clipboard import helpers', () => {
  it('detects JSON without changing the source text', () => {
    expect(isJsonText('{\n  "name": "BayTools"\n}')).toBe(true)
    expect(isJsonText('{ name: "BayTools" }')).toBe(false)
    expect(resolvedTextFormat('auto', '[1, 2]')).toBe('json')
    expect(resolvedTextFormat('markdown', '[1, 2]')).toBe('markdown')
    expect(textImportExtension('auto', '普通文本')).toBe('.txt')
  })

  it('creates stable local-time names for clipboard and dragged text', () => {
    const date = new Date(2026, 8, 4, 9, 7, 5)
    expect(suggestedImportName({ kind: 'text', source: 'clipboard', text: '{}' }, 'auto', date)).toBe('剪贴文本-20260904-090705.json')
    expect(suggestedImportName({ kind: 'text', source: 'drop', text: '# 标题' }, 'markdown', date)).toBe('拖入文本-20260904-090705.md')
    expect(suggestedImportName({ kind: 'image', source: 'clipboard', blob: new Blob(), mimeType: 'image/png' }, 'auto', date)).toBe('剪贴图片-20260904-090705.png')
  })

  it('maps image MIME types and applies the selected extension', () => {
    expect(imageImportExtension('image/jpeg')).toBe('.jpg')
    expect(imageImportExtension('image/webp')).toBe('.webp')
    expect(imageImportExtension('image/svg+xml')).toBeUndefined()
    expect(applyFileExtension('notes.old', '.md')).toBe('notes.md')
    expect(applyFileExtension('README', '.txt')).toBe('README.txt')
    expect(applyFileExtension('', '.txt')).toBe('')
  })

  it('keeps Unicode and line-break content while applying the selected text format', async () => {
    const text = '第一行\r\n第二行：你好'
    const file = createImportFile({ kind: 'text', source: 'clipboard', text }, '记录.txt', 'markdown')
    expect(file.name).toBe('记录.md')
    expect(file.type).toBe('text/markdown;charset=utf-8')
    expect(file.size).toBe(new TextEncoder().encode(text).byteLength)
    const content = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.onerror = () => reject(reader.error)
      reader.readAsText(file)
    })
    expect(content).toBe(text)
  })

  it('matches server-side Windows file name restrictions', () => {
    expect(validateImportFileName('正常文件.json')).toBeUndefined()
    expect(validateImportFileName('a/b.txt')).toBeTruthy()
    expect(validateImportFileName('CON.txt')).toBeTruthy()
    expect(validateImportFileName('trailing.')).toBeTruthy()
  })

  it('prefers files over text and ignores URI-only drags', () => {
    expect(classifyDragTypes(['text/plain', 'Files'])).toBe('files')
    expect(classifyDragTypes(['text/plain'])).toBe('text')
    expect(classifyDragTypes(['text/uri-list'])).toBe('unsupported')
  })

  it('recognizes editable paste targets', () => {
    const input = document.createElement('input')
    const editor = document.createElement('div')
    editor.setAttribute('contenteditable', 'true')
    const child = document.createElement('span')
    editor.append(child)
    const ordinary = document.createElement('div')
    expect(isEditableTarget(input)).toBe(true)
    expect(isEditableTarget(child)).toBe(true)
    expect(isEditableTarget(ordinary)).toBe(false)
  })

  it('extracts image before text from native paste data and ignores empty data', () => {
    const image = new File(['image'], 'clipboard.png', { type: 'image/png' })
    const withBoth = candidatesFromClipboardData({
      files: [image] as unknown as FileList,
      getData: (type: string) => type === 'text/plain' ? '粘贴文字' : '',
    })
    expect(withBoth.map((candidate) => candidate.kind)).toEqual(['image', 'text'])
    expect(withBoth[1]).toMatchObject({ kind: 'text', text: '粘贴文字' })
    expect(candidatesFromClipboardData({ files: [] as unknown as FileList, getData: () => '' })).toEqual([])
  })

  it('returns one image candidate before the plain-text alternative', async () => {
    const image = new Blob(['image'], { type: 'image/png' })
    const text = new Blob(['文字'], { type: 'text/plain' })
    Object.defineProperty(text, 'text', { value: async () => '文字' })
    const clipboard = {
      read: async () => [{
        types: ['text/plain', 'image/png'],
        getType: async (type: string) => type === 'image/png' ? image : text,
      }],
      readText: async () => '',
    } as unknown as Clipboard

    const candidates = await readCurrentClipboard(clipboard)
    expect(candidates.map((candidate) => candidate.kind)).toEqual(['image', 'text'])
    expect(candidates[1]).toMatchObject({ kind: 'text', text: '文字' })
  })

  it('uses readText when rich clipboard reading is unavailable', async () => {
    const clipboard = { readText: async () => 'fallback' } as Clipboard
    await expect(readCurrentClipboard(clipboard)).resolves.toEqual([{ kind: 'text', source: 'clipboard', text: 'fallback' }])
  })

  it('preserves a clipboard permission error when fallback cannot read', async () => {
    const denied = new DOMException('denied', 'NotAllowedError')
    const clipboard = {
      read: async () => { throw denied },
      readText: async () => { throw new DOMException('denied again', 'NotAllowedError') },
    } as unknown as Clipboard
    await expect(readCurrentClipboard(clipboard)).rejects.toBe(denied)
    expect(clipboardReadErrorMessage(denied)).toContain('允许浏览器权限')
  })
})
