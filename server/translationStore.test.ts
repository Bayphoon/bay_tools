import Fastify from 'fastify'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TranslationEvent, TranslationInput } from '../shared/translation.js'
import { windowsSecretProtector } from './localSecret.js'
import { registerTranslationRoutes } from './translationRoutes.js'
import { TranslationStore } from './translationStore.js'

const roots: string[] = []
const input: TranslationInput = { text: '# 你好\n```js\nconst x = 1\n```', sourceLanguage: '自动检测', targetLanguage: '英语', model: 'deepseek-v4-flash' }
const secret = 'sk-test-only-not-a-real-key'
const protector = { protect: vi.fn(async () => 'encrypted-fixture'), unprotect: vi.fn(async () => secret) }
const delta = (content: string) => ({ choices: [{ delta: { content }, finish_reason: null }] })
const stop = { choices: [{ delta: {}, finish_reason: 'stop' }] }
function streamResponse(events: unknown[], byteByByte = false): Response {
  const bytes = new TextEncoder().encode(`: keepalive\r\n\r\n${events.map((value) => `data: ${JSON.stringify(value)}\r\n\r\n`).join('')}data: [DONE]\r\n\r\n`)
  return new Response(new ReadableStream({ start(controller) {
    if (byteByByte) for (const byte of bytes) controller.enqueue(new Uint8Array([byte]))
    else controller.enqueue(bytes)
    controller.close()
  } }))
}
async function setup(fetcher = vi.fn<typeof fetch>().mockResolvedValue(streamResponse([delta('Hello'), stop])), timeoutMs?: number) {
  const root = await mkdtemp(join(tmpdir(), 'baytools-translation-'))
  roots.push(root)
  const store = new TranslationStore(root, { fetch: fetcher, protector, environmentKey: () => secret, timeoutMs })
  return { root, store, fetcher }
}
async function collect(store: TranslationStore, signal = new AbortController().signal): Promise<TranslationEvent[]> {
  const events: TranslationEvent[] = []
  for await (const event of store.translate(input, signal)) events.push(event)
  return events
}
afterEach(async () => {
  vi.clearAllMocks()
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('DeepSeek translation and local persistence', () => {
  it('streams split UTF-8/CRLF events and persists only the completed translation across store instances', async () => {
    const { root, store, fetcher } = await setup(vi.fn<typeof fetch>().mockResolvedValue(streamResponse([delta('译文😀'), stop], true)))
    const events = await collect(store)
    expect(events[0]).toEqual({ type: 'delta', text: '译文😀' })
    expect(events[1]).toMatchObject({ type: 'complete', entry: { text: input.text, translation: '译文😀' } })
    const [url, request] = fetcher.mock.calls[0]
    expect(url).toBe('https://api.deepseek.com/chat/completions')
    expect(request?.redirect).toBe('error')
    expect(JSON.parse(request?.body as string)).toMatchObject({ stream: true, thinking: { type: 'disabled' }, messages: [{ role: 'system' }, { role: 'user', content: input.text }] })
    expect(await new TranslationStore(root).listHistory()).toHaveLength(1)
    expect(await readFile(join(root, 'Doc/translation/history.json'), 'utf8')).not.toContain(secret)
  })

  it('saves only ciphertext and never exposes the key in configuration responses', async () => {
    const { root, store } = await setup()
    expect(await store.saveKey(secret)).toMatchObject({ configured: true, source: 'local' })
    expect(await readFile(join(root, 'Doc/secrets/deepseek.json'), 'utf8')).not.toContain(secret)
    expect(JSON.stringify(await store.getConfig())).not.toContain(secret)
    expect(await store.deleteKey()).toMatchObject({ source: 'environment', hasLocalKey: false })
  })

  it('encrypts and decrypts a synthetic key with Windows DPAPI', async () => {
    if (process.platform !== 'win32') return
    const encrypted = await windowsSecretProtector.protect(secret)
    expect(encrypted).not.toContain(secret)
    expect(await windowsSecretProtector.unprotect(encrypted)).toBe(secret)
  }, 30_000)

  it('rejects invalid input and missing keys without calling DeepSeek', async () => {
    const { root, fetcher, store } = await setup()
    for (const invalid of [{ ...input, text: ' ' }, { ...input, text: 'x'.repeat(12_001) }, { ...input, model: 'untrusted' }, { ...input, targetLanguage: 'invalid' }]) {
      await expect(store.translate(invalid, new AbortController().signal).next()).rejects.toMatchObject({ statusCode: 400 })
    }
    const noKey = new TranslationStore(root, { fetch: fetcher, environmentKey: () => undefined })
    await expect(collect(noKey)).rejects.toMatchObject({ code: 'DEEPSEEK_KEY_REQUIRED' })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it.each([401, 402, 429, 503])('sanitizes provider error %s without persisting failed requests', async (status) => {
    const { store } = await setup(vi.fn<typeof fetch>().mockResolvedValue(new Response(secret, { status })))
    const error = await collect(store).catch((value: Error) => value)
    expect(error).toMatchObject({ code: 'DEEPSEEK_REQUEST_FAILED' })
    expect(JSON.stringify(error)).not.toContain(secret)
    expect(await store.listHistory()).toEqual([])
  })

  it.each([null, 'length', 'content_filter'])('does not save incomplete or truncated output (%s)', async (reason) => {
    const { store } = await setup(vi.fn<typeof fetch>().mockResolvedValue(streamResponse([delta('partial'), { choices: [{ finish_reason: reason }] }])))
    await expect(collect(store)).rejects.toMatchObject({ code: 'TRANSLATION_INCOMPLETE' })
    expect(await store.listHistory()).toEqual([])
  })

  it('cancels upstream work and leaves no history on cancellation or timeout', async () => {
    const fetcher = vi.fn<typeof fetch>((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
    }))
    const { store } = await setup(fetcher, 80)
    const controller = new AbortController()
    const task = collect(store, controller.signal)
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce())
    controller.abort()
    await expect(task).rejects.toMatchObject({ code: 'TRANSLATION_ABORTED', message: '翻译已取消' })
    await expect(collect(store)).rejects.toMatchObject({ code: 'TRANSLATION_ABORTED', message: expect.stringContaining('超时') })
    expect(await store.listHistory()).toEqual([])
  })

  it('serializes concurrent history writes and supports deletion and clearing during a stream', async () => {
    const { store } = await setup(vi.fn<typeof fetch>().mockImplementation(async () => streamResponse([delta('Hello'), stop])))
    await Promise.all([collect(store), collect(store)])
    const entries = await store.listHistory()
    expect(entries).toHaveLength(2)
    await store.deleteHistory(entries[0].id)
    expect(await store.listHistory()).toHaveLength(1)
    const active = store.translate(input, new AbortController().signal)
    expect((await active.next()).value).toMatchObject({ type: 'delta' })
    await store.deleteHistory()
    expect((await active.next()).value).toMatchObject({ type: 'complete', warning: expect.stringContaining('未写入历史') })
    await active.return(undefined)
    expect(await store.listHistory()).toEqual([])
  })

  it('bounds history and keeps the newest completed entries', async () => {
    const { store } = await setup(vi.fn<typeof fetch>().mockImplementation(async () => streamResponse([delta('Hello'), stop])))
    for (let i = 0; i < 102; i += 1) await collect(store)
    expect(await store.listHistory()).toHaveLength(100)
  })

  it('returns a completed result with a warning when history persistence fails', async () => {
    const { store } = await setup()
    vi.spyOn(store as unknown as { addHistory: () => Promise<boolean> }, 'addHistory').mockRejectedValue(new Error('disk full'))
    const events = await collect(store)
    expect(events.at(-1)).toMatchObject({ type: 'complete', warning: expect.stringContaining('保存失败') })
  })

  it('serves NDJSON and non-cacheable history/configuration, with no API key in output', async () => {
    const { store } = await setup()
    const app = Fastify()
    registerTranslationRoutes(app, store)
    try {
      const response = await app.inject({ method: 'POST', url: '/api/translation/translate', payload: input })
      expect(response.headers['content-type']).toContain('application/x-ndjson')
      expect(response.headers['cache-control']).toBe('no-store')
      expect(response.body).not.toContain(secret)
      expect(JSON.parse(response.body.trim().split('\n').at(-1)!)).toMatchObject({ type: 'complete' })
      const config = await app.inject('/api/translation/config')
      expect(config.headers['cache-control']).toBe('no-store')
      expect(config.body).not.toContain(secret)
    } finally { await app.close() }
  })
})
