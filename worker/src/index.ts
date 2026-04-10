import { buildApp } from './app.js'
import type { Env } from './env.js'

const app = buildApp()

export default {
  fetch(req: Request, env: Env, ctx: ExecutionContext) {
    return app.fetch(req, env, ctx)
  },
} satisfies ExportedHandler<Env>
