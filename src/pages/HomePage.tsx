import { CheckCircle2, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ClockPanel } from '../components/ClockPanel'
import { JsonTree } from '../components/JsonTree'
import { JsonTextEditor } from '../components/JsonTextEditor'
import { CopyButton, InlineError, ToolButton } from '../components/ui'
import { useAutoFormatJson } from '../hooks/useAutoFormatJson'
import { useTranslation } from '../hooks/useTranslation'
import { TRANSLATION_MAX_INPUT } from '../../shared/translation'
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

function TranslationMini() {
  const [text, setText] = useState('')
  const [targetLanguage, setTargetLanguage] = useState('英语')
  const translation = useTranslation()
  const input = { text, targetLanguage, sourceLanguage: '自动检测', model: 'deepseek-v4-flash' as const }
  return <section className="dashboard-card home-summary-card home-translation-card">
    <div className="home-card-heading"><h2>翻译</h2><Link to="/translation" state={{ ...input, translation: translation.output }}>完整翻译 ↗</Link></div>
    <form className="home-card-input" onSubmit={(event) => { event.preventDefault(); if (text.trim()) void translation.translate(input) }}>
      <select className="select" aria-label="快速翻译目标语言" value={targetLanguage} disabled={translation.busy} onChange={(event) => { setTargetLanguage(event.target.value); translation.setOutput('') }}><option>英语</option><option>简体中文</option><option>日语</option></select>
      <input className="field" aria-label="快速翻译文本" placeholder="输入文本" maxLength={TRANSLATION_MAX_INPUT} value={text} disabled={translation.busy} onChange={(event) => { setText(event.target.value); translation.setOutput('') }} />
      {translation.busy ? <ToolButton type="button" onClick={translation.cancel}>取消</ToolButton> : <ToolButton type="submit" className="primary" disabled={!text.trim()}>翻译</ToolButton>}
    </form>
    <div className="home-card-result">{translation.error ? <Link className="translation-mini-error" to="/settings?tab=deepseek" title={translation.error}>{translation.error}</Link> : <span className="translation-mini-output" title={translation.output}>{translation.output || (translation.busy ? '正在等待 DeepSeek…' : translation.notice || 'DeepSeek · 历史仅保存在本机')}</span>}{translation.output && <CopyButton value={translation.output} />}</div>
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
    <div className="home-summary-grid"><TimestampMini /><TranslationMini /><ClockPanel settings={settings} /></div>
    <JsonMini />
  </div>
}
