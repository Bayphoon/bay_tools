import { randomUUID } from 'node:crypto'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdir, readFile, rename, rm } from 'node:fs/promises'
import type { LanguageEntry, LanguageEntryPage, LanguageSearchMode, LanguageSource, LanguageSourceSummary } from '../shared/types.js'
import { AppError, ConflictError } from './errors.js'
import { atomicWrite, exists, readJson, writeJson } from './filesystem.js'

interface LanguageIndex {
  schemaVersion: 1
  updatedAt: string
  revision: number
  sources: LanguageSource[]
}

const now = () => new Date().toISOString()
const MAX_SOURCE_BYTES = 32 * 1024 * 1024
const PAGE_SIZE = 10
export const LANGUAGE_SYNC_COOLDOWN_MS = 10_000

function normalizeUrl(input: string): URL {
  const value = input.trim()
  if (!value) throw new AppError(400, 'LANGUAGE_URL_REQUIRED', '请输入多语言文件链接')
  let url: URL
  try {
    url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`)
  } catch {
    throw new AppError(400, 'INVALID_LANGUAGE_URL', '多语言文件链接格式无效')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new AppError(400, 'INVALID_LANGUAGE_URL', '多语言文件链接只支持 HTTP 或 HTTPS')
  }
  if (url.username || url.password) throw new AppError(400, 'INVALID_LANGUAGE_URL', '多语言文件链接不能包含账号或密码')
  return url
}

export function parseLanguageText(text: string): LanguageEntry[] {
  const entries: LanguageEntry[] = []
  const normalized = text.replace(/^\uFEFF/, '')
  for (const rawLine of normalized.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#') || line.startsWith('//')) continue
    const separator = line.indexOf('=')
    if (separator <= 0) continue
    const key = line.slice(0, separator).trim()
    if (!key) continue
    entries.push({ key, content: line.slice(separator + 1).trim() })
  }
  return entries
}

export function paginateLanguageEntries(entries: LanguageEntry[], search: string, page: number, mode: LanguageSearchMode = 'fuzzy'): LanguageEntryPage {
  const needle = search.trim().toLocaleLowerCase()
  const filtered = needle
    ? entries.filter((entry) => {
      const key = entry.key.toLocaleLowerCase()
      const content = entry.content.toLocaleLowerCase()
      return mode === 'exact' ? key === needle || content === needle : key.includes(needle) || content.includes(needle)
    })
    : entries
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(Math.max(1, Number.isFinite(page) ? Math.floor(page) : 1), totalPages)
  return {
    items: filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    total: filtered.length,
    page: safePage,
    pageSize: PAGE_SIZE,
    totalPages,
  }
}

function summary(source: LanguageSource): LanguageSourceSummary {
  const { id, title, url, fileName, createdAt, updatedAt, lastSyncedAt, entryCount } = source
  return { id, title, url, fileName, createdAt, updatedAt, lastSyncedAt, entryCount }
}

export class LanguageStore {
  private readonly indexPath: string
  private readonly cacheRoot: string
  private readonly parsedCache = new Map<string, { updatedAt: string; entries: LanguageEntry[] }>()
  private readonly activeSyncs = new Set<string>()
  private readonly syncStartedAt = new Map<string, number>()

  constructor(root = resolve(dirname(fileURLToPath(import.meta.url)), '..')) {
    const languageRoot = join(root, 'Doc', 'language')
    this.indexPath = join(languageRoot, 'index.json')
    this.cacheRoot = join(languageRoot, 'cache')
  }

  clearCache(): void {
    this.parsedCache.clear()
  }

  async init(): Promise<void> {
    await mkdir(this.cacheRoot, { recursive: true })
    if (!(await exists(this.indexPath))) {
      await writeJson(this.indexPath, { schemaVersion: 1, updatedAt: now(), revision: 1, sources: [] } satisfies LanguageIndex)
    }
  }

  private cachePath(id: string): string {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new AppError(400, 'INVALID_ID', '多语言页签 ID 无效')
    return join(this.cacheRoot, `${id}.txt`)
  }

  private async index(): Promise<LanguageIndex> {
    return readJson<LanguageIndex>(this.indexPath)
  }

  async listSources(): Promise<LanguageSourceSummary[]> {
    return (await this.index()).sources.map(summary)
  }

  async createSource(): Promise<LanguageSource> {
    const createdAt = now()
    const source: LanguageSource = {
      schemaVersion: 1,
      id: randomUUID(),
      title: '未命名语种',
      url: '',
      createdAt,
      updatedAt: createdAt,
      entryCount: 0,
      revision: 1,
      favorites: [],
    }
    const index = await this.index()
    index.sources.push(source)
    index.revision += 1
    index.updatedAt = now()
    await writeJson(this.indexPath, index)
    return source
  }

  async getSource(id: string): Promise<LanguageSource> {
    const source = (await this.index()).sources.find((item) => item.id === id)
    if (!source) throw new AppError(404, 'NOT_FOUND', '多语言页签不存在')
    return source
  }

  async deleteSource(id: string): Promise<void> {
    const index = await this.index()
    const position = index.sources.findIndex((source) => source.id === id)
    if (position < 0) throw new AppError(404, 'NOT_FOUND', '多语言页签不存在')
    const cachePath = this.cachePath(id)
    const stagedPath = `${cachePath}.deleting-${randomUUID()}`
    const hasCache = await exists(cachePath)
    if (hasCache) await rename(cachePath, stagedPath)
    try {
      index.sources.splice(position, 1)
      index.revision += 1
      index.updatedAt = now()
      await writeJson(this.indexPath, index)
    } catch (error) {
      if (hasCache && await exists(stagedPath)) await rename(stagedPath, cachePath)
      throw error
    }
    if (hasCache) await rm(stagedPath, { force: true })
    this.parsedCache.delete(id)
    this.activeSyncs.delete(id)
    this.syncStartedAt.delete(id)
  }

  private async updateSource(id: string, updater: (source: LanguageSource) => LanguageSource): Promise<LanguageSource> {
    const index = await this.index()
    const position = index.sources.findIndex((source) => source.id === id)
    if (position < 0) throw new AppError(404, 'NOT_FOUND', '多语言页签不存在')
    const updated = updater(index.sources[position]!)
    index.sources[position] = updated
    index.revision += 1
    index.updatedAt = now()
    await writeJson(this.indexPath, index)
    return updated
  }

  async syncSource(id: string, inputUrl: string): Promise<LanguageSource> {
    await this.getSource(id)
    const requestedUrl = normalizeUrl(inputUrl)
    const startedAt = Date.now()
    const retryAfterMs = Math.max(0, LANGUAGE_SYNC_COOLDOWN_MS - (startedAt - (this.syncStartedAt.get(id) ?? 0)))
    if (this.activeSyncs.has(id) || retryAfterMs > 0) {
      throw new AppError(429, 'LANGUAGE_SYNC_COOLDOWN', `同步过于频繁，请在 ${Math.max(1, Math.ceil(retryAfterMs / 1000))} 秒后重试`, { retryAfterMs: Math.max(1000, retryAfterMs) })
    }
    this.activeSyncs.add(id)
    this.syncStartedAt.set(id, startedAt)
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 30_000)
    try {
      let response: Response
      try {
        response = await fetch(requestedUrl, { signal: controller.signal, redirect: 'follow' })
      } catch (error) {
        if ((error as Error).name === 'AbortError') throw new AppError(504, 'LANGUAGE_SYNC_TIMEOUT', '下载超时，请检查链接或网络')
        throw new AppError(502, 'LANGUAGE_SYNC_FAILED', `下载失败：${error instanceof Error ? error.message : '网络错误'}`)
      }
      if (!response.ok) throw new AppError(502, 'LANGUAGE_SYNC_FAILED', `服务器返回 ${response.status} ${response.statusText}`)
      const contentLength = Number(response.headers.get('content-length') ?? 0)
      if (contentLength > MAX_SOURCE_BYTES) throw new AppError(413, 'LANGUAGE_FILE_TOO_LARGE', '多语言文件不能超过 32 MiB')
      const buffer = Buffer.from(await response.arrayBuffer())
      if (buffer.byteLength > MAX_SOURCE_BYTES) throw new AppError(413, 'LANGUAGE_FILE_TOO_LARGE', '多语言文件不能超过 32 MiB')
      const text = buffer.toString('utf8').replace(/^\uFEFF/, '')
      const entries = parseLanguageText(text)
      if (!entries.length) throw new AppError(422, 'LANGUAGE_FILE_EMPTY', '文件中没有找到有效的 key=内容 条目')

      const finalUrl = normalizeUrl(response.url || requestedUrl.toString())
      const rawFileName = basename(finalUrl.pathname)
      let fileName = rawFileName || 'language.txt'
      try { fileName = decodeURIComponent(fileName) } catch { /* 保留服务器返回的原始文件名 */ }
      const syncedAt = now()
      await atomicWrite(this.cachePath(id), text)
      this.parsedCache.set(id, { updatedAt: syncedAt, entries })
      const entryMap = new Map(entries.map((entry) => [entry.key, entry.content]))
      return await this.updateSource(id, (source) => ({
        ...source,
        title: fileName,
        url: requestedUrl.toString(),
        fileName,
        lastSyncedAt: syncedAt,
        updatedAt: syncedAt,
        entryCount: entries.length,
        revision: source.revision + 1,
        favorites: source.favorites.map((favorite) => ({ ...favorite, content: entryMap.get(favorite.key) ?? favorite.content })),
      }))
    } finally {
      clearTimeout(timeout)
      this.activeSyncs.delete(id)
      this.syncStartedAt.set(id, Date.now())
    }
  }

  private async entries(id: string): Promise<LanguageEntry[]> {
    const source = await this.getSource(id)
    const cached = this.parsedCache.get(id)
    if (cached && cached.updatedAt === source.lastSyncedAt) return cached.entries
    const path = this.cachePath(id)
    if (!(await exists(path))) return []
    const entries = parseLanguageText(await readFile(path, 'utf8'))
    this.parsedCache.set(id, { updatedAt: source.lastSyncedAt ?? source.updatedAt, entries })
    return entries
  }

  async searchEntries(id: string, search: string, page: number, mode: LanguageSearchMode): Promise<LanguageEntryPage> {
    return paginateLanguageEntries(await this.entries(id), search, page, mode)
  }

  async searchFavorites(id: string, search: string, page: number, mode: LanguageSearchMode): Promise<LanguageEntryPage> {
    const source = await this.getSource(id)
    return paginateLanguageEntries(source.favorites, search, page, mode)
  }

  async setFavorite(id: string, key: string, favorite: boolean, revision: number): Promise<LanguageSource> {
    const normalizedKey = key.trim()
    if (!normalizedKey) throw new AppError(400, 'LANGUAGE_KEY_REQUIRED', '多语言 key 不能为空')
    const entries = favorite ? await this.entries(id) : []
    return this.updateSource(id, (source) => {
      if (source.revision !== revision) throw new ConflictError('多语言收藏已在其他窗口中修改', source)
      const existing = source.favorites.find((item) => item.key === normalizedKey)
      let favorites = source.favorites.filter((item) => item.key !== normalizedKey)
      if (favorite) {
        const entry = entries.find((item) => item.key === normalizedKey)
        if (!entry) throw new AppError(404, 'LANGUAGE_ENTRY_NOT_FOUND', '多语言条目不存在')
        favorites = [...favorites, { ...entry, favoritedAt: existing?.favoritedAt ?? now() }]
      }
      return { ...source, favorites, revision: source.revision + 1, updatedAt: now() }
    })
  }
}
