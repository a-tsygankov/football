# FC 26 Team Picker — Development & Local Deployment Guide

Practical guide for running, testing, and deploying the project locally. For
the full architecture and design rationale see
[`FC26_TeamPicker_Handoff.md`](./FC26_TeamPicker_Handoff.md).

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [First-time Setup](#2-first-time-setup)
3. [Repository Layout](#3-repository-layout)
4. [Running the App Locally](#4-running-the-app-locally)
5. [Running Tests](#5-running-tests)
6. [Type Checking](#6-type-checking)
7. [Building for Production](#7-building-for-production)
8. [Cloudflare Resources (D1, R2)](#8-cloudflare-resources-d1-r2)
9. [Database Migrations](#9-database-migrations)
10. [Environment Variables & Secrets](#10-environment-variables--secrets)
11. [Debug Console (in-app)](#11-debug-console-in-app)
12. [Common Workflows](#12-common-workflows)
13. [Troubleshooting](#13-troubleshooting)
14. [Project Conventions](#14-project-conventions)

---

## 1. Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Node.js | ≥ 20 (tested on 23.7) | <https://nodejs.org/> |
| pnpm | 9.15.0 | `npm install -g pnpm@9.15.0` |
| Git | any recent | |
| Cloudflare account | free tier is enough | Only needed for Phase 1+ (D1, R2, Workers deploy) |
| Wrangler CLI | bundled via `@cloudflare/wrangler` in the worker package | `pnpm --filter @fc26/worker exec wrangler --version` |

Optional but recommended:
- Modern Chrome / Firefox / Safari with mobile-emulation devtools.
- A GitHub account if you want to push the repo and run CI.

> **Windows users:** the project uses Bash-style scripts. Use Git Bash or
> WSL — PowerShell will work for `pnpm` commands but not for the example
> shell snippets in this doc.

---

## 2. First-time Setup

```bash
# 1. Clone (skip if you already have the repo)
git clone <repo-url> football
cd football

# 2. Install everything (uses pnpm workspaces — installs all packages at once)
pnpm install

# 3. Verify the scaffold works end-to-end (90 tests should pass)
pnpm -r test:run
pnpm -r typecheck
```

If the test suite passes you have a working environment. There is no extra
configuration needed for Phase 0 — D1 and R2 are not used yet.

---

## 3. Repository Layout

```
football/
├── apps/web/            @fc26/web — Vite + React SPA (the UI)
├── worker/              @fc26/worker — Cloudflare Worker (Hono API)
├── packages/shared/     @fc26/shared — types, time utils, logger, selection strategies
├── tools/               (Phase 1) one-shot Node scripts (squad-sync)
├── package.json         workspace root + top-level scripts
├── pnpm-workspace.yaml
└── tsconfig.base.json   strict TypeScript settings shared by all packages
```

Each workspace package has its own:
- `package.json` with scripts
- `tsconfig.json` extending the base
- `vitest.config.ts`
- `src/` directory with colocated `*.test.ts` files

---

## 4. Running the App Locally

### Web app only (Phase 0 default — works without a running Worker)

```bash
pnpm dev:web
```

Opens Vite dev server at <http://localhost:5173>. Hot reload is enabled.

The app will try to fetch `/api/version` from the Worker. If the Worker is
not running, the UI shows `Worker: unreachable — …` and continues to render
— this is intentional so you can iterate on the front end without booting
the Worker.

### Worker only

```bash
pnpm dev:worker
```

Starts `wrangler dev` on <http://localhost:8787>. Try:

```bash
curl http://localhost:8787/api/version
curl http://localhost:8787/api/health
```

Both should return JSON. Every response carries a Base64-encoded
`x-fc26-logs` header containing the Worker's per-request log entries.

> **Note:** Until you create a D1 database (Phase 1) the Worker will boot
> with `DB` undefined. The Phase 0 routes (`/api/version`, `/api/health`)
> don't use the database, so this is fine.

### Both at once (recommended once you start integrating)

Open two terminals:

```bash
# Terminal 1
pnpm dev:worker

# Terminal 2
pnpm dev:web
```

Then point the web app at the Worker by creating `apps/web/.env.local`:

```
VITE_API_BASE=http://localhost:8787
```

Restart `pnpm dev:web` after changing env files.

---

## 5. Running Tests

The project uses **Vitest** in every package. Tests live next to the source
file they cover (`foo.ts` ↔ `foo.test.ts`).

### Run everything once (CI mode)

```bash
pnpm -r test:run
```

Expected output (Phase 0): **90 passing tests across 3 packages.**

### Watch mode (during development)

```bash
# All packages, parallel watchers
pnpm -r test

# A single package
pnpm --filter @fc26/shared test
pnpm --filter @fc26/worker test
pnpm --filter @fc26/web test
```

### Run a single test file

```bash
# From the package directory
cd packages/shared
pnpm vitest run src/selection/strategies/strategies.test.ts
```

### Run tests matching a name

```bash
pnpm vitest run -t "balanced-rating"
```

### Coverage (optional)

```bash
pnpm --filter @fc26/shared exec vitest run --coverage
```

Coverage targets per `FC26_TeamPicker_Handoff.md` §22:
- `worker/src/services/` — 80% lines
- `apps/web/src/game/` — 80% lines
- `packages/shared/src/selection/` — **100% lines**

---

## 6. Type Checking

Strict TypeScript with `noUncheckedIndexedAccess`, `noUnusedLocals`, and
`noImplicitReturns`.

```bash
# All packages
pnpm -r typecheck

# A single package
pnpm --filter @fc26/web typecheck
```

Type checking is part of the production build for the web app — `pnpm build`
will fail if `tsc` finds errors.

---

## 7. Building for Production

### Web app

```bash
pnpm --filter @fc26/web build
```

Output: `apps/web/dist/` (deployable to Cloudflare Pages, Netlify, or any
static host). Currently ~150 kB raw / ~49 kB gzipped.

### Worker

```bash
pnpm --filter @fc26/worker build
```

This runs `tsc --noEmit` to catch type errors. The actual Worker bundle is
produced by Wrangler at deploy time:

```bash
pnpm --filter @fc26/worker deploy
```

### Build everything

```bash
pnpm -r build
```

---

## 8. Cloudflare Resources (D1, R2)

Skip this section until Phase 1. The Phase 0 scaffold runs without any
Cloudflare resources provisioned.

### Create resources

```bash
cd worker

# 1. Create the D1 database
pnpm exec wrangler d1 create fc26
# Copy the printed `database_id` into wrangler.toml under [[d1_databases]]

# 2. Create the R2 bucket for squad data
pnpm exec wrangler r2 bucket create fc26-squads
```

### Uncomment the bindings in `worker/wrangler.toml`

```toml
[[d1_databases]]
binding = "DB"
database_name = "fc26"
database_id = "PASTE-THE-ID-HERE"

[[r2_buckets]]
binding = "SQUADS"
bucket_name = "fc26-squads"

[triggers]
crons = ["0 6 * * *"]   # daily squad sync at 06:00 UTC
```

### Create local-only test resources

For local development you can use Wrangler's local SQLite emulation — no
network calls, no Cloudflare account needed:

```bash
# Apply migrations to a local sqlite copy
pnpm exec wrangler d1 migrations apply fc26 --local

# Run a query against the local DB
pnpm exec wrangler d1 execute fc26 --local --command "SELECT * FROM rooms;"
```

`wrangler dev` will use the local DB by default.

---

## 9. Database Migrations

Migrations live in `worker/src/db/migrations/` and follow the Drizzle
convention `NNNN_description.sql`. Each migration may also have an optional
`NNNN_description.ts` for data transforms (run after the SQL).

### Apply migrations locally

```bash
cd worker
pnpm exec wrangler d1 migrations apply fc26 --local
```

### Apply migrations to production

```bash
pnpm exec wrangler d1 migrations apply fc26 --remote
```

Always apply migrations **before** deploying a new Worker version. The
Worker boots with a `SCHEMA_VERSION` env var and refuses to serve requests
if it doesn't match the latest applied migration (Phase 5).

### Create a new migration

```bash
# Create the next numbered file
touch src/db/migrations/0002_add_something.sql
```

Edit the file with your `CREATE TABLE` / `ALTER TABLE` statements, then
finish with:

```sql
INSERT INTO schema_migrations (version, applied_at, description)
VALUES (2, (strftime('%s','now') * 1000), 'add something');
```

If you also need to move data, add `0002_add_something.ts` exporting an
`async function up(db: D1Database)`.

---

## 10. Environment Variables & Secrets

### Web app (`apps/web/.env.local`)

| Variable | Default | Purpose |
|---|---|---|
| `VITE_API_BASE` | empty (same-origin) | Base URL for the Worker API |

Build-time defines (set by `vite.config.ts`, do not edit):
- `__APP_VERSION__` — from `apps/web/package.json`
- `__GIT_SHA__` — from `process.env.GIT_SHA` or `'dev'`
- `__BUILT_AT__` — current ISO timestamp at build

### Worker (`worker/wrangler.toml` `[vars]` block)

| Variable | Default | Purpose |
|---|---|---|
| `WORKER_VERSION` | `0.1.0` | Reported via `/api/version` |
| `SCHEMA_VERSION` | `1` | Latest applied migration |
| `MIN_CLIENT_VERSION` | `0.1.0` | Web app refuses to continue below this |
| `GIT_SHA` | unset | Build metadata |

### Worker secrets (Phase 1+)

```bash
cd worker
pnpm exec wrangler secret put GEMINI_API_KEY      # OCR (Phase 10)
pnpm exec wrangler secret put SESSION_JWT_SECRET  # PIN session signing
```

Secrets are encrypted and never appear in logs.

> **Never commit `.env*` files or secrets.** The repo's `.gitignore` covers
> the common patterns; double-check before pushing.

---

## 11. Debug Console (in-app)

Every response from the Worker carries an `x-fc26-logs` header containing
that request's log entries. The web app drains the header and merges those
entries into the client log buffer.

### Open the Console

**Triple-tap the FC26 logo in the bottom navigation bar.** The logo is the
round button in the centre of the bottom nav — placed there so it's
thumb-reachable on phones and never hidden behind iOS notches.

### Tabs

- **Live** — newest log entries from both client and Worker, auto-follow.
- **System** — app version, git SHA, build time, time zone, user agent.

### What gets logged automatically (Phase 0)

- App boot
- Every API request (out and in)
- Worker version fetch
- Console open/close

You can call the logger directly anywhere in client code:

```ts
import { logger } from './lib/logger.js'

logger.info('game', 'roster selected', { gamerCount: 4 })
logger.warn('squad-sync', 'fallback model used', { model: 'gemini-2.5-pro' })
```

In the Worker, grab it from the Hono context:

```ts
app.get('/api/something', (c) => {
  c.get('logger').info('game', 'thing happened', { id: 42 })
  return c.json({ ok: true })
})
```

---

## 12. Common Workflows

### Add a new selection strategy

1. Create `packages/shared/src/selection/strategies/my-strategy.ts`
2. Create `packages/shared/src/selection/strategies/my-strategy.test.ts`
3. Register it in `packages/shared/src/selection/registry.ts`
4. Re-export it in `packages/shared/src/selection/index.ts`
5. `pnpm --filter @fc26/shared test:run` — your strategy will be picked up by the
   parameterised contract tests automatically (every strategy must satisfy
   the same set of invariants)

That's it — no schema change, no Worker deploy, no DB migration. Once
deployed, room admins can switch to your strategy via the `Room Settings`
dropdown (Phase 2 UI).

### Add a new Worker route

1. Create `worker/src/routes/my-feature.ts` — export a `Hono` sub-app
2. Mount it in `worker/src/app.ts` with `app.route('/api', myFeatureRoutes)`
3. Add `worker/src/routes/my-feature.test.ts` — instantiate `buildApp()` and
   call `app.fetch(new Request(...))` directly. No `wrangler dev` required.

### Add a new database table

1. Create `worker/src/db/migrations/NNNN_description.sql`
2. (Optional) Create the matching `.ts` for data transforms
3. Apply locally: `pnpm exec wrangler d1 migrations apply fc26 --local`
4. Bump `SCHEMA_VERSION` in `wrangler.toml`
5. Add the Drizzle schema entry in `worker/src/db/schema.ts` (Phase 1+)
6. Add a repository class implementing the relevant `IRepository<…>`
7. Add an in-memory implementation for tests

### Update the handoff doc

The full architecture spec is `FC26_TeamPicker_Handoff.md`. Update it
whenever a structural decision changes; small implementation details belong
in code comments instead.

---

## 13. Troubleshooting

### `pnpm: command not found`

Install pnpm globally: `npm install -g pnpm@9.15.0`

### `Cannot find module '@fc26/shared'`

Run `pnpm install` at the repo root. Workspace links are created at install
time and `pnpm` is the only package manager that handles them correctly
here.

### Tests pass individually but a watch run hangs

Vitest's parallel mode can occasionally deadlock on Windows. Run with
`--no-isolate`:

```bash
pnpm vitest run --no-isolate
```

### `wrangler dev` fails with "no D1 binding"

You haven't uncommented `[[d1_databases]]` in `wrangler.toml`. Either do
that and create the database, or comment out the route(s) that read from
`c.env.DB`. The Phase 0 routes don't touch the DB, so a fresh checkout
should boot fine.

### Web app shows "Worker: unreachable"

The Worker isn't running or is on a different origin. Either:
- Start it with `pnpm dev:worker`, or
- Set `VITE_API_BASE` in `apps/web/.env.local` to wherever it lives

### TypeScript errors after pulling new code

```bash
pnpm install                  # in case dependencies changed
pnpm -r typecheck             # surface all errors at once
```

### `iOS Safari` shows the bottom nav under the home indicator

The nav already accounts for `env(safe-area-inset-bottom)`. Make sure your
test page uses `<meta name="viewport" content="… viewport-fit=cover">`
(already set in `apps/web/index.html`).

---

## 14. Project Conventions

These are non-negotiable. Pull requests that violate them will be sent back.

### Code

- **SOLID, Clean Code, DRY (carefully), KISS.**
- Pure functions for logic (selection strategies, draw engine, projections).
- IRepository pattern for storage; tests use in-memory implementations.
- Validate at the boundary with Zod; trust types inside the app.
- No `Math.random` or `Date.now` inside business logic — inject `rng` and
  `Clock` from a composition root. Tests pass deterministic fakes.
- No DI container, no effect libraries. Plain constructor injection.

### Tests

- Tests live next to the source file (`foo.ts` + `foo.test.ts`).
- Every new module ships with tests in the same PR — never "tests later."
- Selection strategies must pass the parameterised contract tests AND
  add their own behaviour-specific tests.
- Logic dirs (`worker/src/services/`, `apps/web/src/game/`,
  `packages/shared/src/selection/`) target high coverage. React
  presentational components are not tracked for coverage.

### Naming

- **`gamers`** = humans in a friend group. Never `players`.
- **`fc_players`** = individual FC26 footballers (R2 only by default).
- **`clubs`** = FC26 teams.
- **`gamer_team_key`** = stable hash of sorted gamer IDs.

### Time

- All `*_at` columns store **UTC milliseconds as `INTEGER`**.
- The Worker never formats dates — clients render with `Intl.DateTimeFormat`.
- `created_at` + `updated_at` on every mutable entity.

### Logging

- Use the shared `ILogger` interface. Don't call `console.*` directly.
- Every game fact and state machine transition must be logged.
- Worker logs auto-pipe to the client Console via the `x-fc26-logs` header.

### Versioning

- Three independent axes: client, worker, schema.
- `GET /api/version` returns all three. Web app refuses to continue if its
  version is below `minClientVersion`.
- Migrations are applied manually before deploying a new Worker.

---

**End of guide.** Questions? Update this file in the same PR as your fix.
