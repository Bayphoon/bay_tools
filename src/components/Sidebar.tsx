import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Braces, ChevronDown, ChevronRight, Clock3, CloudUpload, Files, FileText, Folder, FolderOpen, Home, Languages, MoreHorizontal, Palette, Plus, Server, Settings, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import type { ManagedMarkdownDocumentSummary, ManagedMarkdownLibrary, MarkdownTreeNode } from '../../shared/types'
import { copyFilePath } from '../lib/clipboard'
import { localBridge } from '../lib/api'
import { useAppStore } from '../store/appStore'

function Menu({ children, triggerLabel = '更多操作', triggerIcon, alwaysVisible = false }: { children: React.ReactNode; triggerLabel?: string; triggerIcon?: React.ReactNode; alwaysVisible?: boolean }) {
  return <DropdownMenu.Root>
    <DropdownMenu.Trigger asChild><button className={`icon-button nav-action ${alwaysVisible ? 'always-visible' : ''}`} aria-label={triggerLabel}>{triggerIcon ?? <MoreHorizontal size={15} />}</button></DropdownMenu.Trigger>
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
    })}{item('打开文件所在位置', () => { void localBridge.revealMarkdownDocument(sourceId, node.relativePath) })}{item('复制文件路径', () => { void copyFilePath(() => localBridge.getMarkdownDocumentFilePath(sourceId, node.relativePath)) })}{item('移入垃圾箱', async () => {
      if (!window.confirm(`将 ${node.name} 移入 BayTools 垃圾箱？`)) return
      const document = await localBridge.getMarkdownDocument(sourceId, node.relativePath)
      await localBridge.trashMarkdownDocument(sourceId, node.relativePath, document.hash)
      await onChanged()
      navigate('/markdown')
    }, true)}</Menu>
  </div>)}</>
}

function ManagedDocumentRow({ document, onChanged }: { document: ManagedMarkdownDocumentSummary; onChanged: () => Promise<void> }) {
  const navigate = useNavigate()
  const location = useLocation()
  return <div className="nav-child-wrap">
    <NavLink className="nav-tree-row nav-file" to={`/markdown/document/${document.id}`}><FileText size={13} /><span>{document.title}</span></NavLink>
    <Menu>{item('重命名', async () => {
      const current = await localBridge.getManagedMarkdownDocument(document.id)
      const title = window.prompt('Markdown 文档名称', current.title)?.trim()
      if (!title || title === current.title) return
      await localBridge.updateManagedMarkdownDocument({ ...current, title })
      await onChanged()
    })}{item('创建副本', async () => {
      const duplicate = await localBridge.duplicateManagedMarkdownDocument(document.id)
      await onChanged()
      navigate(`/markdown/document/${duplicate.id}`)
    })}{item('打开文件所在位置', () => { void localBridge.revealManagedMarkdownDocument(document.id) })}{item('复制文件路径', () => { void copyFilePath(() => localBridge.getManagedMarkdownDocumentFilePath(document.id)) })}{item('移入垃圾箱', async () => {
      if (!window.confirm(`将 ${document.title} 移入 BayTools 垃圾箱？`)) return
      await localBridge.trashManagedMarkdownDocument(document.id)
      await onChanged()
      if (location.pathname === `/markdown/document/${document.id}`) navigate('/markdown')
    }, true)}</Menu>
  </div>
}

function ManagedMarkdownSection({ library, onChanged }: { library: ManagedMarkdownLibrary; onChanged: () => Promise<void> }) {
  const navigate = useNavigate()
  const [open, setOpen] = useState(true)
  const [collapsedFolders, setCollapsedFolders] = useState<Record<string, boolean>>({})
  const createDocument = async (folderId?: string) => {
    const document = await localBridge.createManagedMarkdownDocument(undefined, folderId)
    await onChanged()
    navigate(`/markdown/document/${document.id}`)
  }
  const rootDocuments = library.documents.filter((document) => !document.folderId)
  return <div className="source-tree managed-markdown-tree">
    <div className="source-title"><button className="source-toggle" aria-expanded={open} onClick={() => setOpen((value) => !value)}>{open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}{open ? <FolderOpen size={14} /> : <Folder size={14} />}<span>BayTools 文档</span></button></div>
    {open && <>{rootDocuments.map((document) => <ManagedDocumentRow key={document.id} document={document} onChanged={onChanged} />)}{library.folders.map((folder) => {
      const documents = library.documents.filter((document) => document.folderId === folder.id)
      const collapsed = collapsedFolders[folder.id] ?? false
      return <div key={folder.id} className="managed-folder">
        <div className="source-title"><button className="source-toggle managed-folder-toggle" aria-expanded={!collapsed} onClick={() => setCollapsedFolders((value) => ({ ...value, [folder.id]: !collapsed }))}>{collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}<Folder size={14} /><span>{folder.name}</span></button><Menu>{item('新建空文档', () => { void createDocument(folder.id) })}{item('重命名', async () => {
          const name = window.prompt('文件夹名称', folder.name)?.trim()
          if (!name || name === folder.name) return
          await localBridge.renameManagedMarkdownFolder(folder.id, name)
          await onChanged()
        })}{item('删除空文件夹', async () => {
          if (documents.length || !window.confirm(`删除空文件夹 ${folder.name}？`)) return
          await localBridge.deleteManagedMarkdownFolder(folder.id)
          await onChanged()
        }, true)}</Menu></div>
        {!collapsed && documents.map((document) => <ManagedDocumentRow key={document.id} document={document} onChanged={onChanged} />)}
      </div>
    })}</>}
  </div>
}

