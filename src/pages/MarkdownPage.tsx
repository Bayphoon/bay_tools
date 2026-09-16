import Editor from '@monaco-editor/react'
import { Copy, Download, Eye, File, FileCode2, FilePlus2, FolderOpen, FolderPlus, List, Pencil, RefreshCw, Save, SplitSquareHorizontal, Trash2, ZoomIn, ZoomOut } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import type { Components } from 'react-markdown'
import type { FileWorkbenchPreviewKind, MarkdownDocument, MarkdownSourceTree, MarkdownTreeNode } from '../../shared/types'
import { MarkdownWorkspace } from '../components/MarkdownWorkspace'
import { EmptyState, InlineError, PageHeader, Spinner, ToolButton } from '../components/ui'
import { useMarkdownViewState } from '../hooks/useMarkdownViewState'
import { ApiError, assetUrl, localBridge, scannedDocumentContentUrl, scannedDocumentResourceBaseUrl } from '../lib/api'
import { copyFilePath } from '../lib/clipboard'
import { createSafeHtmlPreviewDocument, documentEditorLanguage, documentKindLabel, formatDocumentSize, inferDocumentPreviewKind } from '../lib/documentTypes'
import { useAppStore } from '../store/appStore'
import { ManagedMarkdownPage } from './ManagedMarkdownPage'

type DocumentCounts = Record<FileWorkbenchPreviewKind, number> & { total: number }
type HtmlViewMode = 'source' | 'preview' | 'split'

function countDocuments(nodes: MarkdownTreeNode[]): DocumentCounts {
  return nodes.reduce<DocumentCounts>((counts, node) => {
    if (node.type === 'directory') {
      const nested = countDocuments(node.children ?? [])
      counts.total += nested.total
      counts.markdown += nested.markdown
      counts.text += nested.text
      counts.image += nested.image
      counts.pdf += nested.pdf
      counts.binary += nested.binary
    } else {
      const kind = node.previewKind ?? inferDocumentPreviewKind(node.name)
      counts.total += 1
      counts[kind] += 1
    }
    return counts
  }, { total: 0, markdown: 0, text: 0, image: 0, pdf: 0, binary: 0 })
}

function resolveRelative(documentPath: string, source: string): string {
  const base = documentPath.split('/').slice(0, -1).join('/')
  const stack = base ? base.split('/') : []
  for (const part of source.replaceAll('\\', '/').split('/')) {
    if (!part || part === '.') continue
    if (part === '..') stack.pop()
    else stack.push(part)
  }
  return stack.join('/')
}

function LocalImage({ sourceId, documentPath, src, alt }: { sourceId: string; documentPath: string; src?: string; alt?: string }) {
  const [url, setUrl] = useState('')
  useEffect(() => {
    if (!src || /^(https?:|data:)/i.test(src)) return
    let active = true
    void assetUrl(sourceId, resolveRelative(documentPath, src)).then((value) => { if (active) setUrl(value) })
    return () => { active = false }
  }, [sourceId, documentPath, src])
  if (!src) return null
  if (/^https?:/i.test(src)) return <span className="blocked-image">[远程图片已阻止：{alt ?? src}]</span>
  return url ? <img src={url} alt={alt ?? ''} /> : <span className="image-loading">正在加载图片…</span>
}

