import { Hono } from 'hono'
import type { AppContext } from '../app.js'
import { SCORE_ANALYSIS_MODELS, AI_HANDSHAKE_PROMPT } from '../config/prompts.js'

export interface VersionResponse {
  workerVersion: string
  schemaVersion: number
  minClientVersion: string
  gitSha: string | null
  builtAt: string
  latestSquadVersion: string | null
  /** Which Gemini model is active, or null if AI is not configured. */
  activeAiModel: string | null
}

/**
 * Three-axis version info surfaced to the client. The client calls this on
 * startup and refuses to continue if its version is below `minClientVersion`
 * (Phase 0 scaffold: banner only, no hard stop).
 *
 * Also performs a lightweight AI handshake: tries each model in the fallback
 * chain with a trivial prompt (no image) and reports the first one that
 * responds. This lets the client know whether AI features are available and
 * which model is active. The handshake result is NOT cached — it runs once
 * per client boot so cold-start latency is acceptable.
 */
export const versionRoutes = new Hono<AppContext>()

versionRoutes.get('/version', async (c) => {
  const env = c.env
  const latestSquadVersion = (await c.get('deps').squadVersions.latest())?.version ?? null

  // AI handshake — fire-and-forget style, best-effort.
  let activeAiModel: string | null = null
  const apiKey = env.GEMINI_API_KEY
  if (apiKey) {
    for (const model of SCORE_ANALYSIS_MODELS) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: AI_HANDSHAKE_PROMPT }] }],
            generationConfig: { temperature: 0, maxOutputTokens: 20 },
          }),
        })
        if (res.ok) {
          activeAiModel = model
          c.get('logger').info('system', 'AI handshake succeeded', { model })
          break
        }
        c.get('logger').warn('system', 'AI handshake model unavailable', {
          model,
          status: res.status,
        })
      } catch (err) {
        c.get('logger').warn('system', 'AI handshake error', {
          model,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }
    if (!activeAiModel) {
      c.get('logger').warn('system', 'AI handshake failed for all models')
    }
  } else {
    c.get('logger').info('system', 'AI not configured (no GEMINI_API_KEY)')
  }

  const body: VersionResponse = {
    workerVersion: env.WORKER_VERSION,
    schemaVersion: Number.parseInt(env.SCHEMA_VERSION, 10),
    minClientVersion: env.MIN_CLIENT_VERSION,
    gitSha: env.GIT_SHA ?? null,
    builtAt: new Date().toISOString(),
    latestSquadVersion,
    activeAiModel,
  }
  c.get('logger').info('system', 'version requested', { ...body })
  return c.json(body)
})