export function Sidebar() {
  const navigate = useNavigate()
  const location = useLocation()
  const { jsonWorkspaces, languageSources, markdownTrees, managedMarkdown, refreshJson, refreshLanguages, refreshMarkdown, refreshManagedMarkdown, settings, saveSettings } = useAppStore()
  const [jsonOpen, setJsonOpen] = useState(!settings?.sidebar.collapsedGroups.includes('json'))
  const [languageOpen, setLanguageOpen] = useState(!settings?.sidebar.collapsedGroups.includes('language'))
  const [markdownOpen, setMarkdownOpen] = useState(!settings?.sidebar.collapsedGroups.includes('markdown'))
  const jsonActive = location.pathname === '/json' || location.pathname.startsWith('/json/')
  const languageActive = location.pathname === '/language' || location.pathname.startsWith('/language/')
  const markdownActive = location.pathname === '/markdown' || location.pathname.startsWith('/markdown/')

  const setGroupOpen = (group: 'json' | 'language' | 'markdown', nextOpen: boolean) => {
    const open = group === 'json' ? jsonOpen : group === 'language' ? languageOpen : markdownOpen
    if (open === nextOpen) return
    if (group === 'json') setJsonOpen(nextOpen)
    else if (group === 'language') setLanguageOpen(nextOpen)
    else setMarkdownOpen(nextOpen)
    if (!settings) return
    const collapsedGroups = nextOpen
      ? settings.sidebar.collapsedGroups.filter((value) => value !== group)
      : [...new Set([...settings.sidebar.collapsedGroups, group])]
    void saveSettings({ ...settings, sidebar: { ...settings.sidebar, collapsedGroups } }).catch(() => undefined)
  }

  const toggleGroup = (group: 'json' | 'language' | 'markdown') => {
    const open = group === 'json' ? jsonOpen : group === 'language' ? languageOpen : markdownOpen
    setGroupOpen(group, !open)
  }

  const createWorkspace = async () => {
    const workspace = await localBridge.createJsonWorkspace()
    await refreshJson()
    navigate(`/json/${workspace.id}`)
  }

  const createLanguageSource = async () => {
    const source = await localBridge.createLanguageSource()
    await refreshLanguages()
    navigate(`/language/${source.id}`)
  }

  const selectGroup = async (group: 'json' | 'language' | 'markdown') => {
    const active = group === 'json' ? jsonActive : group === 'language' ? languageActive : markdownActive
    if (active) {
      toggleGroup(group)
      return
    }

    setGroupOpen(group, true)
    if (group === 'markdown') {
      navigate('/markdown')
      return
    }
    if (group === 'language') {
      const firstSource = languageSources[0]
      if (firstSource) navigate(`/language/${firstSource.id}`)
      else await createLanguageSource()
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

  const createManagedDocument = async () => {
    const document = await localBridge.createManagedMarkdownDocument()
    await refreshManagedMarkdown()
    navigate(`/markdown/document/${document.id}`)
  }

  const createManagedFolder = async () => {
    const name = window.prompt('文件夹名称', '未命名文件夹')?.trim()
    if (!name) return
    await localBridge.createManagedMarkdownFolder(name)
    await refreshManagedMarkdown()
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
    <div className="brand"><img className="brand-icon" src="/baytools-icon.png" alt="" /><div><strong>BayTools</strong><span>LOCAL WORKBENCH</span></div></div>
    <nav className="nav-main">
      <NavLink to="/" end className="nav-row"><Home size={16} /><span>主页</span></NavLink>
      <div className="nav-group">
        <div className="nav-parent">
          <button className={jsonActive ? 'active' : undefined} aria-current={jsonActive ? 'page' : undefined} aria-expanded={jsonOpen} onClick={() => void selectGroup('json')}><Braces size={16} /><span>JSON 工具</span>{jsonOpen ? <ChevronDown className="nav-chevron" size={14} /> : <ChevronRight className="nav-chevron" size={14} />}</button>
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
          })}{item('打开文件所在位置', () => { void localBridge.revealJsonWorkspace(workspace.id) })}{item('复制文件路径', () => { void copyFilePath(() => localBridge.getJsonWorkspaceFilePath(workspace.id)) })}{item('移入垃圾箱', async () => {
            if (!window.confirm(`将 ${workspace.title} 移入垃圾箱？`)) return
            await localBridge.trashJsonWorkspace(workspace.id)
            await refreshJson()
            navigate('/')
          }, true)}</Menu>
        </div>)}</div>}
      </div>
      <div className="nav-group">
        <div className="nav-parent">
          <button className={markdownActive ? 'active' : undefined} aria-current={markdownActive ? 'page' : undefined} aria-expanded={markdownOpen} onClick={() => void selectGroup('markdown')}><FileText size={16} /><span>Markdown</span>{markdownOpen ? <ChevronDown className="nav-chevron" size={14} /> : <ChevronRight className="nav-chevron" size={14} />}</button>
          <Menu triggerLabel="添加 Markdown 内容" triggerIcon={<Plus size={15} />} alwaysVisible>{item('添加空文档', () => { void createManagedDocument() })}{item('添加文件夹', () => { void createManagedFolder() })}{item('添加扫描目录', addMarkdownSource)}{item('刷新扫描目录', refreshMarkdown)}</Menu>
        </div>
        {markdownOpen && <div className="nav-children">{managedMarkdown && <ManagedMarkdownSection library={managedMarkdown} onChanged={refreshManagedMarkdown} />}{markdownTrees.map((source) => {
          const collapsed = settings?.sidebar.collapsedGroups.includes(`markdown-source:${source.id}`) ?? false
          const displayName = source.note?.trim() || source.label
          return <div className="source-tree" key={source.id}>
          <div className="source-title"><button className="source-toggle" aria-expanded={!collapsed} onClick={() => toggleMarkdownSource(source.id)}>{collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}{collapsed ? <Folder size={14} /> : <FolderOpen size={14} />}<span title={source.path}>{displayName}</span></button><Menu>{item('修改备注名', async () => {
            const note = window.prompt('扫描目录备注名，留空则显示文件夹名', source.note ?? '')
            if (note === null) return
            await localBridge.updateMarkdownSourceNote(source.id, note)
            await refreshMarkdown()
          })}{item('刷新扫描', refreshMarkdown)}{item('打开文件所在位置', () => { void localBridge.revealMarkdownSource(source.id) })}{item('移除扫描目录', async () => {
            if (!window.confirm(`移除扫描目录 ${displayName}？原文件不会删除。`)) return
            await localBridge.removeMarkdownSource(source.id)
            await refreshMarkdown()
          }, true)}</Menu></div>
          {!collapsed && (source.error ? <div className="source-error">{source.error}</div> : <MarkdownNodes sourceId={source.id} nodes={source.children} onChanged={refreshMarkdown} />)}
        </div>})}</div>}
      </div>
      <NavLink to="/files" className="nav-row"><Files size={16} /><span>文件工作台</span></NavLink>
      <NavLink to="/timestamp" className="nav-row"><Clock3 size={16} /><span>Timestamp</span></NavLink>
      <NavLink to="/color" className="nav-row"><Palette size={16} /><span>颜色格式转换</span></NavLink>
      <div className="nav-group">
        <div className="nav-parent">
          <button className={languageActive ? 'active' : undefined} aria-current={languageActive ? 'page' : undefined} aria-expanded={languageOpen} onClick={() => void selectGroup('language')}><Languages size={16} /><span>多语言查询</span>{languageOpen ? <ChevronDown className="nav-chevron" size={14} /> : <ChevronRight className="nav-chevron" size={14} />}</button>
          <button className="icon-button nav-action always-visible" aria-label="添加语种" onClick={createLanguageSource}><Plus size={15} /></button>
        </div>
        {languageOpen && <div className="nav-children">{languageSources.map((source) => <div className="nav-child-wrap" key={source.id}>
          <NavLink className="nav-tree-row nav-file" to={`/language/${source.id}`}><Languages size={13} /><span title={source.fileName ?? source.title}>{source.title}</span></NavLink>
          <Menu>{item('删除语种', async () => {
            if (!window.confirm(`删除 ${source.title}？将同时删除链接配置、本地 TXT 缓存和该语种的收藏；服务器文件不受影响。`)) return
            await localBridge.deleteLanguageSource(source.id)
            const remaining = languageSources.filter((item) => item.id !== source.id)
            await refreshLanguages()
            if (location.pathname === `/language/${source.id}`) {
              if (remaining[0]) navigate(`/language/${remaining[0].id}`)
              else navigate('/')
            }
          }, true)}</Menu>
        </div>)}</div>}
      </div>
      <NavLink to="/server-status" className="nav-row"><Server size={16} /><span>服务器状态</span></NavLink>
    </nav>
    <div className="sidebar-bottom">
      <NavLink to="/data-sync" className="nav-row"><CloudUpload size={16} /><span>数据同步</span></NavLink>
      <NavLink to="/settings" className="nav-row"><Settings size={16} /><span>设置与垃圾箱</span>{<Trash2 size={13} className="nav-tail" />}</NavLink>
    </div>
  </aside>
}
