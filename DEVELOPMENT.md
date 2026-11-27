# FC 26 Team Picker — Development & Local Deployment Guide

Practical guide for running, testing, and deploying the project locally. For
the full architecture and design rationale see
[`FC26_TeamPicker_Handoff.md`](./FC26_TeamPicker_Handoff.md); for the dev
environment in more depth (LAN access from a phone, smoke tests) see
[`deployment.local.md`](./deployment.local.md).

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [First-time Setup](#2-first-time-setup)
3. [Repository Layout](#3-repository-layout)
4. [Running the App Locally](#4-running-the-app-locally)
5. [Running Tests](#5-running-tests)
6. [Type Checking](#6-type-checking)
7. [Building and Deploying](#7-building-and-deploying)
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
| Node.js | ≥ 20 (CI uses 22) | <https://nodejs.org/> |
| pnpm | 9.15.0 | Pinned by `packageManager` in the root `package.json`. `npm install -g pnpm@9.15.0` |
| Python | 3.x | Runs the version-bump hook and CI gate in `scripts/` |
| Git | any recent | |
| Cloudflare account | free tier is enough | Only for deploying; local dev and tests need none |
| Wrangler | `wrangler` devDependency of the worker | `pnpm --filter @fc26/worker exec wrangler --version` |

Optional but recommended:
- Modern Chrome / Firefox / Safari with mobile-emulation devtools — the app
  is a phone PWA.
- Docker, to reproduce CI in a container of the runner's OS (see
  [`AGENTS.md`](./AGENTS.md), *Testing locally*).

> **Windows users:** the project uses Bash-style scripts. Use Git Bash or
> WSL — PowerShell will work for `pnpm` commands but not for the example
> shell snippets in this doc. `scripts/setup-secrets.ps1` is the exception.

---

## 2. First-time Setup

```bash
# 1. Clone (skip if you already have the repo)
git clone <repo-url> football
cd football

# 2. Install everything (pnpm workspaces — one install for all packages).
#    Its `prepare` script also points git at .githooks/, which enables the
#    pre-commit version bump.
pnpm install

# 3. Local Worker secrets (gitignored)
cp worker/.dev.vars.example worker/.dev.vars

# 4. Verify
pnpm -r typecheck
pnpm -r test:run
```

If both pass you have a working environment. No Cloudflare resources are
needed locally: `wrangler dev` emulates D1 with a local SQLite file (§8).

---

## 3. Repository Layout

```
football/
├── apps/web/               @fc26/web — Vite + React PWA (the UI)
├── worker/                 @fc26/worker — Cloudflare Worker (Hono API), D1 + R2
│   └── src/db/migrations/  numbered D1 migrations (the schema tier)
├── packages/shared/        @fc26/shared — types, selection strategies, wager
│                           ledger, time utils, logger
├── workers/football-app/   @fc26/football-app — static-assets Worker that
│                           serves the client and proxies /api to the API Worker
├── tools/squad-sync/       @fc26/squad-sync — one-shot squad sync and preview
├── redirect-page/          GitHub Pages redirect from the old origin
├── e2e/                    Playwright specs against the real stack
├── scripts/                version bump + check, ledger health check, secrets
├── docs/                   feature specs, plans, hand-offs, walkthroughs
├── .githooks/              pre-commit version bump
├── playwright.config.ts
├── package.json            workspace root + top-level scripts
├── pnpm-workspace.yaml
└── tsconfig.base.json      strict TypeScript settings shared by all packages
```

Each workspace package has its own `package.json` with scripts and a
`tsconfig.json` extending the base; the tested ones also have a
`vitest.config.ts` and colocated `*.test.ts(x)` files under `src/`.

---

## 4. Running the App Locally

The client is served under **`/football/`** (vite `base`), and Vite proxies
`/api` to the local Worker, so the session cookie stays same-origin. Run both:

```bash
# Terminal 1 — Worker (wrangler dev, http://localhost:8787)
pnpm dev:worker

# Terminal 2 — Web (vite, http://localhost:5173/football/)
pnpm dev:web
```

Without the Worker the client still renders, but every `/api` call fails —
including joining a room. Try the Worker directly:

```bash
curl http://localhost:8787/api/version
curl http://localhost:8787/api/health
```

Every response carries a Base64-encoded `x-fc26-logs` header with the Worker's
per-request log entries.

The proxy target is `http://127.0.0.1:8787` unless `VITE_WORKER_TARGET` says
otherwise (the e2e suite uses that to run its own pair on 8788 and 5174).
`VITE_API_BASE` is **not** needed — production is same-origin too, via the
`football-app` Worker. It remains readable as an escape hatch for pointing a
local build at a deployed API.

Both servers bind every interface, so a phone on the same Wi-Fi can reach
`http://<LAN-IP>:5173/football/`; see `deployment.local.md`. AI agents can use
the preview-harness definitions in `.claude/launch.json` (`web`, `worker`,
`web-preview`).

---

## 5. Running Tests

### Unit tests (Vitest)

Tests live next to the source file they cover (`foo.ts` ↔ `foo.test.ts`).

```bash
pnpm -r test:run          # everything once (CI mode)
pnpm -r test              # watch mode, all packages
pnpm --filter @fc26/shared test   # watch one package (@fc26/worker, @fc26/web)
```

At the time of writing that is 581 tests: 261 shared, 174 worker, 146 web
(`tools/squad-sync`'s `test:run` is a typecheck).

Run a single file or filter by name from inside the package directory:

```bash
cd packages/shared
pnpm vitest run src/selection/strategies/strategies.test.ts
pnpm vitest run -t "balanced-rating"
```

### End-to-end tests (Playwright)

```bash
pnpm exec playwright install chromium   # once per Playwright version
pnpm test:e2e                           # = playwright test
```

The suite starts its own Worker (`wrangler dev --local`, fresh local D1, port
8788) and Vite (port 5174), so nothing else needs to be running and no
Cloudflare credentials are needed. See handoff §29 for what it covers and how
to write one.

### Coverage

Targets from `FC26_TeamPicker_Handoff.md` §22: 80% lines for worker services
and client game logic, **100%** for `packages/shared/src/selection/`.
Presentational components are not tracked. No coverage provider is installed;
add `@vitest/coverage-v8` to the package before running
`pnpm vitest run --coverage`.

---

## 6. Type Checking

Strict TypeScript with `noUncheckedIndexedAccess`, `noUnusedLocals`, and
`noImplicitReturns`.

```bash
pnpm -r typecheck                # all packages
pnpm --filter @fc26/web typecheck
pnpm run typecheck:scripts       # scripts/ (e.g. ledger-report.ts), which
                                 # belong to no package
```

Type checking is part of the web build — `pnpm --filter @fc26/web build` fails
if `tsc` finds errors.

---

## 7. Building and Deploying

**Deploys are done by CI**, from `main`, by `.github/workflows/deploy.yml`.
Both deploy jobs wait for the `ci` (typecheck + unit tests) and `e2e` jobs;
on a pull request the workflow runs those two and skips the deploys. (The
version check is a separate workflow and runs on every PR.)

| Job | What it ships |
|---|---|
| `deploy-worker` | Applies pending D1 migrations (`--remote`), **then** deploys `worker/` |
| `deploy-client` | Builds `apps/web`, stages it under `site/football/`, deploys `workers/football-app` (static assets + `/api` service binding to the API Worker) |
| `deploy-redirect` | Publishes `redirect-page/` to the old GitHub Pages origin, mapping URLs 1:1 to the new one |

They need the `CLOUDFLARE_API_TOKEN` (with D1 Edit) and
`CLOUDFLARE_ACCOUNT_ID` repository secrets.

To build locally:

```bash
pnpm --filter @fc26/web build      # → apps/web/dist/
pnpm --filter @fc26/worker build   # tsc --noEmit; wrangler bundles at deploy
pnpm -r build                      # everything
```

---

## 8. Cloudflare Resources (D1, R2)

The bindings in `worker/wrangler.toml` are live: D1 `DB` (database `fc26`)
and R2 `SQUADS` (bucket `fc26`). Locally, `wrangler dev` uses an emulated
SQLite D1 under `worker/.wrangler/state`, so you need no account. If a binding
is missing, the Worker falls back to in-memory stores (`src/dependencies.ts`)
and stays runnable; the squad routes then answer 503 `no_squad_data`.

```bash
cd worker

# Apply migrations to the local SQLite copy
pnpm exec wrangler d1 migrations apply fc26 --local

# Query it
pnpm exec wrangler d1 execute fc26 --local --command "SELECT * FROM rooms;"
```

Provisioning from scratch (only for a new Cloudflare account):

```bash
pnpm exec wrangler d1 create fc26          # paste database_id into wrangler.toml
pnpm exec wrangler r2 bucket create fc26
```

A daily squad-sync cron is implemented (`scheduled` in `worker/src/index.ts`)
but its `[triggers]` block in `wrangler.toml` is commented out, so it does not
run.

---

## 9. Database Migrations

Migrations live in `worker/src/db/migrations/` as `NNNN_description.sql` and
are applied by `wrangler d1 migrations apply` (`migrations_dir` in
`wrangler.toml`). There is no ORM; queries are plain SQL in the repositories.

- **Additive only.** CI applies migrations to production *before* the new
  Worker deploys, so the old Worker briefly runs against the new schema.
- **Data moves are SQL too**, in the same file — see
  `0008_chip_purchases_backfill.sql`. Nothing runs a `.ts` migration.
- **Bump `SCHEMA_VERSION`** in `wrangler.toml` to the new number; the version
  gate fails if it differs from the highest migration.

### Create a new migration

```bash
touch worker/src/db/migrations/0015_add_something.sql
```

Open it with a comment saying *why*, then the statements, and finish with:

```sql
INSERT INTO schema_migrations (version, applied_at, description)
VALUES (15, (strftime('%s','now') * 1000), 'add something');
```

Apply locally with `pnpm exec wrangler d1 migrations apply fc26 --local`.
Production is CI's job (§7); by hand it is the same command with `--remote`.

`SCHEMA_VERSION` is reported by `/api/version`. The Worker does **not** yet
refuse requests when it disagrees with the database (handoff §21 describes
that as intended).

---

## 10. Environment Variables & Secrets

### Web app

| Variable | Default | Purpose |
|---|---|---|
| `VITE_WORKER_TARGET` | `http://127.0.0.1:8787` | Where the dev server proxies `/api` |
| `VITE_API_BASE` | empty (same-origin) | Escape hatch only — production does not set it |
| `PORT` | `5173` | Dev server port, for launchers that assign one |

Build-time defines (set by `vite.config.ts`, do not edit):
- `__APP_VERSION__` — from `apps/web/package.json`
- `__GIT_SHA__` — from `process.env.GIT_SHA` or `'dev'`
- `__BUILT_AT__` — current ISO timestamp at build

### Worker (`worker/wrangler.toml` `[vars]` block)

| Variable | Purpose |
|---|---|
| `WORKER_VERSION` | Reported via `/api/version`; must equal `worker/package.json` |
| `SCHEMA_VERSION` | Highest migration number; must equal the latest file |
| `MIN_CLIENT_VERSION` | Clients below this are shown an update banner |
| `GIT_SHA` | Passed at deploy (`--var GIT_SHA:…`) |

Don't hand-edit the versions — the pre-commit hook bumps them (§14).

### Worker secrets

```bash
cd worker
pnpm exec wrangler secret put SESSION_SECRET           # room session signing (required)
pnpm exec wrangler secret put GEMINI_API_KEY           # TV-photo score analysis (optional)
pnpm exec wrangler secret put SQUAD_SYNC_ADMIN_SECRET  # guards /internal/squads/sync (optional)
```

Secrets are encrypted and never appear in logs.

The name is `SESSION_SECRET` — matching `worker/src/env.ts`. This document
previously said `SESSION_JWT_SECRET`, which the Worker never reads, so anyone
following it set a secret with no effect and left the plaintext `[vars]`
placeholder signing production cookies.

A secret cannot share a name with a `[vars]` binding; Cloudflare rejects it
with `Binding name '<X>' already in use [code: 10053]`. If you hit that,
remove the var, `wrangler deploy` so the binding disappears, then set the
secret.

Rotating `SESSION_SECRET` invalidates every existing room session — everyone
has to rejoin.

For local development, put values in `worker/.dev.vars` (gitignored) rather
than `wrangler.toml`; copy `worker/.dev.vars.example` to get started.
`scripts/setup-secrets.ps1 -All` automates the production side.

> **Never commit `.env*`, `.dev.vars` or secrets.** The repo's `.gitignore`
> covers the common patterns; double-check before pushing.

---

## 11. Debug Console (in-app)

Every response from the Worker carries an `x-fc26-logs` header containing
that request's log entries. The web app drains the header and merges those
entries into the client log buffer.

### Open the Console

**Triple-tap the FC26 logo in the bottom navigation bar** (the round button in
the centre). The app deliberately no longer hints at this on screen (#54), and
"hidden" is not a permission boundary: the Console also unlocks the Settings
panel and its destructive controls (handoff §25, open item 16).

### Tabs

- **Live** — newest log entries from both client and Worker, auto-follow.
- **System** — app version, git SHA, build time, time zone, user agent.

### Logging from code

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

The handoff's §17 lists the log points that are mandatory.

---

## 12. Common Workflows

### Add a new selection strategy

1. Create `packages/shared/src/selection/strategies/my-strategy.ts`
2. Add behaviour-specific tests, e.g. `my-strategy.test.ts` next to it
3. Register it in `packages/shared/src/selection/registry.ts` (registration
   order is the display order)
4. Re-export it in `packages/shared/src/selection/index.ts`
5. Add it to the `STRATEGIES` list in
   `packages/shared/src/selection/strategies/strategies.test.ts` so it runs
   the parameterised contract tests — they do **not** discover strategies on
   their own
6. `pnpm --filter @fc26/shared test:run`

No schema change, no migration. Once deployed it is offered wherever a game's
selection strategy is chosen.

### Add a new Worker route

1. Create `worker/src/routes/my-feature.ts` — export a `Hono` sub-app
2. Mount it in `worker/src/app.ts` with `app.route('/api', myFeatureRoutes)`
3. Add `worker/src/routes/my-feature.test.ts` — instantiate `buildApp()` and
   call `app.fetch(new Request(...))` directly; `routes/test-support.ts` has
   the shared fixtures. No `wrangler dev` required.

### Add a new database table

1. Create `worker/src/db/migrations/NNNN_description.sql` (§9)
2. Apply locally: `pnpm exec wrangler d1 migrations apply fc26 --local`
3. Bump `SCHEMA_VERSION` in `wrangler.toml`
4. Add a repository interface, a D1 implementation and an in-memory one for
   tests, and wire both into `worker/src/dependencies.ts`

### Update the handoff doc

The full architecture spec is `FC26_TeamPicker_Handoff.md`. Update it
whenever a structural decision changes, add a **Recent Changes** entry for
shipped work, and record anything left unresolved under **§25 Open Items**.
Small implementation details belong in code comments instead.

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

### Web tests fail with `Cannot read properties of undefined (reading 'clear')`

Newer Node releases (seen on Node 26) turn on Node's own Web Storage by
default. Its `localStorage` global hides jsdom's, so with no
`--localstorage-file` set, `localStorage` is undefined in every web test that
touches it. CI is on Node 22 and is not affected. Use Node 22, or turn Node's
storage off for the run:

```bash
NODE_OPTIONS=--no-webstorage pnpm -r test:run
```

### Every authenticated request returns 401 in dev

The session cookie is not round-tripping. Open the app through Vite
(`http://localhost:5173/football/`), not the Worker's port, so `/api` is
proxied same-origin; and don't set `VITE_API_BASE` to the Worker's URL.

### Creating a room fails with 500 locally

`SESSION_SECRET` is unset, so the Worker cannot sign a session. Copy
`worker/.dev.vars.example` to `worker/.dev.vars` and restart `pnpm dev:worker`.

### `playwright install` says the OS is not supported

The installed `@playwright/test` predates your OS (or the CI runner's). Upgrade
it in the root `package.json`; see handoff §29.

### TypeScript errors after pulling new code

```bash
pnpm install                  # in case dependencies changed
pnpm -r typecheck             # surface all errors at once
```

### iOS Safari shows the bottom nav under the home indicator

The nav already accounts for `env(safe-area-inset-bottom)`. Make sure your
test page uses `<meta name="viewport" content="… viewport-fit=cover">`
(already set in `apps/web/index.html`).

---

## 14. Project Conventions

These are non-negotiable. Pull requests that violate them will be sent back.
`AGENTS.md` collects them with the rest of the project's rules for agents.

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
- Sabotage every new guarantee: break it, confirm a test fails, restore it.
- Logic dirs (`worker/src/services/`, client game logic,
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
- `GET /api/version` returns all three. The web app shows an update banner
  when its version is below `minClientVersion`.
- Every PR that touches a tier bumps it. `.githooks/pre-commit` does this
  automatically (`pnpm version:bump` by hand); CI's version check is the
  backstop: `BASE_REF=origin/main python3 scripts/check_version_bump.py`.
- Migrations are applied by CI before the Worker deploys (§7).

---

**End of guide.** Questions? Update this file in the same PR as your fix.
