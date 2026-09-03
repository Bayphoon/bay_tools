import { AlertCircle, CheckCircle2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Outlet } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { BAYTOOLS_NOTICE_EVENT, type AppNotice } from '../lib/clipboard'
import { useAppStore } from '../store/appStore'

export function AppLayout() {
  const dirty = useAppStore((state) => state.markdownDirty)
  const [notice, setNotice] = useState<AppNotice>()
  const noticeTimer = useRef<number | undefined>(undefined)
  useEffect(() => {
    const showNotice = (event: Event) => {
      setNotice((event as CustomEvent<AppNotice>).detail)
      if (noticeTimer.current) window.clearTimeout(noticeTimer.current)
      noticeTimer.current = window.setTimeout(() => setNotice(undefined), 1800)
    }
    window.addEventListener(BAYTOOLS_NOTICE_EVENT, showNotice)
    return () => {
      window.removeEventListener(BAYTOOLS_NOTICE_EVENT, showNotice)
      if (noticeTimer.current) window.clearTimeout(noticeTimer.current)
    }
  }, [])
  return <div className="app-shell" onClickCapture={(event) => {
    if (!dirty) return
    const target = event.target as HTMLElement
    const link = target.closest('a')
    if (link && !window.confirm('当前 Markdown 有未保存修改，确定离开吗？')) {
      event.preventDefault()
      event.stopPropagation()
    }
  }}><Sidebar /><main className="workspace"><Outlet /></main>{notice && <div className={`app-notice ${notice.kind}`} role="status">{notice.kind === 'success' ? <CheckCircle2 size={17} /> : <AlertCircle size={17} />}<span>{notice.message}</span></div>}</div>
}
