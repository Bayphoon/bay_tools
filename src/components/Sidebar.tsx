import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Braces, ChevronDown, ChevronRight, Clock3, CloudUpload, File, FileCode2, FileSpreadsheet, Files, FileImage, FileText, Folder, FolderOpen, Home, Languages, MessageSquareText, MoreHorizontal, Palette, PanelsTopLeft, Plus, Server, Settings, Table2, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom'
import type { CodeCardFolder, CodeCardWorkspaceSummary, FileWorkbenchPreviewKind, JsonFolder, JsonWorkspaceSummary, ManagedMarkdownDocumentSummary, ManagedMarkdownFolder, ManagedMarkdownLibrary, MarkdownTreeNode } from '../../shared/types'
import { copyFilePath } from '../lib/clipboard'
import { confirmAction } from '../lib/confirmation'
import { localBridge } from '../lib/api'
import { inferDocumentPreviewKind, isScannedDocumentActive } from '../lib/documentTypes'
import { setSidebarGroupCollapsed, sidebarGroupCollapsed } from '../lib/sidebarState'
import { useAppStore } from '../store/appStore'

function Menu({ children, triggerLabel = '更多操作', triggerIcon, alwaysVisible = false }: { children: React.ReactNode; triggerLabel?: string; triggerIcon?: React.ReactNode; alwaysVisible?: boolean }) {
  return <DropdownMenu.Root>
    <DropdownMenu.Trigger asChild><button className={`icon-button nav-action ${alwaysVisible ? 'always-visible' : ''}`} aria-label={triggerLabel}>{triggerIcon ?? <MoreHorizontal size={15} />}</button></DropdownMenu.Trigger>
    <DropdownMenu.Portal><DropdownMenu.Content className="dropdown-content" sideOffset={4}>{children}</DropdownMenu.Content></DropdownMenu.Portal>
  </DropdownMenu.Root>
}

const item = (label: string, action: () => void, danger = false) => <DropdownMenu.Item className={`dropdown-item ${danger ? 'danger' : ''}`} onSelect={action}>{label}</DropdownMenu.Item>

type DocumentFilter = 'all' | FileWorkbenchPreviewKind

function documentKind(node: MarkdownTreeNode): FileWorkbenchPreviewKind {
  return node.previewKind ?? inferDocumentPreviewKind(node.name)
}

function filterDocumentNodes(nodes: MarkdownTreeNode[], filter: DocumentFilter): MarkdownTreeNode[] {
  if (filter === 'all') return nodes
  return nodes.flatMap((node) => {
    if (node.type === 'file') return documentKind(node) === filter ? [node] : []
    const children = filterDocumentNodes(node.children ?? [], filter)
    return children.length ? [{ ...node, children }] : []
  })
}

function DocumentNodeIcon({ node }: { node: MarkdownTreeNode }) {
  const kind = documentKind(node)
  if (kind === 'image') return <FileImage size={13} />
  if (kind === 'text' || kind === 'markdown') return <FileCode2 size={13} />
  if (kind === 'pdf') return <FileText size={13} />
  return <File size={13} />
}

function MoveToFolderSubmenu({ folders, currentFolderId, onMove }: { folders: Array<{ id: string; name: string }>; currentFolderId?: string; onMove: (folderId?: string) => void }) {
  return <DropdownMenu.Sub>
    <DropdownMenu.SubTrigger className="dropdown-item dropdown-sub-trigger">移动到分组<ChevronRight size={13} /></DropdownMenu.SubTrigger>
    <DropdownMenu.Portal><DropdownMenu.SubContent className="dropdown-content" sideOffset={3} alignOffset={-4}>
      <DropdownMenu.Item className="dropdown-item" disabled={!currentFolderId} onSelect={() => onMove(undefined)}>未分组</DropdownMenu.Item>
      {folders.map((folder) => <DropdownMenu.Item key={folder.id} className="dropdown-item" disabled={folder.id === currentFolderId} onSelect={() => onMove(folder.id)}>{folder.name}</DropdownMenu.Item>)}
    </DropdownMenu.SubContent></DropdownMenu.Portal>
  </DropdownMenu.Sub>
}

