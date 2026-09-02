import Fastify from 'fastify'
import fastifyStatic from '@fastify/static'
import { randomBytes } from 'node:crypto'
import { dirname, join } from 'node:path'
import { readFile } from 'node:fs/promises'
import openBrowser from 'open'
import type { AppSettings, ColorState, JsonWorkspace, ManagedMarkdownDocument, MarkdownDocument, MarkdownUiState } from '../shared/types.js'
import { AppError } from './errors.js'
import { LanguageStore } from './languageStore.js'
import { BayToolsStore } from './store.js'
import { selectWindowsFolder } from './folderDialog.js'

const projectRoot = process.cwd()
const store = new BayToolsStore(projectRoot)
const languageStore = new LanguageStore(projectRoot)
const apiVersion = 4
const sessionToken = randomBytes(32).toString('base64url')
const quietLogger = process.env.NODE_ENV === 'production' || process.argv.includes('--open')
const app = Fastify({
  logger: { level: process.env.NODE_ENV === 'test' ? 'silent' : quietLogger ? 'error' : 'info' },
  bodyLimit: 32 * 1024 * 1024,
})

function allowedHost(value?: string): boolean {
  return Boolean(value && /^(127\.0\.0\.1|localhost):(4319|5173)$/i.test(value))
}

function allowedOrigin(value?: string): boolean {
  return !value || /^http:\/\/(127\.0\.0\.1|localhost):(4319|5173)$/i.test(value)
}

async function revealInExplorer(path: string, selectFile: boolean): Promise<void> {
  if (process.platform !== 'win32') throw new AppError(501, 'WINDOWS_ONLY', '文件位置功能当前仅支持 Windows')
  await openBrowser(selectFile ? dirname(path) : path, { wait: false })
}

app.addHook('onRequest', async (request) => {
  if (!allowedHost(request.headers.host)) throw new AppError(403, 'HOST_DENIED', '请求主机不受信任')
  if (!allowedOrigin(request.headers.origin)) throw new AppError(403, 'ORIGIN_DENIED', '请求来源不受信任')
  const isRead = request.method === 'GET' || request.method === 'HEAD' || request.method === 'OPTIONS'
  if (!isRead && request.headers['x-baytools-token'] !== sessionToken) {
    throw new AppError(403, 'TOKEN_REQUIRED', '会话令牌无效')
  }
})

app.setErrorHandler((error, _request, reply) => {
  const appError = error instanceof AppError ? error : new AppError(500, 'INTERNAL_ERROR', error instanceof Error ? error.message : '未知服务错误')
  reply.status(appError.statusCode).send({ error: appError.message, code: appError.code, details: appError.details })
})

app.get('/api/session', async () => ({ token: sessionToken, apiVersion }))

app.get('/api/settings', async () => store.getSettings())
app.put<{ Body: AppSettings }>('/api/settings', async (request) => store.updateSettings(request.body))

app.get('/api/json-workspaces', async () => store.listJsonWorkspaces())
app.post<{ Body: { title?: string } }>('/api/json-workspaces', async (request) => store.createJsonWorkspace(request.body?.title))
app.get<{ Params: { id: string } }>('/api/json-workspaces/:id', async (request) => store.getJsonWorkspace(request.params.id))
app.put<{ Params: { id: string }; Body: JsonWorkspace }>('/api/json-workspaces/:id', async (request) => {
  if (request.params.id !== request.body.id) throw new AppError(400, 'ID_MISMATCH', '工作区 ID 不匹配')
  return store.updateJsonWorkspace(request.body)
})
app.post<{ Params: { id: string }; Body: { title: string } }>('/api/json-workspaces/:id/rename', async (request) => store.renameJsonWorkspace(request.params.id, request.body.title))
app.post<{ Params: { id: string } }>('/api/json-workspaces/:id/duplicate', async (request) => store.duplicateJsonWorkspace(request.params.id))
app.post<{ Params: { id: string } }>('/api/json-workspaces/:id/trash', async (request, reply) => {
  await store.trashJsonWorkspace(request.params.id)
  return reply.status(204).send()
})
app.post<{ Params: { id: string } }>('/api/json-workspaces/:id/reveal', async (request, reply) => {
  await revealInExplorer(await store.getJsonWorkspaceLocation(request.params.id), true)
  return reply.status(204).send()
})

