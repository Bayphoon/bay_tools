import Editor from '@monaco-editor/react'
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, ClipboardPaste, Copy, ImagePlus, Pencil, Plus, Search, Trash2, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import type { CodeCard, CodeCardSearchMode, CodeCardSearchPage, CodeCardSearchResult, CodeCardWorkspace } from '../../shared/types'
import { InlineError, Spinner, ToolButton } from '../components/ui'
import { clearSearchOnEscape, SearchClearButton } from '../components/SearchClearButton'
import { codeCardImageUrl, localBridge } from '../lib/api'
import { showAppNotice } from '../lib/clipboard'
import { clipboardReadErrorMessage, readCurrentClipboard } from '../lib/clipboardImport'
import { copyCodeCardImage, prepareCodeCardImage } from '../lib/codeCardImage'
import { confirmAction } from '../lib/confirmation'
import { useAppStore } from '../store/appStore'

type SaveState = 'idle' | 'pending' | 'saving' | 'saved' | 'error' | 'conflict'
const emptySearchPage: CodeCardSearchPage = { items: [], total: 0, page: 1, pageSize: 20, totalPages: 1 }

function newCard(): CodeCard {
  const createdAt = new Date().toISOString()
  return { id: crypto.randomUUID(), title: '未命名卡片', code: '', collapsed: false, height: 240, splitRatio: 55, createdAt, updatedAt: createdAt }
}

