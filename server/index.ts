import Fastify from 'fastify'
import fastifyStatic from '@fastify/static'
import { randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import { basename, extname, join } from 'node:path'
import { readFile, stat } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { Readable } from 'node:stream'
import openBrowser from 'open'
import type { AppSettings, CodeCardWorkspace, ColorState, FileWorkbenchMetadataPatch, FileWorkbenchTextDocument, JsonScratchpad, JsonWorkspace, ManagedMarkdownDocument, MarkdownDocument, MarkdownUiState, ShortcutLocation } from '../shared/types.js'
import { CODE_CARD_IMAGE_MAX_UPLOAD_SIZE, FILE_WORKBENCH_MAX_UPLOAD_SIZE } from '../shared/types.js'
import { AppError } from './errors.js'
import { LanguageStore } from './languageStore.js'
import { ServerStatusStore } from './serverStatusStore.js'
import { BayToolsStore } from './store.js'
import { selectWindowsFolder } from './folderDialog.js'
import { createWindowsShortcut } from './shortcut.js'
import { parseSingleByteRange } from './fileRange.js'
import { PersonalDataManager } from './personalData.js'
import { TranslationStore } from './translationStore.js'
import { registerTranslationRoutes } from './translationRoutes.js'
import { CodeCardStore } from './codeCardStore.js'

const projectRoot = process.cwd()
const store = new BayToolsStore(projectRoot)
const languageStore = new LanguageStore(projectRoot)
const serverStatusStore = new ServerStatusStore(projectRoot)
const personalDataManager = new PersonalDataManager(projectRoot)
const codeCardStore = new CodeCardStore(projectRoot)
const apiVersion = 17
const sourceVersion = process.env.BAYTOOLS_SOURCE_VERSION ?? null
const serviceId = randomBytes(16).toString('hex')
const sessionToken = randomBytes(32).toString('base64url')
const quietLogger = process.env.NODE_ENV === 'production' || process.argv.includes('--open')
const app = Fastify({
  logger: { level: process.env.NODE_ENV === 'test' ? 'silent' : quietLogger ? 'error' : 'info' },
  bodyLimit: 32 * 1024 * 1024,
})

app.addContentTypeParser('application/octet-stream', (_request, payload, done) => done(null, payload))

function allowedHost(value?: string): boolean {
  return Boolean(value && /^(127\.0\.0\.1|localhost):(4319|5173)$/i.test(value))
}

function allowedOrigin(value?: string): boolean {
  return !value || /^http:\/\/(127\.0\.0\.1|localhost):(4319|5173)$/i.test(value)
}

async function revealInExplorer(path: string, selectFile: boolean): Promise<void> {
  if (process.platform !== 'win32') throw new AppError(501, 'WINDOWS_ONLY', '文件位置功能当前仅支持 Windows')
  if (!selectFile) {
    await openBrowser(path, { wait: false })
    return
  }
  await new Promise<void>((resolve, reject) => {
    const explorer = spawn('explorer.exe', ['/select,', path], { detached: true, stdio: 'ignore' })
    explorer.once('error', reject)
    explorer.once('spawn', () => {
      explorer.unref()
      resolve()
    })
  })
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

app.get('/api/session', async () => ({ token: sessionToken, apiVersion, sourceVersion, serviceId }))
registerTranslationRoutes(app, new TranslationStore(projectRoot))

app.get('/api/settings', async () => store.getSettings())
app.put<{ Body: AppSettings }>('/api/settings', async (request) => store.updateSettings(request.body))

app.get('/api/json-scratchpad', async () => store.getJsonScratchpad())
app.put<{ Body: JsonScratchpad }>('/api/json-scratchpad', async (request) => store.updateJsonScratchpad(request.body))

app.get('/api/json-workspaces', async () => store.listJsonWorkspaces())
app.get('/api/json-folders', async () => store.listJsonFolders())
app.post<{ Body: { title?: string; folderId?: string } }>('/api/json-workspaces', async (request) => store.createJsonWorkspace(request.body?.title, request.body?.folderId))
app.get<{ Params: { id: string } }>('/api/json-workspaces/:id', async (request) => store.getJsonWorkspace(request.params.id))
app.put<{ Params: { id: string }; Body: JsonWorkspace }>('/api/json-workspaces/:id', async (request) => {
  if (request.params.id !== request.body.id) throw new AppError(400, 'ID_MISMATCH', '工作区 ID 不匹配')
  return store.updateJsonWorkspace(request.body)
})
app.post<{ Params: { id: string }; Body: { title: string } }>('/api/json-workspaces/:id/rename', async (request) => store.renameJsonWorkspace(request.params.id, request.body.title))
app.post<{ Params: { id: string } }>('/api/json-workspaces/:id/duplicate', async (request) => store.duplicateJsonWorkspace(request.params.id))
app.patch<{ Params: { id: string }; Body: { folderId?: string | null } }>('/api/json-workspaces/:id/folder', async (request) => store.moveJsonWorkspace(request.params.id, request.body?.folderId ?? undefined))
app.post<{ Params: { id: string } }>('/api/json-workspaces/:id/trash', async (request, reply) => {
  await store.trashJsonWorkspace(request.params.id)
  return reply.status(204).send()
})
app.post<{ Params: { id: string } }>('/api/json-workspaces/:id/reveal', async (request, reply) => {
  await revealInExplorer(await store.getJsonWorkspaceLocation(request.params.id), true)
  return reply.status(204).send()
})
app.get<{ Params: { id: string } }>('/api/json-workspaces/:id/location', async (request) => ({ path: await store.getJsonWorkspaceLocation(request.params.id) }))
app.post<{ Body: { name?: string } }>('/api/json-folders', async (request) => store.createJsonFolder(request.body?.name))
app.patch<{ Params: { id: string }; Body: { name: string } }>('/api/json-folders/:id', async (request) => store.renameJsonFolder(request.params.id, request.body.name))
app.delete<{ Params: { id: string } }>('/api/json-folders/:id', async (request, reply) => {
  await store.deleteJsonFolder(request.params.id)
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

app.get('/api/server-status', async () => serverStatusStore.getState())
app.post<{ Body: { url: string } }>('/api/server-status/sync', async (request) => serverStatusStore.sync(request.body?.url ?? ''))

app.get('/api/code-cards', async () => codeCardStore.getLibrary())
app.post<{ Body: { title?: string; folderId?: string } }>('/api/code-cards/workspaces', async (request) => codeCardStore.createWorkspace(request.body?.title, request.body?.folderId))
app.get<{ Params: { id: string } }>('/api/code-cards/workspaces/:id', async (request) => codeCardStore.getWorkspace(request.params.id))
app.put<{ Params: { id: string }; Body: CodeCardWorkspace }>('/api/code-cards/workspaces/:id', async (request) => {
  if (request.params.id !== request.body.id) throw new AppError(400, 'ID_MISMATCH', '代码段 ID 不匹配')
  return codeCardStore.updateWorkspace(request.body)
})
app.patch<{ Params: { id: string }; Body: { title: string } }>('/api/code-cards/workspaces/:id/title', async (request) => codeCardStore.renameWorkspace(request.params.id, request.body.title))
app.patch<{ Params: { id: string }; Body: { folderId?: string | null } }>('/api/code-cards/workspaces/:id/folder', async (request) => codeCardStore.moveWorkspace(request.params.id, request.body?.folderId ?? undefined))
app.post<{ Params: { id: string } }>('/api/code-cards/workspaces/:id/trash', async (request, reply) => {
  await codeCardStore.trashWorkspace(request.params.id)
  return reply.status(204).send()
})
app.post<{ Body: { name?: string } }>('/api/code-cards/folders', async (request) => codeCardStore.createFolder(request.body?.name))
app.patch<{ Params: { id: string }; Body: { name: string } }>('/api/code-cards/folders/:id', async (request) => codeCardStore.renameFolder(request.params.id, request.body.name))
app.delete<{ Params: { id: string } }>('/api/code-cards/folders/:id', async (request, reply) => {
  await codeCardStore.deleteFolder(request.params.id)
  return reply.status(204).send()
})
app.put<{ Params: { workspaceId: string; cardId: string }; Body: Readable; Headers: { 'x-image-type'?: string; 'x-image-size'?: string; 'x-image-width'?: string; 'x-image-height'?: string; 'x-workspace-revision'?: string } }>('/api/code-cards/workspaces/:workspaceId/cards/:cardId/image', {
  bodyLimit: CODE_CARD_IMAGE_MAX_UPLOAD_SIZE + 1024,
}, async (request) => {
  let mimeType = ''
  try { mimeType = request.headers['x-image-type'] ? decodeURIComponent(request.headers['x-image-type']) : '' } catch { throw new AppError(400, 'INVALID_MIME_TYPE', '图片类型编码无效') }
  return codeCardStore.uploadImage(request.params.workspaceId, request.params.cardId, request.body || Readable.from([]), {
    mimeType: mimeType as 'image/webp' | 'image/png' | 'image/jpeg',
    size: Number(request.headers['x-image-size']),
    width: Number(request.headers['x-image-width']),
    height: Number(request.headers['x-image-height']),
    revision: Number(request.headers['x-workspace-revision']),
  })
})
app.delete<{ Params: { workspaceId: string; cardId: string }; Body: { revision: number } }>('/api/code-cards/workspaces/:workspaceId/cards/:cardId/image', async (request) => codeCardStore.deleteImage(request.params.workspaceId, request.params.cardId, request.body.revision))
app.get<{ Params: { workspaceId: string; cardId: string } }>('/api/code-cards/workspaces/:workspaceId/cards/:cardId/image', async (request, reply) => {
  const result = await codeCardStore.getImage(request.params.workspaceId, request.params.cardId)
  reply.header('x-content-type-options', 'nosniff')
  reply.header('cache-control', 'no-store')
  reply.header('content-length', String(result.image.size))
  return reply.type(result.image.mimeType).send(createReadStream(result.path))
})

app.get('/api/file-workbench', async () => store.listFileWorkbenchItems())
app.post<{ Body: Readable; Headers: { 'x-file-name'?: string; 'x-file-type'?: string; 'x-file-size'?: string; 'x-file-last-modified'?: string } }>('/api/file-workbench', {
  bodyLimit: FILE_WORKBENCH_MAX_UPLOAD_SIZE + 1024,
}, async (request) => {
  const encodedName = request.headers['x-file-name']
  const declaredSize = Number(request.headers['x-file-size'])
  if (!encodedName) throw new AppError(400, 'FILE_NAME_REQUIRED', '缺少文件名')
  let name: string
  try { name = decodeURIComponent(encodedName) } catch { throw new AppError(400, 'INVALID_NAME', '文件名编码无效') }
  const lastModified = Number(request.headers['x-file-last-modified'])
  let mimeType = ''
  try { mimeType = request.headers['x-file-type'] ? decodeURIComponent(request.headers['x-file-type']) : '' } catch { throw new AppError(400, 'INVALID_MIME_TYPE', '文件类型编码无效') }
  return store.importFileWorkbenchFile(request.body || Readable.from([]), {
    name,
    mimeType,
    size: declaredSize,
    ...(Number.isFinite(lastModified) && lastModified > 0 && lastModified <= 8.64e15 ? { sourceLastModified: new Date(lastModified).toISOString() } : {}),
  })
})
app.patch<{ Params: { id: string }; Body: FileWorkbenchMetadataPatch }>('/api/file-workbench/:id', async (request) => store.updateFileWorkbenchMetadata(request.params.id, request.body))
app.get<{ Params: { id: string } }>('/api/file-workbench/:id/text', async (request) => store.getFileWorkbenchText(request.params.id))
app.put<{ Params: { id: string }; Body: FileWorkbenchTextDocument }>('/api/file-workbench/:id/text', async (request) => {
  if (request.params.id !== request.body.id) throw new AppError(400, 'ID_MISMATCH', '工作台文件 ID 不匹配')
  return store.saveFileWorkbenchText(request.body)
})
app.post<{ Params: { id: string } }>('/api/file-workbench/:id/trash', async (request, reply) => {
  await store.trashFileWorkbenchItem(request.params.id)
  return reply.status(204).send()
})
app.post<{ Params: { id: string } }>('/api/file-workbench/:id/reveal', async (request, reply) => {
  await revealInExplorer(await store.getFileWorkbenchItemLocation(request.params.id), true)
  return reply.status(204).send()
})
app.get<{ Params: { id: string } }>('/api/file-workbench/:id/location', async (request) => ({ path: await store.getFileWorkbenchItemLocation(request.params.id) }))

const workbenchMimeTypes: Record<string, string> = {
  '.txt': 'text/plain; charset=utf-8', '.log': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8', '.xml': 'application/xml; charset=utf-8', '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp', '.lua': 'text/plain; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.jsx': 'text/javascript; charset=utf-8', '.ts': 'text/plain; charset=utf-8', '.tsx': 'text/plain; charset=utf-8',
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.yaml': 'text/yaml; charset=utf-8', '.yml': 'text/yaml; charset=utf-8', '.ini': 'text/plain; charset=utf-8', '.cfg': 'text/plain; charset=utf-8',
  '.sql': 'text/plain; charset=utf-8', '.py': 'text/plain; charset=utf-8', '.java': 'text/plain; charset=utf-8', '.cs': 'text/plain; charset=utf-8',
}
app.get<{ Params: { id: string }; Querystring: { download?: string } }>('/api/file-workbench/:id/content', async (request, reply) => {
  const item = await store.getFileWorkbenchItem(request.params.id)
  const path = await store.getFileWorkbenchItemLocation(item.id)
  const disposition = request.query.download === '1' ? 'attachment' : 'inline'
  reply.header('x-content-type-options', 'nosniff')
  reply.header('cache-control', 'no-store')
  reply.header('accept-ranges', 'bytes')
  reply.header('content-disposition', `${disposition}; filename*=UTF-8''${encodeURIComponent(item.name)}`)
  reply.type(workbenchMimeTypes[item.extension] ?? 'application/octet-stream')
  let range
  try { range = parseSingleByteRange(request.headers.range, item.size) } catch (error) {
    reply.header('content-range', `bytes */${item.size}`)
    throw error
  }
  if (range) {
    reply.code(206)
    reply.header('content-range', `bytes ${range.start}-${range.end}/${item.size}`)
    reply.header('content-length', String(range.end - range.start + 1))
    return reply.send(createReadStream(path, range))
  }
  reply.header('content-length', String(item.size))
  return reply.send(createReadStream(path))
})

app.post('/api/system/select-directory', async () => {
  if (process.platform !== 'win32') throw new AppError(501, 'WINDOWS_ONLY', '目录选择器当前仅支持 Windows')
  const script = join(projectRoot, 'server', 'select-folder.ps1')
  return { path: await selectWindowsFolder(script) }
})
app.post<{ Body: { location?: ShortcutLocation } }>('/api/system/shortcut', async (request) => {
  const location = request.body?.location
  if (location !== 'desktop' && location !== 'start-menu') throw new AppError(400, 'INVALID_SHORTCUT_LOCATION', '快捷方式位置无效')
  return createWindowsShortcut(projectRoot, location)
})
app.post('/api/system/restart', async (_request, reply) => {
  if (process.platform !== 'win32') throw new AppError(501, 'WINDOWS_ONLY', '服务重启功能当前仅支持 Windows')
  const launcher = join(projectRoot, 'BayTools.vbs')
  const wscript = process.env.SystemRoot ? join(process.env.SystemRoot, 'System32', 'wscript.exe') : 'wscript.exe'
  const timer = setTimeout(() => {
    const child = spawn(wscript, [launcher, '/restart'], { cwd: projectRoot, detached: true, stdio: 'ignore', windowsHide: true })
    child.once('error', (error) => app.log.error(error))
    child.unref()
  }, 200)
  timer.unref()
  return reply.status(202).send({ previousServiceId: serviceId })
})

app.get('/api/personal-data/status', async () => personalDataManager.getStatus())
app.post<{ Body: { force?: boolean } }>('/api/personal-data/sync', async (request) => personalDataManager.sync(request.body?.force === true))
app.post<{ Body: { confirm?: boolean } }>('/api/personal-data/restore', async (request) => {
  const result = await personalDataManager.restore(request.body?.confirm === true)
  languageStore.clearCache()
  return result
})
app.post<{ Body: { confirm?: boolean; force?: boolean } }>('/api/personal-data/publish', async (request) => {
  return personalDataManager.publish(request.body?.confirm === true, request.body?.force === true)
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
app.post<{ Body: { sourceId: string; relativeDirectory?: string; name: string } }>('/api/markdown/document/create', async (request) => {
  return store.createMarkdownDocument(request.body.sourceId, request.body.relativeDirectory ?? '', request.body.name)
})
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
app.get<{ Querystring: { sourceId: string; path: string } }>('/api/markdown/document/location', async (request) => ({ path: await store.getMarkdownDocumentLocation(request.query.sourceId, request.query.path) }))
app.get<{ Querystring: { sourceId: string; path: string; download?: string } }>('/api/markdown/content', async (request, reply) => {
  const path = await store.getMarkdownDocumentLocation(request.query.sourceId, request.query.path)
  const info = await stat(path)
  const name = basename(path)
  const disposition = request.query.download === '1' ? 'attachment' : 'inline'
  reply.header('x-content-type-options', 'nosniff')
  reply.header('cache-control', 'no-store')
  reply.header('accept-ranges', 'bytes')
  reply.header('content-disposition', `${disposition}; filename*=UTF-8''${encodeURIComponent(name)}`)
  reply.type(workbenchMimeTypes[extname(name).toLowerCase()] ?? 'application/octet-stream')
  let range
  try { range = parseSingleByteRange(request.headers.range, info.size) } catch (error) {
    reply.header('content-range', `bytes */${info.size}`)
    throw error
  }
  if (range) {
    reply.code(206)
    reply.header('content-range', `bytes ${range.start}-${range.end}/${info.size}`)
    reply.header('content-length', String(range.end - range.start + 1))
    return reply.send(createReadStream(path, range))
  }
  reply.header('content-length', String(info.size))
  return reply.send(createReadStream(path))
})
app.get<{ Params: { sourceId: string; '*': string } }>('/api/markdown/resource/:sourceId/*', async (request, reply) => {
  const relativePath = request.params['*']
  const path = await store.getMarkdownDocumentLocation(request.params.sourceId, relativePath)
  const info = await stat(path)
  const extension = extname(path).toLowerCase()
  reply.header('x-content-type-options', 'nosniff')
  reply.header('cache-control', 'no-store')
  reply.header('content-security-policy', "default-src 'none'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; media-src 'self' blob:; script-src 'none'; connect-src 'none'; object-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'self'")
  reply.header('content-length', String(info.size))
  reply.type(workbenchMimeTypes[extension] ?? 'application/octet-stream')
  return reply.send(createReadStream(path))
})

app.get('/api/markdown/managed', async () => store.getManagedMarkdownLibrary())
app.post<{ Body: { title?: string; folderId?: string } }>('/api/markdown/managed/documents', async (request) => store.createManagedMarkdownDocument(request.body?.title, request.body?.folderId))
app.get<{ Params: { id: string } }>('/api/markdown/managed/documents/:id', async (request) => store.getManagedMarkdownDocument(request.params.id))
app.put<{ Params: { id: string }; Body: ManagedMarkdownDocument }>('/api/markdown/managed/documents/:id', async (request) => {
  if (request.params.id !== request.body.id) throw new AppError(400, 'ID_MISMATCH', '文档 ID 不匹配')
  return store.updateManagedMarkdownDocument(request.body)
})
app.post<{ Params: { id: string } }>('/api/markdown/managed/documents/:id/duplicate', async (request) => store.duplicateManagedMarkdownDocument(request.params.id))
app.patch<{ Params: { id: string }; Body: { folderId?: string | null } }>('/api/markdown/managed/documents/:id/folder', async (request) => store.moveManagedMarkdownDocument(request.params.id, request.body?.folderId ?? undefined))
app.post<{ Params: { id: string } }>('/api/markdown/managed/documents/:id/trash', async (request, reply) => {
  await store.trashManagedMarkdownDocument(request.params.id)
  return reply.status(204).send()
})
app.post<{ Params: { id: string } }>('/api/markdown/managed/documents/:id/reveal', async (request, reply) => {
  await revealInExplorer(await store.getManagedMarkdownDocumentLocation(request.params.id), true)
  return reply.status(204).send()
})
app.get<{ Params: { id: string } }>('/api/markdown/managed/documents/:id/location', async (request) => ({ path: await store.getManagedMarkdownDocumentLocation(request.params.id) }))
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
  await personalDataManager.autoRestoreIfEmpty()
  // 主存储初始化会清理整个 Doc 下遗留的原子写入临时文件，必须先于其他存储执行。
  await store.init()
  await Promise.all([languageStore.init(), serverStatusStore.init(), codeCardStore.init()])
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
