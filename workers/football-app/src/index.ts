/**
 * Front door for the web client.
 *
 * Serves the built client from [assets] and forwards `/api/*` to the API
 * Worker over a service binding, so the browser only ever talks to one origin.
 *
 * Why this exists: the client used to be told the API's absolute URL at build
 * time via VITE_API_BASE. When that variable was unset the base compiled to
 * '', the client called its own origin, and every request 404'd against the
 * static assets — a green deploy and a dead app. Same-origin removes the
 * variable, and with it that entire failure mode, plus:
 *
 *   * no CORS between client and API
 *   * session cookies are same-origin, so SameSite=Lax works without the
 *     workarounds a cross-origin setup needs
 *
 * Service bindings are Worker-to-Worker calls inside Cloudflare's network:
 * no public hop, no DNS, no TLS handshake per request.
 */
export interface Env {
  /** The API Worker (fc26-worker), via the [[services]] binding. */
  API: Fetcher
  /** The built client in ./site, via the [assets] binding. */
  ASSETS: Fetcher
}

/**
 * Requests matching a static asset never reach this script — Cloudflare
 * serves those directly. So in practice this runs for `/api/*` and for paths
 * that match no asset.
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname.startsWith('/api/')) {
      // Forwarded whole, so method, headers, body, cookies and the correlation
      // header all survive. The API Worker sees the original URL.
      return env.API.fetch(request)
    }

    // Anything else is an asset lookup. Falls through to the assets binding,
    // which 404s for genuinely unknown paths.
    return env.ASSETS.fetch(request)
  },
}
