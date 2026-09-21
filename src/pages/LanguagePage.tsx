import { Check, ChevronLeft, ChevronRight, Copy, RefreshCw, Search, Star, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import type { LanguageEntry, LanguageEntryPage, LanguageSearchMode, LanguageSource } from '../../shared/types'
import { ApiError, localBridge } from '../lib/api'
import { useAppStore } from '../store/appStore'
import { PageHeader, Spinner, ToolButton } from '../components/ui'
import { clearSearchOnEscape, SearchClearButton } from '../components/SearchClearButton'

const emptyPage: LanguageEntryPage = { items: [], total: 0, page: 1, pageSize: 10, totalPages: 1 }

function formatUpdateTime(value?: string): string {
  if (!value) return '尚未同步'
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(new Date(value))
}

function Pagination({ data, onPage }: { data: LanguageEntryPage; onPage: (page: number) => void }) {
  if (data.totalPages <= 1) return null
  return <div className="language-pagination">
    <ToolButton disabled={data.page <= 1} onClick={() => onPage(data.page - 1)}><ChevronLeft size={14} />上一页</ToolButton>
    <span>第 {data.page} / {data.totalPages} 页</span>
    <ToolButton disabled={data.page >= data.totalPages} onClick={() => onPage(data.page + 1)}>下一页<ChevronRight size={14} /></ToolButton>
  </div>
}

function LanguageSearch({ value, mode, onChange, onModeChange, placeholder }: { value: string; mode: LanguageSearchMode; onChange: (value: string) => void; onModeChange: (mode: LanguageSearchMode) => void; placeholder: string }) {
  return <div className="language-search-controls">
    <label className="language-search"><Search size={15} /><input value={value} onChange={(event) => onChange(event.target.value)} onKeyDown={(event) => clearSearchOnEscape(event, value, () => onChange(''))} placeholder={placeholder} /><SearchClearButton value={value} onClear={() => onChange('')} /></label>
    <div className="segmented language-search-mode" role="group" aria-label="搜索匹配方式"><button className={mode === 'fuzzy' ? 'active' : undefined} onClick={() => onModeChange('fuzzy')}>模糊搜索</button><button className={mode === 'exact' ? 'active' : undefined} onClick={() => onModeChange('exact')}>全文匹配</button></div>
  </div>
}

function LanguageEntryCard({ entry, kind, favorited, busy, copiedToken, onCopy, onFavorite }: {
  entry: LanguageEntry
  kind: 'result' | 'favorite'
  favorited?: boolean
  busy: boolean
  copiedToken?: string
  onCopy: (value: string, token: string) => void
  onFavorite: (favorite: boolean) => void
}) {
  const wide = entry.content.includes('\n') || entry.content.length > 48 || entry.key.length + entry.content.length > 72
  const keyToken = `key:${kind}:${entry.key}`
  const contentToken = `content:${kind}:${entry.key}`
  const lineToken = `line:${kind}:${entry.key}`
  return <article className={`language-entry-card ${wide ? 'wide' : ''}`}>
    <div className="language-entry-main">
      <button type="button" className={`language-copy-target key ${copiedToken === keyToken ? 'copied' : ''}`} title="点击复制 key" onClick={() => onCopy(entry.key, keyToken)}>
        <code>{entry.key}</code><span className="language-copy-state">{copiedToken === keyToken ? <><Check size={13} />已复制</> : <><Copy size={12} />点击复制</>}</span>
      </button>
      <button type="button" className={`language-copy-target content ${copiedToken === contentToken ? 'copied' : ''}`} title="点击复制多语言内容" onClick={() => onCopy(entry.content, contentToken)}>
        <span>{entry.content}</span><span className="language-copy-state">{copiedToken === contentToken ? <><Check size={13} />已复制</> : <><Copy size={12} />点击复制</>}</span>
      </button>
    </div>
    <div className="language-entry-actions">
      {kind === 'result' ? <ToolButton className={favorited ? 'favorite-icon active' : 'favorite-icon'} title={favorited ? '取消收藏' : '收藏'} aria-label={favorited ? '取消收藏' : '收藏'} disabled={busy} onClick={() => onFavorite(!favorited)}><Star size={14} fill={favorited ? 'currentColor' : 'none'} /></ToolButton> : <ToolButton className="danger" disabled={busy} onClick={() => onFavorite(false)}><X size={13} />移除</ToolButton>}
      <ToolButton title="复制完整原文行" aria-label={`复制 ${entry.key}=${entry.content}`} onClick={() => onCopy(`${entry.key}=${entry.content}`, lineToken)}>
        {copiedToken === lineToken ? <Check size={14} /> : <Copy size={14} />}
      </ToolButton>
    </div>
  </article>
}

export function LanguagePage() {
  const { id } = useParams<{ id: string }>()
  const refreshLanguages = useAppStore((state) => state.refreshLanguages)
  const [source, setSource] = useState<LanguageSource>()
  const [url, setUrl] = useState('')
  const [search, setSearch] = useState('')
  const [searchMode, setSearchMode] = useState<LanguageSearchMode>('fuzzy')
  const [searchPage, setSearchPage] = useState(1)
  const [results, setResults] = useState<LanguageEntryPage>(emptyPage)
  const [favoriteSearch, setFavoriteSearch] = useState('')
  const [favoriteSearchMode, setFavoriteSearchMode] = useState<LanguageSearchMode>('fuzzy')
  const [favoritePage, setFavoritePage] = useState(1)
  const [favorites, setFavorites] = useState<LanguageEntryPage>(emptyPage)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [favoriteBusy, setFavoriteBusy] = useState<string>()
  const [cooldownSeconds, setCooldownSeconds] = useState(0)
  const [copiedToken, setCopiedToken] = useState<string>()
  const [error, setError] = useState<string>()
  const [reload, setReload] = useState(0)
  const copyTimer = useRef<number | undefined>(undefined)

  useEffect(() => () => { if (copyTimer.current) window.clearTimeout(copyTimer.current) }, [])

  useEffect(() => {
    if (cooldownSeconds <= 0) return
    const timer = window.setInterval(() => setCooldownSeconds((value) => Math.max(0, value - 1)), 1000)
    return () => window.clearInterval(timer)
  }, [cooldownSeconds])

  useEffect(() => {
    if (!id) return
    let active = true
    setLoading(true)
    setError(undefined)
    void localBridge.getLanguageSource(id).then((value) => {
      if (!active) return
      setSource(value)
      setUrl(value.url)
      const remaining = value.lastSyncedAt ? Math.ceil((Date.parse(value.lastSyncedAt) + 10_000 - Date.now()) / 1000) : 0
      setCooldownSeconds(Math.max(0, remaining))
    }).catch((reason) => {
      if (active) setError(reason instanceof Error ? reason.message : '多语言配置加载失败')
    }).finally(() => {
      if (active) setLoading(false)
    })
    return () => { active = false }
  }, [id])

  useEffect(() => {
    if (!id) return
    let active = true
    const timer = window.setTimeout(() => {
      void localBridge.searchLanguageEntries(id, search, searchPage, searchMode).then((value) => {
        if (active) setResults(value)
      }).catch((reason) => {
        if (active) setError(reason instanceof Error ? reason.message : '搜索失败')
      })
    }, 180)
    return () => { active = false; window.clearTimeout(timer) }
  }, [id, reload, search, searchMode, searchPage])

  useEffect(() => {
    if (!id) return
    let active = true
    const timer = window.setTimeout(() => {
      void localBridge.searchLanguageFavorites(id, favoriteSearch, favoritePage, favoriteSearchMode).then((value) => {
        if (active) setFavorites(value)
      }).catch((reason) => {
        if (active) setError(reason instanceof Error ? reason.message : '收藏搜索失败')
      })
    }, 180)
    return () => { active = false; window.clearTimeout(timer) }
  }, [favoritePage, favoriteSearch, favoriteSearchMode, id, reload])

  const favoriteKeys = useMemo(() => new Set(source?.favorites.map((item) => item.key) ?? []), [source])

  const sync = async () => {
    if (!id || !url.trim()) {
      setError('请输入多语言 TXT 文件链接')
      return
    }
    if (syncing || cooldownSeconds > 0) return
    setSyncing(true)
    setCooldownSeconds(10)
    setError(undefined)
    try {
      const updated = await localBridge.syncLanguageSource(id, url)
      setSource(updated)
      setUrl(updated.url)
      setSearchPage(1)
      setFavoritePage(1)
      setReload((value) => value + 1)
      await refreshLanguages()
    } catch (reason) {
      if (reason instanceof ApiError && reason.code === 'LANGUAGE_SYNC_COOLDOWN') {
        const retryAfterMs = Number((reason.details as { retryAfterMs?: number } | undefined)?.retryAfterMs ?? 10_000)
        setCooldownSeconds(Math.max(1, Math.ceil(retryAfterMs / 1000)))
      }
      setError(reason instanceof Error ? reason.message : '同步失败')
    } finally {
      setSyncing(false)
      setCooldownSeconds((value) => Math.max(value, 10))
    }
  }

  const copy = (value: string, token: string) => {
    void navigator.clipboard.writeText(value).then(() => {
      setCopiedToken(token)
      if (copyTimer.current) window.clearTimeout(copyTimer.current)
      copyTimer.current = window.setTimeout(() => {
        setCopiedToken(undefined)
      }, 1400)
    }).catch(() => setError('复制失败，请检查浏览器剪贴板权限'))
  }

  const toggleFavorite = async (entry: LanguageEntry, favorite: boolean) => {
    if (!id || !source || favoriteBusy) return
    setFavoriteBusy(entry.key)
    setError(undefined)
    try {
      const updated = await localBridge.setLanguageFavorite(id, entry.key, favorite, source.revision)
      setSource(updated)
      setReload((value) => value + 1)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '收藏更新失败')
      const latest = await localBridge.getLanguageSource(id).catch(() => undefined)
      if (latest) setSource(latest)
    } finally {
      setFavoriteBusy(undefined)
    }
  }

  if (loading) return <div className="page"><Spinner label="正在加载多语言数据" /></div>
  if (!source || !id) return <div className="page"><PageHeader title="多语言查询" /><div className="inline-error">{error ?? '多语言页签不存在'}</div></div>

  return <div className="page language-page">
    <PageHeader title={source.title} description="同步服务器 TXT 文件，搜索并收藏常用多语言条目" />

    <section className="tool-panel language-source-panel">
      <div className="language-source-row">
        <input className="field mono" value={url} onChange={(event) => setUrl(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void sync() }} placeholder="https://wb-jenkins-xxx.net/xxx/xxx/zh_CN.txt" aria-label="多语言数据来源链接" />
        <ToolButton className="primary language-sync-button" disabled={syncing || cooldownSeconds > 0} onClick={() => void sync()}><RefreshCw className={syncing ? 'spinning' : undefined} size={14} />{syncing ? '同步中' : cooldownSeconds > 0 ? `${cooldownSeconds} 秒后可同步` : '同步'}</ToolButton>
      </div>
      <div className="language-source-meta"><span>最后更新：{formatUpdateTime(source.lastSyncedAt)}</span><span>{source.entryCount} 条多语言</span></div>
      {error && <div className="inline-error">{error}</div>}
    </section>

    <section className="tool-panel language-section">
      <div className="language-section-heading"><div><h2>搜索结果</h2><span>{searchMode === 'fuzzy' ? 'key 或内容包含关键词即可匹配' : 'key 或内容必须与关键词完全一致'}</span></div><strong>{results.total} 条</strong></div>
      <LanguageSearch value={search} mode={searchMode} onChange={(value) => { setSearch(value); setSearchPage(1) }} onModeChange={(mode) => { setSearchMode(mode); setSearchPage(1) }} placeholder="输入 key 或多语言内容" />
      <div className="language-entry-grid">
        {results.items.map((entry) => {
          const favorited = favoriteKeys.has(entry.key)
          return <LanguageEntryCard key={entry.key} entry={entry} kind="result" favorited={favorited} busy={Boolean(favoriteBusy)} copiedToken={copiedToken} onCopy={copy} onFavorite={(favorite) => void toggleFavorite(entry, favorite)} />
        })}
        {!results.items.length && <div className="language-empty">{source.lastSyncedAt ? '没有匹配的多语言条目' : '请先配置链接并同步多语言 TXT 文件'}</div>}
      </div>
      <Pagination data={results} onPage={setSearchPage} />
    </section>

    <section className="tool-panel language-section favorites-section">
      <div className="language-section-heading"><div><h2>收藏</h2><span>快速查看常用多语言</span></div><strong>{source.favorites.length} 条</strong></div>
      <LanguageSearch value={favoriteSearch} mode={favoriteSearchMode} onChange={(value) => { setFavoriteSearch(value); setFavoritePage(1) }} onModeChange={(mode) => { setFavoriteSearchMode(mode); setFavoritePage(1) }} placeholder="搜索收藏的 key 或内容" />
      <div className="language-entry-grid favorites-grid">
        {favorites.items.map((entry) => <LanguageEntryCard key={entry.key} entry={entry} kind="favorite" busy={Boolean(favoriteBusy)} copiedToken={copiedToken} onCopy={copy} onFavorite={(favorite) => void toggleFavorite(entry, favorite)} />)}
        {!favorites.items.length && <div className="language-empty">{favoriteSearch ? '没有匹配的收藏' : '暂时没有收藏'}</div>}
      </div>
      <Pagination data={favorites} onPage={setFavoritePage} />
    </section>
  </div>
}
