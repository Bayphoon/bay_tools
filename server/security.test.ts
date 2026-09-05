import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from './index.js'

describe('local service security boundary', () => {
  let service: FastifyInstance

  beforeAll(async () => { service = await buildApp() })
  afterAll(async () => { await service.close() })

  it('accepts the local host and rejects an untrusted host', async () => {
    const valid = await service.inject({ method: 'GET', url: '/api/session', headers: { host: '127.0.0.1:4319' } })
    expect(valid.statusCode).toBe(200)
    const denied = await service.inject({ method: 'GET', url: '/api/session', headers: { host: 'evil.example' } })
    expect(denied.statusCode).toBe(403)
    expect(denied.json().code).toBe('HOST_DENIED')
  })

  it('rejects untrusted origins and mutations without a token', async () => {
    const originDenied = await service.inject({ method: 'GET', url: '/api/settings', headers: { host: '127.0.0.1:4319', origin: 'https://evil.example' } })
    expect(originDenied.statusCode).toBe(403)
    const tokenDenied = await service.inject({ method: 'PUT', url: '/api/settings', headers: { host: '127.0.0.1:4319' }, payload: {} })
    expect(tokenDenied.statusCode).toBe(403)
    expect(tokenDenied.json().code).toBe('TOKEN_REQUIRED')
  })

  it('protects personal data mutations', async () => {
    const status = await service.inject({ method: 'GET', url: '/api/personal-data/status', headers: { host: '127.0.0.1:4319' } })
    expect(status.statusCode).toBe(200)
    expect(status.json()).toMatchObject({ eligible: expect.any(Boolean), runtimeHasData: expect.any(Boolean) })

    const denied = await service.inject({ method: 'POST', url: '/api/personal-data/sync', headers: { host: '127.0.0.1:4319' }, payload: {} })
    expect(denied.statusCode).toBe(403)
    const publishDenied = await service.inject({ method: 'POST', url: '/api/personal-data/publish', headers: { host: '127.0.0.1:4319' }, payload: { confirm: true } })
    expect(publishDenied.statusCode).toBe(403)
  })
})
