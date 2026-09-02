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
  return <section className="dashboard-card timestamp-mini-card">
    <div className="timestamp-mini-title"><h2>Timestamp</h2></div>
    <input className="field mono" value={input} onChange={(event) => setInput(event.target.value)} aria-label="Timestamp" />
    {result.ok ? <div className="output-line timestamp-mini-output"><strong>{result.value.local}</strong><CopyButton value={result.value.local} /></div> : <InlineError>{result.error}</InlineError>}
    {result.ok && <span className="status-badge">按{result.value.detectedUnit === 'seconds' ? '秒' : '毫秒'}</span>}
  </section>
}

function ColorMini() {
  const [kind, setKind] = useState<ColorInputKind>('hex')
  const [input, setInput] = useState('#3B82F6')
  const result = useMemo(() => {
    try { return { ok: true as const, value: convertColor(input, kind) } } catch (error) { return { ok: false as const, error: error instanceof Error ? error.message : '转换失败' } }
  }, [input, kind])
  return <section className="dashboard-card home-color-card">
    <div className="card-heading"><div><h2>颜色转换</h2></div>{result.ok && <div className="color-chip" style={{ background: result.value.hex }} />}</div>
    <div className="inline-fields"><select className="select" value={kind} onChange={(event) => setKind(event.target.value as ColorInputKind)}><option value="hex">HEX</option><option value="rgb255">RGB 255</option><option value="rgb1">RGB 1</option></select><input className="field mono" value={input} onChange={(event) => setInput(event.target.value)} /></div>
    {result.ok ? <div className="mini-color-values"><span>{result.value.rgb255}</span><span>{result.value.rgb1}</span></div> : <InlineError>{result.error}</InlineError>}
  </section>
}

function JsonMini() {
  const [text, setText] = useState('{\n  "project": "BayTools",\n  "local": true\n}')
  const [mode, setMode] = useState<'text' | 'tree'>('text')
  const [search, setSearch] = useState('')
  const [autoFormat, setAutoFormat] = useState(false)
  const parsed = useMemo(() => { try { return { value: JSON.parse(text) as unknown } } catch (error) { return { error: error instanceof Error ? error.message : 'JSON 无效' } } }, [text])
  const format = () => { if ('value' in parsed) setText(JSON.stringify(parsed.value, null, 2)) }
  useAutoFormatJson(text, autoFormat && mode === 'text', setText)
  return <section className="dashboard-card json-mini-card">
    <div className="json-mini-toolbar"><div className="toolbar"><ToolButton onClick={() => setMode(mode === 'text' ? 'tree' : 'text')}>{mode === 'text' ? '树形查看' : '原文编辑'}</ToolButton><ToolButton onClick={format}>格式化</ToolButton><label className="json-auto-format"><input type="checkbox" checked={autoFormat} onChange={(event) => setAutoFormat(event.target.checked)} />自动格式化</label>{'value' in parsed && <span className="valid-state"><CheckCircle2 size={14} />有效</span>}</div><span className="json-mini-note">临时 JSON · 不保存</span></div>
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
