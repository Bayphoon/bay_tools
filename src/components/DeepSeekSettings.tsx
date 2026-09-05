import { useEffect, useState } from 'react'
import type { TranslationConfig } from '../../shared/translation'
import { translationApi } from '../lib/api'
import { InlineError, ToolButton } from './ui'
import '../translation.css'

export function DeepSeekSettings() {
  const [config, setConfig] = useState<TranslationConfig>()
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  useEffect(() => { void translationApi.getConfig().then(setConfig).catch((value: Error) => setError(value.message)) }, [])
  const run = async (name: string, action: () => Promise<void>) => {
    setBusy(name); setError(''); setMessage('')
    try { await action() } catch (value) { setError(value instanceof Error ? value.message : '操作失败') } finally { setBusy('') }
  }
  return <section className="settings-section deepseek-settings">
    <div className="section-heading"><div><span className="eyebrow">DEEPSEEK API</span><h2>翻译服务</h2><p>配置后即可在主页和翻译页使用。</p></div><span className="status-badge">{!config ? '正在读取配置' : config.source === 'local' ? '已配置本机密钥' : config.source === 'environment' ? '使用环境变量' : '尚未配置'}</span></div>
    <p>API Key 加密保存在本机，仅当前 Windows 用户可解密。每台设备分别配置，密钥和翻译历史不参与数据同步。</p>
    <label className="field-label">DeepSeek API Key<input className="field" type="password" autoComplete="off" spellCheck={false} maxLength={512} value={key} disabled={Boolean(busy) || config?.canSaveKey === false} onChange={(event) => setKey(event.target.value)} placeholder={config?.hasLocalKey ? '输入新密钥以替换，已保存密钥不会回显' : '输入你的 DeepSeek API Key'} /></label>
    {config?.canSaveKey === false && <p>当前系统请使用 DEEPSEEK_API_KEY 环境变量配置密钥。</p>}
    <div className="toolbar">
      <ToolButton className="primary" disabled={!key.trim() || Boolean(busy) || !config?.canSaveKey} onClick={() => void run('save', async () => { setConfig(await translationApi.saveKey(key)); setKey(''); setMessage('密钥已加密保存在本机') })}>{busy === 'save' ? '保存中…' : '保存密钥'}</ToolButton>
      <ToolButton disabled={!config?.configured || Boolean(busy)} onClick={() => void run('test', async () => { setMessage((await translationApi.testConnection()).message) })}>{busy === 'test' ? '正在连接…' : '测试连接'}</ToolButton>
      <ToolButton className="danger" disabled={!config?.hasLocalKey || Boolean(busy)} onClick={() => { if (window.confirm('删除本机保存的 DeepSeek API Key？')) void run('delete', async () => { setConfig(await translationApi.deleteKey()); setKey(''); setMessage('本机密钥已删除') }) }}>删除密钥</ToolButton>
    </div>
    <InlineError>{error}</InlineError>{message && <p role="status">{message}</p>}
    <p>点击翻译会将当前原文发送给 DeepSeek，并按其 API 用量计费。历史记录仅保存在本机，只有选中内容再次翻译时才会重新发送。</p>
  </section>
}
