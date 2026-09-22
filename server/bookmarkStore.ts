import { randomUUID } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { BOOKMARK_BUILTIN_ICONS, BOOKMARK_ICON_MAX_UPLOAD_SIZE, type BookmarkBuiltinIcon, type BookmarkCreateInput, type BookmarkLayout, type BookmarkLibrary, type BookmarkUpdateInput } from '../shared/types.js'
import { AppError, ConflictError } from './errors.js'
import { exists, readJson, writeJson } from './filesystem.js'

const now = () => new Date().toISOString()
const bookmarkIdPattern = /^[0-9a-f-]{36}$/i
const localIconFilePattern = /^[0-9a-f-]{36}-[0-9a-f-]{36}\.(png|jpg|webp|gif|ico)$/i
const builtinIcons = new Set<string>(BOOKMARK_BUILTIN_ICONS)
const iconTypes: Record<string, { extension: string; mimeType: string }> = {
  'image/png': { extension: 'png', mimeType: 'image/png' },
  'image/jpeg': { extension: 'jpg', mimeType: 'image/jpeg' },
  'image/webp': { extension: 'webp', mimeType: 'image/webp' },
  'image/gif': { extension: 'gif', mimeType: 'image/gif' },
  'image/x-icon': { extension: 'ico', mimeType: 'image/x-icon' },
  'image/vnd.microsoft.icon': { extension: 'ico', mimeType: 'image/x-icon' },
}

export interface BookmarkIconUpload {
  mimeType: string
  size: number
  revision: number
}

function validateId(value: string): string {
  if (!bookmarkIdPattern.test(value)) throw new AppError(400, 'INVALID_BOOKMARK_ID', '书签 ID 无效')
  return value
}

function validateTitle(value: string): string {
  const title = value.trim()
  if (!title) throw new AppError(400, 'BOOKMARK_TITLE_REQUIRED', '请输入书签标题')
  if (title.length > 120) throw new AppError(400, 'BOOKMARK_TITLE_TOO_LONG', '书签标题不能超过 120 个字符')
  return title
}

