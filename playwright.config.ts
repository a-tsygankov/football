import { defineConfig, devices } from '@playwright/test'

/**
 * Browser tests against the real stack.
 *
 * The unit suites mock at every boundary: worker routes run against in-memory
 * repositories, components run against stubbed callbacks. Both are fast and
 * neither can catch the wiring between them — a button calling the wrong
 * endpoint, a response the client never applies, a cookie that does not round
 * trip. That is what this covers, and it is why it drives a real browser
 * against a real Worker over real HTTP.
 *
 * `wrangler dev --local` runs the Worker on Miniflare with a SQLite D1 in
 * `.wrangler/state`, so nothing here needs Cloudflare credentials. Vite proxies
 * `/api` to it, which is what keeps the session cookie same-origin — without
 * that proxy every authenticated request comes back 401.
 */
const WORKER_PORT = 8788
const WEB_PORT = 5174

export default defineConfig({
  testDir: './e2e',
  // A wager journey is a dozen round trips through two servers.
  timeout: 60_000,
  expect: { timeout: 10_000 },
  // Shared local D1: parallel workers would race on the same database file.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],
  use: {
    baseURL: `http://127.0.0.1:${WEB_PORT}/football/`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      // The app is mobile-first and its layout assumes a phone. Testing it at
      // desktop width would exercise a shape nobody uses.
      //
      // No executablePath: the runner resolves the browser itself, from
      // PLAYWRIGHT_BROWSERS_PATH where one is preinstalled and from its own
      // download otherwise.
      use: { ...devices['Pixel 7'] },
    },
  ],
  webServer: [
    {
      // A fresh database per run: the wager assertions are about exact
      // balances, and leftovers from a previous run would make them lie.
      command:
        'rm -rf worker/.wrangler/state/v3/d1 && ' +
        'pnpm --filter @fc26/worker exec wrangler d1 migrations apply fc26 --local && ' +
        `pnpm --filter @fc26/worker exec wrangler dev --local --port ${WORKER_PORT} ` +
        // Session cookies are HMAC-signed and the secret lives in a gitignored
        // .dev.vars, so a checkout without one cannot sign anything and every
        // room creation 500s. Supplied here so the suite stands on its own; a
        // throwaway value is right for a database thrown away with it.
        '--var SESSION_SECRET:e2e-not-a-real-secret',
      url: `http://127.0.0.1:${WORKER_PORT}/api/health`,
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      command: `pnpm --filter @fc26/web exec vite --port ${WEB_PORT} --strictPort`,
      url: `http://127.0.0.1:${WEB_PORT}/football/`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: { VITE_WORKER_TARGET: `http://127.0.0.1:${WORKER_PORT}` },
      stdout: 'pipe',
      stderr: 'pipe',
    },
  ],
})
