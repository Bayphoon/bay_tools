import type { FileWorkbenchPreviewKind } from '../../shared/types'

const textExtensions = new Set(['.txt', '.log', '.lua', '.js', '.jsx', '.ts', '.tsx', '.css', '.scss', '.html', '.htm', '.xml', '.csv', '.ini', '.cfg', '.conf', '.yaml', '.yml', '.toml', '.sql', '.sh', '.ps1', '.bat', '.cmd', '.py', '.java', '.cs', '.cpp', '.c', '.h', '.go', '.rs'])
const imageExtensions = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'])

export function extensionOf(name: string): string {
  const leaf = name.replaceAll('\\', '/').split('/').at(-1) ?? name
  const dot = leaf.lastIndexOf('.')
  return dot > 0 ? leaf.slice(dot).toLowerCase() : ''
}

export function inferDocumentPreviewKind(name: string): FileWorkbenchPreviewKind {
  const extension = extensionOf(name)
  if (extension === '.md' || extension === '.markdown') return 'markdown'
  if (extension === '.pdf') return 'pdf'
  if (imageExtensions.has(extension)) return 'image'
  if (extension === '.json' || textExtensions.has(extension)) return 'text'
  return 'binary'
}

export function documentEditorLanguage(extension: string): string {
  return ({
    '.json': 'json', '.js': 'javascript', '.jsx': 'javascript', '.ts': 'typescript', '.tsx': 'typescript', '.lua': 'lua',
    '.xml': 'xml', '.html': 'html', '.htm': 'html', '.css': 'css', '.scss': 'scss', '.sql': 'sql', '.py': 'python',
    '.java': 'java', '.cs': 'csharp', '.cpp': 'cpp', '.c': 'c', '.h': 'cpp', '.md': 'markdown', '.markdown': 'markdown',
    '.yaml': 'yaml', '.yml': 'yaml', '.sh': 'shell', '.ps1': 'powershell',
  }[extension.toLowerCase()] ?? 'plaintext')
}

export function documentKindLabel(kind: FileWorkbenchPreviewKind): string {
  return ({ markdown: 'Markdown', text: '文本', image: '图片', pdf: 'PDF', binary: '其他' })[kind]
}

export function formatDocumentSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KiB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MiB`
  return `${(bytes / 1024 ** 3).toFixed(1)} GiB`
}

export function isScannedDocumentActive(pathname: string, search: string, sourceId: string, relativePath: string): boolean {
  return pathname === `/markdown/${sourceId}` && new URLSearchParams(search).get('path') === relativePath
}

export interface ScannedDocumentLink {
  relativePath: string
  hash: string
}

export function resolveScannedDocumentLink(documentPath: string, href: string): ScannedDocumentLink | undefined {
  const value = href.trim()
  if (!value || value.startsWith('#') || value.startsWith('?') || value.startsWith('/') || value.startsWith('\\') || /^[a-z][a-z0-9+.-]*:/i.test(value)) return undefined

  const hashIndex = value.indexOf('#')
  const hash = hashIndex >= 0 ? value.slice(hashIndex) : ''
  const pathAndQuery = hashIndex >= 0 ? value.slice(0, hashIndex) : value
  const encodedPath = pathAndQuery.split('?', 1)[0]!.replaceAll('\\', '/')
  if (!encodedPath || encodedPath.endsWith('/')) return undefined

  const pathSegments: string[] = []
  for (const encodedSegment of encodedPath.split('/')) {
    try { pathSegments.push(decodeURIComponent(encodedSegment)) } catch { return undefined }
  }
  const leaf = pathSegments.at(-1)
  if (!leaf || leaf === '.' || leaf === '..') return undefined

  const segments = documentPath.replaceAll('\\', '/').split('/').filter(Boolean).slice(0, -1)
  for (const segment of pathSegments) {
    if (!segment || segment === '.') continue
    if (segment === '..') {
      if (!segments.length) return undefined
      segments.pop()
      continue
    }
    if (segment.includes('/') || segment.includes('\\') || segment.includes('\0')) return undefined
    segments.push(segment)
  }
  return segments.length ? { relativePath: segments.join('/'), hash } : undefined
}

export function createSafeHtmlPreviewDocument(content: string, baseHref: string): string {
  // A <base> is required so relative images and styles can load through the
  // restricted resource endpoint. Keep fragment-only links inside srcdoc;
  // otherwise the browser resolves href="#section" against that endpoint and
  // requests the containing directory as though it were a file.
  const normalizedContent = content.replace(
    /(\bhref\s*=\s*)(["'])#([^"']*)\2/gi,
    (_match, prefix: string, quote: string, fragment: string) => `${prefix}${quote}about:srcdoc#${fragment}${quote}`,
  )
  const escapedBase = baseHref.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;')
  const origin = new URL(baseHref).origin
  const policy = `default-src 'none'; img-src data: blob: ${origin}; style-src 'unsafe-inline' ${origin}; font-src data: ${origin}; media-src blob: ${origin}; script-src 'none'; connect-src 'none'; object-src 'none'; frame-src 'none'; form-action 'none'; base-uri ${origin}`
  const previewHead = `<meta http-equiv="Content-Security-Policy" content="${policy}"><base href="${escapedBase}">`
  if (/<head(?:\s[^>]*)?>/i.test(normalizedContent)) return normalizedContent.replace(/<head(?:\s[^>]*)?>/i, (head) => `${head}${previewHead}`)
  if (/<html(?:\s[^>]*)?>/i.test(normalizedContent)) return normalizedContent.replace(/<html(?:\s[^>]*)?>/i, (html) => `${html}<head>${previewHead}</head>`)
  const doctype = /^\s*<!doctype[^>]*>/i.exec(normalizedContent)
  if (doctype) return `${doctype[0]}<html><head>${previewHead}</head><body>${normalizedContent.slice(doctype[0].length)}</body></html>`
  return `<html><head>${previewHead}</head><body>${normalizedContent}</body></html>`
}