export function normalizeBookmarkUrl(value: string): string {
  let candidate = value.trim()
  if (!candidate) throw new AppError(400, 'BOOKMARK_URL_REQUIRED', '请输入书签链接')
  if (candidate.length > 2048) throw new AppError(400, 'BOOKMARK_URL_TOO_LONG', '书签链接不能超过 2048 个字符')
  if (!/^[a-z][a-z\d+.-]*:/i.test(candidate)) candidate = `https://${candidate}`
  let url: URL
  try {
    url = new URL(candidate)
  } catch {
    throw new AppError(400, 'INVALID_BOOKMARK_URL', '书签链接格式无效')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new AppError(400, 'INVALID_BOOKMARK_URL', '书签链接只支持 HTTP 或 HTTPS')
  if (url.username || url.password) throw new AppError(400, 'INVALID_BOOKMARK_URL', '书签链接不能包含账号或密码')
  return url.toString()
}

function validateBuiltinIcon(value: string): BookmarkBuiltinIcon {
  if (!builtinIcons.has(value)) throw new AppError(400, 'INVALID_BOOKMARK_ICON', '不支持的内置书签图标')
  return value as BookmarkBuiltinIcon
}

function validateRevision(actual: number, requested: number, library: BookmarkLibrary): void {
  if (!Number.isSafeInteger(requested) || requested < 1) throw new AppError(400, 'INVALID_REVISION', '书签版本号无效')
  if (actual !== requested) throw new ConflictError('书签已在其他窗口中修改', library)
}

function localIconPath(iconRoot: string, fileName: string): string {
  if (!localIconFilePattern.test(fileName)) throw new AppError(500, 'INVALID_BOOKMARK_ICON_PATH', '书签图标文件名无效')
  return join(iconRoot, fileName)
}

export class BookmarkStore {
  private readonly root: string
  private readonly indexPath: string
  private readonly iconRoot: string
  private mutationQueue: Promise<void> = Promise.resolve()

  constructor(projectRoot = process.cwd()) {
    this.root = join(projectRoot, 'Doc', 'bookmarks')
    this.indexPath = join(this.root, 'index.json')
    this.iconRoot = join(this.root, 'icons')
  }

  async init(): Promise<void> {
    await mkdir(this.iconRoot, { recursive: true })
    if (!(await exists(this.indexPath))) {
      await writeJson(this.indexPath, {
        schemaVersion: 1,
        revision: 1,
        updatedAt: now(),
        layout: 'grid',
        items: [],
      } satisfies BookmarkLibrary)
    }
  }

  private mutate<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.mutationQueue.then(operation, operation)
    this.mutationQueue = next.then(() => undefined, () => undefined)
    return next
  }

  private async readLibrary(): Promise<BookmarkLibrary> {
    const library = await readJson<BookmarkLibrary>(this.indexPath)
    if (library.schemaVersion !== 1 || !Array.isArray(library.items)) throw new AppError(500, 'INVALID_BOOKMARK_DATA', '书签数据格式无效')
    return { ...library, layout: ['list', 'grid', 'large'].includes(library.layout) ? library.layout : 'grid' }
  }

  async getLibrary(): Promise<BookmarkLibrary> {
    await this.mutationQueue
    return this.readLibrary()
  }

  async create(input: BookmarkCreateInput): Promise<BookmarkLibrary> {
    return this.mutate(async () => {
      const library = await this.readLibrary()
      validateRevision(library.revision, input.revision, library)
      const timestamp = now()
      library.items.unshift({
        id: randomUUID(),
        title: validateTitle(input.title),
        url: normalizeBookmarkUrl(input.url),
        favorite: false,
        icon: { kind: 'builtin', name: validateBuiltinIcon(input.builtinIcon) },
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      library.revision += 1
      library.updatedAt = timestamp
      await writeJson(this.indexPath, library)
      return library
    })
  }

  async update(id: string, input: BookmarkUpdateInput): Promise<BookmarkLibrary> {
    return this.mutate(async () => {
      const library = await this.readLibrary()
      validateRevision(library.revision, input.revision, library)
      const item = library.items.find((entry) => entry.id === validateId(id))
      if (!item) throw new AppError(404, 'BOOKMARK_NOT_FOUND', '书签不存在')
      if (typeof input.favorite !== 'boolean') throw new AppError(400, 'INVALID_BOOKMARK_FAVORITE', '书签收藏状态无效')
      const previousLocalIcon = item.icon.kind === 'local' ? item.icon.fileName : undefined
      item.title = validateTitle(input.title)
      item.url = normalizeBookmarkUrl(input.url)
      item.favorite = input.favorite
      if (input.builtinIcon !== undefined) item.icon = { kind: 'builtin', name: validateBuiltinIcon(input.builtinIcon) }
      item.updatedAt = now()
      library.revision += 1
      library.updatedAt = item.updatedAt
      await writeJson(this.indexPath, library)
      if (previousLocalIcon && item.icon.kind === 'builtin') await rm(localIconPath(this.iconRoot, previousLocalIcon), { force: true }).catch(() => undefined)
      return library
    })
  }

  async delete(id: string, revision: number): Promise<BookmarkLibrary> {
    return this.mutate(async () => {
      const library = await this.readLibrary()
      validateRevision(library.revision, revision, library)
      const index = library.items.findIndex((entry) => entry.id === validateId(id))
      if (index < 0) throw new AppError(404, 'BOOKMARK_NOT_FOUND', '书签不存在')
      const [item] = library.items.splice(index, 1)
      library.revision += 1
      library.updatedAt = now()
      await writeJson(this.indexPath, library)
      if (item.icon.kind === 'local') await rm(localIconPath(this.iconRoot, item.icon.fileName), { force: true }).catch(() => undefined)
      return library
    })
  }

  async updateLayout(layout: BookmarkLayout, revision: number): Promise<BookmarkLibrary> {
    return this.mutate(async () => {
      if (layout !== 'list' && layout !== 'grid' && layout !== 'large') throw new AppError(400, 'INVALID_BOOKMARK_LAYOUT', '不支持的书签布局')
      const library = await this.readLibrary()
      validateRevision(library.revision, revision, library)
      library.layout = layout
      library.revision += 1
      library.updatedAt = now()
      await writeJson(this.indexPath, library)
      return library
    })
  }

  async uploadIcon(id: string, stream: Readable, metadata: BookmarkIconUpload): Promise<BookmarkLibrary> {
    const type = iconTypes[metadata.mimeType]
    if (!type) throw new AppError(415, 'BOOKMARK_ICON_TYPE_UNSUPPORTED', '本地图标只支持 PNG、JPEG、WebP、GIF 或 ICO')
    if (!Number.isSafeInteger(metadata.size) || metadata.size <= 0 || metadata.size > BOOKMARK_ICON_MAX_UPLOAD_SIZE) throw new AppError(413, 'BOOKMARK_ICON_TOO_LARGE', '本地图标不能超过 2 MiB')
    const safeId = validateId(id)
    const temporary = join(this.iconRoot, `upload.tmp-${randomUUID()}`)
    let received = 0
    try {
      const counter = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          received += chunk.byteLength
          if (received > metadata.size || received > BOOKMARK_ICON_MAX_UPLOAD_SIZE) return callback(new AppError(413, 'BOOKMARK_ICON_TOO_LARGE', '本地图标大小超过声明值或限制'))
          callback(null, chunk)
        },
      })
      await pipeline(stream, counter, createWriteStream(temporary, { flags: 'wx' }))
      if (received !== metadata.size) throw new AppError(400, 'SIZE_MISMATCH', '本地图标上传不完整')
      return await this.mutate(async () => {
        const library = await this.readLibrary()
        validateRevision(library.revision, metadata.revision, library)
        const item = library.items.find((entry) => entry.id === safeId)
        if (!item) throw new AppError(404, 'BOOKMARK_NOT_FOUND', '书签不存在')
        const fileName = `${item.id}-${randomUUID()}.${type.extension}`
        const target = join(this.iconRoot, fileName)
        const previousLocalIcon = item.icon.kind === 'local' ? item.icon.fileName : undefined
        let moved = false
        let committed = false
        try {
          await rename(temporary, target)
          moved = true
          const updatedAt = now()
          item.icon = { kind: 'local', fileName, mimeType: type.mimeType, size: received, updatedAt }
          item.updatedAt = updatedAt
          library.revision += 1
          library.updatedAt = updatedAt
          await writeJson(this.indexPath, library)
          committed = true
          if (previousLocalIcon) await rm(localIconPath(this.iconRoot, previousLocalIcon), { force: true }).catch(() => undefined)
          return library
        } finally {
          if (moved && !committed) await rm(target, { force: true }).catch(() => undefined)
        }
      })
    } finally {
      await rm(temporary, { force: true }).catch(() => undefined)
    }
  }

  async getIcon(id: string): Promise<{ path: string; mimeType: string; updatedAt: string }> {
    const library = await this.getLibrary()
    const item = library.items.find((entry) => entry.id === validateId(id))
    if (!item) throw new AppError(404, 'BOOKMARK_NOT_FOUND', '书签不存在')
    if (item.icon.kind !== 'local') throw new AppError(404, 'BOOKMARK_ICON_NOT_FOUND', '书签没有本地图标')
    const path = localIconPath(this.iconRoot, item.icon.fileName)
    if (!(await exists(path))) throw new AppError(404, 'BOOKMARK_ICON_MISSING', '书签图标文件不存在')
    return { path, mimeType: item.icon.mimeType, updatedAt: item.icon.updatedAt }
  }
}
