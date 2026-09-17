import { BookmarkPlus, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { ColorState, ColorValue } from '../../shared/types'
import { CopyButton, EmptyState, InlineError, PageHeader, ToolButton } from '../components/ui'
import { convertColor, type ColorInputKind } from '../lib/color'
import { localBridge } from '../lib/api'
import { confirmAction } from '../lib/confirmation'

const initial: ColorValue = { hex: '#3B82F6', rgb255: 'rgb(59, 130, 246)', rgb1: 'rgb(0.231, 0.510, 0.965)' }

export function ColorPage() {
  const [inputs, setInputs] = useState({ hex: initial.hex, rgb255: initial.rgb255, rgb1: initial.rgb1 })
  const [active, setActive] = useState<ColorInputKind>('hex')
  const [current, setCurrent] = useState(initial)
  const [state, setState] = useState<ColorState>()
  const [error, setError] = useState('')
  useEffect(() => { void localBridge.getColors().then(setState).catch((value) => setError(value.message)) }, [])

  const persist = async (next: ColorState) => {
    try { setState(await localBridge.updateColors(next)) } catch (value) { setError(value instanceof Error ? value.message : '保存失败'); setState(await localBridge.getColors()) }
  }
  const apply = (value: ColorValue) => {
    setCurrent(value)
    setInputs({ hex: value.hex, rgb255: value.rgb255, rgb1: value.rgb1 })
    setError('')
  }
  const convert = () => { try { apply(convertColor(inputs[active], active)) } catch (value) { setError(value instanceof Error ? value.message : '转换失败') } }
  const selectColor = (hex: string) => apply(convertColor(hex, 'hex'))
  const save = () => {
    if (!state) return
    const name = window.prompt('收藏颜色名称', current.hex)
    if (!name) return
    void persist({ ...state, saved: [...state.saved, { ...current, id: crypto.randomUUID(), name, createdAt: new Date().toISOString() }] })
  }
  return <div className="page">
    <PageHeader title="颜色格式转换" description="RGB、归一化 RGB 与 HEX 相互转换" />
    <section className="tool-panel color-converter">
      <div className="color-input-grid">{(['rgb255', 'rgb1', 'hex'] as ColorInputKind[]).map((kind) => <label className={`field-label ${active === kind ? 'active-source' : ''}`} key={kind}>{kind === 'rgb255' ? 'RGB（0～255）' : kind === 'rgb1' ? 'RGB（0～1）' : 'HEX'}<input className="field mono" value={inputs[kind]} onFocus={() => setActive(kind)} onChange={(event) => { setActive(kind); setInputs((value) => ({ ...value, [kind]: event.target.value })) }} /></label>)}</div>
      <div className="converter-actions"><ToolButton className="primary" onClick={convert}>转换</ToolButton><span>当前以 <strong>{active === 'rgb255' ? 'RGB 255' : active === 'rgb1' ? 'RGB 1' : 'HEX'}</strong> 为输入来源</span></div>
      <InlineError>{error}</InlineError>
      <div className="color-result">
        <div className="color-preview" style={{ background: current.hex }}><input type="color" value={current.hex} onChange={(event) => selectColor(event.target.value)} aria-label="色盘选色" /><span>点击色块打开色盘</span></div>
        <div className="color-output-list">{([['RGB 255', current.rgb255], ['RGB 1', current.rgb1], ['HEX', current.hex]] as const).map(([label, value]) => <div className="result-row" key={label}><span>{label}</span><strong className="mono">{value}</strong><CopyButton value={value} /></div>)}</div>
        <ToolButton onClick={save}><BookmarkPlus size={15} />保存颜色</ToolButton>
      </div>
    </section>
    <section className="list-section"><div className="section-heading"><div><span className="eyebrow">SAVED</span><h2>收藏颜色</h2></div></div>
      {!state?.saved.length ? <EmptyState title="还没有收藏颜色">把常用的品牌色或主题色保存下来。</EmptyState> : <div className="saved-color-grid">{state.saved.map((record) => <article className="saved-color" key={record.id}><div className="saved-swatch" style={{ background: record.hex }} /><div><button className="record-name" onClick={() => { const name = window.prompt('新的名称', record.name); if (name) void persist({ ...state, saved: state.saved.map((item) => item.id === record.id ? { ...item, name } : item) }) }}>{record.name}</button><span>{record.hex}</span></div><ToolButton onClick={() => apply(record)}>应用</ToolButton><button className="icon-button danger" aria-label="删除收藏" onClick={() => { void (async () => { if (await confirmAction(`删除收藏颜色 ${record.name}？`)) await persist({ ...state, saved: state.saved.filter((item) => item.id !== record.id) }) })() }}><Trash2 size={14} /></button></article>)}</div>}
    </section>
  </div>
}
