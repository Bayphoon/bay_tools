import { Outlet } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { useAppStore } from '../store/appStore'

export function AppLayout() {
  const dirty = useAppStore((state) => state.markdownDirty)
  return <div className="app-shell" onClickCapture={(event) => {
    if (!dirty) return
    const target = event.target as HTMLElement
    const link = target.closest('a')
    if (link && !window.confirm('当前 Markdown 有未保存修改，确定离开吗？')) {
      event.preventDefault()
      event.stopPropagation()
    }
  }}><Sidebar /><main className="workspace"><Outlet /></main></div>
}
