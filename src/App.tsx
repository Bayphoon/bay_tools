import { lazy, Suspense, useEffect } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { AppLayout } from './components/AppLayout'
import { Spinner } from './components/ui'
import { useTheme } from './hooks/useTheme'
import { useAppStore } from './store/appStore'
const HomePage = lazy(() => import('./pages/HomePage').then((module) => ({ default: module.HomePage })))
const TimestampPage = lazy(() => import('./pages/TimestampPage').then((module) => ({ default: module.TimestampPage })))
const ColorPage = lazy(() => import('./pages/ColorPage').then((module) => ({ default: module.ColorPage })))
const TranslationPage = lazy(() => import('./pages/TranslationPage').then((module) => ({ default: module.TranslationPage })))
const JsonWorkspacePage = lazy(() => import('./pages/JsonWorkspacePage').then((module) => ({ default: module.JsonWorkspacePage })))
const LanguagePage = lazy(() => import('./pages/LanguagePage').then((module) => ({ default: module.LanguagePage })))
const ServerStatusPage = lazy(() => import('./pages/ServerStatusPage').then((module) => ({ default: module.ServerStatusPage })))
const MarkdownPage = lazy(() => import('./pages/MarkdownPage').then((module) => ({ default: module.MarkdownPage })))
const FileWorkbenchPage = lazy(() => import('./pages/FileWorkbenchPage').then((module) => ({ default: module.FileWorkbenchPage })))
const CodeCardsPage = lazy(() => import('./pages/CodeCardsPage').then((module) => ({ default: module.CodeCardsPage })))
const PersonalDataPage = lazy(() => import('./pages/PersonalDataPage').then((module) => ({ default: module.PersonalDataPage })))
const ConfigTablesPage = lazy(() => import('./pages/ConfigTablesPage').then((module) => ({ default: module.ConfigTablesPage })))
const BookmarksPage = lazy(() => import('./pages/BookmarksPage').then((module) => ({ default: module.BookmarksPage })))
const SettingsPage = lazy(() => import('./pages/SettingsPage').then((module) => ({ default: module.SettingsPage })))

export default function App() {
  const { ready, error, settings, bootstrap } = useAppStore()
  useEffect(() => { void bootstrap() }, [bootstrap])
  useTheme(settings)
  if (!ready) return <div className="startup"><img className="brand-icon large" src="/baytools-icon.png" alt="" /><Spinner label="正在启动 BayTools" /></div>
  if (error || !settings) return <div className="startup error"><h1>BayTools 无法启动</h1><p>{error ?? '设置加载失败'}</p><p>若重试无效，请重新运行 BayTools 快捷方式；启动器会检查并重启异常或旧版本服务。</p><button onClick={() => location.reload()}>重试</button></div>
  return <Suspense fallback={<Spinner label="正在加载工具" />}><Routes>
    <Route element={<AppLayout />}>
      <Route index element={<HomePage />} />
      <Route path="timestamp" element={<TimestampPage />} />
      <Route path="color" element={<ColorPage />} />
      <Route path="translation" element={<TranslationPage />} />
      <Route path="json/:id" element={<JsonWorkspacePage />} />
      <Route path="language/:id" element={<LanguagePage />} />
      <Route path="server-status" element={<ServerStatusPage />} />
      <Route path="config-tables" element={<ConfigTablesPage />} />
      <Route path="config-tables/:branch" element={<ConfigTablesPage />} />
      <Route path="markdown" element={<MarkdownPage />} />
      <Route path="markdown/document/:documentId" element={<MarkdownPage />} />
      <Route path="markdown/:sourceId" element={<MarkdownPage />} />
      <Route path="files" element={<FileWorkbenchPage />} />
      <Route path="bookmarks" element={<BookmarksPage />} />
      <Route path="code-cards/:id" element={<CodeCardsPage />} />
      <Route path="data-sync" element={<PersonalDataPage />} />
      <Route path="settings" element={<SettingsPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Route>
  </Routes></Suspense>
}
