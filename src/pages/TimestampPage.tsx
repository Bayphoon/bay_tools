import { ArrowRightLeft, Clock3 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { CopyButton, InlineError, PageHeader, ToolButton } from '../components/ui'
import { dateInputToTimestamp, parseTimestamp, type TimestampResult, type TimestampUnit } from '../lib/timestamp'

function defaultDateInput() {
  const now = new Date()
  const offset = now.getTimezoneOffset() * 60_000
  return new Date(now.getTime() - offset).toISOString().slice(0, 16)
}

function ResultGrid({ result }: { result: TimestampResult }) {
  const rows = [['本地时间', result.local], ['UTC', result.utc], ['秒时间戳', String(result.seconds)], ['毫秒时间戳', String(result.milliseconds)]]
  return <div className="result-grid">{rows.map(([label, value]) => <div className="result-row" key={label}><span>{label}</span><strong className="mono">{value}</strong><CopyButton value={value} /></div>)}</div>
}

export function TimestampPage() {
  const [input, setInput] = useState(String(Date.now()))
  const [unit, setUnit] = useState<TimestampUnit>('auto')
  const [dateInput, setDateInput] = useState(defaultDateInput)
  const fromTimestamp = useMemo(() => { try { return { ok: true as const, value: parseTimestamp(input, unit) } } catch (error) { return { ok: false as const, error: error instanceof Error ? error.message : '转换失败' } } }, [input, unit])
  const fromDate = useMemo(() => { try { return { ok: true as const, value: dateInputToTimestamp(dateInput) } } catch (error) { return { ok: false as const, error: error instanceof Error ? error.message : '转换失败' } } }, [dateInput])
  return <div className="page">
    <PageHeader title="Timestamp 工具" description="本地时间与 Unix 时间戳双向转换" actions={<span className="timezone-badge"><Clock3 size={14} />{Intl.DateTimeFormat().resolvedOptions().timeZone}</span>} />
    <div className="two-column-tools">
      <section className="tool-panel"><div className="panel-title"><div><span className="eyebrow">TIMESTAMP → DATE</span><h2>时间戳转日期</h2></div><ArrowRightLeft size={18} /></div>
        <label className="field-label">时间戳<input className="field mono large-field" value={input} onChange={(event) => setInput(event.target.value)} /></label>
        <div className="segmented">{(['auto', 'seconds', 'milliseconds'] as TimestampUnit[]).map((value) => <button className={unit === value ? 'active' : ''} key={value} onClick={() => setUnit(value)}>{value === 'auto' ? '自动识别' : value === 'seconds' ? '秒' : '毫秒'}</button>)}</div>
        {fromTimestamp.ok ? <><div className="detected">已按{fromTimestamp.value.detectedUnit === 'seconds' ? '秒' : '毫秒'}解析</div><ResultGrid result={fromTimestamp.value} /></> : <InlineError>{fromTimestamp.error}</InlineError>}
      </section>
      <section className="tool-panel"><div className="panel-title"><div><span className="eyebrow">DATE → TIMESTAMP</span><h2>日期转时间戳</h2></div><ToolButton onClick={() => setDateInput(defaultDateInput())}>使用现在</ToolButton></div>
        <label className="field-label">本地日期时间<input type="datetime-local" className="field mono large-field" value={dateInput} onChange={(event) => setDateInput(event.target.value)} /></label>
        {fromDate.ok ? <ResultGrid result={fromDate.value} /> : <InlineError>{fromDate.error}</InlineError>}
      </section>
    </div>
  </div>
}
