import { describe, expect, it } from 'vitest'
import { createSafeHtmlPreviewDocument, documentEditorLanguage, extensionOf, inferDocumentPreviewKind, isScannedDocumentActive, resolveScannedDocumentLink } from './documentTypes'

describe('documentTypes', () => {
  it('classifies scanned document previews consistently', () => {
    expect(inferDocumentPreviewKind('README.md')).toBe('markdown')
    expect(inferDocumentPreviewKind('config.JSON')).toBe('text')
    expect(inferDocumentPreviewKind('screen.png')).toBe('image')
    expect(inferDocumentPreviewKind('manual.pdf')).toBe('pdf')
    expect(inferDocumentPreviewKind('package.zip')).toBe('binary')
  })

  it('selects Monaco languages without treating dots in folders as extensions', () => {
    expect(extensionOf('folder.with.dot/main.lua')).toBe('.lua')
    expect(extensionOf('LICENSE')).toBe('')
    expect(documentEditorLanguage('.lua')).toBe('lua')
    expect(documentEditorLanguage('.unknown')).toBe('plaintext')
  })

  it('only marks the exact scanned file query as active', () => {
    expect(isScannedDocumentActive('/markdown/source-1', '?path=folder%2Fa.md', 'source-1', 'folder/a.md')).toBe(true)
    expect(isScannedDocumentActive('/markdown/source-1', '?path=folder%2Fa.md', 'source-1', 'folder/b.md')).toBe(false)
    expect(isScannedDocumentActive('/markdown/source-2', '?path=folder%2Fa.md', 'source-1', 'folder/a.md')).toBe(false)
  })

  it('resolves relative Markdown links inside the current scan source', () => {
    expect(resolveScannedDocumentLink('guide/start/current.md', '../reference/API%20说明.md#request')).toEqual({ relativePath: 'guide/reference/API 说明.md', hash: '#request' })
    expect(resolveScannedDocumentLink('guide/current.md', './next.md?mode=preview')).toEqual({ relativePath: 'guide/next.md', hash: '' })
    expect(resolveScannedDocumentLink('current.md', '../outside.md')).toBeUndefined()
    expect(resolveScannedDocumentLink('guide/current.md', '../')).toBeUndefined()
    expect(resolveScannedDocumentLink('guide/current.md', '.')).toBeUndefined()
    expect(resolveScannedDocumentLink('guide/current.md', 'https://example.com/doc.md')).toBeUndefined()
    expect(resolveScannedDocumentLink('guide/current.md', '#section')).toBeUndefined()
    expect(resolveScannedDocumentLink('guide/current.md', '/root/doc.md')).toBeUndefined()
  })

  it('injects a restricted HTML preview policy and local resource base', () => {
    const preview = createSafeHtmlPreviewDocument('<html><head><title>Demo</title></head><body><a href="#summary">Summary</a><a href=\'#\'>Top</a><a href="other.html">Other</a><img src="a.png"><script>alert(1)</script></body></html>', 'http://127.0.0.1:4319/api/markdown/resource/source/docs/')
    expect(preview).toContain('Content-Security-Policy')
    expect(preview).toContain("script-src 'none'")
    expect(preview).toContain('<base href="http://127.0.0.1:4319/api/markdown/resource/source/docs/">')
    expect(preview).toContain('href="about:srcdoc#summary"')
    expect(preview).toContain("href='about:srcdoc#'")
    expect(preview).toContain('href="other.html"')
    expect(preview).not.toContain('href="#summary"')
    expect(preview.indexOf('<base')).toBeLessThan(preview.indexOf('<img'))
  })
})
