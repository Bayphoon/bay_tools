import { lazy, Suspense, useEffect } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { AppLayout } from './components/AppLayout'
import { Spinner } from './components/ui'
import { useTheme } from './hooks/useTheme'
import { useAppStore } from './store/appStore'
const HomePage = lazy(() => import('./pages/HomePage').then((module) => ({ default: module.HomePage })))
const TimestampPage = lazy(() => import('./pages/TimestampPage').then((module) => ({ default: module.TimestampPage })))
const ColorPage = lazy(() => import('./pages/ColorPage').then((module) => ({ default: module.ColorPage })))
const JsonWorkspacePage = lazy(() => import('./pages/JsonWorkspacePage').then((module) => ({ default: module.JsonWorkspacePage })))
const MarkdownPage = lazy(() => import('./pages/MarkdownPage').then((module) => ({ default: module.MarkdownPage })))
const SettingsPage = lazy(() => import('./pages/SettingsPage').then((module) => ({ default: module.SettingsPage })))

export default function App() {
  const { ready, error, settings, bootstrap } = useAppStore()
  useEffect(() => { void bootstrap() }, [bootstrap])
  useTheme(settings)
  if (!ready) return <div className="startup"><img className="brand-icon large" src="/baytools-icon.png" alt="" /><Spinner label="正在启动 BayTools" /></div>
  if (error || !settings) return <div className="startup error"><h1>BayTools 无法启动</h1><p>{error ?? '设置加载失败'}</p><button onClick={() => location.reload()}>重试</button></div>
  return <Suspense fallback={<Spinner label="正在加载工具" />}><Routes>
    <Route element={<AppLayout />}>
      <Route index element={<HomePage />} />
      <Route path="timestamp" element={<TimestampPage />} />
      <Route path="color" element={<ColorPage />} />
      <Route path="json/:id" element={<JsonWorkspacePage />} />
      <Route path="markdown" element={<MarkdownPage />} />
      <Route path="markdown/document/:documentId" element={<MarkdownPage />} />
      <Route path="markdown/:sourceId" element={<MarkdownPage />} />
      <Route path="settings" element={<SettingsPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Route>
  </Routes></Suspense>
}