function JsonWorkspaceRow({ workspace, folders, onChanged }: { workspace: JsonWorkspaceSummary; folders: JsonFolder[]; onChanged: () => Promise<void> }) {
  const navigate = useNavigate()
  return <div className="nav-child-wrap">
    <NavLink className="nav-tree-row nav-file" to={`/json/${workspace.id}`}><span className="nav-child-dot" aria-hidden="true" /><span>{workspace.title}</span></NavLink>
    <Menu>{item('重命名', async () => {
      const title = window.prompt('工作区名称', workspace.title)
      if (!title || title === workspace.title) return
      await localBridge.renameJsonWorkspace(workspace.id, title)
      await onChanged()
    })}{item('创建副本', async () => {
      const duplicate = await localBridge.duplicateJsonWorkspace(workspace.id)
      await onChanged()
      navigate(`/json/${duplicate.id}`)
    })}<MoveToFolderSubmenu folders={folders} currentFolderId={workspace.folderId} onMove={(folderId) => { void localBridge.moveJsonWorkspace(workspace.id, folderId).then(onChanged) }} />{item('打开文件所在位置', () => { void localBridge.revealJsonWorkspace(workspace.id) })}{item('复制文件路径', () => { void copyFilePath(() => localBridge.getJsonWorkspaceFilePath(workspace.id)) })}{item('移入垃圾箱', async () => {
      if (!(await confirmAction(`将 ${workspace.title} 移入垃圾箱？`))) return
      await localBridge.trashJsonWorkspace(workspace.id)
      await onChanged()
      navigate('/')
    }, true)}</Menu>
  </div>
}

function JsonFolderSection({ folder, folders, workspaces, collapsed, onToggle, onCreate, onChanged }: { folder: JsonFolder; folders: JsonFolder[]; workspaces: JsonWorkspaceSummary[]; collapsed: boolean; onToggle: () => void; onCreate: () => Promise<void>; onChanged: () => Promise<void> }) {
  const open = !collapsed
  return <div className="source-tree json-folder-tree">
    <div className="source-title"><button className="source-toggle" aria-expanded={open} onClick={onToggle}>{open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}{open ? <FolderOpen size={14} /> : <Folder size={14} />}<span>{folder.name}</span></button><Menu>{item('添加空 JSON', () => { void onCreate() })}{item('重命名', async () => {
      const name = window.prompt('分组名称', folder.name)?.trim()
      if (!name || name === folder.name) return
      await localBridge.renameJsonFolder(folder.id, name)
      await onChanged()
    })}{item('删除空分组', async () => {
      if (workspaces.length || !(await confirmAction(`删除空分组 ${folder.name}？`))) return
      await localBridge.deleteJsonFolder(folder.id)
      await onChanged()
    }, true)}</Menu></div>
    {open && workspaces.map((workspace) => <JsonWorkspaceRow key={workspace.id} workspace={workspace} folders={folders} onChanged={onChanged} />)}
  </div>
}

function CodeCardWorkspaceRow({ workspace, folders, onChanged }: { workspace: CodeCardWorkspaceSummary; folders: CodeCardFolder[]; onChanged: () => Promise<void> }) {
  const navigate = useNavigate()
  const location = useLocation()
  return <div className="nav-child-wrap">
    <NavLink className="nav-tree-row nav-file" to={`/code-cards/${workspace.id}`}><span className="nav-child-dot" aria-hidden="true" /><span>{workspace.title}</span></NavLink>
    <Menu>{item('重命名', async () => {
      const title = window.prompt('代码段名称', workspace.title)?.trim()
      if (!title || title === workspace.title) return
      await localBridge.renameCodeCardWorkspace(workspace.id, title)
      await onChanged()
    })}<MoveToFolderSubmenu folders={folders} currentFolderId={workspace.folderId} onMove={(folderId) => { void localBridge.moveCodeCardWorkspace(workspace.id, folderId).then(onChanged) }} />{item('移入垃圾箱', async () => {
      if (!(await confirmAction(`将代码段“${workspace.title}”移入垃圾箱？其中的卡片代码和图片会一起移入。`))) return
      await localBridge.trashCodeCardWorkspace(workspace.id)
      await onChanged()
      if (location.pathname === `/code-cards/${workspace.id}`) navigate('/')
    }, true)}</Menu>
  </div>
}

function CodeCardFolderSection({ folder, folders, workspaces, collapsed, onToggle, onCreate, onChanged }: { folder: CodeCardFolder; folders: CodeCardFolder[]; workspaces: CodeCardWorkspaceSummary[]; collapsed: boolean; onToggle: () => void; onCreate: () => Promise<void>; onChanged: () => Promise<void> }) {
  return <div className="source-tree code-card-folder-tree">
    <div className="source-title"><button className="source-toggle" aria-expanded={!collapsed} onClick={onToggle}>{collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}{collapsed ? <Folder size={14} /> : <FolderOpen size={14} />}<span>{folder.name}</span></button><Menu>{item('新建代码段', () => { void onCreate() })}{item('重命名', async () => {
      const name = window.prompt('分组名称', folder.name)?.trim()
      if (!name || name === folder.name) return
      await localBridge.renameCodeCardFolder(folder.id, name)
      await onChanged()
    })}{item('删除空分组', async () => {
      if (workspaces.length || !(await confirmAction(`删除空分组 ${folder.name}？`))) return
      await localBridge.deleteCodeCardFolder(folder.id)
      await onChanged()
    }, true)}</Menu></div>
    {!collapsed && workspaces.map((workspace) => <CodeCardWorkspaceRow key={workspace.id} workspace={workspace} folders={folders} onChanged={onChanged} />)}
  </div>
}

