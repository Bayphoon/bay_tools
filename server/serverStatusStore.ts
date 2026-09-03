import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdir } from 'node:fs/promises'
import type { ServerStatusRecord, ServerStatusState } from '../shared/types.js'
import { AppError } from './errors.js'
import { exists, readJson, writeJson } from './filesystem.js'

const now = () => new Date().toISOString()
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024
export const SERVER_STATUS_SYNC_COOLDOWN_MS = 10_000

function normalizeUrl(input: string): URL {
  const value = input.trim()
  if (!value) throw new AppError(400, 'SERVER_STATUS_URL_REQUIRED', '请输入服务器状态数据链接')
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new AppError(400, 'INVALID_SERVER_STATUS_URL', '服务器状态数据链接格式无效')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new AppError(400, 'INVALID_SERVER_STATUS_URL', '服务器状态数据链接只支持 HTTP 或 HTTPS')
  }
  if (url.username || url.password) {
    throw new AppError(400, 'INVALID_SERVER_STATUS_URL', '服务器状态数据链接不能包含账号或密码')
  }
  return url
}

function stringField(record: Record<string, unknown>, field: string, index: number): string {
  const value = record[field]
  if (value === undefined || value === null) return ''
  if (typeof value !== 'string') {
    throw new AppError(422, 'INVALID_SERVER_STATUS_DATA', `第 ${index + 1} 条服务器数据的 ${field} 必须是字符串`)
  }
  return value
}

function normalizeRunningStatus(value: string): string {
  return value.replace(/<[^>]*>/g, '').trim()
}

function parseSeasonDays(value: unknown, index: number): Record<string, number> {
  if (typeof value !== 'object' || value === null || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new AppError(422, 'INVALID_SERVER_STATUS_DATA', `第 ${index + 1} 条服务器数据的 season_days 必须是普通对象`)
  }
  const seasons: Record<string, number> = {}
  for (const [key, day] of Object.entries(value)) {
    const seasonNumber = /^S\d+$/.test(key) ? Number(key.slice(1)) : Number.NaN
    if (!Number.isSafeInteger(seasonNumber) || seasonNumber < 0) {
      throw new AppError(422, 'INVALID_SERVER_STATUS_DATA', `第 ${index + 1} 条服务器数据的赛季键 ${key} 格式无效，应为 S 加数字`)
    }
    if (typeof day !== 'number' || !Number.isFinite(day) || day < 0) {
      throw new AppError(422, 'INVALID_SERVER_STATUS_DATA', `第 ${index + 1} 条服务器数据的 ${key} 天数必须是非负有限数字`)
    }
    seasons[`S${seasonNumber}`] = Math.floor(day)
  }
  return seasons
}

export function parseServerStatusPayload(payload: unknown): ServerStatusRecord[] {
  if (!Array.isArray(payload)) {
    throw new AppError(422, 'INVALID_SERVER_STATUS_DATA', '服务器状态 JSON 的顶层必须是数组')
  }
  return payload.map((value, index) => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new AppError(422, 'INVALID_SERVER_STATUS_DATA', `第 ${index + 1} 条服务器数据必须是对象`)
    }
    const record = value as Record<string, unknown>
    const serverId = stringField(record, 'server_id', index).trim()
    if (!serverId) {
      throw new AppError(422, 'INVALID_SERVER_STATUS_DATA', `第 ${index + 1} 条服务器数据缺少有效的 server_id`)
    }
    return {
      server_id: serverId,
      running_status: normalizeRunningStatus(stringField(record, 'running_status', index)),
      season_days: parseSeasonDays(
        record.season_days === undefined || (typeof record.season_days === 'string' && record.season_days.trim() === '')
          ? {}
          : record.season_days,
        index,
      ),
      config_branch: stringField(record, 'config_branch', index),
      code_branch: stringField(record, 'code_branch', index),
    }
  })
}

export class ServerStatusStore {
  private readonly statePath: string
  private syncing = false
  private syncFinishedAt = 0

  constructor(root = resolve(dirname(fileURLToPath(import.meta.url)), '..')) {
    this.statePath = join(root, 'Doc', 'server-status', 'state.json')
  }