function ExternalMarkdownPage() {
  const { sourceId } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const path = searchParams.get('path') ?? ''
  const navigate = useNavigate()
  const { markdownTrees, refreshMarkdown, setMarkdownDirty } = useAppStore()
  const [document, setDocument] = useState<MarkdownDocument>()
  const [content, setContent] = useState('')
  const { mode, tocOpen, syncScroll, changeMode, toggleToc, toggleSyncScroll } = useMarkdownViewState()
  const [headingCount, setHeadingCount] = useState(0)
  const [dirty, setDirty] = useState(false)
  const [zoom, setZoom] = useState(0)
  const [htmlMode, setHtmlMode] = useState<HtmlViewMode>('split')
  const [htmlPreviewContent, setHtmlPreviewContent] = useState('')
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'conflict' | 'error'>('idle')
  const [error, setError] = useState('')

  useEffect(() => {
    setMarkdownDirty(dirty)
    return () => setMarkdownDirty(false)
  }, [dirty, setMarkdownDirty])
  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => { if (dirty) event.preventDefault() }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [dirty])
  useEffect(() => {
    if (!sourceId || !path) { setDocument(undefined); setContent(''); setDirty(false); return }
    setDocument(undefined); setContent(''); setError(''); setDirty(false); setZoom(0); setStatus('idle')
    void localBridge.getMarkdownDocument(sourceId, path)
      .then((value) => { setDocument(value); setContent(value.content) })
      .catch((value) => setError(value instanceof Error ? value.message : '文件读取失败'))
  }, [sourceId, path])
  const previewComponents = useMemo<Components>(() => ({
    img: (props) => <LocalImage sourceId={sourceId ?? ''} documentPath={path} src={props.src} alt={props.alt} />,
    a: ({ href, children }) => <a href={href} target="_blank" rel="noreferrer">{children}</a>,
  }), [sourceId, path])
  const isHtmlDocument = document?.previewKind === 'text' && (document.extension === '.html' || document.extension === '.htm')
  useEffect(() => {
    if (!isHtmlDocument) { setHtmlPreviewContent(''); return }
    const timer = window.setTimeout(() => setHtmlPreviewContent(content), 200)
    return () => window.clearTimeout(timer)
  }, [content, isHtmlDocument])
  const htmlPreviewDocument = useMemo(() => {
    if (!sourceId || !path || !isHtmlDocument) return ''
    const baseUrl = new URL(scannedDocumentResourceBaseUrl(sourceId, path), window.location.href).href
    return createSafeHtmlPreviewDocument(htmlPreviewContent, baseUrl)
  }, [htmlPreviewContent, isHtmlDocument, path, sourceId])

  const save = async () => {
    if (!document?.editable) return
    setStatus('saving'); setError('')
    try {
      const saved = await localBridge.saveMarkdownDocument({ ...document, content })
      setDocument(saved); setContent(saved.content); setDirty(false); setStatus('saved')
    } catch (value) {
      if (value instanceof ApiError && value.status === 409) setStatus('conflict')
      else setStatus('error')
      setError(value instanceof Error ? value.message : '保存失败')
    }
  }
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's' && document?.editable) { event.preventDefault(); void save() }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  })

  const addSource = async () => {
    const selected = await localBridge.selectDirectory()
    if (!selected) return
    await localBridge.addMarkdownSource(selected)
    await refreshMarkdown()
  }
  const editSourceNote = async (source: MarkdownSourceTree) => {
    const note = window.prompt('扫描目录备注名，留空则显示文件夹名', source.note ?? '')
    if (note === null) return
    await localBridge.updateMarkdownSourceNote(source.id, note)
    await refreshMarkdown()
  }
  const removeSource = async (source: MarkdownSourceTree) => {
    const displayName = source.note?.trim() || source.label
    if (!window.confirm(`移除扫描目录 ${displayName}？原文件不会删除。`)) return
    await localBridge.removeMarkdownSource(source.id)
    await refreshMarkdown()
  }
  const createSourceDocument = async (source: MarkdownSourceTree) => {
    const name = window.prompt('新文件名（支持 Markdown、文本和代码文件）', '未命名文档.md')?.trim()
    if (!name) return
    try {
      const created = await localBridge.createMarkdownDocument(source.id, '', name)
      await refreshMarkdown()
      navigate(`/markdown/${source.id}?path=${encodeURIComponent(created.relativePath)}`)
    } catch (value) {
      window.alert(value instanceof Error ? value.message : '新建文件失败')
    }
  }
  const renameDocument = async () => {
    if (!document) return
    if (dirty && !window.confirm('重命名前将丢弃未保存修改，继续吗？')) return
    const currentName = path.split('/').at(-1) ?? ''
    const nextName = window.prompt('新的文件名（不能修改扩展名）', currentName)
    if (!nextName || nextName === currentName) return
    try {
      const renamed = await localBridge.renameMarkdownDocument(document.sourceId, document.relativePath, nextName, document.hash)
      await refreshMarkdown(); setSearchParams({ path: renamed.relativePath }, { replace: true })
    } catch (value) { setError(value instanceof Error ? value.message : '重命名失败') }
  }
  const trashDocument = async () => {
    if (!document || !window.confirm(`将 ${path.split('/').at(-1)} 移入垃圾箱？`)) return
    try {
      await localBridge.trashMarkdownDocument(document.sourceId, document.relativePath, document.hash)
      await refreshMarkdown(); navigate('/markdown')
    } catch (value) { setError(value instanceof Error ? value.message : '删除失败') }
  }

  if (!sourceId || !path) return <div className="page"><PageHeader title="文档工具" description="编辑 Markdown 和文本文件，预览图片、PDF 及其他扫描文件" actions={<><ToolButton onClick={refreshMarkdown}><RefreshCw size={14} />刷新扫描</ToolButton><ToolButton className="primary" onClick={addSource}><FolderPlus size={14} />添加扫描目录</ToolButton></>} />
    {!markdownTrees.length ? <EmptyState title="还没有扫描目录">可以从左侧文档工具的“＋”菜单添加空 Markdown、文件夹或扫描目录。<div><ToolButton className="primary" onClick={addSource}>选择扫描目录</ToolButton></div></EmptyState> : <div className="source-overview">{markdownTrees.map((source) => {
      const displayName = source.note?.trim() || source.label
      const counts = countDocuments(source.children)
      return <section className="source-overview-card" key={source.id}><div className="source-overview-icon"><FolderOpen size={21} /></div><div className="source-overview-main"><button className="source-note-button" onClick={() => editSourceNote(source)} title="点击修改备注名"><strong>{displayName}</strong><Pencil size={12} /></button><span>文件夹名：{source.label}</span><code title={source.path}>{source.path}</code><small>{source.error ?? `扫描到 ${counts.total} 个文件`}</small>{!source.error && counts.total > 0 && <div className="document-kind-summary">{(['markdown', 'text', 'image', 'pdf', 'binary'] as const).filter((kind) => counts[kind]).map((kind) => <span key={kind}>{documentKindLabel(kind)} {counts[kind]}</span>)}</div>}</div><div className="source-overview-actions"><ToolButton className="primary" onClick={() => createSourceDocument(source)}><FilePlus2 size={14} />新建文件</ToolButton><ToolButton onClick={() => refreshMarkdown()}><RefreshCw size={14} />刷新扫描</ToolButton><ToolButton onClick={() => localBridge.revealMarkdownSource(source.id)}><FolderOpen size={14} />打开文件位置</ToolButton><ToolButton onClick={() => editSourceNote(source)}><Pencil size={14} />修改备注</ToolButton><ToolButton className="danger" onClick={() => removeSource(source)}><Trash2 size={14} />移除目录</ToolButton></div></section>
    })}</div>}
  </div>
  if (!document) return <div className="page"><PageHeader title={path.split('/').at(-1) ?? '文档'} />{error ? <EmptyState title="文件读取失败">{error}</EmptyState> : <Spinner label="正在读取文件" />}</div>

  const name = path.split('/').at(-1) ?? '文档'
  const contentUrl = scannedDocumentContentUrl(document.sourceId, document.relativePath)
  const metadata = `${documentKindLabel(document.previewKind)} · ${formatDocumentSize(document.size)} · ${path}`
  return <div className="page full-height-page markdown-page document-page">
    <PageHeader title={name} description={metadata} actions={<>{document.editable && <div className="save-status"><span className={`save-dot ${status}`} />{dirty ? '未保存' : status === 'saved' ? '已保存' : status === 'conflict' ? '文件冲突' : '磁盘文件'}</div>}<ToolButton onClick={() => localBridge.revealMarkdownDocument(document.sourceId, document.relativePath)}><FolderOpen size={14} />打开文件位置</ToolButton><ToolButton onClick={() => void copyFilePath(() => localBridge.getMarkdownDocumentFilePath(document.sourceId, document.relativePath))}><Copy size={14} />复制文件路径</ToolButton><ToolButton onClick={renameDocument}>重命名</ToolButton><ToolButton className="danger" onClick={trashDocument}><Trash2 size={14} />删除</ToolButton>{document.editable && <ToolButton className="primary" disabled={!dirty || status === 'saving'} onClick={save}><Save size={14} />保存</ToolButton>}</>} />
    {status === 'conflict' && <div className="conflict-banner"><span>磁盘文件已经变化。重新加载会丢弃当前编辑内容。</span><ToolButton onClick={async () => { const value = await localBridge.getMarkdownDocument(document.sourceId, document.relativePath); setDocument(value); setContent(value.content); setDirty(false); setStatus('idle') }}>重新加载</ToolButton></div>}
    {document.previewKind === 'markdown' && document.editable && <><div className="markdown-toolbar"><div className="segmented"><button className={mode === 'source' ? 'active' : ''} onClick={() => changeMode('source')}><FileCode2 size={14} />原文</button><button className={mode === 'preview' ? 'active' : ''} onClick={() => changeMode('preview')}><Eye size={14} />预览</button><button className={mode === 'split' ? 'active' : ''} onClick={() => changeMode('split')}><SplitSquareHorizontal size={14} />分屏</button></div>{mode !== 'source' && <ToolButton className={tocOpen ? 'active' : ''} disabled={!headingCount} aria-pressed={tocOpen} title={headingCount ? (tocOpen ? '收起文档目录' : '展开文档目录') : '当前文档没有标题'} onClick={toggleToc}><List size={14} />目录</ToolButton>}{mode === 'split' && <ToolButton className={syncScroll ? 'active' : ''} aria-pressed={syncScroll} onClick={toggleSyncScroll}>同步滚动</ToolButton>}<InlineError>{error}</InlineError></div><MarkdownWorkspace content={content} mode={mode} tocOpen={tocOpen} syncScroll={syncScroll} previewComponents={previewComponents} onHeadingCountChange={setHeadingCount} onChange={(value) => { setContent(value); setDirty(value !== document.content); setStatus('idle') }} /></>}
    {isHtmlDocument && document.editable && <><div className="markdown-toolbar document-toolbar"><div className="segmented"><button className={htmlMode === 'source' ? 'active' : ''} onClick={() => setHtmlMode('source')}><FileCode2 size={14} />原文</button><button className={htmlMode === 'preview' ? 'active' : ''} onClick={() => setHtmlMode('preview')}><Eye size={14} />预览</button><button className={htmlMode === 'split' ? 'active' : ''} onClick={() => setHtmlMode('split')}><SplitSquareHorizontal size={14} />分屏</button></div><span className="html-security-note">沙箱预览 · 脚本已禁用</span><InlineError>{error}</InlineError></div><div className={`html-document-workspace mode-${htmlMode}`}>{htmlMode !== 'preview' && <div className="html-document-editor"><Editor height="100%" language="html" value={content} onChange={(value) => { const next = value ?? ''; setContent(next); setDirty(next !== document.content); setStatus('idle') }} theme="vs-dark" options={{ automaticLayout: true, minimap: { enabled: false }, fontSize: 14, fontFamily: 'Cascadia Code, Consolas, monospace', wordWrap: 'off', scrollBeyondLastLine: false }} /></div>}{htmlMode !== 'source' && <iframe className="html-preview-frame" sandbox="" srcDoc={htmlPreviewDocument} title={`${name} 预览`} />}</div></>}
    {document.previewKind === 'text' && document.editable && !isHtmlDocument && <><div className="markdown-toolbar document-toolbar"><span>{document.extension.slice(1).toUpperCase() || 'TEXT'} 文本编辑</span><InlineError>{error}</InlineError></div><div className="document-text-editor"><Editor height="100%" language={documentEditorLanguage(document.extension)} value={content} onChange={(value) => { const next = value ?? ''; setContent(next); setDirty(next !== document.content); setStatus('idle') }} theme="vs-dark" options={{ automaticLayout: true, minimap: { enabled: false }, fontSize: 14, fontFamily: 'Cascadia Code, Consolas, monospace', wordWrap: 'off', scrollBeyondLastLine: false }} /></div></>}
    {(document.previewKind === 'text' || document.previewKind === 'markdown') && !document.editable && <div className="file-preview-message"><FileCode2 size={40} /><h3>文本文件过大，未载入编辑器</h3><p>{formatDocumentSize(document.size)} 的文本超过 10 MiB 编辑限制，可复制路径后使用本地编辑器打开。</p></div>}
    {document.previewKind === 'image' && <><div className="markdown-toolbar document-toolbar"><ToolButton onClick={() => setZoom(Math.max(.25, (zoom || 1) - .25))}><ZoomOut size={14} /></ToolButton><span>{zoom === 0 ? '适应窗口' : `${Math.round(zoom * 100)}%`}</span><ToolButton onClick={() => setZoom(Math.min(4, (zoom || 1) + .25))}><ZoomIn size={14} /></ToolButton><ToolButton onClick={() => setZoom(1)}>原始大小</ToolButton><ToolButton onClick={() => setZoom(0)}>适应窗口</ToolButton></div><div className="file-image-preview"><img src={contentUrl} alt={name} style={zoom === 0 ? { maxWidth: '100%', maxHeight: '100%' } : { width: `${zoom * 100}%`, maxWidth: 'none' }} /></div></>}
    {document.previewKind === 'pdf' && <div className="file-pdf-preview"><iframe src={contentUrl} title={name} /></div>}
    {document.previewKind === 'binary' && <div className="file-preview-message"><File size={40} /><h3>暂不支持预览此文件</h3><p>{name} · {formatDocumentSize(document.size)}</p><a className="tool-button primary" href={scannedDocumentContentUrl(document.sourceId, document.relativePath, true)} download={name}><Download size={14} />下载文件</a></div>}
  </div>
}

export function MarkdownPage() {
  const { documentId } = useParams()
  return documentId ? <ManagedMarkdownPage documentId={documentId} /> : <ExternalMarkdownPage />
}
