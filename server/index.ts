import Fastify from 'fastify'
import fastifyStatic from '@fastify/static'
import { randomBytes } from 'node:crypto'
import { join } from 'node:path'
import { readFile } from 'node:fs/promises'
import openBrowser from 'open'
import type { AppSettings, ColorState, JsonWorkspace, MarkdownDocument, MarkdownUiState } from '../shared/types.js'
import { AppError } from './errors.js'
import { BayToolsStore } from './store.js'
import { selectWindowsFolder } from './folderDialog.js'

const projectRoot = process.cwd()
const store = new BayToolsStore(projectRoot)
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

app.get('/api/session', async () => ({ token: sessionToken }))

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

app.get('/api/colors', async () => store.getColors())
app.put<{ Body: ColorState }>('/api/colors', async (request) => store.updateColors(request.body))

app.post('/api/system/select-directory', async () => {
  if (process.platform !== 'win32') throw new AppError(501, 'WINDOWS_ONLY', '目录选择器当前仅支持 Windows')
  const script = join(projectRoot, 'server', 'select-folder.ps1')
  return { path: await selectWindowsFolder(script) }
})

app.get('/api/markdown/sources', async () => store.listMarkdownSources())
app.get('/api/markdown/ui-state', async () => store.getMarkdownUiState())
app.put<{ Body: MarkdownUiState }>('/api/markdown/ui-state', async (request) => store.updateMarkdownUiState(request.body))
app.post<{ Body: { path: string } }>('/api/markdown/sources', async (request) => store.addMarkdownSource(request.body.path))
app.delete<{ Params: { id: string } }>('/api/markdown/sources/:id', async (request, reply) => {
  await store.removeMarkdownSource(request.params.id)
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
  await store.init()
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
