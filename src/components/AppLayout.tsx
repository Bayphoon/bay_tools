import { AlertCircle, CheckCircle2 } from 'lucide-react'
import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { Outlet, useNavigate } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { ActionConfirmationHost } from './ActionConfirmationHost'
import { BAYTOOLS_NOTICE_EVENT, type AppNotice } from '../lib/clipboard'
import { confirmAction } from '../lib/confirmation'
import { useAppStore } from '../store/appStore'

export function AppLayout() {
  const navigate = useNavigate()
  const markdownDirty = useAppStore((state) => state.markdownDirty)
  const fileWorkbenchDirty = useAppStore((state) => state.fileWorkbenchDirty)
  const settings = useAppStore((state) => state.settings)
  const dirty = markdownDirty || fileWorkbenchDirty
  const [sidebarWidth, setSidebarWidth] = useState(252)
  const resizingSidebar = useRef(false)
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
  useEffect(() => {
    if (!resizingSidebar.current && settings?.sidebar.width) setSidebarWidth(Math.max(200, Math.min(520, settings.sidebar.width)))
  }, [settings?.sidebar.width])

  const persistSidebarWidth = (width: number) => {
    const state = useAppStore.getState()
    if (!state.settings || state.settings.sidebar.width === width) return
    void state.saveSettings({ ...state.settings, sidebar: { ...state.settings.sidebar, width } }).catch(() => undefined)
  }
  const beginSidebarResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = sidebarWidth
    let nextWidth = startWidth
    resizingSidebar.current = true
    document.body.classList.add('sidebar-resizing')
    const move = (pointerEvent: PointerEvent) => {
      nextWidth = Math.max(200, Math.min(520, startWidth + pointerEvent.clientX - startX))
      setSidebarWidth(nextWidth)
    }
    const finish = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', finish)
      document.body.classList.remove('sidebar-resizing')
      resizingSidebar.current = false
      persistSidebarWidth(nextWidth)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', finish)
  }
  const resizeWithKeyboard = (direction: number) => {
    const nextWidth = Math.max(200, Math.min(520, sidebarWidth + direction * 16))
    setSidebarWidth(nextWidth)
    persistSidebarWidth(nextWidth)
  }

  return <div className="app-shell" style={{ '--sidebar-width': `${sidebarWidth}px` } as CSSProperties} onClickCapture={(event) => {
    if (!dirty) return
    const target = event.target as HTMLElement
    const link = target.closest('a')
    if (!link) return
    event.preventDefault()
    event.stopPropagation()
    void confirmAction(`${fileWorkbenchDirty ? '当前工作台文件' : '当前 Markdown'}有未保存修改，确定离开吗？`, { anchor: link, confirmLabel: '离开' }).then((confirmed) => {
      if (!confirmed) return
      const destination = new URL(link.href, window.location.href)
      navigate(`${destination.pathname}${destination.search}${destination.hash}`)
    })
  }}><Sidebar /><div className="sidebar-resize-handle" role="separator" aria-label="调整侧边栏宽度" aria-orientation="vertical" aria-valuemin={200} aria-valuemax={520} aria-valuenow={sidebarWidth} tabIndex={0} onPointerDown={beginSidebarResize} onDoubleClick={() => { setSidebarWidth(252); persistSidebarWidth(252) }} onKeyDown={(event) => { if (event.key === 'ArrowLeft') { event.preventDefault(); resizeWithKeyboard(-1) } else if (event.key === 'ArrowRight') { event.preventDefault(); resizeWithKeyboard(1) } }} /><main className="workspace"><Outlet /></main>{notice && <div className={`app-notice ${notice.kind}`} role="status">{notice.kind === 'success' ? <CheckCircle2 size={17} /> : <AlertCircle size={17} />}<span>{notice.message}</span></div>}<ActionConfirmationHost /></div>
}
