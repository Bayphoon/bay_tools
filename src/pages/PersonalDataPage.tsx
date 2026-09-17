import { Download, GitBranch, Upload } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { PersonalDataStatus } from '../../shared/types'
import { InlineError, PageHeader, ToolButton } from '../components/ui'
import { localBridge } from '../lib/api'
import { confirmAction } from '../lib/confirmation'

const formatSize = (bytes: number) => bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KiB` : `${(bytes / 1024 / 1024).toFixed(1)} MiB`

export function PersonalDataPage() {
  const [personalData, setPersonalData] = useState<PersonalDataStatus>()
  const [busy, setBusy] = useState<'sync' | 'restore' | 'publish'>()
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const loadPersonalData = async () => setPersonalData(await localBridge.getPersonalDataStatus())

  useEffect(() => {
    void loadPersonalData().catch((value) => setError(value instanceof Error ? value.message : '个人数据状态加载失败'))
  }, [])

  const syncPersonalData = async () => {
    if (!personalData) return
    const force = personalData.state === 'snapshot-newer' || personalData.state === 'diverged'
    if (force && !(await confirmAction('分支快照包含尚未恢复的修改。确定用当前本机数据覆盖快照吗？', { confirmLabel: '覆盖快照' }))) return
    setBusy('sync')
    setMessage('')
    setError('')
    try {
      const result = await localBridge.syncPersonalData(force)
      setPersonalData(result.status)
      setMessage(result.changed ? '个人数据快照已更新，请检查并提交 UserData 的 Git 变更。' : '本机数据与分支快照一致，无需更新。')
    } catch (value) {
      setError(value instanceof Error ? value.message : '个人数据同步失败')
    } finally {
      setBusy(undefined)
    }
  }

  const restorePersonalData = async () => {
    if (!personalData?.snapshotExists || !(await confirmAction('这会用当前用户分支的快照覆盖本机个人数据，是否继续？', { confirmLabel: '从分支恢复' }))) return
    setBusy('restore')
    setMessage('')
    setError('')
    try {
      await localBridge.restorePersonalData(true)
      window.location.reload()
    } catch (value) {
      setError(value instanceof Error ? value.message : '个人数据恢复失败')
      setBusy(undefined)
    }
  }

  const publishPersonalData = async () => {
    if (!personalData?.eligible) return
    const force = personalData.state === 'snapshot-newer' || personalData.state === 'diverged'
    const warning = force ? '\n\n分支快照与本机数据存在差异，本次操作将以本机数据覆盖快照。' : ''
    const target = `${personalData.remoteName ?? 'origin'}${personalData.remoteUrl ? ` (${personalData.remoteUrl})` : ''}`
    if (!(await confirmAction(`将同步、提交并推送个人数据：\n分支：${personalData.branch}\n远端：${target}\n数据：${personalData.fileCount} 个文件，${formatSize(personalData.totalBytes)}\n只会提交 UserData/${personalData.user}，但会推送当前分支已有的全部本地提交。${warning}`, { confirmLabel: '提交并推送' }))) return
    setBusy('publish')
    setMessage('')
    setError('')
    try {
      const result = await localBridge.publishPersonalData(true, force)
      setPersonalData(result.status)
      setMessage(result.commitCreated ? `个人数据已提交并推送：${result.commit.slice(0, 8)}` : '没有新的个人数据提交；当前用户分支已推送到远端。')
    } catch (value) {
      setError(value instanceof Error ? value.message : '个人数据提交或推送失败')
      await loadPersonalData().catch(() => undefined)
    } finally {
      setBusy(undefined)
    }
  }

  return <div className="page">
    <PageHeader title="数据同步" description="在本机运行数据与当前用户分支之间同步个人数据" />
    <div className="settings-content">
      <div className="section-heading"><div><span className="eyebrow">PERSONAL DATA</span><h2>个人数据同步</h2><p>本机数据始终保存在 Doc；用户分支只保存可提交的 UserData 快照。</p></div></div>
      <section className="settings-section personal-data-status">
        <div className="personal-data-heading"><GitBranch size={22} /><div><strong>{personalData?.branch ?? '未识别 Git 分支'}</strong><span>{personalData?.eligible ? `用户：${personalData.user}` : '请切换到 user/&lt;用户名&gt; 分支后同步'}</span></div></div>
        {personalData && <dl className="personal-data-details">
          <div><dt>同步状态</dt><dd>{({ unavailable: '当前分支不可同步', ready: '已同步', 'runtime-newer': '本机数据有更新', 'snapshot-newer': '分支快照有更新', diverged: '本机与快照均有更新' })[personalData.state]}</dd></div>
          <div><dt>快照内容</dt><dd>{personalData.fileCount} 个文件 · {formatSize(personalData.totalBytes)}</dd></div>
          <div><dt>快照路径</dt><dd className="mono">{personalData.snapshotPath ?? '—'}</dd></div>
          <div><dt>Git 远端</dt><dd className="mono">{personalData.remoteUrl ?? '未配置 origin'}</dd></div>
          <div><dt>上次同步</dt><dd>{personalData.lastSyncedAt ? new Date(personalData.lastSyncedAt).toLocaleString() : '尚未同步'}</dd></div>
        </dl>}
        <div className="personal-data-actions">
          <ToolButton disabled={!personalData?.eligible || Boolean(busy)} onClick={() => void syncPersonalData()}><Upload size={14} />{busy === 'sync' ? '同步中' : '同步到当前用户分支'}</ToolButton>
          <ToolButton disabled={!personalData?.eligible || !personalData.snapshotExists || Boolean(busy)} onClick={() => void restorePersonalData()}><Download size={14} />{busy === 'restore' ? '恢复中' : '从分支恢复'}</ToolButton>
          <ToolButton className="primary" disabled={!personalData?.eligible || !personalData.remoteUrl || Boolean(busy)} onClick={() => void publishPersonalData()}><GitBranch size={14} />{busy === 'publish' ? '提交并推送中' : '同步、提交并推送'}</ToolButton>
        </div>
      </section>
      {message && <div className="shortcut-result" role="status">{message}</div>}
      <InlineError>{error}</InlineError>
      <section className="settings-section shortcut-note"><strong>安全提交范围</strong><p>自动发布只提交当前用户的 UserData 目录，不会提交代码，且不会强推。远端有本机尚未合并的提交或存在其他已暂存文件时会停止。main 分支始终禁用个人数据发布。</p></section>
    </div>
  </div>
}
