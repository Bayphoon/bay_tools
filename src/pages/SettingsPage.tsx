import * as Tabs from '@radix-ui/react-tabs'
import { LayoutGrid, Monitor, Moon, RotateCcw, Sun, Sunrise, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { AppSettings, ShortcutLocation, ThemeMode, TrashItem } from '../../shared/types'
import { EmptyState, InlineError, PageHeader, ToolButton } from '../components/ui'
import { ApiError, localBridge } from '../lib/api'
import { applyTheme } from '../hooks/useTheme'
import { useAppStore } from '../store/appStore'

const formatSize = (bytes: number) => bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KiB` : `${(bytes / 1024 / 1024).toFixed(1)} MiB`

export function SettingsPage() {
  const settings = useAppStore((state) => state.settings)!
  const saveSettings = useAppStore((state) => state.saveSettings)
  const refreshJson = useAppStore((state) => state.refreshJson)
  const refreshMarkdown = useAppStore((state) => state.refreshMarkdown)
  const refreshManagedMarkdown = useAppStore((state) => state.refreshManagedMarkdown)
  const [draft, setDraft] = useState<AppSettings>(settings)
  const [trash, setTrash] = useState<TrashItem[]>([])
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const [shortcutBusy, setShortcutBusy] = useState<ShortcutLocation>()
  const [shortcutMessage, setShortcutMessage] = useState('')
  const [shortcutError, setShortcutError] = useState('')
  const loadTrash = async () => setTrash(await localBridge.listTrash())
  useEffect(() => { void loadTrash().catch((value) => setError(value.message)) }, [])
  useEffect(() => setDraft(settings), [settings])
  useEffect(() => {
    applyTheme(draft)
    return () => applyTheme(settings)
  }, [draft, settings])

  const updateTheme = (patch: Partial<AppSettings['theme']>) => setDraft((value) => ({ ...value, theme: { ...value.theme, ...patch } }))
  const save = async () => {
    try { await saveSettings(draft); setSaved(true); window.setTimeout(() => setSaved(false), 1500) }
    catch (value) { setError(value instanceof Error ? value.message : '设置保存失败') }
  }
  const createShortcut = async (location: ShortcutLocation) => {
    setShortcutBusy(location)
    setShortcutMessage('')
    setShortcutError('')
    try {
      const result = await localBridge.createShortcut(location)
      setShortcutMessage(`${result.replaced ? '已更新' : '已创建'}快捷方式：${result.path}`)
    } catch (value) {
      setShortcutError(value instanceof Error ? value.message : '快捷方式创建失败')
    } finally {
      setShortcutBusy(undefined)
    }
  }
  const restore = async (item: TrashItem, asCopy = false, targetDirectory?: string) => {
    try {
      const result = await localBridge.restoreTrash(item.id, asCopy, targetDirectory)
      await Promise.all([loadTrash(), refreshJson(), refreshMarkdown(), refreshManagedMarkdown()])
      setError(`已恢复到 ${result.restoredLocation}`)
    } catch (value) {
      if (value instanceof ApiError && value.code === 'RESTORE_CONFLICT') {
        if (window.confirm('原位置已经存在同名内容，是否恢复为副本？')) await restore(item, true, targetDirectory)
      } else if (value instanceof ApiError && value.code === 'RESTORE_DIRECTORY_MISSING') {
        const directory = await localBridge.selectDirectory()
        if (directory) await restore(item, asCopy, directory)
      } else setError(value instanceof Error ? value.message : '恢复失败')
    }
  }
  return <div className="page">
    <PageHeader title="设置" description="调整 BayTools 外观、启动方式并管理本地垃圾箱" />
    <Tabs.Root defaultValue="appearance" className="settings-tabs">
      <Tabs.List className="settings-tab-list"><Tabs.Trigger value="appearance">外观</Tabs.Trigger><Tabs.Trigger value="shortcut">快捷方式</Tabs.Trigger><Tabs.Trigger value="trash">垃圾箱 <span>{trash.length}</span></Tabs.Trigger></Tabs.List>
      <Tabs.Content value="appearance" className="settings-content">
        <section className="settings-section"><div className="section-heading"><div><span className="eyebrow">THEME MODE</span><h2>外观模式</h2></div></div>
          <div className="theme-mode-grid">{([
            ['light', '亮色', Sun], ['dark', '暗色', Moon], ['manual', '手动过渡', RotateCcw], ['solar', '日出日落', Sunrise],
          ] as [ThemeMode, string, typeof Sun][]).map(([mode, label, Icon]) => <button key={mode} className={draft.theme.mode === mode ? 'active' : ''} onClick={() => updateTheme({ mode })}><Icon size={20} /><strong>{label}</strong><span>{mode === 'solar' ? '06:00 / 19:00 自动切换' : mode === 'manual' ? '使用过渡滑块' : `固定${label}主题`}</span></button>)}</div>
        </section>
        <section className="settings-section"><div className="section-heading"><div><span className="eyebrow">ACCENT</span><h2>主题强调色</h2></div></div>
          <div className="accent-settings"><label>亮色主题<input type="color" value={draft.theme.lightAccent} onChange={(event) => updateTheme({ lightAccent: event.target.value.toUpperCase() })} /><code>{draft.theme.lightAccent}</code></label><div className="accent-gradient" style={{ background: `linear-gradient(90deg, ${draft.theme.lightAccent}, ${draft.theme.darkAccent})` }} /><label>暗色主题<input type="color" value={draft.theme.darkAccent} onChange={(event) => updateTheme({ darkAccent: event.target.value.toUpperCase() })} /><code>{draft.theme.darkAccent}</code></label></div>
          <label className="range-setting"><span>手动过渡</span><input type="range" min="0" max="1" step="0.01" value={draft.theme.manualBlend} onChange={(event) => updateTheme({ manualBlend: Number(event.target.value), mode: 'manual' })} /><strong>{Math.round(draft.theme.manualBlend * 100)}%</strong></label>
        </section>
        <section className="settings-section solar-info"><Sunrise size={22} /><div><strong>日出日落过渡</strong><p>06:00～06:30 从暗色过渡到亮色；19:00～19:30 从亮色过渡到暗色。其他时段保持对应主题。</p></div></section>
        <div className="settings-save"><InlineError>{error}</InlineError><ToolButton className="primary" onClick={save}>{saved ? '已保存' : '保存外观设置'}</ToolButton></div>
      </Tabs.Content>
      <Tabs.Content value="shortcut" className="settings-content">
        <div className="section-heading"><div><span className="eyebrow">WINDOWS SHORTCUT</span><h2>启动快捷方式</h2><p>快捷方式使用 BayTools 图标，并通过无终端窗口的启动方式打开。</p></div></div>
        <div className="shortcut-grid">
          <section className="shortcut-card"><div className="shortcut-icon"><Monitor size={24} /></div><div><strong>桌面快捷方式</strong><span>从 Windows 桌面直接启动 BayTools。</span></div><ToolButton className="primary" disabled={Boolean(shortcutBusy)} onClick={() => void createShortcut('desktop')}>{shortcutBusy === 'desktop' ? '创建中' : '创建或更新'}</ToolButton></section>
          <section className="shortcut-card"><div className="shortcut-icon"><LayoutGrid size={24} /></div><div><strong>开始菜单快捷方式</strong><span>可从开始菜单搜索 BayTools，也可以继续固定到任务栏。</span></div><ToolButton className="primary" disabled={Boolean(shortcutBusy)} onClick={() => void createShortcut('start-menu')}>{shortcutBusy === 'start-menu' ? '创建中' : '创建或更新'}</ToolButton></section>
        </div>
        {shortcutMessage && <div className="shortcut-result" role="status">{shortcutMessage}</div>}
        <InlineError>{shortcutError}</InlineError>
        <section className="settings-section shortcut-note"><strong>固定到任务栏</strong><p>先创建开始菜单快捷方式，再在开始菜单中右键 BayTools，选择“固定到任务栏”。Windows 11 不允许网页直接完成固定操作。</p></section>
      </Tabs.Content>
      <Tabs.Content value="trash" className="settings-content">
        <div className="section-heading"><div><span className="eyebrow">LOCAL TRASH</span><h2>BayTools 垃圾箱</h2><p>内容不会自动清理，恢复时不会覆盖已有文件。</p></div>{trash.length > 0 && <ToolButton className="danger" onClick={async () => { if (!window.confirm(`彻底删除垃圾箱中的 ${trash.length} 项？此操作无法撤销。`)) return; await localBridge.emptyTrash(); await loadTrash() }}><Trash2 size={14} />清空垃圾箱</ToolButton>}</div>
        <InlineError>{error}</InlineError>
        {!trash.length ? <EmptyState title="垃圾箱是空的">删除的 JSON 工作区和 Markdown 文件会出现在这里。</EmptyState> : <div className="trash-list">{trash.map((item) => <article className="trash-item" key={item.id}><div className={`trash-kind ${item.kind}`}>{item.kind === 'json-workspace' ? '{}' : 'MD'}</div><div className="trash-main"><strong>{item.displayName}</strong><span className="mono" title={item.originalLocation}>{item.originalLocation}</span><small>{new Date(item.deletedAt).toLocaleString()} · {formatSize(item.size)}</small></div><ToolButton onClick={() => restore(item)}><RotateCcw size={14} />恢复</ToolButton><ToolButton className="danger" onClick={async () => { if (!window.confirm(`彻底删除 ${item.displayName}？此操作无法撤销。`)) return; await localBridge.deleteTrash(item.id); await loadTrash() }}><Trash2 size={14} />彻底删除</ToolButton></article>)}</div>}
      </Tabs.Content>
    </Tabs.Root>
  </div>
}