app.get('/api/colors', async () => store.getColors())
app.put<{ Body: ColorState }>('/api/colors', async (request) => store.updateColors(request.body))

app.get('/api/languages', async () => languageStore.listSources())
app.post('/api/languages', async () => languageStore.createSource())
app.get<{ Params: { id: string } }>('/api/languages/:id', async (request) => languageStore.getSource(request.params.id))
app.delete<{ Params: { id: string } }>('/api/languages/:id', async (request, reply) => {
  await languageStore.deleteSource(request.params.id)
  return reply.status(204).send()
})
app.post<{ Params: { id: string }; Body: { url: string } }>('/api/languages/:id/sync', async (request) => languageStore.syncSource(request.params.id, request.body.url))
app.get<{ Params: { id: string }; Querystring: { search?: string; page?: string; mode?: 'fuzzy' | 'exact' } }>('/api/languages/:id/search', async (request) => {
  return languageStore.searchEntries(request.params.id, request.query.search ?? '', Number(request.query.page ?? 1), request.query.mode ?? 'fuzzy')
})
app.get<{ Params: { id: string }; Querystring: { search?: string; page?: string; mode?: 'fuzzy' | 'exact' } }>('/api/languages/:id/favorites', async (request) => {
  return languageStore.searchFavorites(request.params.id, request.query.search ?? '', Number(request.query.page ?? 1), request.query.mode ?? 'fuzzy')
})
app.put<{ Params: { id: string }; Body: { key: string; favorite: boolean; revision: number } }>('/api/languages/:id/favorites', async (request) => {
  const { key, favorite, revision } = request.body
  return languageStore.setFavorite(request.params.id, key, favorite, revision)
})

app.post('/api/system/select-directory', async () => {
  if (process.platform !== 'win32') throw new AppError(501, 'WINDOWS_ONLY', '目录选择器当前仅支持 Windows')
  const script = join(projectRoot, 'server', 'select-folder.ps1')
  return { path: await selectWindowsFolder(script) }
})

app.get('/api/markdown/sources', async () => store.listMarkdownSources())
app.get('/api/markdown/ui-state', async () => store.getMarkdownUiState())
app.put<{ Body: MarkdownUiState }>('/api/markdown/ui-state', async (request) => store.updateMarkdownUiState(request.body))
app.post<{ Body: { path: string } }>('/api/markdown/sources', async (request) => store.addMarkdownSource(request.body.path))
app.patch<{ Params: { id: string }; Body: { note: string } }>('/api/markdown/sources/:id', async (request) => store.updateMarkdownSourceNote(request.params.id, request.body.note))
app.delete<{ Params: { id: string } }>('/api/markdown/sources/:id', async (request, reply) => {
  await store.removeMarkdownSource(request.params.id)
  return reply.status(204).send()
})
app.post<{ Params: { id: string } }>('/api/markdown/sources/:id/reveal', async (request, reply) => {
  await revealInExplorer(await store.getMarkdownSourceLocation(request.params.id), false)
  return reply.status(204).send()
})
app.get('/api/markdown/tree', async () => store.scanMarkdownSources())
app.get<{ Querystring: { sourceId: string; path: string } }>('/api/markdown/document', async (request) => store.getMarkdownDocument(request.query.sourceId, request.query.path))
app.put<{ Body: MarkdownDocument }>('/api/markdown/document', async (request) => store.saveMarkdownDocument(request.body))
app.post<{ Body: { sourceId: string; path: string; nextName: string; hash: string } }>('/api/markdown/document/rename', async (request) => {
  const { sourceId, path, nextName, hash } = request.body
  return store.renameMarkdownDocument(sourceId, path, nextName, hash)
})
app.post<{ Body: { sourceId: string; path: string; hash: string } }>('/api/markdown/document/trash', async (request, reply) => {
  await store.trashMarkdownDocument(request.body.sourceId, request.body.path, request.body.hash)
  return reply.status(204).send()
})
app.post<{ Body: { sourceId: string; path: string } }>('/api/markdown/document/reveal', async (request, reply) => {
  await revealInExplorer(await store.getMarkdownDocumentLocation(request.body.sourceId, request.body.path), true)
  return reply.status(204).send()
})

