import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { API_PATTERN, IMMUTABLE_SQUAD_PATTERN } from './src/lib/swCacheRules.js'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf-8')) as {
  version: string
}

// GitHub Pages project sites are served from /<repo>/, not /.
// Keep this in sync with the repository name. The service worker's scope and
// its offline navigation fallback are both derived from it below, so a change
// here moves them too.
const BASE = '/football/'

export default defineConfig({
  base: BASE,
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // 'prompt', not 'autoUpdate': a game night is a long-lived tab and a
      // silent takeover mid-bet is worse than a slightly stale bundle. The
      // waiting worker surfaces as a banner (see src/lib/swUpdate.ts).
      registerType: 'prompt',
      // main.tsx imports `virtual:pwa-register` itself so registration can
      // feed the banner; nothing should be injected into index.html.
      injectRegister: null,
      // public/manifest.json stays the single source of the installed
      // identity — name, icons, theme colour. Generating a second manifest
      // here would risk silently re-identifying already-installed apps.
      manifest: false,
      workbox: {
        // The app shell. Sourcemaps (.map) are deliberately absent: they are
        // large and only ever wanted by a devtools session that has network.
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}', 'manifest.json'],
        // Offline navigations fall back to the precached shell. Without the
        // denylist this would also swallow /api requests, which must fail
        // honestly rather than resolve to a page of HTML.
        navigateFallback: `${BASE}index.html`,
        navigateFallbackDenylist: [/^\/api\//],
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            // Squad data is immutable per version by construction, so it is
            // served from cache and revalidated behind the gamer's back.
            // What counts as immutable is defined and tested in
            // src/lib/swCacheRules.ts.
            urlPattern: IMMUTABLE_SQUAD_PATTERN,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'fc26-squads',
              expiration: { maxEntries: 64, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            // Everything else behind /api is live state — rooms, bets, the
            // running game, the version floor. Serving any of it from cache
            // would show a gamer a scoreboard that is quietly wrong, so this
            // is never cached, not even as a fallback.
            urlPattern: API_PATTERN,
            handler: 'NetworkOnly',
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: { '@': resolve(__dirname, 'src') },
  },
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __GIT_SHA__: JSON.stringify(process.env.GIT_SHA ?? 'dev'),
    __BUILT_AT__: JSON.stringify(new Date().toISOString()),
  },
  server: {
    // host: true binds to 0.0.0.0 so phones on the same Wi-Fi can hit us at
    // http://<LAN-IP>:<port>. Vite also prints the Network URL on startup.
    host: true,
    // Honor PORT env var when the launcher assigns a free port (autoPort),
    // otherwise fall back to the default 5173.
    port: process.env.PORT ? Number(process.env.PORT) : 5173,
    strictPort: true,
    // Same-origin proxy to the Worker so the session cookie (SameSite=Lax)
    // actually round-trips. Without this, the browser refuses to send the
    // cookie from Vite's origin to the Worker's port, and every authed
    // request comes back 401. VITE_WORKER_TARGET defaults to the local
    // wrangler dev server.
    proxy: {
      '/api': {
        target: process.env.VITE_WORKER_TARGET ?? 'http://127.0.0.1:8787',
        changeOrigin: true,
        ws: false,
      },
    },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
})
