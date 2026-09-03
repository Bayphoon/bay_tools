import { RefreshCw } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { ServerStatusState } from '../../shared/types'
import { PageHeader, Spinner, ToolButton } from '../components/ui'
import { ApiError, localBridge } from '../lib/api'
import { ALL_SEASONS, filterServersBySeason, formatCardSeasons, getSeasonOptions } from '../lib/serverStatus'

function formatUpdateTime(value?: string): string {
  if (!value) return '尚未同步'
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(new Date(value))
}

export function ServerStatusPage() {
  const [state, setState] = useState<ServerStatusState>()
  const [url, setUrl] = useState('')
  const [season, setSeason] = useState(ALL_SEASONS)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [cooldownSeconds, setCooldownSeconds] = useState(0)
  const [error, setError] = useState<string>()

  useEffect(() => {
    let active = true
    void localBridge.getServerStatus().then((value) => {
      if (!active) return
      setState(value)
      setUrl(value.url)
      const remaining = value.lastSyncedAt ? Math.ceil((Date.parse(value.lastSyncedAt) + 10_000 - Date.now()) / 1000) : 0
      setCooldownSeconds(Math.max(0, remaining))
    }).catch((reason) => {
      if (active) setError(reason instanceof Error ? reason.message : '服务器状态缓存加载失败')
    }).finally(() => {
      if (active) setLoading(false)
    })
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (cooldownSeconds <= 0) return
    const timer = window.setInterval(() => setCooldownSeconds((value) => Math.max(0, value - 1)), 1000)
    return () => window.clearInterval(timer)
  }, [cooldownSeconds])

  const seasonOptions = useMemo(() => getSeasonOptions(state?.servers ?? []), [state])
  const filteredServers = useMemo(() => filterServersBySeason(state?.servers ?? [], season), [season, state])

  useEffect(() => {
    if (season !== ALL_SEASONS && !seasonOptions.includes(season)) setSeason(ALL_SEASONS)
  }, [season, seasonOptions])

  const sync = async () => {
    if (!url.trim()) {
      setError('请输入服务器状态 JSON 链接')
      return
    }
    if (syncing || cooldownSeconds > 0) return
    setSyncing(true)
    setCooldownSeconds(10)
    setError(undefined)
    try {
      const updated = await localBridge.syncServerStatus(url)
      setState(updated)
      setUrl(updated.url)
      setSeason(ALL_SEASONS)
    } catch (reason) {
      if (reason instanceof ApiError && reason.code === 'SERVER_STATUS_SYNC_COOLDOWN') {
        const retryAfterMs = Number((reason.details as { retryAfterMs?: number } | undefined)?.retryAfterMs ?? 10_000)
        setCooldownSeconds(Math.max(1, Math.ceil(retryAfterMs / 1000)))
      }
      setError(reason instanceof Error ? reason.message : '服务器状态同步失败')
    } finally {
      setSyncing(false)
      setCooldownSeconds((value) => Math.max(value, 10))
    }
  }

  if (loading) return <div className="page"><Spinner label="正在加载服务器状态" /></div>

  return <div className="page server-status-page">
    <PageHeader title="服务器状态" description="同步并查看服务器运行状态、赛季和分支信息" />

    <section className="tool-panel server-status-source-panel">
      <div className="server-status-source-row">
        <input className="field mono" value={url} onChange={(event) => setUrl(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void sync() }} placeholder="https://example.net/server-status.json" aria-label="服务器状态数据链接" />
        <ToolButton className="primary server-status-sync-button" disabled={syncing || cooldownSeconds > 0} onClick={() => void sync()}>
          <RefreshCw className={syncing ? 'spinning' : undefined} size={14} />
          {syncing ? '同步中' : cooldownSeconds > 0 ? `${cooldownSeconds} 秒后可同步` : '同步'}
        </ToolButton>
      </div>
      <div className="server-status-source-meta"><span>最后更新：{formatUpdateTime(state?.lastSyncedAt)}</span><span>{state?.servers.length ?? 0} 台服务器</span></div>
      {error && <div className="inline-error">{error}</div>}
    </section>

    <section className="tool-panel server-status-list-panel">
      <div className="server-status-list-toolbar">
        <div><h2>服务器列表</h2><span>显示 {filteredServers.length} / {state?.servers.length ?? 0} 台</span></div>
        <label className="server-status-filter"><span>赛季</span><select className="select" value={season} onChange={(event) => setSeason(event.target.value)}>
          <option value={ALL_SEASONS}>全部</option>
          {seasonOptions.map((item) => <option key={item} value={item}>第 {Number(item.slice(1))} 赛季</option>)}
        </select></label>
      </div>

      <div className="server-status-list">
        {filteredServers.map((server, index) => {
          const running = server.running_status.trim() === '已启动'
          const status = server.running_status.trim() || '未知'
          const seasonText = formatCardSeasons(server.season_days)
          return <article
            aria-label={`${server.server_id}，状态：${status}`}
            className={`server-status-card ${running ? 'running' : 'not-running'}`}
            key={`${server.server_id}:${index}`}
          >
            <header className="server-status-card-header">
              <strong className="server-status-id" title={server.server_id}>{server.server_id}</strong>
              {seasonText && <span className="server-status-season" title={seasonText}>{seasonText}</span>}
            </header>
            <dl className="server-status-card-details">
              <div><dt>配置</dt><dd className="server-branch" title={server.config_branch}>{server.config_branch || '—'}</dd></div>
              <div><dt>代码</dt><dd className="server-branch" title={server.code_branch}>{server.code_branch || '—'}</dd></div>
            </dl>
          </article>
        })}
        {!filteredServers.length && <div className="server-status-empty">{state?.lastSyncedAt ? '当前筛选条件下没有服务器' : '尚未配置并同步服务器状态数据'}</div>}
      </div>
    </section>
  </div>
}
