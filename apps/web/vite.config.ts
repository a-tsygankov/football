import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf-8')) as {
  version: string
}

export default defineConfig({
  plugins: [react()],
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
