import { ArrowRightLeft } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { CopyButton, InlineError, ToolButton } from '../components/ui'
import { dateInputToTimestamp, parseTimestamp, type DateInputTimeZone, type TimestampResult, type TimestampUnit } from '../lib/timestamp'

const pad = (value: number) => String(value).padStart(2, '0')

function dateInputsForTimeZone(date: Date, timeZone: DateInputTimeZone) {
  const zoned = new Date(date.getTime() + (timeZone === 'beijing' ? 8 * 60 * 60_000 : 0))
  const datePart = `${zoned.getUTCFullYear()}-${pad(zoned.getUTCMonth() + 1)}-${pad(zoned.getUTCDate())}`
  const timePart = `${pad(zoned.getUTCHours())}:${pad(zoned.getUTCMinutes())}:${pad(zoned.getUTCSeconds())}`
  return { calendar: `${datePart}T${timePart}`, text: `${datePart} ${timePart}` }
}

function formatTimeForZone(date: Date, timeZone: DateInputTimeZone) {
  return dateInputsForTimeZone(date, timeZone).text
}

function ResultGrid({ result }: { result: TimestampResult }) {
  const rows = [['本地时间', result.local], ['UTC', result.utc], ['秒时间戳', String(result.seconds)], ['毫秒时间戳', String(result.milliseconds)]]
  return <div className="result-grid">{rows.map(([label, value]) => <div className="result-row" key={label}><span>{label}</span><strong className="mono">{value}</strong><CopyButton value={value} /></div>)}</div>
}

export function TimestampPage() {
  const [input, setInput] = useState(String(Date.now()))
  const [unit, setUnit] = useState<TimestampUnit>('auto')
  const [currentTime, setCurrentTime] = useState(() => new Date())
  const [inputTimeZone, setInputTimeZone] = useState<DateInputTimeZone>('beijing')
  const [dateInputs, setDateInputs] = useState(() => dateInputsForTimeZone(new Date(), 'beijing'))
  const [dateSource, setDateSource] = useState<'calendar' | 'text'>('text')

  useEffect(() => {
    const timer = window.setInterval(() => setCurrentTime(new Date()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  const fromTimestamp = useMemo(() => { try { return { ok: true as const, value: parseTimestamp(input, unit) } } catch (error) { return { ok: false as const, error: error instanceof Error ? error.message : '转换失败' } } }, [input, unit])
  const fromDate = useMemo(() => {
    try {
      return { ok: true as const, value: dateInputToTimestamp(dateInputs[dateSource], inputTimeZone) }
    } catch (error) {
      return { ok: false as const, error: error instanceof Error ? error.message : '转换失败' }
    }
  }, [dateInputs, dateSource, inputTimeZone])

  const useNow = () => {
    setDateInputs(dateInputsForTimeZone(new Date(), inputTimeZone))
    setDateSource('text')
  }

  return <div className="page timestamp-page">
    <header className="timestamp-header">
      <div className="timestamp-heading"><h1>Timestamp 工具</h1><p>日期时间与 Unix 时间戳双向转换</p></div>
      <div className="timestamp-clock-row">
        <div className="timestamp-clock"><span>北京时间</span><strong className="mono">{formatTimeForZone(currentTime, 'beijing')}</strong></div>
        <div className="timestamp-clock"><span>UTC+0</span><strong className="mono">{formatTimeForZone(currentTime, 'utc')}</strong></div>
      </div>
    </header>
    <div className="two-column-tools">
      <section className="tool-panel"><div className="panel-title"><div><span className="eyebrow">TIMESTAMP → DATE</span><h2>时间戳转日期</h2></div><ArrowRightLeft size={18} /></div>
        <label className="field-label">时间戳<input className="field mono large-field" value={input} onChange={(event) => setInput(event.target.value)} /></label>
        <div className="segmented">{(['auto', 'seconds', 'milliseconds'] as TimestampUnit[]).map((value) => <button className={unit === value ? 'active' : ''} key={value} onClick={() => setUnit(value)}>{value === 'auto' ? '自动识别' : value === 'seconds' ? '秒' : '毫秒'}</button>)}</div>
        {fromTimestamp.ok ? <><div className="detected">已按{fromTimestamp.value.detectedUnit === 'seconds' ? '秒' : '毫秒'}解析</div><ResultGrid result={fromTimestamp.value} /></> : <InlineError>{fromTimestamp.error}</InlineError>}
      </section>
      <section className="tool-panel date-to-timestamp-panel"><div className="panel-title"><div><span className="eyebrow">DATE → TIMESTAMP</span><h2>日期转时间戳</h2></div><ToolButton onClick={useNow}>使用现在</ToolButton></div>
        <div className="date-timezone-row"><span>输入时区</span><div className="segmented">{(['beijing', 'utc'] as DateInputTimeZone[]).map((value) => <button className={inputTimeZone === value ? 'active' : ''} key={value} onClick={() => setInputTimeZone(value)}>{value === 'beijing' ? '北京时间（UTC+8）' : 'UTC+0'}</button>)}</div></div>
        <label className={`field-label date-input-field ${dateSource === 'calendar' ? 'active' : ''}`}>日历选择<span>{dateSource === 'calendar' ? '当前输入' : ''}</span><input type="datetime-local" step="1" className="field mono large-field" value={dateInputs.calendar} onChange={(event) => {
          const calendar = event.target.value
          setDateInputs({ calendar, text: calendar.replace('T', ' ') })
          setDateSource('calendar')
        }} /></label>
        <label className={`field-label date-input-field ${dateSource === 'text' ? 'active' : ''}`}>粘贴日期字符串<span>{dateSource === 'text' ? '当前输入' : ''}</span><input className="field mono large-field" value={dateInputs.text} placeholder="例如：2026-09-03 10:46:12.999564051" onChange={(event) => {
          setDateInputs((current) => ({ ...current, text: event.target.value }))
          setDateSource('text')
        }} /></label>
        <p className="date-input-help">支持 - 或 / 分隔、空格或 T、可选时间与 1～9 位小数；字符串自带 Z 或时区偏移时优先使用。</p>
        {fromDate.ok ? <ResultGrid result={fromDate.value} /> : <InlineError>{fromDate.error}</InlineError>}
      </section>
    </div>
  </div>
}
