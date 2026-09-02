import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Braces, ChevronDown, ChevronRight, Clock3, FileText, Folder, FolderOpen, Home, MoreHorizontal, Palette, Plus, Settings, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import type { MarkdownTreeNode } from '../../shared/types'
import { localBridge } from '../lib/api'
import { useAppStore } from '../store/appStore'

function Menu({ children, triggerLabel = '更多操作' }: { children: React.ReactNode; triggerLabel?: string }) {
  return <DropdownMenu.Root>
    <DropdownMenu.Trigger asChild><button className="icon-button nav-action" aria-label={triggerLabel}><MoreHorizontal size={15} /></button></DropdownMenu.Trigger>
    <DropdownMenu.Portal><DropdownMenu.Content className="dropdown-content" sideOffset={4}>{children}</DropdownMenu.Content></DropdownMenu.Portal>
  </DropdownMenu.Root>
}

const item = (label: string, action: () => void, danger = false) => <DropdownMenu.Item className={`dropdown-item ${danger ? 'danger' : ''}`} onSelect={action}>{label}</DropdownMenu.Item>

function MarkdownNodes({ sourceId, nodes, onChanged, depth = 0 }: { sourceId: string; nodes: MarkdownTreeNode[]; onChanged: () => Promise<void>; depth?: number }) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const navigate = useNavigate()
  return <>{nodes.map((node) => node.type === 'directory' ? <div key={node.relativePath}>
    <button className="nav-tree-row" style={{ paddingLeft: 18 + depth * 12 }} onClick={() => setCollapsed((value) => ({ ...value, [node.relativePath]: !value[node.relativePath] }))}>
      {collapsed[node.relativePath] ? <ChevronRight size={13} /> : <ChevronDown size={13} />}<Folder size={13} /><span>{node.name}</span>
    </button>
    {!collapsed[node.relativePath] && <MarkdownNodes sourceId={sourceId} nodes={node.children ?? []} onChanged={onChanged} depth={depth + 1} />}
  </div> : <div className="nav-child-wrap" key={node.relativePath}>
    <NavLink className="nav-tree-row nav-file" style={{ paddingLeft: 34 + depth * 12 }} to={`/markdown/${sourceId}?path=${encodeURIComponent(node.relativePath)}`}><FileText size={13} /><span>{node.name}</span></NavLink>
    <Menu>{item('重命名', async () => {
      const document = await localBridge.getMarkdownDocument(sourceId, node.relativePath)
      const nextName = window.prompt('新的 Markdown 文件名', node.name)
      if (!nextName || nextName === node.name) return
      const renamed = await localBridge.renameMarkdownDocument(sourceId, node.relativePath, nextName, document.hash)
      await onChanged()
      navigate(`/markdown/${sourceId}?path=${encodeURIComponent(renamed.relativePath)}`)
    })}{item('移入垃圾箱', async () => {
      if (!window.confirm(`将 ${node.name} 移入 BayTools 垃圾箱？`)) return
      const document = await localBridge.getMarkdownDocument(sourceId, node.relativePath)
      await localBridge.trashMarkdownDocument(sourceId, node.relativePath, document.hash)
      await onChanged()
      navigate('/markdown')
    }, true)}</Menu>
  </div>)}</>
}

