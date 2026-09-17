import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import Editor from '@monaco-editor/react'
import { ChevronDown, ChevronRight, ClipboardPaste, Copy, Download, File, FileCode2, FileImage, FileText, FolderOpen, MoreHorizontal, Pencil, Plus, Save, Search, Star, X, ZoomIn, ZoomOut } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type DragEvent, type FormEvent } from 'react'
import ReactMarkdown from 'react-markdown'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize from 'rehype-sanitize'
import remarkGfm from 'remark-gfm'
import { FILE_WORKBENCH_MAX_UPLOAD_SIZE, FILE_WORKBENCH_TEXT_EDIT_LIMIT, type FileWorkbenchItem, type FileWorkbenchLibrary, type FileWorkbenchTextDocument } from '../../shared/types'
import { ToolButton } from '../components/ui'
import { ApiError, fileWorkbenchContentUrl, localBridge } from '../lib/api'
import { copyFilePath, showAppNotice } from '../lib/clipboard'
import { confirmAction } from '../lib/confirmation'
import { applyFileExtension, candidatesFromClipboardData, classifyDragTypes, clipboardReadErrorMessage, createImportFile, imageImportExtension, isEditableTarget, readCurrentClipboard, suggestedImportName, textImportExtension, textImportFormatOptions, validateImportFileName, type ClipboardImportCandidate, type DragContentKind, type TextImportFormat } from '../lib/clipboardImport'
import { useAppStore } from '../store/appStore'

type MarkdownMode = 'source' | 'preview' | 'split'

