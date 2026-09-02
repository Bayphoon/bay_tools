import Editor from '@monaco-editor/react'
import { Eye, FileCode2, FolderOpen, FolderPlus, Pencil, RefreshCw, Save, SplitSquareHorizontal, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize from 'rehype-sanitize'
import remarkGfm from 'remark-gfm'
import type { Components } from 'react-markdown'
import type { MarkdownDocument, MarkdownSourceTree, MarkdownUiState } from '../../shared/types'
import { EmptyState, InlineError, PageHeader, Spinner, ToolButton } from '../components/ui'
import { ApiError, assetUrl, localBridge } from '../lib/api'
import { useAppStore } from '../store/appStore'
import { ManagedMarkdownPage } from './ManagedMarkdownPage'

type MarkdownMode = 'source' | 'preview' | 'split'

function countMarkdownFiles(nodes: MarkdownSourceTree['children']): number {
  return nodes.reduce((count, node) => count + (node.type === 'file' ? 1 : countMarkdownFiles(node.children ?? [])), 0)
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

function MarkdownPreview({ sourceId, documentPath, content }: { sourceId: string; documentPath: string; content: string }) {
  const components = useMemo<Components>(() => ({
    img: (props) => <LocalImage sourceId={sourceId} documentPath={documentPath} src={props.src} alt={props.alt} />,
    a: ({ href, children }) => <a href={href} target="_blank" rel="noreferrer">{children}</a>,
  }), [sourceId, documentPath])
  return <article className="markdown-preview"><ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw, rehypeSanitize]} components={components}>{content}</ReactMarkdown></article>
}

function ExternalMarkdownPage() {
  const { sourceId } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const path = searchParams.get('path') ?? ''
  const navigate = useNavigate()
  const { markdownTrees, refreshMarkdown, setMarkdownDirty } = useAppStore()
  const [document, setDocument] = useState<MarkdownDocument>()
  const [content, setContent] = useState('')
  const [mode, setMode] = useState<MarkdownMode>('split')
  const [uiState, setUiState] = useState<MarkdownUiState>()
  const [dirty, setDirty] = useState(false)
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
    setDocument(undefined); setError(''); setDirty(false)
    void localBridge.getMarkdownDocument(sourceId, path).then((value) => { setDocument(value); setContent(value.content) }).catch((value) => setError(value.message))
  }, [sourceId, path])
  useEffect(() => { void localBridge.getMarkdownUiState().then((value) => { setUiState(value); setMode(value.mode) }) }, [])

  const changeMode = (nextMode: MarkdownMode) => {
    setMode(nextMode)
    if (uiState) void localBridge.updateMarkdownUiState({ ...uiState, mode: nextMode }).then(setUiState).catch(() => undefined)
  }

  const save = async () => {
    if (!document) return
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
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); void save() }
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
  const renameDocument = async () => {
    if (!document) return
    if (dirty && !window.confirm('重命名前将丢弃未保存修改，继续吗？')) return
    const currentName = path.split('/').at(-1) ?? ''
    const nextName = window.prompt('新的 Markdown 文件名', currentName)
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

  if (!sourceId || !path) return <div className="page"><PageHeader title="Markdown 阅读器" description="管理 BayTools 文档和本地扫描目录" actions={<><ToolButton onClick={refreshMarkdown}><RefreshCw size={14} />刷新扫描</ToolButton><ToolButton className="primary" onClick={addSource}><FolderPlus size={14} />添加扫描目录</ToolButton></>} />
    {!markdownTrees.length ? <EmptyState title="还没有扫描目录">可以从左侧 Markdown 的“＋”菜单添加空文档、文件夹或扫描目录。<div><ToolButton className="primary" onClick={addSource}>选择扫描目录</ToolButton></div></EmptyState> : <div className="source-overview">{markdownTrees.map((source) => {
      const displayName = source.note?.trim() || source.label
      return <section className="source-overview-card" key={source.id}><div className="source-overview-icon"><FolderOpen size={21} /></div><div className="source-overview-main"><button className="source-note-button" onClick={() => editSourceNote(source)} title="点击修改备注名"><strong>{displayName}</strong><Pencil size={12} /></button><span>文件夹名：{source.label}</span><code title={source.path}>{source.path}</code><small>{source.error ?? `扫描到 ${countMarkdownFiles(source.children)} 个 Markdown 文档`}</small></div><div className="source-overview-actions"><ToolButton onClick={() => refreshMarkdown()}><RefreshCw size={14} />刷新扫描</ToolButton><ToolButton onClick={() => localBridge.revealMarkdownSource(source.id)}><FolderOpen size={14} />打开文件位置</ToolButton><ToolButton onClick={() => editSourceNote(source)}><Pencil size={14} />修改备注</ToolButton><ToolButton className="danger" onClick={() => removeSource(source)}><Trash2 size={14} />移除目录</ToolButton></div></section>
    })}</div>}
  </div>
  if (!document) return <div className="page"><PageHeader title={path.split('/').at(-1) ?? 'Markdown'} /><Spinner label={error || '正在读取文件'} /></div>
  return <div className="page full-height-page markdown-page">
    <PageHeader title={path.split('/').at(-1) ?? 'Markdown'} description={path} actions={<><div className="save-status"><span className={`save-dot ${status}`} />{dirty ? '未保存' : status === 'saved' ? '已保存' : status === 'conflict' ? '文件冲突' : '磁盘文件'}</div><ToolButton onClick={() => localBridge.revealMarkdownDocument(document.sourceId, document.relativePath)}><FolderOpen size={14} />打开文件位置</ToolButton><ToolButton onClick={renameDocument}>重命名</ToolButton><ToolButton className="danger" onClick={trashDocument}><Trash2 size={14} />删除</ToolButton><ToolButton className="primary" disabled={!dirty || status === 'saving'} onClick={save}><Save size={14} />保存</ToolButton></>} />
    {status === 'conflict' && <div className="conflict-banner"><span>磁盘文件已经变化。重新加载会丢弃当前编辑内容。</span><ToolButton onClick={async () => { const value = await localBridge.getMarkdownDocument(document.sourceId, document.relativePath); setDocument(value); setContent(value.content); setDirty(false); setStatus('idle') }}>重新加载</ToolButton></div>}
    <div className="markdown-toolbar"><div className="segmented"><button className={mode === 'source' ? 'active' : ''} onClick={() => changeMode('source')}><FileCode2 size={14} />原文</button><button className={mode === 'preview' ? 'active' : ''} onClick={() => changeMode('preview')}><Eye size={14} />预览</button><button className={mode === 'split' ? 'active' : ''} onClick={() => changeMode('split')}><SplitSquareHorizontal size={14} />分屏</button></div><InlineError>{error}</InlineError></div>
    <div className={`markdown-workspace mode-${mode}`}>
      {mode !== 'preview' && <div className="markdown-editor"><Editor height="100%" language="markdown" value={content} onChange={(value) => { setContent(value ?? ''); setDirty((value ?? '') !== document.content); setStatus('idle') }} theme="vs-dark" options={{ minimap: { enabled: false }, fontSize: 14, fontFamily: 'Cascadia Code, Consolas, monospace', wordWrap: 'on', automaticLayout: true, scrollBeyondLastLine: false }} /></div>}
      {mode !== 'source' && <MarkdownPreview sourceId={document.sourceId} documentPath={document.relativePath} content={content} />}
    </div>
  </div>
}

export function MarkdownPage() {
  const { documentId } = useParams()
  return documentId ? <ManagedMarkdownPage documentId={documentId} /> : <ExternalMarkdownPage />
}