export function Sidebar() {
  const navigate = useNavigate()
  const location = useLocation()
  const { jsonWorkspaces, markdownTrees, refreshJson, refreshMarkdown, settings, saveSettings } = useAppStore()
  const [jsonOpen, setJsonOpen] = useState(!settings?.sidebar.collapsedGroups.includes('json'))
  const [markdownOpen, setMarkdownOpen] = useState(!settings?.sidebar.collapsedGroups.includes('markdown'))
  const jsonActive = location.pathname === '/json' || location.pathname.startsWith('/json/')
  const markdownActive = location.pathname === '/markdown' || location.pathname.startsWith('/markdown/')

  const setGroupOpen = (group: 'json' | 'markdown', nextOpen: boolean) => {
    const open = group === 'json' ? jsonOpen : markdownOpen
    if (open === nextOpen) return
    if (group === 'json') setJsonOpen(nextOpen); else setMarkdownOpen(nextOpen)
    if (!settings) return
    const collapsedGroups = nextOpen
      ? settings.sidebar.collapsedGroups.filter((value) => value !== group)
      : [...new Set([...settings.sidebar.collapsedGroups, group])]
    void saveSettings({ ...settings, sidebar: { ...settings.sidebar, collapsedGroups } }).catch(() => undefined)
  }

  const toggleGroup = (group: 'json' | 'markdown') => {
    const open = group === 'json' ? jsonOpen : markdownOpen
    setGroupOpen(group, !open)
  }

  const createWorkspace = async () => {
    const workspace = await localBridge.createJsonWorkspace()
    await refreshJson()
    navigate(`/json/${workspace.id}`)
  }

  const selectGroup = async (group: 'json' | 'markdown') => {
    const active = group === 'json' ? jsonActive : markdownActive
    if (active) {
      toggleGroup(group)
      return
    }

    setGroupOpen(group, true)
    if (group === 'markdown') {
      navigate('/markdown')
      return
    }

    const firstWorkspace = jsonWorkspaces[0]
    if (firstWorkspace) navigate(`/json/${firstWorkspace.id}`)
    else await createWorkspace()
  }

  const addMarkdownSource = async () => {
    const path = await localBridge.selectDirectory()
    if (!path) return
    await localBridge.addMarkdownSource(path)
    await refreshMarkdown()
  }

  const toggleMarkdownSource = (sourceId: string) => {
    if (!settings) return
    const key = `markdown-source:${sourceId}`
    const collapsed = settings.sidebar.collapsedGroups.includes(key)
    const collapsedGroups = collapsed
      ? settings.sidebar.collapsedGroups.filter((value) => value !== key)
      : [...new Set([...settings.sidebar.collapsedGroups, key])]
    void saveSettings({ ...settings, sidebar: { ...settings.sidebar, collapsedGroups } }).catch(() => undefined)
  }

  return <aside className="sidebar">
    <div className="brand"><div className="brand-mark">B</div><div><strong>BayTools</strong><span>LOCAL WORKBENCH</span></div></div>
    <nav className="nav-main">
      <NavLink to="/" end className="nav-row"><Home size={16} /><span>主页</span></NavLink>
      <div className="nav-group">
        <div className="nav-parent">
          <button className={jsonActive ? 'active' : undefined} aria-current={jsonActive ? 'page' : undefined} aria-expanded={jsonOpen} onClick={() => void selectGroup('json')}>{jsonOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}<Braces size={16} /><span>JSON 工具</span></button>
          <button className="icon-button nav-action" aria-label="新建 JSON 工作区" onClick={createWorkspace}><Plus size={15} /></button>
        </div>
        {jsonOpen && <div className="nav-children">{jsonWorkspaces.map((workspace) => <div className="nav-child-wrap" key={workspace.id}>
          <NavLink className="nav-tree-row nav-file" to={`/json/${workspace.id}`}><span className="json-dot">{'{}'}</span><span>{workspace.title}</span></NavLink>
          <Menu>{item('重命名', async () => {
            const title = window.prompt('工作区名称', workspace.title)
            if (!title || title === workspace.title) return
            await localBridge.renameJsonWorkspace(workspace.id, title)
            await refreshJson()
          })}{item('创建副本', async () => {
            const duplicate = await localBridge.duplicateJsonWorkspace(workspace.id)
            await refreshJson()
            navigate(`/json/${duplicate.id}`)
          })}{item('移入垃圾箱', async () => {
            if (!window.confirm(`将 ${workspace.title} 移入垃圾箱？`)) return
            await localBridge.trashJsonWorkspace(workspace.id)
            await refreshJson()
            navigate('/')
          }, true)}</Menu>
        </div>)}</div>}
      </div>
      <NavLink to="/timestamp" className="nav-row"><Clock3 size={16} /><span>Timestamp</span></NavLink>
      <NavLink to="/color" className="nav-row"><Palette size={16} /><span>颜色格式转换</span></NavLink>
      <div className="nav-group">
        <div className="nav-parent">
          <button className={markdownActive ? 'active' : undefined} aria-current={markdownActive ? 'page' : undefined} aria-expanded={markdownOpen} onClick={() => void selectGroup('markdown')}>{markdownOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}<FileText size={16} /><span>Markdown</span></button>
          <Menu triggerLabel="Markdown 操作">{item('添加扫描目录', addMarkdownSource)}{item('刷新全部目录', refreshMarkdown)}</Menu>
        </div>
        {markdownOpen && <div className="nav-children">{markdownTrees.map((source) => {
          const collapsed = settings?.sidebar.collapsedGroups.includes(`markdown-source:${source.id}`) ?? false
          return <div className="source-tree" key={source.id}>
          <div className="source-title"><button className="source-toggle" aria-expanded={!collapsed} onClick={() => toggleMarkdownSource(source.id)}>{collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}{collapsed ? <Folder size={14} /> : <FolderOpen size={14} />}<span title={source.path}>{source.label}</span></button><Menu>{item('刷新', refreshMarkdown)}{item('移除扫描目录', async () => {
            if (!window.confirm(`移除扫描目录 ${source.label}？原文件不会删除。`)) return
            await localBridge.removeMarkdownSource(source.id)
            await refreshMarkdown()
          }, true)}</Menu></div>
          {!collapsed && (source.error ? <div className="source-error">{source.error}</div> : <MarkdownNodes sourceId={source.id} nodes={source.children} onChanged={refreshMarkdown} />)}
        </div>})}</div>}
      </div>
    </nav>
    <div className="sidebar-bottom"><NavLink to="/settings" className="nav-row"><Settings size={16} /><span>设置与垃圾箱</span>{<Trash2 size={13} className="nav-tail" />}</NavLink></div>
  </aside>
}
