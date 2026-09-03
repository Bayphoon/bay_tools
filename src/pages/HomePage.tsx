import { CheckCircle2, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { ClockPanel } from '../components/ClockPanel'
import { JsonTree } from '../components/JsonTree'
import { JsonTextEditor } from '../components/JsonTextEditor'
import { CopyButton, InlineError, ToolButton } from '../components/ui'
import { useAutoFormatJson } from '../hooks/useAutoFormatJson'
import { convertColor, type ColorInputKind } from '../lib/color'
import { parseTimestamp } from '../lib/timestamp'
import { useAppStore } from '../store/appStore'

function TimestampMini() {
  const [input, setInput] = useState(String(Math.floor(Date.now() / 1000)))
  const result = useMemo(() => {
    try { return { ok: true as const, value: parseTimestamp(input) } } catch (error) { return { ok: false as const, error: error instanceof Error ? error.message : '转换失败' } }
  }, [input])
  return <section className="dashboard-card home-summary-card timestamp-mini-card">
    <div className="home-card-heading"><h2>Timestamp</h2></div>
    <div className="home-card-input">
      <input className="field mono" value={input} onChange={(event) => setInput(event.target.value)} aria-label="Timestamp" />
    </div>
    {result.ok ? <div className="home-card-result">
      <div className="home-result-text"><strong>{result.value.local}</strong><span>按{result.value.detectedUnit === 'seconds' ? '秒' : '毫秒'}识别</span></div>
      <CopyButton value={result.value.local} />
    </div> : <InlineError>{result.error}</InlineError>}
  </section>
}

function ColorMini() {
  const [kind, setKind] = useState<ColorInputKind>('hex')
  const [input, setInput] = useState('#3B82F6')
  const result = useMemo(() => {
    try { return { ok: true as const, value: convertColor(input, kind) } } catch (error) { return { ok: false as const, error: error instanceof Error ? error.message : '转换失败' } }
  }, [input, kind])
  return <section className="dashboard-card home-summary-card home-color-card">
    <div className="home-card-heading"><h2>颜色转换</h2></div>
    <div className="home-card-input"><select className="select" value={kind} onChange={(event) => setKind(event.target.value as ColorInputKind)}><option value="hex">HEX</option><option value="rgb255">RGB 255</option><option value="rgb1">RGB 1</option></select><input className="field mono" value={input} onChange={(event) => setInput(event.target.value)} /></div>
    {result.ok ? <div className="home-card-result color-mini-result"><div className="mini-color-values"><span>{result.value.rgb255}</span><span>{result.value.rgb1}</span></div><div className="color-chip" style={{ background: result.value.hex }} /></div> : <InlineError>{result.error}</InlineError>}
  </section>
}

function JsonMini() {
  const scratchpad = useAppStore((state) => state.jsonScratchpad)!
  const saveStatus = useAppStore((state) => state.jsonScratchpadSaveStatus)
  const saveError = useAppStore((state) => state.jsonScratchpadSaveError)
  const updateScratchpad = useAppStore((state) => state.updateJsonScratchpad)
  const [search, setSearch] = useState('')
  const { text, mode, autoFormat } = scratchpad
  const parsed = useMemo(() => { try { return { value: JSON.parse(text) as unknown } } catch (error) { return { error: error instanceof Error ? error.message : 'JSON 无效' } } }, [text])
  const setText = (value: string) => updateScratchpad({ text: value })
  const format = () => { if ('value' in parsed) setText(JSON.stringify(parsed.value, null, 2)) }
  const saveLabel = saveStatus === 'pending' ? '等待自动保存' : saveStatus === 'saving' ? '正在自动保存' : saveStatus === 'conflict' || saveStatus === 'error' ? (saveError ?? '自动保存失败') : '草稿已自动保存'
  useAutoFormatJson(text, autoFormat && mode === 'text', setText)
  return <section className="dashboard-card json-mini-card">
    <div className="json-mini-toolbar"><div className="toolbar"><ToolButton onClick={() => updateScratchpad({ mode: mode === 'text' ? 'tree' : 'text' })}>{mode === 'text' ? '树形查看' : '原文编辑'}</ToolButton><ToolButton onClick={format}>格式化</ToolButton><label className="json-auto-format"><input type="checkbox" checked={autoFormat} onChange={(event) => updateScratchpad({ autoFormat: event.target.checked })} />自动格式化</label>{'value' in parsed && <span className="valid-state"><CheckCircle2 size={14} />有效</span>}</div><span className={`json-mini-note ${saveStatus}`} title="保存在 Doc/json/home-scratchpad.json">{saveLabel}</span></div>
    {mode === 'text' ? <div className="scratch-monaco"><JsonTextEditor value={text} onChange={setText} /></div> : <div className="tree-panel"><label className="search-field"><Search size={14} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索键或值" /></label><JsonTree text={text} search={search} /></div>}
    {'error' in parsed && <InlineError>{parsed.error}</InlineError>}
  </section>
}

export function HomePage() {
  const settings = useAppStore((state) => state.settings)!
  return <div className="page home-page">
    <div className="home-summary-grid"><TimestampMini /><ColorMini /><ClockPanel settings={settings} /></div>
    <JsonMini />
  </div>
}