function MarkdownNodes({ sourceId, nodes, collapsedGroups, onToggle, onChanged, onCreate, depth = 0 }: { sourceId: string; nodes: MarkdownTreeNode[]; collapsedGroups: string[]; onToggle: (key: string) => void; onChanged: () => Promise<void>; onCreate: (relativeDirectory: string) => Promise<void>; depth?: number }) {
  const navigate = useNavigate()
  const location = useLocation()
  return <>{nodes.map((node) => node.type === 'directory' ? (() => {
    const key = `markdown-directory:${sourceId}:${node.relativePath}`
    const collapsed = sidebarGroupCollapsed(collapsedGroups, key)
    return <div key={node.relativePath}>
    <div className="nav-child-wrap document-directory-wrap"><button className="nav-tree-row" aria-expanded={!collapsed} style={{ paddingLeft: 18 + depth * 12 }} onClick={() => onToggle(key)}>
      {collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}<Folder size={13} /><span>{node.name}</span>
    </button><Menu>{item('新建文件', () => { void onCreate(node.relativePath) })}</Menu></div>
    {!collapsed && <MarkdownNodes sourceId={sourceId} nodes={node.children ?? []} collapsedGroups={collapsedGroups} onToggle={onToggle} onChanged={onChanged} onCreate={onCreate} depth={depth + 1} />}
  </div>
  })() : <div className="nav-child-wrap" key={node.relativePath}>
    <Link className={`nav-tree-row nav-file document-file-row ${isScannedDocumentActive(location.pathname, location.search, sourceId, node.relativePath) ? 'active' : ''}`} aria-current={isScannedDocumentActive(location.pathname, location.search, sourceId, node.relativePath) ? 'page' : undefined} style={{ paddingLeft: 34 + depth * 12 }} to={`/markdown/${sourceId}?path=${encodeURIComponent(node.relativePath)}`}><DocumentNodeIcon node={node} /><span>{node.name}</span></Link>
    <Menu>{item('重命名', async () => {
      const document = await localBridge.getMarkdownDocument(sourceId, node.relativePath)
      const nextName = window.prompt('新的文件名（不能修改扩展名）', node.name)
      if (!nextName || nextName === node.name) return
      const renamed = await localBridge.renameMarkdownDocument(sourceId, node.relativePath, nextName, document.hash)
      await onChanged()
      navigate(`/markdown/${sourceId}?path=${encodeURIComponent(renamed.relativePath)}`)
    })}{item('打开文件所在位置', () => { void localBridge.revealMarkdownDocument(sourceId, node.relativePath) })}{item('复制文件路径', () => { void copyFilePath(() => localBridge.getMarkdownDocumentFilePath(sourceId, node.relativePath)) })}{item('移入垃圾箱', async () => {
      if (!(await confirmAction(`将 ${node.name} 移入 BayTools 垃圾箱？`))) return
      const document = await localBridge.getMarkdownDocument(sourceId, node.relativePath)
      await localBridge.trashMarkdownDocument(sourceId, node.relativePath, document.hash)
      await onChanged()
      navigate('/markdown')
    }, true)}</Menu>
  </div>)}</>
}

function ManagedDocumentRow({ document, folders, onChanged }: { document: ManagedMarkdownDocumentSummary; folders: ManagedMarkdownFolder[]; onChanged: () => Promise<void> }) {
  const navigate = useNavigate()
  const location = useLocation()
  return <div className="nav-child-wrap">
    <NavLink className="nav-tree-row nav-file" to={`/markdown/document/${document.id}`}><span className="nav-child-dot" aria-hidden="true" /><span>{document.title}</span></NavLink>
    <Menu>{item('重命名', async () => {
      const current = await localBridge.getManagedMarkdownDocument(document.id)
      const title = window.prompt('文件名（不能修改扩展名）', current.title)?.trim()
      if (!title || title === current.title) return
      await localBridge.updateManagedMarkdownDocument({ ...current, title })
      await onChanged()
    })}{item('创建副本', async () => {
      const duplicate = await localBridge.duplicateManagedMarkdownDocument(document.id)
      await onChanged()
      navigate(`/markdown/document/${duplicate.id}`)
    })}<MoveToFolderSubmenu folders={folders} currentFolderId={document.folderId} onMove={(folderId) => { void localBridge.moveManagedMarkdownDocument(document.id, folderId).then(onChanged) }} />{item('打开文件所在位置', () => { void localBridge.revealManagedMarkdownDocument(document.id) })}{item('复制文件路径', () => { void copyFilePath(() => localBridge.getManagedMarkdownDocumentFilePath(document.id)) })}{item('移入垃圾箱', async () => {
      if (!(await confirmAction(`将 ${document.title} 移入 BayTools 垃圾箱？`))) return
      await localBridge.trashManagedMarkdownDocument(document.id)
      await onChanged()
      if (location.pathname === `/markdown/document/${document.id}`) navigate('/markdown')
    }, true)}</Menu>
  </div>
}

