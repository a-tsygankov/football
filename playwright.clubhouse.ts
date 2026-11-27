import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: '.',
  testMatch: ['**/e2e/wager.spec.ts', '**/clubhouse-tests/preview.spec.ts'],
  timeout: 120000,
  workers: 2,
  use: {
    ...devices['Pixel 7'],
    channel: process.env.CLUBHOUSE_BROWSER_CHANNEL || undefined,
    baseURL: 'https://football-preview.atsyg-feedme.workers.dev/',
  },
})
