import { Hono } from 'hono'
import type { AppContext } from '../app.js'

export const healthRoutes = new Hono<AppContext>()

healthRoutes.get('/health', (c) => {
  c.get('logger').debug('system', 'health check')
  return c.json({ ok: true })
})