function ManagedMarkdownSection({ library, filter, collapsedGroups, onToggle, onChanged }: { library: ManagedMarkdownLibrary; filter: DocumentFilter; collapsedGroups: string[]; onToggle: (key: string) => void; onChanged: () => Promise<void> }) {
  const navigate = useNavigate()
  const open = !sidebarGroupCollapsed(collapsedGroups, 'managed-documents')
  const createDocument = async (folderId?: string) => {
    const name = window.prompt('新文件名（支持 Markdown、文本和代码文件）', '未命名文档.md')?.trim()
    if (!name) return
    try {
      const document = await localBridge.createManagedMarkdownDocument(name, folderId)
      await onChanged()
      navigate(`/markdown/document/${document.id}`)
    } catch (error) {
      window.alert(error instanceof Error ? error.message : '新建文件失败')
    }
  }
  const matchesFilter = (document: ManagedMarkdownDocumentSummary) => filter === 'all' || document.previewKind === filter
  const rootDocuments = library.documents.filter((document) => !document.folderId && matchesFilter(document))
  const folders = filter === 'all'
    ? library.folders
    : library.folders.filter((folder) => library.documents.some((document) => document.folderId === folder.id && matchesFilter(document)))
  return <div className="source-tree managed-markdown-tree">
    <div className="source-title"><button className="source-toggle" aria-expanded={open} onClick={() => onToggle('managed-documents')}>{open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}{open ? <FolderOpen size={14} /> : <Folder size={14} />}<span>BayTools 文档</span></button></div>
    {open && <>{rootDocuments.map((document) => <ManagedDocumentRow key={document.id} document={document} folders={library.folders} onChanged={onChanged} />)}{folders.map((folder) => {
      const documents = library.documents.filter((document) => document.folderId === folder.id && matchesFilter(document))
      const key = `managed-folder:${folder.id}`
      const collapsed = sidebarGroupCollapsed(collapsedGroups, key)
      return <div key={folder.id} className="managed-folder">
        <div className="source-title"><button className="source-toggle managed-folder-toggle" aria-expanded={!collapsed} onClick={() => onToggle(key)}>{collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}<Folder size={14} /><span>{folder.name}</span></button><Menu>{item('新建文件', () => { void createDocument(folder.id) })}{item('重命名', async () => {
          const name = window.prompt('分组名称', folder.name)?.trim()
          if (!name || name === folder.name) return
          await localBridge.renameManagedMarkdownFolder(folder.id, name)
          await onChanged()
        })}{item('删除空分组', async () => {
          if (documents.length || !(await confirmAction(`删除空分组 ${folder.name}？`))) return
          await localBridge.deleteManagedMarkdownFolder(folder.id)
          await onChanged()
        }, true)}</Menu></div>
        {!collapsed && documents.map((document) => <ManagedDocumentRow key={document.id} document={document} folders={library.folders} onChanged={onChanged} />)}
      </div>
    })}</>}
  </div>
}

