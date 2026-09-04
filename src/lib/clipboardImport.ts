import { FILE_WORKBENCH_MAX_UPLOAD_SIZE, FILE_WORKBENCH_TEXT_EDIT_LIMIT } from '../../shared/types'

export type ClipboardImportSource = 'clipboard' | 'drop'
export type TextImportFormat = 'auto' | 'txt' | 'json' | 'markdown' | 'lua' | 'log'
export type DragContentKind = 'files' | 'text' | 'unsupported'

export interface TextImportCandidate {
  kind: 'text'
  source: ClipboardImportSource
  text: string
}

export interface ImageImportCandidate {
  kind: 'image'
  source: 'clipboard'
  blob: Blob
  mimeType: string
}

export type ClipboardImportCandidate = TextImportCandidate | ImageImportCandidate

export const textImportFormatOptions: Array<{ value: TextImportFormat; label: string }> = [
  { value: 'auto', label: '自动识别' },
  { value: 'txt', label: 'TXT' },
  { value: 'json', label: 'JSON' },
  { value: 'markdown', label: 'Markdown' },
  { value: 'lua', label: 'Lua' },
  { value: 'log', label: 'Log' },
]

const textFormatExtensions: Record<Exclude<TextImportFormat, 'auto'>, string> = {
  txt: '.txt',
  json: '.json',
  markdown: '.md',
  lua: '.lua',
  log: '.log',
}

const textFormatMimeTypes: Record<Exclude<TextImportFormat, 'auto'>, string> = {
  txt: 'text/plain;charset=utf-8',
  json: 'application/json;charset=utf-8',
  markdown: 'text/markdown;charset=utf-8',
  lua: 'text/plain;charset=utf-8',
  log: 'text/plain;charset=utf-8',
}

const imageExtensions: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/bmp': '.bmp',
}

const timestamp = (date: Date): string => {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}

export function isJsonText(value: string): boolean {
  try {
    JSON.parse(value)
    return true
  } catch {
    return false
  }
}

export function resolvedTextFormat(format: TextImportFormat, text: string): Exclude<TextImportFormat, 'auto'> {
  return format === 'auto' ? (isJsonText(text) ? 'json' : 'txt') : format
}

export function textImportExtension(format: TextImportFormat, text: string): string {
  return textFormatExtensions[resolvedTextFormat(format, text)]
}

export function imageImportExtension(mimeType: string): string | undefined {
  return imageExtensions[mimeType.toLowerCase()]
}

export function suggestedImportName(candidate: ClipboardImportCandidate, format: TextImportFormat = 'auto', date = new Date()): string {
  const suffix = timestamp(date)
  if (candidate.kind === 'image') return `剪贴图片-${suffix}${imageImportExtension(candidate.mimeType) ?? '.png'}`
  const prefix = candidate.source === 'drop' ? '拖入文本' : '剪贴文本'
  return `${prefix}-${suffix}${textImportExtension(format, candidate.text)}`
}

export function applyFileExtension(name: string, extension: string): string {
  const trimmed = name.trim()
  if (!trimmed) return ''
  const lastDot = trimmed.lastIndexOf('.')
  const base = lastDot > 0 ? trimmed.slice(0, lastDot) : trimmed
  return `${base}${extension}`
}

export function validateImportFileName(value: string): string | undefined {
  const name = value.trim()
  if (!name || name === '.' || name === '..' || /[<>:"/\\|?*\u0000-\u001f]/.test(name) || /[. ]$/.test(name) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name) || name.length > 200) {
    return '文件名为空、过长或包含 Windows 不允许的字符'
  }
  return undefined
}

export function createImportFile(candidate: ClipboardImportCandidate, name: string, format: TextImportFormat): File {
  if (candidate.kind === 'image') {
    const extension = imageImportExtension(candidate.mimeType)
    if (!extension) throw new Error(`不支持的图片格式：${candidate.mimeType || '未知格式'}`)
    const finalName = applyFileExtension(name, extension)
    const invalid = validateImportFileName(finalName)
    if (invalid) throw new Error(invalid)
    if (candidate.blob.size > FILE_WORKBENCH_MAX_UPLOAD_SIZE) throw new Error('图片超过 512 MiB 的单文件限制')
    return new File([candidate.blob], finalName, { type: candidate.mimeType, lastModified: Date.now() })
  }

  const size = new TextEncoder().encode(candidate.text).byteLength
  if (size > FILE_WORKBENCH_TEXT_EDIT_LIMIT) throw new Error('文本超过 10 MiB 的导入限制')
  const resolved = resolvedTextFormat(format, candidate.text)
  const finalName = applyFileExtension(name, textFormatExtensions[resolved])
  const invalid = validateImportFileName(finalName)
  if (invalid) throw new Error(invalid)
  return new File([candidate.text], finalName, { type: textFormatMimeTypes[resolved], lastModified: Date.now() })
}

export function classifyDragTypes(types: readonly string[]): DragContentKind {
  if (types.some((type) => type.toLowerCase() === 'files')) return 'files'
  if (types.some((type) => type.toLowerCase() === 'text/plain')) return 'text'
  return 'unsupported'
}

export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  if (target.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="textbox"]')) return true
  return target instanceof HTMLElement && Boolean(target.isContentEditable)
}

export function candidatesFromClipboardData(data: Pick<DataTransfer, 'files' | 'getData'>): ClipboardImportCandidate[] {
  const image = Array.from(data.files).find((file) => file.type.startsWith('image/') && imageImportExtension(file.type))
  const text = data.getData('text/plain')
  const candidates: ClipboardImportCandidate[] = []
  if (image) candidates.push({ kind: 'image', source: 'clipboard', blob: image, mimeType: image.type })
  if (text) candidates.push({ kind: 'text', source: 'clipboard', text })
  return candidates
}

export async function readCurrentClipboard(clipboard: Clipboard | undefined = navigator.clipboard): Promise<ClipboardImportCandidate[]> {
  if (!clipboard) throw new Error('当前浏览器不支持读取剪贴板')

  let readFailure: unknown
  if (typeof clipboard.read === 'function') {
    try {
      const items = await clipboard.read()
      let image: ImageImportCandidate | undefined
      let text: TextImportCandidate | undefined
      for (const item of items) {
        if (!image) {
          const imageType = item.types.find((type) => imageImportExtension(type))
          if (imageType) image = { kind: 'image', source: 'clipboard', blob: await item.getType(imageType), mimeType: imageType }
        }
        if (!text && item.types.includes('text/plain')) {
          const blob = await item.getType('text/plain')
          const value = await blob.text()
          if (value) text = { kind: 'text', source: 'clipboard', text: value }
        }
      }
      const candidates: ClipboardImportCandidate[] = []
      if (image) candidates.push(image)
      if (text) candidates.push(text)
      if (candidates.length) return candidates
    } catch (error) {
      readFailure = error
    }
  }

  if (typeof clipboard.readText === 'function') {
    try {
      const text = await clipboard.readText()
      if (text) return [{ kind: 'text', source: 'clipboard', text }]
    } catch (error) {
      readFailure ??= error
    }
  }

  if (readFailure) throw readFailure
  return []
}

export function clipboardReadErrorMessage(error: unknown): string {
  if (error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'SecurityError')) {
    return '无法读取剪贴板，请允许浏览器权限，或在工作台空白区域按 Ctrl+V'
  }
  if (error instanceof Error && error.message) return `读取剪贴板失败：${error.message}`
  return '读取剪贴板失败，请在工作台空白区域按 Ctrl+V 重试'
}