export function CodeCardsPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const targetCardId = searchParams.get('card')
  const refreshCodeCards = useAppStore((state) => state.refreshCodeCards)
  const [workspace, setWorkspace] = useState<CodeCardWorkspace>()
  const [loading, setLoading] = useState(true)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [error, setError] = useState<string>()
  const [imageBusyCard, setImageBusyCard] = useState<string>()
  const [search, setSearch] = useState('')
  const [searchMode, setSearchMode] = useState<CodeCardSearchMode>('fuzzy')
  const [searchPage, setSearchPage] = useState(1)
  const [searchResults, setSearchResults] = useState<CodeCardSearchPage>(emptySearchPage)
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState('')
  const workspaceRef = useRef<CodeCardWorkspace | undefined>(undefined)
  const dirtyRef = useRef(false)
  const editVersionRef = useRef(0)
  const savePromiseRef = useRef<Promise<CodeCardWorkspace | undefined> | undefined>(undefined)
  const revealedCardRef = useRef('')

  useEffect(() => {
    let active = true
    const previous = workspaceRef.current
    const flushPrevious = savePromiseRef.current ?? (previous && dirtyRef.current ? localBridge.updateCodeCardWorkspace(previous) : Promise.resolve(undefined))
    setLoading(true)
    setError(undefined)
    setWorkspace(undefined)
    workspaceRef.current = undefined
    dirtyRef.current = false
    editVersionRef.current = 0
    if (!id) { setLoading(false); return () => { active = false } }
    void flushPrevious.catch((reason) => {
      showAppNotice({ message: reason instanceof Error ? `上一页代码段保存失败：${reason.message}` : '上一页代码段保存失败', kind: 'error' })
    }).then(() => localBridge.getCodeCardWorkspace(id)).then((value) => {
      if (!active) return
      workspaceRef.current = value
      setWorkspace(value)
      setSaveState('idle')
    }).catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : '代码段加载失败') }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [id])

  const persist = useCallback(async function persistWorkspace(): Promise<CodeCardWorkspace | undefined> {
    if (savePromiseRef.current) {
      await savePromiseRef.current
      return dirtyRef.current ? persistWorkspace() : workspaceRef.current
    }
    const snapshot = workspaceRef.current
    if (!snapshot || !dirtyRef.current) return snapshot
    const version = editVersionRef.current
    setSaveState('saving')
    setError(undefined)
    const operation = localBridge.updateCodeCardWorkspace(snapshot).then((saved) => {
      if (editVersionRef.current === version) {
        workspaceRef.current = saved
        dirtyRef.current = false
        setWorkspace(saved)
        setSaveState('saved')
      } else {
        setWorkspace((current) => {
          if (!current) return saved
          const next = { ...current, revision: saved.revision, updatedAt: saved.updatedAt }
          workspaceRef.current = next
          return next
        })
        setSaveState('pending')
      }
      void refreshCodeCards()
      return workspaceRef.current
    }).catch((reason) => {
      setSaveState(reason && typeof reason === 'object' && 'status' in reason && reason.status === 409 ? 'conflict' : 'error')
      setError(reason instanceof Error ? reason.message : '代码段保存失败')
      throw reason
    }).finally(() => { savePromiseRef.current = undefined })
    savePromiseRef.current = operation
    return operation
  }, [refreshCodeCards])

  useEffect(() => {
    if (!workspace || !dirtyRef.current) return
    const timer = window.setTimeout(() => void persist().catch(() => undefined), 650)
    return () => window.clearTimeout(timer)
  }, [persist, workspace])

  useEffect(() => {
    const needle = search.trim()
    if (!needle) {
      setSearchResults(emptySearchPage)
      setSearching(false)
      setSearchError('')
      return
    }
    let active = true
    const timer = window.setTimeout(() => {
      setSearching(true)
      setSearchError('')
      void persist().then(() => localBridge.searchCodeCards(needle, searchPage, searchMode)).then((result) => {
        if (active) setSearchResults(result)
      }).catch((reason) => {
        if (active) setSearchError(reason instanceof Error ? reason.message : '代码段搜索失败')
      }).finally(() => { if (active) setSearching(false) })
    }, 220)
    return () => { active = false; window.clearTimeout(timer) }
  }, [persist, search, searchMode, searchPage])

  useEffect(() => () => {
    const snapshot = workspaceRef.current
    if (snapshot && dirtyRef.current) void localBridge.updateCodeCardWorkspace(snapshot).catch(() => undefined)
  }, [])

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return
      event.preventDefault()
    }
    window.addEventListener('beforeunload', beforeUnload)
    return () => window.removeEventListener('beforeunload', beforeUnload)
  }, [])

  const mutate = (change: (current: CodeCardWorkspace) => CodeCardWorkspace) => {
    setWorkspace((current) => {
      if (!current) return current
      const next = change(current)
      workspaceRef.current = next
      dirtyRef.current = true
      editVersionRef.current += 1
      setSaveState('pending')
      return next
    })
  }

  const updateCard = (cardId: string, patch: Partial<CodeCard>) => mutate((current) => ({
    ...current,
    cards: current.cards.map((card) => card.id === cardId ? { ...card, ...patch, updatedAt: new Date().toISOString() } : card),
  }))

  useEffect(() => {
    if (!workspace || !targetCardId) return
    const revealKey = `${workspace.id}:${targetCardId}`
    if (revealedCardRef.current === revealKey) return
    const card = workspace.cards.find((item) => item.id === targetCardId)
    if (!card) return
    revealedCardRef.current = revealKey
    if (card.collapsed) updateCard(card.id, { collapsed: false })
    const timer = window.setTimeout(() => document.getElementById(`code-card-${card.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 80)
    return () => window.clearTimeout(timer)
  }, [targetCardId, workspace?.id])

  const addCard = () => mutate((current) => ({ ...current, cards: [...current.cards, newCard()] }))

  const removeCard = async (card: CodeCard) => {
    if (!(await confirmAction(`删除卡片“${card.title}”？卡片代码和缩略图都会被删除。`))) return
    mutate((current) => ({ ...current, cards: current.cards.filter((item) => item.id !== card.id) }))
  }

  const renameCard = (card: CodeCard) => {
    const title = window.prompt('卡片标题', card.title)?.trim()
    if (!title || title === card.title) return
    updateCard(card.id, { title })
  }

  const addClipboardImage = async (card: CodeCard) => {
    if (imageBusyCard) return
    if (card.image && !(await confirmAction('当前卡片已经有图片，确定用剪贴板中的图片替换吗？', { confirmLabel: '替换' }))) return
    setImageBusyCard(card.id)
    setError(undefined)
    try {
      const saved = await persist()
      if (!saved) return
      const candidates = await readCurrentClipboard()
      const image = candidates.find((candidate) => candidate.kind === 'image')
      if (!image || image.kind !== 'image') throw new Error('当前剪贴板中没有可用图片')
      const prepared = await prepareCodeCardImage(image.blob)
      const updated = await localBridge.uploadCodeCardImage(saved.id, card.id, prepared.blob, prepared.width, prepared.height, saved.revision)
      workspaceRef.current = updated
      dirtyRef.current = false
      setWorkspace(updated)
      setSaveState('saved')
      void refreshCodeCards()
      showAppNotice({ message: prepared.blob.size < image.blob.size ? '图片已压缩并添加到卡片' : '图片已添加到卡片', kind: 'success' })
    } catch (reason) {
      const message = reason instanceof DOMException ? clipboardReadErrorMessage(reason) : reason instanceof Error ? reason.message : '图片添加失败'
      setError(message)
      showAppNotice({ message, kind: 'error' })
    } finally { setImageBusyCard(undefined) }
  }

  const clearImage = async (card: CodeCard) => {
    if (!card.image || !(await confirmAction('移除这张卡片的图片？'))) return
    setImageBusyCard(card.id)
    try {
      const saved = await persist()
      if (!saved) return
      const updated = await localBridge.deleteCodeCardImage(saved.id, card.id, saved.revision)
      workspaceRef.current = updated
      dirtyRef.current = false
      setWorkspace(updated)
      setSaveState('saved')
    } catch (reason) { setError(reason instanceof Error ? reason.message : '图片移除失败') } finally { setImageBusyCard(undefined) }
  }

  const copyCode = async (code: string) => {
    try { await navigator.clipboard.writeText(code); showAppNotice({ message: 'Lua 代码已复制', kind: 'success' }) }
    catch (reason) { showAppNotice({ message: reason instanceof Error ? reason.message : '复制失败', kind: 'error' }) }
  }

  const copyImage = async (card: CodeCard) => {
    if (!card.image) return
    try {
      const image = await fetch(codeCardImageUrl(workspaceRef.current!.id, card.id, card.image.updatedAt)).then((response) => {
        if (!response.ok) throw new Error('卡片图片读取失败')
        return response.blob()
      })
      await copyCodeCardImage(image)
      showAppNotice({ message: '卡片图片已复制', kind: 'success' })
    } catch (reason) { showAppNotice({ message: reason instanceof Error ? `复制图片失败：${reason.message}` : '图片复制失败', kind: 'error' }) }
  }

  const startHeightDrag = (event: ReactPointerEvent, card: CodeCard) => {
    event.preventDefault()
    const startY = event.clientY
    const startHeight = card.height
    const move = (pointer: PointerEvent) => updateCard(card.id, { height: Math.min(1000, Math.max(240, startHeight + pointer.clientY - startY)) })
    const stop = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', stop) }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
  }

  const startSplitDrag = (event: ReactPointerEvent, card: CodeCard) => {
    event.preventDefault()
    const container = event.currentTarget.parentElement
    if (!container) return
    const bounds = container.getBoundingClientRect()
    const move = (pointer: PointerEvent) => updateCard(card.id, { splitRatio: Math.min(75, Math.max(25, ((pointer.clientX - bounds.left) / bounds.width) * 100)) })
    const stop = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', stop) }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
  }

  const openSearchResult = (result: CodeCardSearchResult) => {
    navigate(`/code-cards/${result.workspaceId}?card=${encodeURIComponent(result.cardId)}`)
  }

  if (loading) return <div className="page"><Spinner label="正在加载代码段" /></div>
  if (!workspace) return <div className="page"><InlineError>{error ?? '代码段不存在'}</InlineError></div>

  return <div className="page code-cards-page">
    <header className="code-cards-header">
      <div><input className="code-cards-page-title" value={workspace.title} aria-label="代码段名称" onChange={(event) => mutate((current) => ({ ...current, title: event.target.value }))} /><div className={`save-state ${saveState}`}>{saveState === 'saving' ? '保存中…' : saveState === 'pending' ? '等待保存' : saveState === 'saved' ? '已保存' : saveState === 'conflict' ? '版本冲突' : saveState === 'error' ? '保存失败' : ''}</div></div>
      <ToolButton onClick={addCard}><Plus size={15} />添加卡片</ToolButton>
    </header>
    <section className="code-card-global-search" aria-label="跨代码段搜索">
      <div className="code-card-search-controls">
        <label className="code-card-search-field"><Search size={16} /><input value={search} maxLength={200} onChange={(event) => { setSearch(event.target.value); setSearchPage(1) }} onKeyDown={(event) => clearSearchOnEscape(event, search, () => { setSearch(''); setSearchPage(1) })} placeholder="搜索标题或 Lua 文本；空格分词，引号匹配短语" /><SearchClearButton value={search} onClear={() => { setSearch(''); setSearchPage(1) }} label="清空代码段搜索" /></label>
        <div className="segmented code-card-search-mode" role="group" aria-label="代码段搜索匹配方式"><button title="空格分词，每个关键词都必须连续包含" className={searchMode === 'fuzzy' ? 'active' : undefined} onClick={() => { setSearchMode('fuzzy'); setSearchPage(1) }}>模糊搜索</button><button title="整段内容必须连续包含" className={searchMode === 'exact' ? 'active' : undefined} onClick={() => { setSearchMode('exact'); setSearchPage(1) }}>短语匹配</button></div>
        <span className="code-card-search-count">{searching ? '搜索中…' : search.trim() ? `${searchResults.total} 条` : '跨页签搜索'}</span>
      </div>
      {search.trim() && <div className="code-card-search-results">
        {searchResults.items.map((result) => <button key={`${result.workspaceId}:${result.cardId}`} className="code-card-search-result" onClick={() => openSearchResult(result)}>
          <span className="code-card-search-result-path"><strong>{result.workspaceTitle}</strong><ChevronRight size={13} /><span>{result.cardTitle}</span></span>
          <span className="code-card-search-result-context">{result.matchField === 'title' ? '标题' : `Lua${result.line ? ` · 第 ${result.line} 行` : ''}`}</span>
          <code>{result.excerpt}</code>
        </button>)}
        {!searching && !searchResults.items.length && !searchError && <div className="code-card-search-empty">没有找到匹配的代码段</div>}
        {searchError && <div className="inline-error">{searchError}</div>}
        {searchResults.totalPages > 1 && <div className="code-card-search-pagination"><ToolButton disabled={searchResults.page <= 1 || searching} onClick={() => setSearchPage((value) => Math.max(1, value - 1))}><ChevronLeft size={14} />上一页</ToolButton><span>第 {searchResults.page} / {searchResults.totalPages} 页</span><ToolButton disabled={searchResults.page >= searchResults.totalPages || searching} onClick={() => setSearchPage((value) => value + 1)}>下一页<ChevronRight size={14} /></ToolButton></div>}
      </div>}
    </section>
    <InlineError>{error}</InlineError>
    <div className="code-card-list">
      {workspace.cards.map((card) => <article id={`code-card-${card.id}`} className={`code-card ${card.collapsed ? 'collapsed' : ''} ${targetCardId === card.id ? 'located' : ''}`} key={card.id}>
        <header className="code-card-header" title={card.collapsed ? '点击标题栏展开卡片' : '点击标题栏折叠卡片'} onClick={() => updateCard(card.id, { collapsed: !card.collapsed })}>
          <button className="code-card-title-button" title="点击重命名" onClick={(event) => { event.stopPropagation(); renameCard(card) }}><span>{card.title}</span><Pencil size={13} /></button>
          <div className="code-card-actions" onClick={(event) => event.stopPropagation()}>
            <button title={card.collapsed ? '展开卡片' : '折叠卡片'} onClick={() => updateCard(card.id, { collapsed: !card.collapsed })}>{card.collapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}</button>
            <button className="danger" title="删除卡片" onClick={() => void removeCard(card)}><Trash2 size={15} /></button>
          </div>
        </header>
        {!card.collapsed && <>
          <div className="code-card-body" style={{ height: card.height, gridTemplateColumns: `minmax(0, ${card.splitRatio}fr) 8px minmax(0, ${100 - card.splitRatio}fr)` }}>
            <section className="code-card-code">
              <div className="code-card-pane-toolbar"><span>Lua</span><button onClick={() => void copyCode(card.code)}><Copy size={14} />复制代码</button></div>
              <Editor height="calc(100% - 36px)" language="lua" value={card.code} onChange={(value) => updateCard(card.id, { code: value ?? '' })} theme="vs-dark" options={{ automaticLayout: true, minimap: { enabled: false }, fontSize: 15, fontFamily: 'Cascadia Code, Consolas, monospace', wordWrap: 'off', scrollBeyondLastLine: false, padding: { top: 10 } }} />
            </section>
            <button className="code-card-splitter" aria-label="调整代码和图片宽度" onPointerDown={(event) => startSplitDrag(event, card)} />
            <section className="code-card-image-pane">
              <div className="code-card-pane-toolbar"><span>图片</span><div>{card.image && <button title="复制图片" onClick={() => void copyImage(card)}><Copy size={14} />复制图片</button>}<button disabled={imageBusyCard === card.id} onClick={() => void addClipboardImage(card)}><ClipboardPaste size={14} />{imageBusyCard === card.id ? '处理中…' : card.image ? '替换图片' : '从剪贴板添加'}</button>{card.image && <button title="移除图片" onClick={() => void clearImage(card)}><X size={14} /></button>}</div></div>
              <div className="code-card-image-stage">{card.image ? <img src={codeCardImageUrl(workspace.id, card.id, card.image.updatedAt)} alt={card.title} /> : <button className="code-card-image-empty" onClick={() => void addClipboardImage(card)}><ImagePlus size={28} /><span>读取剪贴板图片</span><small>大图会自动压缩为本地缩略图</small></button>}</div>
            </section>
          </div>
          <button className="code-card-height-handle" aria-label="调整卡片高度" onPointerDown={(event) => startHeightDrag(event, card)}><span /></button>
        </>}
      </article>)}
      {!workspace.cards.length && <button className="code-card-add-empty" onClick={addCard}><Plus size={22} />添加第一张卡片</button>}
    </div>
  </div>
}
