import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { Check, Copy } from 'lucide-react'
import { useState } from 'react'

export function PageHeader({ title, description, actions }: { title: ReactNode; description?: string; actions?: ReactNode }) {
  return <header className="page-header">
    <div><h1>{title}</h1>{description && <p>{description}</p>}</div>
    {actions && <div className="page-actions">{actions}</div>}
  </header>
}

export function ToolButton({ className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button className={`tool-button ${className}`} {...props} />
}

export function CopyButton({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  return <ToolButton title="复制" onClick={async () => {
    await navigator.clipboard.writeText(value)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1200)
  }}>{copied ? <Check size={14} /> : <Copy size={14} />}{label}</ToolButton>
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return <div className="empty-state"><div className="empty-icon">◇</div><h3>{title}</h3>{children && <p>{children}</p>}{action}</div>
}

export function InlineError({ children }: { children?: ReactNode }) {
  return children ? <div className="inline-error">{children}</div> : null
}

export function Spinner({ label = '正在加载' }: { label?: string }) {
  return <div className="spinner"><span />{label}</div>
}