export function Sidebar() {
  const navigate = useNavigate()
  const location = useLocation()
  const { jsonFolders, jsonWorkspaces, languageSources, markdownTrees, managedMarkdown, codeCards, configTables, refreshJson, refreshLanguages, refreshMarkdown, refreshManagedMarkdown, refreshCodeCards, refreshConfigTables, settings } = useAppStore()
  const [collapsedGroups, setCollapsedGroups] = useState(() => [...(settings?.sidebar.collapsedGroups ?? [])])
  const collapsedGroupsRef = useRef(collapsedGroups)
  const pendingCollapsedGroups = useRef<string[] | undefined>(undefined)
  const savingCollapsedGroups = useRef(false)
  const [documentFilter, setDocumentFilter] = useState<DocumentFilter>('all')
  const jsonOpen = !sidebarGroupCollapsed(collapsedGroups, 'json')
  const languageOpen = !sidebarGroupCollapsed(collapsedGroups, 'language')
  const markdownOpen = !sidebarGroupCollapsed(collapsedGroups, 'markdown')
  const codeCardsOpen = !sidebarGroupCollapsed(collapsedGroups, 'code-cards')
  const configTablesOpen = !sidebarGroupCollapsed(collapsedGroups, 'config-tables')
  const jsonActive = location.pathname === '/json' || location.pathname.startsWith('/json/')
  const languageActive = location.pathname === '/language' || location.pathname.startsWith('/language/')
  const markdownActive = location.pathname === '/markdown' || location.pathname.startsWith('/markdown/')
  const codeCardsActive = location.pathname.startsWith('/code-cards/')
  const configTablesActive = location.pathname === '/config-tables' || location.pathname.startsWith('/config-tables/')

  useEffect(() => {
    if (savingCollapsedGroups.current || pendingCollapsedGroups.current || !settings) return
    const next = [...settings.sidebar.collapsedGroups]
    collapsedGroupsRef.current = next
    setCollapsedGroups(next)
  }, [settings?.revision])

  const flushCollapsedGroups = () => {
    if (savingCollapsedGroups.current || !pendingCollapsedGroups.current) return
    savingCollapsedGroups.current = true
    void (async () => {
      while (pendingCollapsedGroups.current) {
        const snapshot = pendingCollapsedGroups.current
        pendingCollapsedGroups.current = undefined
        const state = useAppStore.getState()
        if (!state.settings) break
        const next = { ...state.settings, sidebar: { ...state.settings.sidebar, collapsedGroups: snapshot } }
        try {
          await state.saveSettings(next)
        } catch {
          try {
            const latest = await localBridge.getSettings()
            useAppStore.setState({ settings: latest })
            await useAppStore.getState().saveSettings({ ...latest, sidebar: { ...latest.sidebar, collapsedGroups: snapshot } })
          } catch {
            // Keep the in-memory state for this session; a later toggle retries persistence.
          }
        }
      }
    })().finally(() => {
      savingCollapsedGroups.current = false
      if (pendingCollapsedGroups.current) flushCollapsedGroups()
    })
  }

  const setCollapsed = (key: string, collapsed: boolean) => {
    const next = setSidebarGroupCollapsed(collapsedGroupsRef.current, key, collapsed)
    if (next === collapsedGroupsRef.current) return
    collapsedGroupsRef.current = next
    setCollapsedGroups(next)
    pendingCollapsedGroups.current = next
    flushCollapsedGroups()
  }

  const toggleCollapsed = (key: string) => setCollapsed(key, !sidebarGroupCollapsed(collapsedGroupsRef.current, key))

  const setGroupOpen = (group: 'json' | 'language' | 'markdown' | 'code-cards' | 'config-tables', nextOpen: boolean) => {
    const open = group === 'json' ? jsonOpen : group === 'language' ? languageOpen : group === 'markdown' ? markdownOpen : group === 'code-cards' ? codeCardsOpen : configTablesOpen
    if (open === nextOpen) return
    setCollapsed(group, !nextOpen)
  }

  const toggleGroup = (group: 'json' | 'language' | 'markdown' | 'code-cards' | 'config-tables') => {
    const open = group === 'json' ? jsonOpen : group === 'language' ? languageOpen : group === 'markdown' ? markdownOpen : group === 'code-cards' ? codeCardsOpen : configTablesOpen
    setGroupOpen(group, !open)
  }

  const createWorkspace = async (folderId?: string) => {
    const workspace = await localBridge.createJsonWorkspace(undefined, folderId)
    await refreshJson()
    navigate(`/json/${workspace.id}`)
  }

  const createJsonFolder = async () => {
    const name = window.prompt('分组名称', '未命名分组')?.trim()
    if (!name) return
    await localBridge.createJsonFolder(name)
    await refreshJson()
  }

  const createLanguageSource = async () => {
    const source = await localBridge.createLanguageSource()
    await refreshLanguages()
    navigate(`/language/${source.id}`)
  }

  const selectGroup = async (group: 'json' | 'language' | 'markdown' | 'code-cards' | 'config-tables') => {
    const active = group === 'json' ? jsonActive : group === 'language' ? languageActive : group === 'markdown' ? markdownActive : group === 'code-cards' ? codeCardsActive : configTablesActive
    if (active) {
      toggleGroup(group)
      return
    }

    setGroupOpen(group, true)
    if (group === 'config-tables') {
      navigate('/config-tables')
      return
    }
    if (group === 'markdown') {
      navigate('/markdown')
      return
    }
    if (group === 'code-cards') {
      const first = codeCards?.workspaces[0]
      if (first) navigate(`/code-cards/${first.id}`)
      else {
        const workspace = await localBridge.createCodeCardWorkspace()
        await refreshCodeCards()
        navigate(`/code-cards/${workspace.id}`)
      }
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
    const name = window.prompt('新文件名（支持 Markdown、文本和代码文件）', '未命名文档.md')?.trim()
    if (!name) return
    try {
      const document = await localBridge.createManagedMarkdownDocument(name)
      await refreshManagedMarkdown()
      navigate(`/markdown/document/${document.id}`)
    } catch (error) {
      window.alert(error instanceof Error ? error.message : '新建文件失败')
    }
  }

  const createManagedFolder = async () => {
    const name = window.prompt('分组名称', '未命名分组')?.trim()
    if (!name) return
    await localBridge.createManagedMarkdownFolder(name)
    await refreshManagedMarkdown()
  }

  const createCodeCardWorkspace = async (folderId?: string) => {
    const workspace = await localBridge.createCodeCardWorkspace(undefined, folderId)
    await refreshCodeCards()
    navigate(`/code-cards/${workspace.id}`)
  }

  const createCodeCardFolder = async () => {
    const name = window.prompt('分组名称', '未命名分组')?.trim()
    if (!name) return
    await localBridge.createCodeCardFolder(name)
    await refreshCodeCards()
  }

  const createScannedDocument = async (sourceId: string, relativeDirectory = '') => {
    const name = window.prompt('新文件名（支持 Markdown、文本和代码文件）', '未命名文档.md')?.trim()
    if (!name) return
    try {
      const document = await localBridge.createMarkdownDocument(sourceId, relativeDirectory, name)
      setDocumentFilter('all')
      await refreshMarkdown()
      navigate(`/markdown/${sourceId}?path=${encodeURIComponent(document.relativePath)}`)
    } catch (error) {
      window.alert(error instanceof Error ? error.message : '新建文件失败')
    }
  }

  const toggleMarkdownSource = (sourceId: string) => {
    const key = `markdown-source:${sourceId}`
    toggleCollapsed(key)
  }

  return <aside className="sidebar">
    <div className="brand"><img className="brand-icon" src="/baytools-icon.png" alt="" /><div><strong>BayTools</strong><span>LOCAL WORKBENCH</span></div></div>
    <nav className="nav-main">
      <NavLink to="/" end className="nav-row"><span className="nav-root-icon"><Home size={16} /></span><span>主页</span></NavLink>
      <div className="nav-group">
        <div className="nav-parent">
          <button className={jsonActive ? 'active' : undefined} aria-current={jsonActive ? 'page' : undefined} aria-expanded={jsonOpen} onClick={() => void selectGroup('json')}><span className="nav-root-icon"><Braces size={16} /></span><span>JSON 工具</span>{jsonOpen ? <ChevronDown className="nav-chevron" size={14} /> : <ChevronRight className="nav-chevron" size={14} />}</button>
          <Menu triggerLabel="添加 JSON 内容" triggerIcon={<Plus size={15} />} alwaysVisible>{item('添加空 JSON', () => { void createWorkspace() })}{item('添加分组', () => { void createJsonFolder() })}</Menu>
        </div>
        {jsonOpen && <div className="nav-children">
          {jsonWorkspaces.filter((workspace) => !workspace.folderId).map((workspace) => <JsonWorkspaceRow key={workspace.id} workspace={workspace} folders={jsonFolders} onChanged={refreshJson} />)}
          {jsonFolders.map((folder) => {
            const key = `json-folder:${folder.id}`
            return <JsonFolderSection key={folder.id} folder={folder} folders={jsonFolders} workspaces={jsonWorkspaces.filter((workspace) => workspace.folderId === folder.id)} collapsed={sidebarGroupCollapsed(collapsedGroups, key)} onToggle={() => toggleCollapsed(key)} onCreate={() => createWorkspace(folder.id)} onChanged={refreshJson} />
          })}
        </div>}
      </div>
      <div className="nav-group">
        <div className="nav-parent">
          <button className={markdownActive ? 'active' : undefined} aria-current={markdownActive ? 'page' : undefined} aria-expanded={markdownOpen} onClick={() => void selectGroup('markdown')}><span className="nav-root-icon"><FileText size={16} /></span><span>文档</span>{markdownOpen ? <ChevronDown className="nav-chevron" size={14} /> : <ChevronRight className="nav-chevron" size={14} />}</button>
          <Menu triggerLabel="文档操作" triggerIcon={<Plus size={15} />} alwaysVisible>{item('新建文件', () => { void createManagedDocument() })}{item('新建分组', () => { void createManagedFolder() })}{item('添加扫描目录', addMarkdownSource)}{item('刷新扫描目录', refreshMarkdown)}</Menu>
        </div>
        {markdownOpen && <div className="nav-children"><div className="document-filter" aria-label="按文件类型筛选">{([['all', '全部'], ['markdown', 'MD'], ['text', '文本'], ['image', '图片'], ['pdf', 'PDF'], ['binary', '其他']] as const).map(([value, label]) => <button key={value} className={documentFilter === value ? 'active' : ''} onClick={() => setDocumentFilter(value)}>{label}</button>)}</div>{managedMarkdown && (documentFilter === 'all' || documentFilter === 'markdown' || documentFilter === 'text') && <ManagedMarkdownSection library={managedMarkdown} filter={documentFilter} collapsedGroups={collapsedGroups} onToggle={toggleCollapsed} onChanged={refreshManagedMarkdown} />}{markdownTrees.map((source) => {
          const collapsed = sidebarGroupCollapsed(collapsedGroups, `markdown-source:${source.id}`)
          const displayName = source.note?.trim() || source.label
          const visibleNodes = filterDocumentNodes(source.children, documentFilter)
          return <div className="source-tree" key={source.id}>
          <div className="source-title"><button className="source-toggle" aria-expanded={!collapsed} onClick={() => toggleMarkdownSource(source.id)}>{collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}{collapsed ? <Folder size={14} /> : <FolderOpen size={14} />}<span title={source.path}>{displayName}</span></button><Menu>{item('新建文件', () => { void createScannedDocument(source.id) })}{item('修改备注名', async () => {
            const note = window.prompt('扫描目录备注名，留空则显示文件夹名', source.note ?? '')
            if (note === null) return
            await localBridge.updateMarkdownSourceNote(source.id, note)
            await refreshMarkdown()
          })}{item('刷新扫描', refreshMarkdown)}{item('打开文件所在位置', () => { void localBridge.revealMarkdownSource(source.id) })}{item('移除扫描目录', async () => {
            if (!(await confirmAction(`移除扫描目录 ${displayName}？原文件不会删除。`))) return
            await localBridge.removeMarkdownSource(source.id)
            await refreshMarkdown()
          }, true)}</Menu></div>
          {!collapsed && (source.error ? <div className="source-error">{source.error}</div> : visibleNodes.length ? <MarkdownNodes sourceId={source.id} nodes={visibleNodes} collapsedGroups={collapsedGroups} onToggle={toggleCollapsed} onChanged={refreshMarkdown} onCreate={(relativeDirectory) => createScannedDocument(source.id, relativeDirectory)} /> : <div className="source-empty">当前筛选下没有文件</div>)}
        </div>})}</div>}
      </div>
      <div className="nav-group">
        <div className="nav-parent">
          <button className={codeCardsActive ? 'active' : undefined} aria-current={codeCardsActive ? 'page' : undefined} aria-expanded={codeCardsOpen} onClick={() => void selectGroup('code-cards')}><span className="nav-root-icon"><PanelsTopLeft size={16} /></span><span>代码段</span>{codeCardsOpen ? <ChevronDown className="nav-chevron" size={14} /> : <ChevronRight className="nav-chevron" size={14} />}</button>
          <Menu triggerLabel="添加代码段内容" triggerIcon={<Plus size={15} />} alwaysVisible>{item('新建代码段', () => { void createCodeCardWorkspace() })}{item('新建分组', () => { void createCodeCardFolder() })}</Menu>
        </div>
        {codeCardsOpen && codeCards && <div className="nav-children">
          {codeCards.workspaces.filter((workspace) => !workspace.folderId).map((workspace) => <CodeCardWorkspaceRow key={workspace.id} workspace={workspace} folders={codeCards.folders} onChanged={refreshCodeCards} />)}
          {codeCards.folders.map((folder) => {
            const key = `code-card-folder:${folder.id}`
            return <CodeCardFolderSection key={folder.id} folder={folder} folders={codeCards.folders} workspaces={codeCards.workspaces.filter((workspace) => workspace.folderId === folder.id)} collapsed={sidebarGroupCollapsed(collapsedGroups, key)} onToggle={() => toggleCollapsed(key)} onCreate={() => createCodeCardWorkspace(folder.id)} onChanged={refreshCodeCards} />
          })}
        </div>}
      </div>
      <NavLink to="/files" className="nav-row"><span className="nav-root-icon"><Files size={16} /></span><span>文件工作台</span></NavLink>
      <div className="nav-group">
        <div className="nav-parent">
          <button className={configTablesActive ? 'active' : undefined} aria-current={configTablesActive ? 'page' : undefined} aria-expanded={configTablesOpen} onClick={() => void selectGroup('config-tables')}><span className="nav-root-icon"><Table2 size={16} /></span><span>配置表</span>{configTablesOpen ? <ChevronDown className="nav-chevron" size={14} /> : <ChevronRight className="nav-chevron" size={14} />}</button>
          <Menu triggerLabel="配置表操作" alwaysVisible>{item('刷新本地分支列表', async () => {
            try { useAppStore.setState({ configTables: await localBridge.refreshConfigTableLocal() }) } catch (error) { window.alert(error instanceof Error ? error.message : '刷新失败') }
          })}{item('同步远程分支列表', async () => {
            try { useAppStore.setState({ configTables: await localBridge.syncConfigTableRemote() }) } catch (error) { window.alert(error instanceof Error ? error.message : '同步失败') }
          })}</Menu>
        </div>
        {configTablesOpen && <div className="nav-children">{configTables?.branches.map((branch) => <div className="nav-child-wrap" key={branch.name}>
          <NavLink className={`nav-tree-row nav-file ${branch.local ? '' : 'remote-only'}`} to={`/config-tables/${encodeURIComponent(branch.name)}`}><FileSpreadsheet size={13} /><span title={branch.local ? branch.name : `${branch.name}（远程，未下载）`}>{branch.name}</span></NavLink>
          <Menu>{item(branch.pinned ? '取消置顶' : '置顶分支', async () => {
            try { useAppStore.setState({ configTables: await localBridge.setConfigTableBranchPinned(branch.name, !branch.pinned) }) } catch (error) { window.alert(error instanceof Error ? error.message : '置顶失败') }
          })}{branch.local ? <>{item('SVN 更新当前分支', async () => {
            try { useAppStore.setState({ configTables: await localBridge.updateConfigTableBranch(branch.name) }) } catch (error) { window.alert(error instanceof Error ? error.message : 'SVN 更新失败') }
          })}{item('重新扫描内容', async () => {
            try { useAppStore.setState({ configTables: await localBridge.scanConfigTableBranch(branch.name) }) } catch (error) { window.alert(error instanceof Error ? error.message : '扫描失败') }
          })}{item('打开分支目录', () => { void localBridge.revealConfigTableBranch(branch.name) })}</> : item('下载分支', async () => {
            try { useAppStore.setState({ configTables: await localBridge.downloadConfigTableBranch(branch.name) }); await refreshConfigTables() } catch (error) { window.alert(error instanceof Error ? error.message : '下载失败') }
          })}</Menu>
        </div>)}</div>}
      </div>
      <NavLink to="/timestamp" className="nav-row"><span className="nav-root-icon"><Clock3 size={16} /></span><span>Timestamp</span></NavLink>
      <NavLink to="/color" className="nav-row"><span className="nav-root-icon"><Palette size={16} /></span><span>颜色格式转换</span></NavLink>
      <NavLink to="/translation" className="nav-row"><span className="nav-root-icon"><MessageSquareText size={16} /></span><span>翻译</span></NavLink>
      <div className="nav-group">
        <div className="nav-parent">
          <button className={languageActive ? 'active' : undefined} aria-current={languageActive ? 'page' : undefined} aria-expanded={languageOpen} onClick={() => void selectGroup('language')}><span className="nav-root-icon"><Languages size={16} /></span><span>多语言查询</span>{languageOpen ? <ChevronDown className="nav-chevron" size={14} /> : <ChevronRight className="nav-chevron" size={14} />}</button>
          <button className="icon-button nav-action always-visible" aria-label="添加语种" onClick={createLanguageSource}><Plus size={15} /></button>
        </div>
        {languageOpen && <div className="nav-children">{languageSources.map((source) => <div className="nav-child-wrap" key={source.id}>
          <NavLink className="nav-tree-row nav-file" to={`/language/${source.id}`}><span className="nav-child-dot" aria-hidden="true" /><span title={source.fileName ?? source.title}>{source.title}</span></NavLink>
          <Menu>{item('删除语种', async () => {
            if (!(await confirmAction(`删除 ${source.title}？将同时删除链接配置、本地 TXT 缓存和该语种的收藏；服务器文件不受影响。`))) return
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
      <NavLink to="/server-status" className="nav-row"><span className="nav-root-icon"><Server size={16} /></span><span>服务器状态</span></NavLink>
    </nav>
    <div className="sidebar-bottom">
      <NavLink to="/data-sync" className="nav-row"><span className="nav-root-icon"><CloudUpload size={16} /></span><span>数据同步</span></NavLink>
      <NavLink to="/settings" className="nav-row"><span className="nav-root-icon"><Settings size={16} /></span><span>设置与垃圾箱</span>{<Trash2 size={13} className="nav-tail" />}</NavLink>
    </div>
  </aside>
}
