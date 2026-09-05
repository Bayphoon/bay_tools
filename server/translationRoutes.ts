import { Readable } from 'node:stream'
import type { FastifyInstance } from 'fastify'
import type { TranslationEvent } from '../shared/translation.js'
import { AppError } from './errors.js'
import { TranslationStore, validateTranslation } from './translationStore.js'

export function registerTranslationRoutes(app: FastifyInstance, store: TranslationStore): void {
  app.register(async (scope) => {
    scope.addHook('onRequest', async (_request, reply) => { reply.header('cache-control', 'no-store') })
    scope.setErrorHandler((error, _request, reply) => {
      // Parser/provider errors can contain request snippets; never echo them near credentials.
      if (error instanceof AppError) return reply.code(error.statusCode).send({ error: error.message, code: error.code })
      const status = (error as { statusCode?: number }).statusCode
      return reply.code(status && status >= 400 && status < 500 ? status : 500).send({ error: '翻译请求无法处理，请检查输入后重试', code: 'TRANSLATION_REQUEST_FAILED' })
    })
    scope.get('/api/translation/config', async () => store.getConfig())
    scope.put<{ Body: { apiKey?: unknown } }>('/api/translation/config', { bodyLimit: 4096 }, async (request) => store.saveKey(request.body?.apiKey))
    scope.delete('/api/translation/config', async () => store.deleteKey())
    scope.post('/api/translation/test', async () => store.testConnection())
    scope.get('/api/translation/history', async () => store.listHistory())
    scope.delete<{ Params: { id: string } }>('/api/translation/history/:id', async (request, reply) => {
      await store.deleteHistory(request.params.id)
      return reply.code(204).send()
    })
    scope.delete('/api/translation/history', async (_request, reply) => {
      await store.deleteHistory()
      return reply.code(204).send()
    })
    scope.post('/api/translation/translate', { bodyLimit: 128 * 1024 }, async (request, reply) => {
      const input = validateTranslation(request.body)
      const controller = new AbortController()
      const abort = () => controller.abort()
      reply.raw.once('close', abort)
      async function* stream() {
        try {
          for await (const event of store.translate(input, controller.signal)) yield `${JSON.stringify(event)}\n`
        } catch (error) {
          if (!controller.signal.aborted) {
            const failure: TranslationEvent = { type: 'error', code: error instanceof AppError ? error.code : 'TRANSLATION_FAILED', error: error instanceof AppError ? error.message : '翻译失败，请重试' }
            yield `${JSON.stringify(failure)}\n`
          }
        } finally { reply.raw.off('close', abort) }
      }
      return reply.type('application/x-ndjson; charset=utf-8').header('x-content-type-options', 'nosniff').send(Readable.from(stream()))
    })
  })
  app.addHook('onClose', async () => store.abortAll())
}