app.get('/api/markdown/managed', async () => store.getManagedMarkdownLibrary())
app.post<{ Body: { title?: string; folderId?: string } }>('/api/markdown/managed/documents', async (request) => store.createManagedMarkdownDocument(request.body?.title, request.body?.folderId))
app.get<{ Params: { id: string } }>('/api/markdown/managed/documents/:id', async (request) => store.getManagedMarkdownDocument(request.params.id))
app.put<{ Params: { id: string }; Body: ManagedMarkdownDocument }>('/api/markdown/managed/documents/:id', async (request) => {
  if (request.params.id !== request.body.id) throw new AppError(400, 'ID_MISMATCH', 'Markdown 文档 ID 不匹配')
  return store.updateManagedMarkdownDocument(request.body)
})
app.post<{ Params: { id: string } }>('/api/markdown/managed/documents/:id/duplicate', async (request) => store.duplicateManagedMarkdownDocument(request.params.id))
app.post<{ Params: { id: string } }>('/api/markdown/managed/documents/:id/trash', async (request, reply) => {
  await store.trashManagedMarkdownDocument(request.params.id)
  return reply.status(204).send()
})
app.post<{ Params: { id: string } }>('/api/markdown/managed/documents/:id/reveal', async (request, reply) => {
  await revealInExplorer(await store.getManagedMarkdownDocumentLocation(request.params.id), true)
  return reply.status(204).send()
})
app.post<{ Body: { name?: string } }>('/api/markdown/managed/folders', async (request) => store.createManagedMarkdownFolder(request.body?.name))
app.patch<{ Params: { id: string }; Body: { name: string } }>('/api/markdown/managed/folders/:id', async (request) => store.renameManagedMarkdownFolder(request.params.id, request.body.name))
app.delete<{ Params: { id: string } }>('/api/markdown/managed/folders/:id', async (request, reply) => {
  await store.deleteManagedMarkdownFolder(request.params.id)
  return reply.status(204).send()
})

const mimeTypes: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
}
app.get<{ Querystring: { sourceId: string; path: string; token: string } }>('/api/markdown/asset', async (request, reply) => {
  if (request.query.token !== sessionToken) throw new AppError(403, 'TOKEN_REQUIRED', '资源令牌无效')
  const asset = await store.readAsset(request.query.sourceId, request.query.path)
  return reply.type(mimeTypes[asset.extension] ?? 'application/octet-stream').send(asset.buffer)
})

app.get('/api/trash', async () => store.listTrash())
app.post<{ Params: { id: string }; Body: { asCopy?: boolean; targetDirectory?: string } }>('/api/trash/:id/restore', async (request) => {
  return store.restoreTrash(request.params.id, request.body?.asCopy, request.body?.targetDirectory)
})
app.delete<{ Params: { id: string } }>('/api/trash/:id', async (request, reply) => {
  await store.deleteTrash(request.params.id)
  return reply.status(204).send()
})
app.delete('/api/trash', async (_request, reply) => {
  await store.emptyTrash()
  return reply.status(204).send()
})

async function registerFrontend(): Promise<void> {
  const dist = join(projectRoot, 'dist')
  await app.register(fastifyStatic, { root: dist, prefix: '/', wildcard: true })
  app.setNotFoundHandler(async (request, reply) => {
    if (request.url.startsWith('/api/')) return reply.status(404).send({ error: '接口不存在', code: 'NOT_FOUND' })
    const html = await readFile(join(dist, 'index.html'), 'utf8')
    return reply.type('text/html').send(html)
  })
}

export async function buildApp(options?: { serveFrontend?: boolean }) {
  await Promise.all([store.init(), languageStore.init()])
  if (options?.serveFrontend) await registerFrontend()
  return app
}

async function start(): Promise<void> {
  const shouldOpen = process.argv.includes('--open')
  await buildApp({ serveFrontend: shouldOpen || process.env.NODE_ENV === 'production' })
  let address: string
  try {
    address = await app.listen({ host: '127.0.0.1', port: 4319 })
  } catch (error) {
    if (shouldOpen && (error as NodeJS.ErrnoException).code === 'EADDRINUSE') {
      await openBrowser('http://127.0.0.1:4319')
      return
    }
    throw error
  }
  if (shouldOpen) await openBrowser(address)
}

if (process.env.NODE_ENV !== 'test') {
  start().catch((error) => {
    app.log.error(error)
    process.exitCode = 1
  })
}
