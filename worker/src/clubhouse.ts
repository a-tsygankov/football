import { Hono } from 'hono'
import { buildApp, type AppContext } from './app.js'
import { isValidPin } from './auth/pin.js'

const preview = new Hono<AppContext>()

preview.use('*', async (context, next) => {
  const origin = context.req.header('origin')
  if (origin && origin !== new URL(context.req.url).origin) {
    return context.json({ error: 'cross_origin_request' }, 403)
  }
  if (!context.env.SESSION_SECRET || !context.env.DB || !context.env.SQUADS) {
    return context.json({ error: 'preview_unavailable' }, 503)
  }
  return next()
})

preview.post('/api/internal/*', context => context.json({ error: 'disabled_in_preview' }, 403))
preview.post('/api/rooms/:roomId/settings/*', context => context.json({ error: 'disabled_in_preview' }, 403))
preview.post('/api/rooms', async (context, next) => {
  const body = await context.req.raw.clone().json<{ pin?: string }>().catch(() => null)
  if (!body?.pin || !isValidPin(body.pin)) {
    return context.json({ error: 'invalid_pin_format' }, 400)
  }
  return next()
})
preview.route('/', buildApp())

export default preview
