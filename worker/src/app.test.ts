import { describe, expect, it } from 'vitest'
import { buildApp } from './app.js'
import type { Env } from './env.js'
import { LOG_HEADER } from '@fc26/shared/logger'

const env: Env = {
  WORKER_VERSION: '0.1.0-test',
  SCHEMA_VERSION: '1',
  MIN_CLIENT_VERSION: '0.1.0',
  SESSION_SECRET: 'test-session-secret',
}

function execCtx(): ExecutionContext {
  return {
    waitUntil: () => undefined,
    passThroughOnException: () => undefined,
    props: {},
  } as unknown as ExecutionContext
}

describe('worker scaffold', () => {
  const app = buildApp()

  it('GET /api/health returns ok', async () => {
    const res = await app.fetch(
      new Request('http://localhost/api/health'),
      env,
      execCtx(),
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })

  it('GET /api/version returns the three version axes', async () => {
    const res = await app.fetch(
      new Request('http://localhost/api/version'),
      env,
      execCtx(),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.workerVersion).toBe('0.1.0-test')
    expect(body.schemaVersion).toBe(1)
    expect(body.minClientVersion).toBe('0.1.0')
  })

  it('attaches a log header to every response', async () => {
    const res = await app.fetch(
      new Request('http://localhost/api/health'),
      env,
      execCtx(),
    )
    expect(res.headers.get(LOG_HEADER)).toBeTruthy()
  })

  it('returns 404 JSON for unknown routes', async () => {
    const res = await app.fetch(
      new Request('http://localhost/api/nope'),
      env,
      execCtx(),
    )
    expect(res.status).toBe(404)
  })
})
