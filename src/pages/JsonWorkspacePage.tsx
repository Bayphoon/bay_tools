import { DiffEditor } from '@monaco-editor/react'
import { AlertTriangle, ChevronDown, ChevronUp, Copy, Eraser, FolderOpen, GitCompareArrows, ListTree, Pencil, Plus, Search, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { JSON_WORKSPACE_MAX_PANES, JSON_WORKSPACE_MIN_PANES, type JsonPane, type JsonWorkspace } from '../../shared/types'
import { JsonTree } from '../components/JsonTree'
import { JsonTextEditor } from '../components/JsonTextEditor'
import { CopyButton, InlineError, PageHeader, Spinner, ToolButton } from '../components/ui'
import { useAutoFormatJson } from '../hooks/useAutoFormatJson'
import { ApiError, localBridge } from '../lib/api'
import { copyFilePath } from '../lib/clipboard'
import type { JsonDifference } from '../lib/jsonDiff'
import { useAppStore } from '../store/appStore'

type CompareMode = 'split' | 'structure' | 'text'
type SaveState = 'idle' | 'saving' | 'saved' | 'conflict' | 'error'

function runDiff(left: string, right: string): Promise<JsonDifference[]> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../workers/jsonWorker.ts', import.meta.url), { type: 'module' })
    const id = crypto.randomUUID()
    worker.onmessage = (event: MessageEvent<{ id: string; ok: boolean; result?: JsonDifference[]; error?: string }>) => {
      if (event.data.id !== id) return
      worker.terminate()
      if (event.data.ok) resolve(event.data.result ?? [])
      else reject(new Error(event.data.error ?? 'JSON Diff 失败'))
    }
    worker.onerror = (event) => { worker.terminate(); reject(new Error(event.message)) }
    worker.postMessage({ id, type: 'diff', left, right })
  })
}

function parse(text: string) {
  try { return { value: JSON.parse(text) as unknown } } catch (error) { return { error: error instanceof Error ? error.message : 'JSON 无效' } }
}