  async init(): Promise<void> {
    await mkdir(dirname(this.statePath), { recursive: true })
    if (!(await exists(this.statePath))) {
      await writeJson(this.statePath, {
        schemaVersion: 1,
        updatedAt: now(),
        revision: 1,
        url: '',
        servers: [],
      } satisfies ServerStatusState)
    }
  }

  async getState(): Promise<ServerStatusState> {
    const state = await readJson<ServerStatusState>(this.statePath)
    return {
      ...state,
      servers: state.servers.map((server) => ({
        ...server,
        running_status: normalizeRunningStatus(server.running_status),
      })),
    }
  }

  async sync(inputUrl: string): Promise<ServerStatusState> {
    const requestedUrl = normalizeUrl(inputUrl)
    const retryAfterMs = Math.max(0, SERVER_STATUS_SYNC_COOLDOWN_MS - (Date.now() - this.syncFinishedAt))
    if (this.syncing || retryAfterMs > 0) {
      const effectiveRetryAfterMs = this.syncing ? SERVER_STATUS_SYNC_COOLDOWN_MS : retryAfterMs
      throw new AppError(429, 'SERVER_STATUS_SYNC_COOLDOWN', `同步过于频繁，请在 ${Math.max(1, Math.ceil(effectiveRetryAfterMs / 1000))} 秒后重试`, {
        retryAfterMs: effectiveRetryAfterMs,
      })
    }

    this.syncing = true
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 30_000)
    try {
      let response: Response
      try {
        response = await fetch(requestedUrl, { signal: controller.signal, redirect: 'follow' })
      } catch (error) {
        if ((error as Error).name === 'AbortError') {
          throw new AppError(504, 'SERVER_STATUS_SYNC_TIMEOUT', '下载超时，请检查链接或网络')
        }
        throw new AppError(502, 'SERVER_STATUS_SYNC_FAILED', `下载失败：${error instanceof Error ? error.message : '网络错误'}`)
      }
      if (!response.ok) {
        throw new AppError(502, 'SERVER_STATUS_SYNC_FAILED', `服务器返回 ${response.status} ${response.statusText}`)
      }
      normalizeUrl(response.url || requestedUrl.toString())
      const contentLength = Number(response.headers.get('content-length') ?? 0)
      if (contentLength > MAX_RESPONSE_BYTES) {
        throw new AppError(413, 'SERVER_STATUS_RESPONSE_TOO_LARGE', '服务器状态数据不能超过 8 MiB')
      }
      let buffer: Buffer
      try {
        buffer = Buffer.from(await response.arrayBuffer())
      } catch (error) {
        if ((error as Error).name === 'AbortError') {
          throw new AppError(504, 'SERVER_STATUS_SYNC_TIMEOUT', '下载超时，请检查链接或网络')
        }
        throw new AppError(502, 'SERVER_STATUS_SYNC_FAILED', `读取服务器响应失败：${error instanceof Error ? error.message : '网络错误'}`)
      }
      if (buffer.byteLength > MAX_RESPONSE_BYTES) {
        throw new AppError(413, 'SERVER_STATUS_RESPONSE_TOO_LARGE', '服务器状态数据不能超过 8 MiB')
      }
      let payload: unknown
      try {
        payload = JSON.parse(buffer.toString('utf8').replace(/^\uFEFF/, ''))
      } catch {
        throw new AppError(422, 'INVALID_SERVER_STATUS_JSON', '服务器返回的内容不是有效 JSON')
      }
      const servers = parseServerStatusPayload(payload)
      const previous = await this.getState()
      const syncedAt = now()
      const state: ServerStatusState = {
        schemaVersion: 1,
        updatedAt: syncedAt,
        revision: previous.revision + 1,
        url: requestedUrl.toString(),
        lastSyncedAt: syncedAt,
        servers,
      }
      await writeJson(this.statePath, state)
      return state
    } finally {
      clearTimeout(timeout)
      this.syncing = false
      this.syncFinishedAt = Date.now()
    }
  }
}
