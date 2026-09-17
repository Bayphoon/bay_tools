import { ArrowLeftRight, History, RefreshCw, Search, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { TRANSLATION_HISTORY_LIMIT, TRANSLATION_LANGUAGES, TRANSLATION_MAX_INPUT, TRANSLATION_MODELS, type TranslationConfig, type TranslationEntry, type TranslationInput, type TranslationModel } from '../../shared/translation'
import { CopyButton, EmptyState, InlineError, PageHeader, ToolButton } from '../components/ui'
import { useTranslation } from '../hooks/useTranslation'
import { translationApi } from '../lib/api'
import { confirmAction } from '../lib/confirmation'
import '../translation.css'

export function TranslationPage() {
  const page = useRef<HTMLDivElement>(null)
  const location = useLocation()
  const initial = location.state as Partial<TranslationInput & { translation: string }> | null
  const [text, setText] = useState(initial?.text ?? '')
  const [sourceLanguage, setSourceLanguage] = useState(initial?.sourceLanguage ?? '自动检测')
  const [targetLanguage, setTargetLanguage] = useState(initial?.targetLanguage ?? '英语')
  const [model, setModel] = useState<TranslationModel>(initial?.model ?? 'deepseek-v4-flash')
  const [config, setConfig] = useState<TranslationConfig>()
  const [history, setHistory] = useState<TranslationEntry[]>([])
  const [historyLoading, setHistoryLoading] = useState(true)
  const [historyBusy, setHistoryBusy] = useState(false)
  const [historyError, setHistoryError] = useState('')
  const [configError, setConfigError] = useState('')
  const [search, setSearch] = useState('')
  const translation = useTranslation(initial?.translation)
  const refreshHistory = async () => {
    setHistoryError(''); setHistoryLoading(true)
    try { setHistory(await translationApi.listHistory()) } catch (value) { setHistoryError(value instanceof Error ? value.message : '历史记录加载失败') } finally { setHistoryLoading(false) }
  }
  useEffect(() => {
    const refresh = () => {
      void translationApi.getConfig().then((value) => { setConfig(value); setConfigError('') }).catch((value: Error) => setConfigError(value.message))
      void refreshHistory()
    }
    refresh()
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
  }, [])
  const start = async () => {
    if (!text.trim() || !config?.configured || translation.busy) return
    if (await translation.translate({ text, sourceLanguage, targetLanguage, model })) await refreshHistory()
  }
  const remove = async (id?: string) => {
    if (!id && !(await confirmAction('清空本机所有翻译历史？此操作无法撤销。', { confirmLabel: '清空历史' }))) return
    setHistoryBusy(true); setHistoryError('')
    try { await translationApi.deleteHistory(id); await refreshHistory() }
    catch (value) { setHistoryError(value instanceof Error ? value.message : '删除历史失败') }
    finally { setHistoryBusy(false) }
  }
  const loadEntry = (entry: TranslationEntry) => {
    setText(entry.text); setSourceLanguage(entry.sourceLanguage); setTargetLanguage(entry.targetLanguage); setModel(entry.model); translation.setOutput(entry.translation)
    page.current?.scrollIntoView?.({ block: 'start', behavior: 'smooth' })
  }
  const visible = history.filter((entry) => `${entry.text}\n${entry.translation}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))
  return <div className="page translation-page" ref={page}>
    <PageHeader title="翻译" description="DeepSeek 翻译 · 保留 Markdown、代码块和变量占位符" actions={<Link className="tool-button" to="/settings?tab=deepseek">配置 API Key</Link>} />
    <InlineError>{configError}</InlineError>
    {config && !config.configured && <div className="translation-setup">先在<Link to="/settings?tab=deepseek">设置 → DeepSeek API</Link>中配置本机密钥，即可开始翻译。</div>}
    <div className="translation-controls">
      <label className="field-label">原文语言<select className="select" value={sourceLanguage} disabled={translation.busy} onChange={(event) => setSourceLanguage(event.target.value)}>{['自动检测', ...TRANSLATION_LANGUAGES].map((language) => <option key={language}>{language}</option>)}</select></label>
      <ToolButton aria-label="交换语言和文本" title={sourceLanguage === '自动检测' ? '请先选定原文语言再交换' : translation.output.length > TRANSLATION_MAX_INPUT ? '译文超过输入上限，请复制后分段翻译' : '交换语言和文本'} disabled={translation.busy || sourceLanguage === '自动检测' || translation.output.length > TRANSLATION_MAX_INPUT} onClick={() => { setSourceLanguage(targetLanguage); setTargetLanguage(sourceLanguage); if (translation.output) { setText(translation.output); translation.setOutput(text) } }}><ArrowLeftRight size={16} /></ToolButton>
      <label className="field-label">目标语言<select className="select" value={targetLanguage} disabled={translation.busy} onChange={(event) => setTargetLanguage(event.target.value)}>{TRANSLATION_LANGUAGES.map((language) => <option key={language}>{language}</option>)}</select></label>
      <label className="field-label translation-model">模型<select className="select" value={model} disabled={translation.busy} onChange={(event) => setModel(event.target.value as TranslationModel)}>{TRANSLATION_MODELS.map((name) => <option key={name} value={name}>{name === 'deepseek-v4-flash' ? 'DeepSeek V4 Flash · 快速' : 'DeepSeek V4 Pro · 质量优先'}</option>)}</select></label>
    </div>
    <div className="translation-editors">
      <section className="tool-panel translation-editor"><div className="translation-editor-heading"><h2>原文</h2><ToolButton disabled={translation.busy || !text} onClick={() => { setText(''); translation.setOutput('') }}>清空输入</ToolButton></div><textarea aria-label="待翻译文本" maxLength={TRANSLATION_MAX_INPUT} value={text} disabled={translation.busy} onChange={(event) => setText(event.target.value)} onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); void start() } }} placeholder="输入或粘贴文本，Ctrl + Enter 翻译" /><div className="translation-editor-footer"><span>{text.length.toLocaleString()} / {TRANSLATION_MAX_INPUT.toLocaleString()}</span>{translation.busy ? <ToolButton onClick={translation.cancel}>取消翻译</ToolButton> : <ToolButton className="primary" disabled={!text.trim() || !config?.configured} onClick={() => void start()}>翻译</ToolButton>}</div></section>
      <section className="tool-panel translation-editor"><div className="translation-editor-heading"><h2>译文</h2>{translation.output && <CopyButton value={translation.output} label="复制译文" />}</div><textarea aria-label="译文" readOnly value={translation.output} placeholder={translation.busy ? '正在等待 DeepSeek，译文将逐步显示…' : '译文将显示在这里'} /><div className="translation-editor-footer" role="status"><span>{translation.busy ? '正在翻译…' : translation.notice || '完成的译文自动保存到本机历史'}</span></div></section>
    </div>
    <InlineError>{translation.error}</InlineError>
    <p className="translation-privacy">翻译时原文会发送给 DeepSeek；历史记录保存在本机，支持切换分支后继续查看，不参与数据同步。</p>
    <section className="settings-section translation-history">
      <div className="section-heading"><div><h2><History size={17} />本机历史 <span>{history.length}</span></h2><p>最近 {TRANSLATION_HISTORY_LIMIT} 条，最多约 8 MiB；点击记录载入原文与译文。</p></div><div className="toolbar"><ToolButton aria-label="刷新历史" disabled={historyLoading || historyBusy} onClick={() => void refreshHistory()}><RefreshCw size={14} /></ToolButton><ToolButton className="danger" disabled={historyBusy || (!history.length && !historyError)} onClick={() => void remove()}><Trash2 size={14} />清空历史</ToolButton></div></div>
      <label className="search-field"><Search size={14} /><input aria-label="搜索翻译历史" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索原文或译文" /></label>
      <InlineError>{historyError}</InlineError>
      {historyLoading ? <p role="status">正在加载历史…</p> : !visible.length ? <EmptyState title={search ? '没有匹配的历史记录' : '暂无翻译历史'}>完成翻译后，原文与译文会出现在这里。</EmptyState> : <div className="translation-history-list">{visible.map((entry) => <article className="translation-history-item" key={entry.id}><button className="translation-history-open" disabled={translation.busy} onClick={() => loadEntry(entry)}><span className="translation-history-meta">{entry.sourceLanguage} → {entry.targetLanguage} · {entry.model === 'deepseek-v4-pro' ? 'Pro' : 'Flash'} · {new Date(entry.createdAt).toLocaleString()}</span><strong>{entry.text}</strong><span className="translation-history-preview">{entry.translation}</span></button><div className="toolbar"><CopyButton value={entry.translation} /><ToolButton className="danger" aria-label="删除这条翻译历史" disabled={historyBusy} onClick={() => void remove(entry.id)}><Trash2 size={14} /></ToolButton></div></article>)}</div>}
    </section>
  </div>
}