function Pane({ pane, onChange, onRename, onClear, onRemove, differences, autoFormat, canRemove }: {
  pane: JsonPane
  onChange: (patch: Partial<JsonPane>) => void
  onRename: () => void
  onClear: () => void
  onRemove: () => void
  differences: JsonDifference[]
  autoFormat: boolean
  canRemove: boolean
}) {
  const [search, setSearch] = useState('')
  const parsed = useMemo(() => parse(pane.text), [pane.text])
  const format = (space?: number) => { if ('value' in parsed) onChange({ text: JSON.stringify(parsed.value, null, space) }) }
  useAutoFormatJson(pane.text, autoFormat && pane.view === 'text', (text) => onChange({ text }))
  return <section className="json-pane">
    <div className="json-pane-toolbar"><button className="json-pane-title" onClick={onRename} title="点击重命名"><span>{pane.title}</span><Pencil size={11} /></button><span className="json-pane-toolbar-divider" /><ToolButton onClick={() => onChange({ view: pane.view === 'text' ? 'tree' : 'text' })}><ListTree size={14} />{pane.view === 'text' ? '树形' : '原文'}</ToolButton><ToolButton onClick={() => format(2)}>格式化</ToolButton><ToolButton onClick={() => format()}>压缩</ToolButton><CopyButton value={pane.text} /><span className="json-pane-toolbar-divider" /><span className={'value' in parsed ? 'valid-state' : 'invalid-state'}>{'value' in parsed ? '有效' : '无效'}</span><div className="toolbar-spacer" /><button className="json-pane-action" onClick={onClear} title="清空内容" aria-label={`清空 ${pane.title}`}><Eraser size={13} /></button><button className="json-pane-action danger" disabled={!canRemove} onClick={onRemove} title={canRemove ? '移除面板' : `至少保留 ${JSON_WORKSPACE_MIN_PANES} 个面板`} aria-label={`移除 ${pane.title}`}><X size={14} /></button></div>
    {pane.view === 'text' ? <JsonTextEditor value={pane.text} onChange={(text) => onChange({ text })} /> : <div className="json-tree-mode"><label className="search-field"><Search size={14} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索键或值" /></label><JsonTree text={pane.text} search={search} differences={differences} /></div>}
    {'error' in parsed && <div className="json-error-bar"><AlertTriangle size={14} />{parsed.error}</div>}
  </section>
}

export function JsonWorkspacePage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const refreshJson = useAppStore((state) => state.refreshJson)
  const [workspace, setWorkspace] = useState<JsonWorkspace>()
  const [dirty, setDirty] = useState(false)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [saveError, setSaveError] = useState('')
  const [mode, setMode] = useState<CompareMode>('split')
  const [differences, setDifferences] = useState<JsonDifference[]>([])
  const [diffError, setDiffError] = useState('')
  const [activeDiff, setActiveDiff] = useState(0)
  const [autoFormat, setAutoFormat] = useState(false)
  const saving = useRef(false)

  useEffect(() => {
    if (!id) return
    setWorkspace(undefined); setDirty(false); setSaveState('idle'); setDifferences([])
    void localBridge.getJsonWorkspace(id).then(setWorkspace).catch((error) => setSaveError(error.message))
  }, [id])

  useEffect(() => {
    if (!workspace || !dirty || saving.current) return
    const timer = window.setTimeout(async () => {
      saving.current = true; setSaveState('saving')
      const snapshot = workspace
      try {
        const saved = await localBridge.updateJsonWorkspace(snapshot)
        setWorkspace((current) => {
          if (current === snapshot) { setDirty(false); return saved }
          setDirty(true)
          return current ? { ...current, revision: saved.revision, updatedAt: saved.updatedAt } : saved
        })
        setSaveState('saved')
        await refreshJson()
      } catch (error) {
        if (error instanceof ApiError && error.status === 409) setSaveState('conflict')
        else { setSaveState('error'); setSaveError(error instanceof Error ? error.message : '保存失败') }
      } finally { saving.current = false }
    }, 500)
    return () => window.clearTimeout(timer)
  }, [workspace, dirty, refreshJson])

  const mutateWorkspace = (mutate: (value: JsonWorkspace) => JsonWorkspace) => {
    setWorkspace((value) => value ? mutate(value) : value)
    setDirty(true)
    setSaveState('idle')
  }
  const updatePane = (paneId: string, patch: Partial<JsonPane>) => {
    mutateWorkspace((value) => ({ ...value, panes: value.panes.map((pane) => pane.id === paneId ? { ...pane, ...patch } : pane) }))
  }
  const compare = async () => {
    if (!workspace) return
    const basePane = workspace.panes.find((pane) => pane.id === workspace.diffSelection.basePaneId)
    const targetPane = workspace.panes.find((pane) => pane.id === workspace.diffSelection.targetPaneId)
    if (!basePane || !targetPane) return
    setDiffError('')
    try { const result = await runDiff(basePane.text, targetPane.text); setDifferences(result); setActiveDiff(0); setMode('structure') }
    catch (error) { setDiffError(error instanceof Error ? error.message : '结构化比较失败') }
  }
  const selectDiffPane = (side: 'base' | 'target', paneId: string) => {
    mutateWorkspace((value) => {
      let basePaneId = side === 'base' ? paneId : value.diffSelection.basePaneId
      let targetPaneId = side === 'target' ? paneId : value.diffSelection.targetPaneId
      if (basePaneId === targetPaneId) {
        const replacement = value.panes.find((pane) => pane.id !== paneId)!.id
        if (side === 'base') targetPaneId = replacement
        else basePaneId = replacement
      }
      return { ...value, diffSelection: { basePaneId, targetPaneId } }
    })
    setDifferences([])
    setActiveDiff(0)
    setMode('split')
  }
  const addPane = () => {
    if (!workspace || workspace.panes.length >= JSON_WORKSPACE_MAX_PANES) return
    const titles = new Set(workspace.panes.map((pane) => pane.title))
    let number = 1
    while (titles.has(`JSON ${number}`)) number += 1
    const pane: JsonPane = { id: crypto.randomUUID(), title: `JSON ${number}`, text: '{\n  \n}', view: 'text' }
    mutateWorkspace((value) => ({ ...value, panes: [...value.panes, pane] }))
  }
  const renamePane = (paneId: string) => {
    const pane = workspace?.panes.find((value) => value.id === paneId)
    if (!pane) return
    const title = window.prompt('JSON 面板名称', pane.title)?.trim()
    if (!title || title === pane.title) return
    updatePane(paneId, { title })
  }
  const clearPane = (paneId: string) => {
    const pane = workspace?.panes.find((value) => value.id === paneId)
    if (!pane || !window.confirm(`清空 ${pane.title} 的内容？`)) return
    updatePane(paneId, { text: '' })
    setDifferences([])
    setMode('split')
  }
  const removePane = (paneId: string) => {
    const pane = workspace?.panes.find((value) => value.id === paneId)
    if (!workspace || !pane || workspace.panes.length <= JSON_WORKSPACE_MIN_PANES) return
    if (!window.confirm(`移除 ${pane.title}？其中的内容将从当前工作区删除。`)) return
    mutateWorkspace((value) => {
      const panes = value.panes.filter((item) => item.id !== paneId)
      const basePaneId = panes.some((item) => item.id === value.diffSelection.basePaneId) ? value.diffSelection.basePaneId : panes[0]!.id
      const targetPaneId = panes.some((item) => item.id === value.diffSelection.targetPaneId) && value.diffSelection.targetPaneId !== basePaneId
        ? value.diffSelection.targetPaneId
        : panes.find((item) => item.id !== basePaneId)!.id
      return { ...value, panes, diffSelection: { basePaneId, targetPaneId } }
    })
    setDifferences([])
    setActiveDiff(0)
    setMode('split')
  }
  const renameWorkspace = async () => {
    if (!workspace || saveState === 'saving') return
    const nextTitle = window.prompt('工作区名称', workspace.title)?.trim()
    if (!nextTitle || nextTitle === workspace.title) return
    const snapshot = workspace
    const wasDirty = dirty
    saving.current = true
    setDirty(false)
    setSaveState('saving')
    setSaveError('')
    try {
      const renamed = await localBridge.updateJsonWorkspace({ ...snapshot, title: nextTitle })
      setWorkspace(renamed)
      setSaveState('saved')
      await refreshJson()
    } catch (error) {
      setWorkspace(snapshot)
      setDirty(wasDirty)
      if (error instanceof ApiError && error.status === 409) setSaveState('conflict')
      else { setSaveState('error'); setSaveError(error instanceof Error ? error.message : '重命名失败') }
    } finally {
      saving.current = false
    }
  }
  const reload = async () => { if (!id) return; setWorkspace(await localBridge.getJsonWorkspace(id)); setDirty(false); setSaveState('saved') }
  const saveAsCopy = async () => {
    if (!workspace) return
    const created = await localBridge.createJsonWorkspace(`${workspace.title}（冲突副本）`)
    const idMap = new Map<string, string>()
    const panes = workspace.panes.map((pane) => {
      const paneId = crypto.randomUUID()
      idMap.set(pane.id, paneId)
      return { ...pane, id: paneId }
    })
    const saved = await localBridge.updateJsonWorkspace({
      ...created,
      panes,
      diffSelection: {
        basePaneId: idMap.get(workspace.diffSelection.basePaneId) ?? panes[0]!.id,
        targetPaneId: idMap.get(workspace.diffSelection.targetPaneId) ?? panes[1]!.id,
      },
    })
    await refreshJson(); navigate(`/json/${saved.id}`)
  }
  if (!workspace) return <div className="page"><PageHeader title="JSON 工作区" /><Spinner label={saveError || '正在加载工作区'} /></div>
  const selected = differences[activeDiff]
  const basePane = workspace.panes.find((pane) => pane.id === workspace.diffSelection.basePaneId) ?? workspace.panes[0]!
  const targetPane = workspace.panes.find((pane) => pane.id === workspace.diffSelection.targetPaneId) ?? workspace.panes[1]!
  return <div className="page full-height-page json-page">
    <PageHeader title={<button className="page-title-button" disabled={saveState === 'saving'} onClick={renameWorkspace} title="点击重命名">{workspace.title}<Pencil size={13} /></button>} actions={<><div className="save-status"><span className={`save-dot ${saveState}`} />{saveState === 'saving' ? '保存中' : saveState === 'saved' ? '已保存' : saveState === 'conflict' ? '版本冲突' : saveState === 'error' ? '保存失败' : dirty ? '等待保存' : '未修改'}</div><ToolButton onClick={() => localBridge.revealJsonWorkspace(workspace.id)}><FolderOpen size={14} />打开文件位置</ToolButton><ToolButton onClick={() => void copyFilePath(() => localBridge.getJsonWorkspaceFilePath(workspace.id))}><Copy size={14} />复制文件路径</ToolButton></>} />
    {saveState === 'conflict' && <div className="conflict-banner"><AlertTriangle size={16} /><span>磁盘版本已变化，没有覆盖你的内容。</span><ToolButton onClick={reload}>加载磁盘版本</ToolButton><ToolButton className="primary" onClick={saveAsCopy}>另存为副本</ToolButton></div>}
    <div className="compare-toolbar">
      <div className="segmented"><button className={mode === 'split' ? 'active' : ''} onClick={() => setMode('split')}>多栏编辑</button><button className={mode === 'structure' ? 'active' : ''} onClick={compare}><GitCompareArrows size={13} />结构 Diff</button><button className={mode === 'text' ? 'active' : ''} onClick={() => setMode('text')}>文本 Diff</button></div>
      <div className="compare-pair"><label>基准<select value={basePane.id} onChange={(event) => selectDiffPane('base', event.target.value)}>{workspace.panes.map((pane) => <option key={pane.id} value={pane.id} disabled={pane.id === targetPane.id}>{pane.title}</option>)}</select></label><span>→</span><label>对比<select value={targetPane.id} onChange={(event) => selectDiffPane('target', event.target.value)}>{workspace.panes.map((pane) => <option key={pane.id} value={pane.id} disabled={pane.id === basePane.id}>{pane.title}</option>)}</select></label></div>
      <label className="json-auto-format"><input type="checkbox" checked={autoFormat} onChange={(event) => setAutoFormat(event.target.checked)} />自动格式化</label>
      {mode === 'structure' && <><span className="diff-count">{differences.length} 处差异</span><ToolButton disabled={!differences.length} onClick={() => setActiveDiff((value) => (value - 1 + differences.length) % differences.length)}><ChevronUp size={14} /></ToolButton><ToolButton disabled={!differences.length} onClick={() => setActiveDiff((value) => (value + 1) % differences.length)}><ChevronDown size={14} /></ToolButton>{selected && <code>{selected.path}</code>}</>}
      <InlineError>{diffError || saveError}</InlineError><div className="toolbar-spacer" /><ToolButton disabled={workspace.panes.length >= JSON_WORKSPACE_MAX_PANES} onClick={addPane} title={`最多 ${JSON_WORKSPACE_MAX_PANES} 个 JSON 面板`}><Plus size={14} />新增 JSON <span className="pane-count">{workspace.panes.length}/{JSON_WORKSPACE_MAX_PANES}</span></ToolButton>
    </div>
    {mode === 'text' ? <div className="diff-editor"><DiffEditor height="100%" language="json" original={basePane.text} modified={targetPane.text} theme="vs-dark" options={{ minimap: { enabled: false }, automaticLayout: true, fontSize: 14, renderSideBySide: true, scrollBeyondLastLine: false }} /></div> : <div className="json-panes" data-pane-count={workspace.panes.length}>{workspace.panes.map((pane) => <Pane key={pane.id} pane={pane} onChange={(patch) => updatePane(pane.id, patch)} onRename={() => renamePane(pane.id)} onClear={() => clearPane(pane.id)} onRemove={() => removePane(pane.id)} differences={mode === 'structure' && pane.id === basePane.id ? differences.filter((item) => item.kind !== 'added') : mode === 'structure' && pane.id === targetPane.id ? differences.filter((item) => item.kind !== 'removed') : []} autoFormat={autoFormat} canRemove={workspace.panes.length > JSON_WORKSPACE_MIN_PANES} />)}</div>}
    {mode === 'structure' && differences.length > 0 && <div className="diff-strip">{differences.map((difference, index) => <button key={`${difference.path}-${index}`} className={`${difference.kind} ${index === activeDiff ? 'active' : ''}`} onClick={() => setActiveDiff(index)}><span>{difference.kind === 'added' ? '+' : difference.kind === 'removed' ? '−' : '~'}</span><code>{difference.path}</code></button>)}</div>}
  </div>
}
