import { createServer, type ServerResponse } from 'node:http'
import { type SquadPlatform } from '@fc26/shared'
import { EA_SQUAD_TOOL_CONFIG } from './config.js'
import { fetchPremierLeaguePreview } from './ea-preview.js'

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
  'access-control-allow-headers': 'content-type',
}

const server = createServer(async (request, response) => {
  try {
    if (!request.url || !request.method) {
      sendJson(response, 400, { error: 'Bad Request', message: 'Missing request URL or method.' })
      return
    }

    if (request.method === 'OPTIONS') {
      response.writeHead(204, JSON_HEADERS)
      response.end()
      return
    }

    const requestUrl = new URL(request.url, `http://${request.headers.host ?? 'localhost'}`)
    if (request.method === 'GET' && requestUrl.pathname === '/health') {
      sendJson(response, 200, {
        ok: true,
        tool: '@fc26/squad-sync',
        mode: 'preview',
        league: EA_SQUAD_TOOL_CONFIG.leagueName,
      })
      return
    }

    if (request.method === 'GET' && requestUrl.pathname === '/api/ea/premier-league') {
      const platform = (requestUrl.searchParams.get('platform')?.trim() ||
        EA_SQUAD_TOOL_CONFIG.defaultPlatform) as SquadPlatform
      // eslint-disable-next-line no-console
      console.log(`[ea-preview] fetching ${EA_SQUAD_TOOL_CONFIG.leagueName} for ${platform}`)
      const preview = await fetchPremierLeaguePreview(fetch, platform)
      sendJson(response, 200, preview)
      return
    }

    sendJson(response, 404, { error: 'Not Found', message: 'Unknown preview route.' })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    // eslint-disable-next-line no-console
    console.error(`[ea-preview] ${message}`)
    sendJson(response, 502, { error: 'Preview Failed', message })
  }
})

server.listen(EA_SQUAD_TOOL_CONFIG.port, EA_SQUAD_TOOL_CONFIG.host, () => {
  // eslint-disable-next-line no-console
  console.log(
    `[ea-preview] listening on http://${EA_SQUAD_TOOL_CONFIG.host}:${EA_SQUAD_TOOL_CONFIG.port}`,
  )
})

function sendJson(
  response: ServerResponse,
  statusCode: number,
  payload: unknown,
): void {
  response.writeHead(statusCode, JSON_HEADERS)
  response.end(JSON.stringify(payload))
}
