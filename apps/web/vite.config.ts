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
    // http://<LAN-IP>:5173. Vite also prints the Network URL on startup.
    host: true,
    port: 5173,
    strictPort: true,
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
})
