import Editor from '@monaco-editor/react'
import { Copy, Eye, FileCode2, FolderOpen, Pencil, Save, SplitSquareHorizontal, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { useNavigate } from 'react-router-dom'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize from 'rehype-sanitize'
import remarkGfm from 'remark-gfm'
import type { Components } from 'react-markdown'
import type { ManagedMarkdownDocument, MarkdownUiState } from '../../shared/types'
import { InlineError, PageHeader, Spinner, ToolButton } from '../components/ui'
import { ApiError, localBridge } from '../lib/api'
import { useAppStore } from '../store/appStore'

type MarkdownMode = 'source' | 'preview' | 'split'

function ManagedPreview({ content }: { content: string }) {
  const components = useMemo<Components>(() => ({
    img: ({ src, alt }) => <span className="blocked-image">[内部文档图片：{alt ?? src ?? '无法定位'}]</span>,
    a: ({ href, children }) => <a href={href} target="_blank" rel="noreferrer">{children}</a>,
  }), [])
  return <article className="markdown-preview"><ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw, rehypeSanitize]} components={components}>{content}</ReactMarkdown></article>
}

export function ManagedMarkdownPage({ documentId }: { documentId: string }) {
  const navigate = useNavigate()
  const refreshManagedMarkdown = useAppStore((state) => state.refreshManagedMarkdown)
  const setMarkdownDirty = useAppStore((state) => state.setMarkdownDirty)
  const [document, setDocument] = useState<ManagedMarkdownDocument>()
  const [content, setContent] = useState('')
  const [mode, setMode] = useState<MarkdownMode>('split')
  const [uiState, setUiState] = useState<MarkdownUiState>()
  const [dirty, setDirty] = useState(false)
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'conflict' | 'error'>('idle')
  const [error, setError] = useState('')
  const saving = useRef(false)
  const contentRef = useRef(content)
  contentRef.current = content

  useEffect(() => {
    setDocument(undefined); setContent(''); setDirty(false); setError(''); setStatus('idle')
    void localBridge.getManagedMarkdownDocument(documentId).then((value) => { setDocument(value); setContent(value.content) }).catch((value) => setError(value.message))
  }, [documentId])
  useEffect(() => { void localBridge.getMarkdownUiState().then((value) => { setUiState(value); setMode(value.mode) }) }, [])
  useEffect(() => {
    setMarkdownDirty(dirty)
    return () => setMarkdownDirty(false)
  }, [dirty, setMarkdownDirty])
  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => { if (dirty) event.preventDefault() }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [dirty])

  const changeMode = (nextMode: MarkdownMode) => {
    setMode(nextMode)
    if (uiState) void localBridge.updateMarkdownUiState({ ...uiState, mode: nextMode }).then(setUiState).catch(() => undefined)
  }

  const save = async () => {
    if (!document || saving.current) return
    saving.current = true; setStatus('saving'); setError('')
    const snapshotContent = contentRef.current
    try {
      const saved = await localBridge.updateManagedMarkdownDocument({ ...document, content: snapshotContent })
      setDocument(saved)
      if (contentRef.current === snapshotContent) { setContent(saved.content); setDirty(false) }
      else setDirty(true)
      setStatus('saved')
      await refreshManagedMarkdown()
    } catch (value) {
      if (value instanceof ApiError && value.status === 409) setStatus('conflict')
      else setStatus('error')
      setError(value instanceof Error ? value.message : '保存失败')
    } finally { saving.current = false }
  }

  useEffect(() => {
    if (!document || !dirty || saving.current || status === 'conflict') return
    const timer = window.setTimeout(() => { void save() }, 500)
    return () => window.clearTimeout(timer)
  }, [content, dirty, document, status])
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); void save() }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  })

  const rename = () => {
    if (!document) return
    const title = window.prompt('Markdown 文档名称', document.title)?.trim()
    if (!title || title === document.title) return
    setDocument({ ...document, title })
    setDirty(true)
    setStatus('idle')
  }
  const duplicate = async () => {
    if (!document) return
    if (dirty) await save()
    const copy = await localBridge.duplicateManagedMarkdownDocument(document.id)
    await refreshManagedMarkdown()
    navigate(`/markdown/document/${copy.id}`)
  }
  const trash = async () => {
    if (!document || !window.confirm(`将 ${document.title} 移入垃圾箱？`)) return
    if (dirty) await save()
    await localBridge.trashManagedMarkdownDocument(document.id)
    await refreshManagedMarkdown()
    navigate('/markdown')
  }
  const reload = async () => {
    const value = await localBridge.getManagedMarkdownDocument(documentId)
    setDocument(value); setContent(value.content); setDirty(false); setStatus('idle'); setError('')
  }

  if (!document) return <div className="page"><PageHeader title="BayTools Markdown" /><Spinner label={error || '正在读取文档'} /></div>
  return <div className="page full-height-page markdown-page">
    <PageHeader title={<button className="page-title-button" onClick={rename} title="点击重命名">{document.title}<Pencil size={13} /></button>} description="BayTools 文档 · 自动保存" actions={<><div className="save-status"><span className={`save-dot ${status}`} />{status === 'saving' ? '保存中' : dirty ? '等待保存' : status === 'saved' ? '已保存' : status === 'conflict' ? '文档冲突' : '已保存'}</div><ToolButton onClick={() => localBridge.revealManagedMarkdownDocument(document.id)}><FolderOpen size={14} />打开文件位置</ToolButton><ToolButton onClick={duplicate}><Copy size={14} />创建副本</ToolButton><ToolButton className="danger" onClick={trash}><Trash2 size={14} />删除</ToolButton><ToolButton className="primary" disabled={!dirty || status === 'saving'} onClick={save}><Save size={14} />保存</ToolButton></>} />
    {status === 'conflict' && <div className="conflict-banner"><span>磁盘文档已经变化，没有覆盖当前内容。</span><ToolButton onClick={reload}>重新加载</ToolButton></div>}
    <div className="markdown-toolbar"><div className="segmented"><button className={mode === 'source' ? 'active' : ''} onClick={() => changeMode('source')}><FileCode2 size={14} />原文</button><button className={mode === 'preview' ? 'active' : ''} onClick={() => changeMode('preview')}><Eye size={14} />预览</button><button className={mode === 'split' ? 'active' : ''} onClick={() => changeMode('split')}><SplitSquareHorizontal size={14} />分屏</button></div><InlineError>{error}</InlineError></div>
    <div className={`markdown-workspace mode-${mode}`}>
      {mode !== 'preview' && <div className="markdown-editor"><Editor height="100%" language="markdown" value={content} onChange={(value) => { setContent(value ?? ''); setDirty((value ?? '') !== document.content || document.title !== (useAppStore.getState().managedMarkdown?.documents.find((item) => item.id === document.id)?.title ?? document.title)); setStatus('idle') }} theme="vs-dark" options={{ minimap: { enabled: false }, fontSize: 13, fontFamily: 'Cascadia Code, Consolas, monospace', wordWrap: 'on', automaticLayout: true, scrollBeyondLastLine: false }} /></div>}
      {mode !== 'source' && <ManagedPreview content={content} />}
    </div>
  </div>
}
