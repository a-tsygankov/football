import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwind from '@tailwindcss/vite'
import pkg from './package.json'

const local = (path: string) => fileURLToPath(new URL(path, import.meta.url))
export default defineConfig({
  root: local('./clubhouse'),
  publicDir: local('./clubhouse/public'),
  plugins: [react(), tailwind()],
  resolve: { alias: { '@': local('./src') } },
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __GIT_SHA__: JSON.stringify(process.env.GIT_SHA ?? 'preview'),
    __BUILT_AT__: JSON.stringify(new Date().toISOString()),
    'import.meta.env.VITE_API_BASE': '""',
  },
  build: { outDir: local('./dist-preview'), emptyOutDir: true, target: 'es2022' },
})
