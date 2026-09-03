import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseServerStatusPayload, ServerStatusStore } from './serverStatusStore.js'

const tempRoots: string[] = []

afterEach(async () => {
  vi.unstubAllGlobals()
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function createStore(): Promise<{ root: string; store: ServerStatusStore }> {
  const root = await mkdtemp(join(tmpdir(), 'baytools-server-status-'))
  tempRoots.push(root)
  const store = new ServerStatusStore(root)
  await store.init()
  return { root, store }
}

describe('server status payload', () => {
  it('validates the array and normalizes supported fields', () => {
    expect(parseServerStatusPayload([{
      server_id: ' yace-1 ',
      running_status: " <span style='color: green;'>已启动</span> ",
      season_days: { S3: 4.9, S4: 0 },
      config_branch: 'test',
    }])).toEqual([{
      server_id: 'yace-1',
      running_status: '已启动',
      season_days: { S3: 4, S4: 0 },
      config_branch: 'test',
      code_branch: '',
    }])
    expect(() => parseServerStatusPayload({})).toThrow('顶层必须是数组')
    expect(() => parseServerStatusPayload([{ server_id: '', season_days: {} }])).toThrow('server_id')
    expect(() => parseServerStatusPayload([{ server_id: 'a', running_status: 1, season_days: {} }])).toThrow('running_status')
    expect(() => parseServerStatusPayload([{ server_id: 'a', season_days: null }])).toThrow('season_days')
    expect(() => parseServerStatusPayload([{ server_id: 'a', season_days: [] }])).toThrow('season_days')
    expect(parseServerStatusPayload([{ server_id: 'a', season_days: '' }])[0]?.season_days).toEqual({})
    expect(parseServerStatusPayload([{ server_id: 'a', season_days: '   ' }])[0]?.season_days).toEqual({})
    expect(() => parseServerStatusPayload([{ server_id: 'a', season_days: 'S3' }])).toThrow('season_days')
    expect(() => parseServerStatusPayload([{ server_id: 'a', season_days: { season3: 2 } }])).toThrow('格式无效')
    expect(() => parseServerStatusPayload([{ server_id: 'a', season_days: { S3: -1 } }])).toThrow('非负有限数字')
  })

  it('strips rich text tags from running status', () => {
    expect(parseServerStatusPayload([{
      server_id: 'a',
      running_status: "<span style='color: red;'>未启动</span>",
      season_days: {},
    }])[0]?.running_status).toBe('未启动')
  })
})

describe('server status store', () => {
  it('persists a successful sync and reloads its cache', async () => {
    const { root, store } = await createStore()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([{
      server_id: 'yace-1', running_status: '已启动', season_days: { S3: 4 }, config_branch: 'test', code_branch: 'release/1.0', ignored: '<b>ignored</b>',
    }]), { status: 200 })))

    const synced = await store.sync('https://example.test/status.json')
    expect(synced).toMatchObject({ url: 'https://example.test/status.json', revision: 2 })
    expect(synced.servers).toEqual([{
      server_id: 'yace-1', running_status: '已启动', season_days: { S3: 4 }, config_branch: 'test', code_branch: 'release/1.0',
    }])

    const reloaded = new ServerStatusStore(root)
    await reloaded.init()
    expect(await reloaded.getState()).toEqual(synced)
  })

  it('rejects repeated syncs during cooldown', async () => {
    const { store } = await createStore()
    vi.stubGlobal('fetch', vi.fn(async () => new Response('[]', { status: 200 })))
    await store.sync('https://example.test/status.json')
    await expect(store.sync('https://example.test/status.json')).rejects.toMatchObject({
      statusCode: 429,
      code: 'SERVER_STATUS_SYNC_COOLDOWN',
    })
  })

  it('normalizes rich status text already stored in the cache', async () => {
    const { root, store } = await createStore()
    await writeFile(join(root, 'Doc', 'server-status', 'state.json'), JSON.stringify({
      schemaVersion: 1,
      updatedAt: '2026-09-03T00:00:00.000Z',
      revision: 2,
      url: 'https://example.test/status.json',
      servers: [{
        server_id: 'cached-1',
        running_status: "<span style='color: red;'>未启动</span>",
        season_days: {},
        config_branch: '',
        code_branch: '',
      }],
    }))

    expect((await store.getState()).servers[0]?.running_status).toBe('未启动')
  })

  it('reports download and URL errors without replacing the cache', async () => {
    const { root, store } = await createStore()
    await expect(store.sync('file:///tmp/status.json')).rejects.toMatchObject({ code: 'INVALID_SERVER_STATUS_URL' })
    await expect(store.sync('https://user:secret@example.test/status.json')).rejects.toMatchObject({ code: 'INVALID_SERVER_STATUS_URL' })

    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([{
      server_id: 'cached-1', running_status: '已启动', season_days: { S3: 7 }, config_branch: 'config/cache', code_branch: 'code/cache',
    }]), { status: 200 })))
    const cached = await store.sync('https://example.test/cached-status.json')

    const reloaded = new ServerStatusStore(root)
    await reloaded.init()
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    await expect(reloaded.sync('https://example.test/status.json')).rejects.toMatchObject({
      statusCode: 502,
      code: 'SERVER_STATUS_SYNC_FAILED',
    })
    expect(await reloaded.getState()).toEqual(cached)
  })
})