const formatSize = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KiB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MiB`
  return `${(bytes / 1024 ** 3).toFixed(1)} GiB`
}

const editorLanguage = (extension: string) => ({
  '.json': 'json', '.js': 'javascript', '.jsx': 'javascript', '.ts': 'typescript', '.tsx': 'typescript', '.lua': 'lua', '.xml': 'xml', '.html': 'html', '.htm': 'html', '.css': 'css', '.scss': 'scss', '.sql': 'sql', '.py': 'python', '.java': 'java', '.cs': 'csharp', '.cpp': 'cpp', '.c': 'c', '.h': 'cpp', '.md': 'markdown', '.yaml': 'yaml', '.yml': 'yaml', '.sh': 'shell', '.ps1': 'powershell',
}[extension] ?? 'plaintext')

function FileTypeIcon({ item, size = 17 }: { item: FileWorkbenchItem; size?: number }) {
  if (item.previewKind === 'image') return <FileImage size={size} />
  if (item.previewKind === 'text' || item.previewKind === 'markdown') return <FileCode2 size={size} />
  if (item.previewKind === 'pdf') return <FileText size={size} />
  return <File size={size} />
}

function FileMenu({ item, onRename, onFavorite, onTrash }: { item: FileWorkbenchItem; onRename: () => void; onFavorite: () => void; onTrash: () => void }) {
  const download = () => {
    const link = document.createElement('a')
    link.href = fileWorkbenchContentUrl(item.id, true)
    link.download = item.name
    link.click()
  }
  return <DropdownMenu.Root>
    <DropdownMenu.Trigger asChild><button className="icon-button" aria-label="更多文件操作"><MoreHorizontal size={16} /></button></DropdownMenu.Trigger>
    <DropdownMenu.Portal><DropdownMenu.Content className="dropdown-content" sideOffset={4}>
      <DropdownMenu.Item className="dropdown-item" onSelect={onRename}>重命名</DropdownMenu.Item>
      <DropdownMenu.Item className="dropdown-item" onSelect={onFavorite}>{item.favorite ? '取消收藏' : '收藏'}</DropdownMenu.Item>
      <DropdownMenu.Item className="dropdown-item" onSelect={() => void copyFilePath(() => localBridge.getFileWorkbenchItemPath(item.id))}>复制文件路径</DropdownMenu.Item>
      <DropdownMenu.Item className="dropdown-item" onSelect={() => void localBridge.revealFileWorkbenchItem(item.id)}>打开副本所在位置</DropdownMenu.Item>
      <DropdownMenu.Item className="dropdown-item" onSelect={download}>导出副本</DropdownMenu.Item>
      <DropdownMenu.Separator className="dropdown-separator" />
      <DropdownMenu.Item className="dropdown-item danger" onSelect={onTrash}>移入垃圾箱</DropdownMenu.Item>
    </DropdownMenu.Content></DropdownMenu.Portal>
  </DropdownMenu.Root>
}

function FileRow({ item, active, onOpen, onRename, onFavorite, onTrash }: { item: FileWorkbenchItem; active: boolean; onOpen: () => void; onRename: () => void; onFavorite: () => void; onTrash: () => void }) {
  return <div className={`file-library-row ${active ? 'active' : ''}`} onClick={onOpen}>
    <span className="file-library-icon"><FileTypeIcon item={item} /></span>
    <div className="file-library-copy"><strong title={item.name}>{item.name}</strong><span>{item.extension.slice(1).toUpperCase() || 'FILE'} · {formatSize(item.size)}</span>{item.description && <small title={item.description}>{item.description}</small>}</div>
    <button className={`file-favorite ${item.favorite ? 'active' : ''}`} aria-label={item.favorite ? '取消收藏' : '收藏'} onClick={(event) => { event.stopPropagation(); onFavorite() }}><Star size={15} fill={item.favorite ? 'currentColor' : 'none'} /></button>
    <span onClick={(event) => event.stopPropagation()}><FileMenu item={item} onRename={onRename} onFavorite={onFavorite} onTrash={onTrash} /></span>
  </div>
}

function DescriptionEditor({ item, onSaved, onEditingChange }: { item: FileWorkbenchItem; onSaved: (item: FileWorkbenchItem) => void; onEditingChange: (editing: boolean) => void }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(item.description)
  useEffect(() => { setValue(item.description); setEditing(false) }, [item.id, item.description])
  const save = async () => {
    try {
      const saved = await localBridge.updateFileWorkbenchMetadata(item.id, { description: value, metadataRevision: item.metadataRevision })
      onSaved(saved); setEditing(false); onEditingChange(false); showAppNotice({ kind: 'success', message: '文件描述已保存' })
    } catch (error) { showAppNotice({ kind: 'error', message: error instanceof Error ? error.message : '描述保存失败' }) }
  }
  if (editing) return <section className="file-description editing"><div className="file-description-label">描述 <span>{value.length}/1000</span></div><textarea autoFocus maxLength={1000} value={value} onChange={(event) => setValue(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') { setValue(item.description); setEditing(false); onEditingChange(false) } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void save() } }} /><div className="file-description-actions"><ToolButton onClick={() => { setValue(item.description); setEditing(false); onEditingChange(false) }}>取消</ToolButton><ToolButton className="primary" onClick={() => void save()}>保存</ToolButton></div></section>
  return <button className={`file-description ${item.description ? '' : 'empty'}`} onClick={() => { setEditing(true); onEditingChange(true) }}><span className="file-description-label">描述</span><span className="file-description-value">{item.description || '添加这个文件的用途、来源或注意事项……'}</span><Pencil size={14} /></button>
}

function MarkdownPreview({ content }: { content: string }) {
  return <article className="markdown-preview"><ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw, rehypeSanitize]}>{content}</ReactMarkdown></article>
}

export function ImportClipboardDialog({ candidates, uploading, onClose, onImport }: {
  candidates: ClipboardImportCandidate[]
  uploading: boolean
  onClose: () => void
  onImport: (file: File) => Promise<boolean>
}) {
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [format, setFormat] = useState<TextImportFormat>('auto')
  const [name, setName] = useState(() => suggestedImportName(candidates[0]))
  const [localError, setLocalError] = useState('')
  const [previewUrl, setPreviewUrl] = useState<string>()
  const nameInputRef = useRef<HTMLInputElement>(null)
  const candidate = candidates[selectedIndex]

  useEffect(() => { nameInputRef.current?.focus(); nameInputRef.current?.select() }, [])
  useEffect(() => {
    if (candidate.kind !== 'image') { setPreviewUrl(undefined); return }
    const url = URL.createObjectURL(candidate.blob)
    setPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [candidate])

  const extension = candidate.kind === 'image' ? (imageImportExtension(candidate.mimeType) ?? '.png') : textImportExtension(format, candidate.text)
  const finalName = applyFileExtension(name, extension)
  const fileNameError = validateImportFileName(finalName)
  const size = candidate.kind === 'image' ? candidate.blob.size : new TextEncoder().encode(candidate.text).byteLength
  const tooLarge = candidate.kind === 'text' ? size > FILE_WORKBENCH_TEXT_EDIT_LIMIT : size > FILE_WORKBENCH_MAX_UPLOAD_SIZE
  const sizeError = tooLarge ? (candidate.kind === 'text' ? '文本超过 10 MiB 的导入限制' : '图片超过 512 MiB 的单文件限制') : ''
  const previewLines = candidate.kind === 'text' ? candidate.text.split(/\r?\n/, 11) : []
  const previewText = previewLines.slice(0, 10).join('\n')
  const previewTruncated = candidate.kind === 'text' && (previewLines.length > 10 || previewText.length < candidate.text.length)

  const selectCandidate = (index: number) => {
    const next = candidates[index]
    setSelectedIndex(index)
    setFormat('auto')
    setName(suggestedImportName(next))
    setLocalError('')
  }
  const changeFormat = (next: TextImportFormat) => {
    if (candidate.kind !== 'text') return
    setFormat(next)
    setName((value) => applyFileExtension(value, textImportExtension(next, candidate.text)))
    setLocalError('')
  }
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (uploading || fileNameError || tooLarge) return
    try {
      const file = createImportFile(candidate, name, format)
      if (await onImport(file)) onClose()
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : '无法创建导入文件')
    }
  }

  return <div className="file-import-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget && !uploading) onClose() }}>
    <form className="file-import-dialog" role="dialog" aria-modal="true" aria-labelledby="file-import-title" onSubmit={(event) => void submit(event)} onKeyDown={(event) => { if (event.key === 'Escape' && !uploading) { event.preventDefault(); onClose() } }}>
      <header><div><h2 id="file-import-title">{candidate.source === 'drop' ? '添加拖入文字' : '添加剪贴板内容'}</h2><p>确认后会作为独立副本保存到文件工作台。</p></div><button type="button" className="icon-button" aria-label="关闭导入窗口" disabled={uploading} onClick={onClose}><X size={17} /></button></header>
      {candidates.length > 1 && <div className="file-import-candidates" role="tablist" aria-label="剪贴板内容类型">{candidates.map((item, index) => <button type="button" role="tab" aria-selected={selectedIndex === index} className={selectedIndex === index ? 'active' : ''} key={`${item.kind}-${index}`} onClick={() => selectCandidate(index)}>{item.kind === 'image' ? <FileImage size={15} /> : <FileText size={15} />}{item.kind === 'image' ? '图片' : '文字'}</button>)}</div>}
      <label className="file-import-field"><span>文件名</span><input ref={nameInputRef} value={name} maxLength={200} onChange={(event) => { setName(event.target.value); setLocalError('') }} /></label>
      {candidate.kind === 'text' && <label className="file-import-field"><span>格式</span><select value={format} onChange={(event) => changeFormat(event.target.value as TextImportFormat)}>{textImportFormatOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>}
      <div className="file-import-result">将保存为 <strong>{finalName}</strong><span>{formatSize(size)}</span></div>
      <section className={`file-import-preview ${candidate.kind}`} aria-label="导入内容预览">{candidate.kind === 'image' ? <>{previewUrl && <img src={previewUrl} alt="剪贴板图片预览" />}<div><span>{candidate.mimeType}</span><span>{formatSize(candidate.blob.size)}</span></div></> : <pre>{previewText}{previewTruncated ? '\n…' : ''}</pre>}</section>
      {(fileNameError || sizeError || localError) && <div className="file-import-error" role="alert">{fileNameError || sizeError || localError}</div>}
      <footer><span>{candidate.kind === 'text' ? '保留原始文字、换行和 Unicode 内容' : '按剪贴板实际图片格式保存'}</span><ToolButton type="button" disabled={uploading} onClick={onClose}>取消</ToolButton><ToolButton type="submit" className="primary" disabled={uploading || Boolean(fileNameError) || tooLarge}>{uploading ? '正在添加…' : '添加并打开'}</ToolButton></footer>
    </form>
  </div>
}

function FileContent({ item, document, draft, dirty, loading, error, markdownMode, zoom, onDraft, onSave, onMarkdownMode, onZoom }: {
  item: FileWorkbenchItem; document?: FileWorkbenchTextDocument; draft: string; dirty: boolean; loading: boolean; error: string; markdownMode: MarkdownMode; zoom: number
  onDraft: (value: string) => void; onSave: () => void; onMarkdownMode: (mode: MarkdownMode) => void; onZoom: (zoom: number) => void
}) {
  if (item.previewKind === 'text' || item.previewKind === 'markdown') {
    if (item.size > FILE_WORKBENCH_TEXT_EDIT_LIMIT) return <div className="file-preview-message"><FileCode2 size={36} /><h3>文件过大，未载入编辑器</h3><p>{formatSize(item.size)} 的文本可能导致浏览器卡顿，请导出后使用本地编辑器打开。</p></div>
    if (loading) return <div className="file-preview-message">正在读取文件……</div>
    if (error || !document) return <div className="file-preview-message error">{error || '无法读取文件'}</div>
    const editor = <div className="file-text-editor"><Editor height="100%" language={editorLanguage(item.extension)} value={draft} onChange={(value) => onDraft(value ?? '')} theme="vs-dark" options={{ automaticLayout: true, minimap: { enabled: false }, fontSize: 14, fontFamily: 'Cascadia Code, Consolas, monospace', wordWrap: item.previewKind === 'markdown' ? 'on' : 'off', scrollBeyondLastLine: false }} /></div>
    return <><div className="file-view-toolbar">{item.previewKind === 'markdown' && <div className="segmented"><button className={markdownMode === 'source' ? 'active' : ''} onClick={() => onMarkdownMode('source')}>原文</button><button className={markdownMode === 'preview' ? 'active' : ''} onClick={() => onMarkdownMode('preview')}>预览</button><button className={markdownMode === 'split' ? 'active' : ''} onClick={() => onMarkdownMode('split')}>分屏</button></div>}<span className={`file-save-state ${dirty ? 'dirty' : ''}`}>{dirty ? '未保存' : '已保存'}</span><ToolButton className="primary" disabled={!dirty} onClick={onSave}><Save size={14} />保存</ToolButton></div><div className={`file-text-workspace ${item.previewKind === 'markdown' ? `markdown-${markdownMode}` : ''}`}>{item.previewKind !== 'markdown' || markdownMode !== 'preview' ? editor : null}{item.previewKind === 'markdown' && markdownMode !== 'source' && <MarkdownPreview content={draft} />}</div></>
  }
  if (item.previewKind === 'image') return <><div className="file-view-toolbar"><ToolButton onClick={() => onZoom(Math.max(.25, zoom - .25))}><ZoomOut size={14} /></ToolButton><span>{Math.round(zoom * 100)}%</span><ToolButton onClick={() => onZoom(Math.min(4, zoom + .25))}><ZoomIn size={14} /></ToolButton><ToolButton onClick={() => onZoom(1)}>原始大小</ToolButton><ToolButton onClick={() => onZoom(0)}>适应窗口</ToolButton></div><div className="file-image-preview"><img src={fileWorkbenchContentUrl(item.id)} alt={item.name} style={zoom === 0 ? { maxWidth: '100%', maxHeight: '100%' } : { width: `${zoom * 100}%`, maxWidth: 'none' }} /></div></>
  if (item.previewKind === 'pdf') return <div className="file-pdf-preview"><iframe src={fileWorkbenchContentUrl(item.id)} title={item.name} /></div>
  return <div className="file-preview-message"><File size={40} /><h3>暂不支持预览此文件</h3><p>{item.name} · {formatSize(item.size)}</p><a className="tool-button primary" href={fileWorkbenchContentUrl(item.id, true)} download={item.name}><Download size={14} />导出副本</a></div>
}

export function FileWorkbenchPage() {
  const setFileWorkbenchDirty = useAppStore((state) => state.setFileWorkbenchDirty)
  const inputRef = useRef<HTMLInputElement>(null)
  const [library, setLibrary] = useState<FileWorkbenchLibrary>()
  const [openIds, setOpenIds] = useState<string[]>([])
  const [activeId, setActiveId] = useState<string>()
  const [documents, setDocuments] = useState<Record<string, FileWorkbenchTextDocument>>({})
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [dirtyIds, setDirtyIds] = useState<Set<string>>(new Set())
  const [loadingId, setLoadingId] = useState<string>()
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [favoritesOpen, setFavoritesOpen] = useState(true)
  const [allOpen, setAllOpen] = useState(true)
  const [dragging, setDragging] = useState<DragContentKind>()
  const [uploading, setUploading] = useState(false)
  const [clipboardReading, setClipboardReading] = useState(false)
  const [importCandidates, setImportCandidates] = useState<ClipboardImportCandidate[]>()
  const [markdownMode, setMarkdownMode] = useState<MarkdownMode>('split')
  const [zoom, setZoom] = useState(0)
  const [descriptionEditingId, setDescriptionEditingId] = useState<string>()
  const uploadingRef = useRef(false)
  const clipboardReadingRef = useRef(false)

  const refresh = async () => setLibrary(await localBridge.listFileWorkbenchItems())
  useEffect(() => { void refresh().catch((value) => setError(value instanceof Error ? value.message : '文件库加载失败')) }, [])
  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => { if (dirtyIds.size || descriptionEditingId) event.preventDefault() }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [dirtyIds, descriptionEditingId])
  useEffect(() => {
    setFileWorkbenchDirty(dirtyIds.size > 0 || Boolean(descriptionEditingId))
    return () => setFileWorkbenchDirty(false)
  }, [dirtyIds, descriptionEditingId, setFileWorkbenchDirty])

  const activeItem = library?.items.find((item) => item.id === activeId)
  useEffect(() => {
    if (!activeItem || (activeItem.previewKind !== 'text' && activeItem.previewKind !== 'markdown') || activeItem.size > FILE_WORKBENCH_TEXT_EDIT_LIMIT || documents[activeItem.id]) return
    setLoadingId(activeItem.id); setError('')
    void localBridge.getFileWorkbenchText(activeItem.id).then((value) => { setDocuments((items) => ({ ...items, [value.id]: value })); setDrafts((items) => ({ ...items, [value.id]: value.content })) }).catch((value) => setError(value instanceof Error ? value.message : '文件读取失败')).finally(() => setLoadingId(undefined))
  }, [activeItem, documents])

  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase()
    return (library?.items ?? []).filter((item) => !query || item.name.toLocaleLowerCase().includes(query) || item.description.toLocaleLowerCase().includes(query))
  }, [library, search])
  const favorites = filtered.filter((item) => item.favorite).sort((a, b) => (b.favoritedAt ?? '').localeCompare(a.favoritedAt ?? ''))
  const totalSize = (library?.items ?? []).reduce((sum, item) => sum + item.size, 0)

  const replaceItem = (next: FileWorkbenchItem) => setLibrary((current) => current ? { ...current, items: current.items.map((item) => item.id === next.id ? next : item) } : current)
  const openFile = async (item: FileWorkbenchItem) => {
    if (descriptionEditingId && descriptionEditingId !== item.id && !(await confirmAction('文件描述尚未保存，切换文件将丢弃描述草稿，是否继续？', { confirmLabel: '切换文件' }))) return
    setDescriptionEditingId(undefined); setOpenIds((ids) => ids.includes(item.id) ? ids : [...ids, item.id]); setActiveId(item.id); setZoom(0); setError('')
  }
  const closeTab = async (id: string, force = false) => {
    if (!force && (dirtyIds.has(id) || descriptionEditingId === id) && !(await confirmAction('该文件有未保存的修改，确定关闭吗？', { confirmLabel: '关闭' }))) return
    const position = openIds.indexOf(id)
    const next = openIds.filter((value) => value !== id)
    setOpenIds(next); if (descriptionEditingId === id) setDescriptionEditingId(undefined); setDirtyIds((values) => { const copy = new Set(values); copy.delete(id); return copy })
    if (activeId === id) setActiveId(next[Math.min(position, next.length - 1)])
  }
  const updateMetadata = async (item: FileWorkbenchItem, patch: { name?: string; favorite?: boolean; description?: string }) => {
    try { replaceItem(await localBridge.updateFileWorkbenchMetadata(item.id, { ...patch, metadataRevision: item.metadataRevision })) }
    catch (value) { setError(value instanceof Error ? value.message : '文件信息修改失败'); await refresh() }
  }
  const renameItem = async (item: FileWorkbenchItem) => {
    const name = window.prompt('新的文件名', item.name)?.trim()
    if (!name || name === item.name) return
    const oldExtension = item.extension.toLowerCase()
    const newExtension = name.includes('.') ? `.${name.split('.').at(-1)!.toLowerCase()}` : ''
    if (oldExtension !== newExtension && !(await confirmAction('修改扩展名可能改变文件的预览方式，是否继续？', { confirmLabel: '继续重命名' }))) return
    await updateMetadata(item, { name })
  }
  const trashItem = async (item: FileWorkbenchItem) => {
    const warning = dirtyIds.has(item.id) ? `将 ${item.name} 移入垃圾箱？未保存的编辑会被丢弃。` : `将 ${item.name} 移入 BayTools 垃圾箱？`
    if (!(await confirmAction(warning, { confirmLabel: '移入垃圾箱' }))) return
    try { await localBridge.trashFileWorkbenchItem(item.id); await closeTab(item.id, true); await refresh(); showAppNotice({ kind: 'success', message: '文件已移入垃圾箱' }) }
    catch (value) { setError(value instanceof Error ? value.message : '删除失败') }
  }
  const upload = async (files: File[]): Promise<boolean> => {
    if (!files.length || uploadingRef.current) return false
    uploadingRef.current = true
    setUploading(true); setError('')
    let last: FileWorkbenchItem | undefined
    let completed = 0
    try {
      for (const file of files) {
        if (file.size > FILE_WORKBENCH_MAX_UPLOAD_SIZE) throw new Error(`${file.name} 超过 512 MiB 的单文件限制`)
        last = await localBridge.uploadFileWorkbenchFile(file)
        completed += 1
      }
      showAppNotice({ kind: 'success', message: `已添加 ${completed} 个文件` })
    } catch (value) { setError(value instanceof Error ? value.message : '文件添加失败') }
    finally {
      try { await refresh(); if (last) await openFile(last) }
      catch (value) { setError(value instanceof Error ? value.message : '文件库刷新失败') }
      finally {
        uploadingRef.current = false
        setUploading(false)
        if (inputRef.current) inputRef.current.value = ''
      }
    }
    return completed === files.length
  }

  const openImportCandidates = (candidates: ClipboardImportCandidate[]) => {
    if (!candidates.length) {
      setError('剪贴板中没有可导入的文字或图片')
      showAppNotice({ kind: 'error', message: '剪贴板中没有可导入的文字或图片' })
      return
    }
    setError('')
    setImportCandidates(candidates)
  }
  const readClipboard = async () => {
    if (clipboardReadingRef.current || uploadingRef.current || importCandidates) return
    clipboardReadingRef.current = true
    setClipboardReading(true)
    setError('')
    try {
      openImportCandidates(await readCurrentClipboard())
    } catch (value) {
      const message = clipboardReadErrorMessage(value)
      setError(message)
      showAppNotice({ kind: 'error', message })
    } finally {
      clipboardReadingRef.current = false
      setClipboardReading(false)
    }
  }
  const saveActive = async () => {
    if (!activeItem) return
    const document = documents[activeItem.id]
    if (!document) return
    try {
      const saved = await localBridge.saveFileWorkbenchText({ ...document, content: drafts[activeItem.id] ?? '' })
      setDocuments((items) => ({ ...items, [saved.id]: saved })); setDirtyIds((values) => { const copy = new Set(values); copy.delete(saved.id); return copy }); await refresh(); showAppNotice({ kind: 'success', message: '文件已保存' })
    } catch (value) { setError(value instanceof ApiError && value.status === 409 ? '保存冲突：文件已在其他窗口中改变，请关闭页签后重新打开。' : value instanceof Error ? value.message : '保存失败') }
  }
  useEffect(() => {
    const handler = (event: KeyboardEvent) => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's' && activeItem) { event.preventDefault(); void saveActive() } }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  })
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.repeat || !event.ctrlKey || !event.shiftKey || event.key.toLowerCase() !== 'v' || isEditableTarget(event.target)) return
      event.preventDefault()
      void readClipboard()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  })

  useEffect(() => {
    const handler = (event: ClipboardEvent) => {
      if (!event.clipboardData || isEditableTarget(event.target) || clipboardReadingRef.current || uploadingRef.current || importCandidates) return
      const candidates = candidatesFromClipboardData(event.clipboardData)
      if (!candidates.length) return
      event.preventDefault()
      openImportCandidates(candidates)
    }
    document.addEventListener('paste', handler)
    return () => document.removeEventListener('paste', handler)
  })
  const onDrop = (event: DragEvent) => {
    event.preventDefault()
    const kind = classifyDragTypes(Array.from(event.dataTransfer.types))
    setDragging(undefined)
    if (kind === 'files') {
      void upload(Array.from(event.dataTransfer.files))
      return
    }
    if (kind === 'text') {
      const text = event.dataTransfer.getData('text/plain')
      if (text) openImportCandidates([{ kind: 'text', source: 'drop', text }])
      else setError('拖入的文字为空，未创建文件')
      return
    }
    setError('当前拖入内容无法识别，仅支持文件或纯文本')
  }

  const dragCopy = dragging === 'files'
    ? { title: '松开以复制文件', detail: '文件将复制，源文件不会改变', icon: <File size={50} /> }
    : dragging === 'text'
      ? { title: '松开以创建文本文件', detail: '确认名称和格式后添加到工作台', icon: <FileText size={50} /> }
      : { title: '当前拖入内容无法识别', detail: '仅支持文件或纯文本', icon: <X size={50} /> }

  return <div className="file-workbench-page" onDragEnter={(event) => { event.preventDefault(); setDragging(classifyDragTypes(Array.from(event.dataTransfer.types))) }} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; setDragging(classifyDragTypes(Array.from(event.dataTransfer.types))) }} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(undefined) }} onDrop={onDrop}>
    <header className="file-workbench-header"><div><h1>文件工作台</h1><span>{library?.items.length ?? 0} 个文件 · {formatSize(totalSize)}</span></div><ToolButton disabled={uploading || clipboardReading} onClick={() => void readClipboard()}><ClipboardPaste size={15} />{clipboardReading ? '正在读取…' : '从剪贴板添加'}</ToolButton><ToolButton className="primary" disabled={uploading || clipboardReading} onClick={() => inputRef.current?.click()}><Plus size={15} />{uploading ? '正在添加…' : '添加文件'}</ToolButton><input ref={inputRef} hidden type="file" multiple onChange={(event) => void upload(Array.from(event.target.files ?? []))} /></header>
    {error && <div className="file-workbench-error" role="alert">{error}<button aria-label="关闭错误提示" onClick={() => setError('')}><X size={14} /></button></div>}
    <div className="file-workbench-shell">
      <aside className="file-library"><label className="file-library-search"><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索文件名或描述" /></label>
        <section><button className="file-library-group" onClick={() => setFavoritesOpen((value) => !value)}>{favoritesOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}<Star size={15} /><strong>收藏文件</strong><span>{favorites.length}</span></button>{favoritesOpen && <div>{favorites.length ? favorites.map((item) => <FileRow key={`favorite-${item.id}`} item={item} active={activeId === item.id} onOpen={() => { void openFile(item) }} onRename={() => void renameItem(item)} onFavorite={() => void updateMetadata(item, { favorite: !item.favorite })} onTrash={() => void trashItem(item)} />) : <p className="file-library-empty">收藏的文件会固定显示在这里</p>}</div>}</section>
        <section><button className="file-library-group" onClick={() => setAllOpen((value) => !value)}>{allOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}<FolderOpen size={15} /><strong>全部文件</strong><span>{filtered.length}</span></button>{allOpen && <div>{filtered.map((item) => <FileRow key={item.id} item={item} active={activeId === item.id} onOpen={() => { void openFile(item) }} onRename={() => void renameItem(item)} onFavorite={() => void updateMetadata(item, { favorite: !item.favorite })} onTrash={() => void trashItem(item)} />)}</div>}</section>
        <button className="file-library-drop" onClick={() => inputRef.current?.click()}><Plus size={14} />拖入或选择文件添加</button>
      </aside>
      <main className="file-workspace-panel">
        <div className="file-tabs">{openIds.map((id) => { const item = library?.items.find((value) => value.id === id); if (!item) return null; return <button key={id} className={`file-tab ${id === activeId ? 'active' : ''}`} onClick={() => { void openFile(item) }}><FileTypeIcon item={item} size={14} /><span>{item.name}</span>{dirtyIds.has(id) && <i />}<X size={13} onClick={(event) => { event.stopPropagation(); void closeTab(id) }} /></button> })}</div>
        {!activeItem ? <div className="file-workbench-empty"><File size={42} /><h2>{library?.items.length ? '选择文件进行预览' : '将文件拖到这里'}</h2><p>文件会复制到 BayTools 工作台，不会修改或移动源文件。</p><ToolButton className="primary" onClick={() => inputRef.current?.click()}>选择文件</ToolButton></div> : <div className="file-active-workspace">
          <div className="file-active-header"><div><h2>{activeItem.name}</h2><span>{activeItem.extension.slice(1).toUpperCase() || 'FILE'} · {formatSize(activeItem.size)} · 更新于 {new Date(activeItem.updatedAt).toLocaleString()}</span></div><div><ToolButton onClick={() => void updateMetadata(activeItem, { favorite: !activeItem.favorite })}><Star size={14} fill={activeItem.favorite ? 'currentColor' : 'none'} />{activeItem.favorite ? '已收藏' : '收藏'}</ToolButton><ToolButton onClick={() => void renameItem(activeItem)}>重命名</ToolButton><ToolButton onClick={() => void copyFilePath(() => localBridge.getFileWorkbenchItemPath(activeItem.id))}><Copy size={14} />复制路径</ToolButton><ToolButton onClick={() => void localBridge.revealFileWorkbenchItem(activeItem.id)}><FolderOpen size={14} />打开位置</ToolButton><FileMenu item={activeItem} onRename={() => void renameItem(activeItem)} onFavorite={() => void updateMetadata(activeItem, { favorite: !activeItem.favorite })} onTrash={() => void trashItem(activeItem)} /></div></div>
          <DescriptionEditor item={activeItem} onSaved={replaceItem} onEditingChange={(editing) => setDescriptionEditingId(editing ? activeItem.id : undefined)} />
          <div className="file-active-content"><FileContent item={activeItem} document={documents[activeItem.id]} draft={drafts[activeItem.id] ?? ''} dirty={dirtyIds.has(activeItem.id)} loading={loadingId === activeItem.id} error={error} markdownMode={markdownMode} zoom={zoom} onDraft={(value) => { setDrafts((items) => ({ ...items, [activeItem.id]: value })); setDirtyIds((values) => { const copy = new Set(values); if (value === documents[activeItem.id]?.content) copy.delete(activeItem.id); else copy.add(activeItem.id); return copy }) }} onSave={() => void saveActive()} onMarkdownMode={setMarkdownMode} onZoom={setZoom} /></div>
        </div>}
      </main>
    </div>
    {dragging && <div className={`file-drop-overlay ${dragging}`}>{dragCopy.icon}<strong>{dragCopy.title}</strong><span>{dragCopy.detail}</span></div>}
    {importCandidates && <ImportClipboardDialog candidates={importCandidates} uploading={uploading} onClose={() => setImportCandidates(undefined)} onImport={(file) => upload([file])} />}
  </div>
}
