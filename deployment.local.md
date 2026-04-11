# FC26 TeamPicker — Local Deployment & Dev Environment

> **Audience:** human developers and AI coding agents working on this repo.
> **Goal:** one page that tells you how to install, run, test, and debug the
> stack on a developer workstation without any Cloudflare cloud resources.
> If you are an AI agent reading this: every command in this doc is verified
> to work as of Phase 0 scaffold + Phase 1 read-side. Prefer `preview_start`
> (see §6) over `Bash` for long-running dev servers.

---

## 1. What this repo is

A pnpm monorepo for a mobile-first FC 26 companion web app. Four major modes
(Game, Dashboard, View Teams, Update Changes). Stack: **Vite + React 18** SPA
on Cloudflare Pages, **Hono** API on Cloudflare Workers, **D1** (SQLite at the
edge) + **R2** (blobs). Shared code lives in `@fc26/shared`.

Full architecture: see [`FC26_TeamPicker_Handoff.md`](./FC26_TeamPicker_Handoff.md).
Coding principles and detailed dev guide: [`DEVELOPMENT.md`](./DEVELOPMENT.md).

### Terminology (strict)
- **gamer** — a human in the friend group (never "player")
- **fc_player** — an FC26 footballer
- **room** — a group of gamers persisted across devices
- **game** — one FC26 match, exactly 2 or 4 gamers (`GameSize = 2 | 4`)

---

## 2. Repository layout

```
football/
├── apps/
│   └── web/                  # @fc26/web — Vite + React SPA
│       ├── vite.config.ts    # defines port 5173, injects __APP_VERSION__ etc.
│       ├── .env.local        # NOT checked in — see §4
│       └── src/
├── worker/                   # @fc26/worker — Hono on Cloudflare Workers
│   ├── wrangler.toml         # D1 + R2 bindings (currently commented out)
│   ├── src/
│   │   ├── app.ts            # buildApp() — DI-friendly Hono factory
│   │   ├── dependencies.ts   # composition root, falls back to in-memory
│   │   ├── db/migrations/    # NNNN_description.sql files
│   │   ├── routes/           # version, health, squads
│   │   └── squad/            # ISquadStorage, ISquadVersionRepository
│   └── package.json
├── packages/
│   └── shared/               # @fc26/shared — types, logger, selection, diff
├── tools/                    # (reserved — squad-sync will land here in Phase 1 write-side)
├── .github/workflows/deploy.yml  # CI + Pages + Workers deploy
├── .claude/
│   └── launch.json           # dev server registry (see §6)
├── package.json              # pnpm workspace root
├── pnpm-workspace.yaml
├── pnpm-lock.yaml
├── tsconfig.base.json
├── DEVELOPMENT.md            # deeper dev guide
├── FC26_TeamPicker_Handoff.md
└── deployment.local.md       # this file
```

---

## 3. Prerequisites

| Tool | Version | Check | Notes |
|---|---|---|---|
| Node.js | **≥ 20** (22 recommended) | `node -v` | `package.json` sets `engines.node: ">=20"` |
| pnpm | **9.15.0** exactly | `pnpm -v` | Pinned in `packageManager` field |
| Git | any recent | `git --version` | |
| Cloudflare account | **not needed** for local dev | — | Only required for remote deploys or real D1/R2 |

### Installing pnpm

If `pnpm` is missing or on the wrong version:
```bash
npm install -g pnpm@9.15.0
```
> `corepack enable` is the "official" way but has been known to fail with
> `EPERM` on Windows because Node ships in `C:\Program Files\nodejs`. The
> global npm install above works around that without privilege escalation.

---

## 4. First-time setup

```bash
# From the repo root
pnpm install --frozen-lockfile
```

This installs every workspace (`apps/web`, `worker`, `packages/shared`) in
one pass. `--frozen-lockfile` matches CI exactly.

### Required environment file: `apps/web/.env.local`

The web app reads `VITE_API_BASE` at build time (see
`apps/web/src/lib/api.ts:15`). For local dev the SPA runs on port 5173 and
the Worker on port 8787 — different origins — so you must tell the SPA where
the Worker is:

```bash
# apps/web/.env.local — desktop-only dev
VITE_API_BASE=http://localhost:8787
```

> **Phone testing over Wi-Fi?** Use your LAN IP instead of `localhost` here
> — `localhost` on a phone means the phone itself, not the dev machine.
> See **§17 Accessing dev servers from a phone on the same Wi-Fi**.

> Worker CORS middleware already echoes the request origin back with
> `credentials: true`, so cross-origin calls from 5173 → 8787 work without
> further config — whether the origin is `localhost`, a LAN IP, or a
> `.local` Bonjour name.

> **Alternative (not yet applied):** add a Vite dev proxy in
> `apps/web/vite.config.ts` so `/api/*` transparently forwards to
> `http://localhost:8787`. This would remove the need for `.env.local`
> entirely and make dev match prod (same-origin). Not compatible with phone
> testing though, so the current setup (explicit `VITE_API_BASE`) wins.

### Network binding (LAN vs localhost-only)

As of the Phase 1 read-side commit, both dev servers bind to **all
interfaces** (`0.0.0.0`) so LAN clients can connect:

- `apps/web/vite.config.ts` — `server.host: true` (Vite idiom for 0.0.0.0)
- `worker/wrangler.toml` — `[dev] ip = "0.0.0.0"`

If you want to scope dev to the loopback interface only (for example on an
untrusted café Wi-Fi), remove `host: true` from `vite.config.ts` and set
`[dev] ip = "127.0.0.1"` in `wrangler.toml`.

### No other env files are required for local dev

- `worker/wrangler.toml` currently has D1 and R2 bindings **commented out**.
- `worker/src/dependencies.ts` detects missing bindings and silently falls
  back to `InMemorySquadStorage` + `InMemorySquadVersionRepository`.
- Every route still responds; endpoints that need real data (e.g.
  `GET /api/squads/latest`) return `503 no_squad_data` honestly.

---

## 5. Verify the install (sanity checks)

Run these before starting any dev server. They should all pass cleanly on
a fresh checkout.

```bash
# 1. Workspace-wide typecheck (strict, noUncheckedIndexedAccess, etc.)
pnpm -r typecheck

# 2. Workspace-wide tests (vitest run, non-watch)
pnpm -r test:run
```

**Expected result (as of Phase 1 read-side):**
- `@fc26/shared` → 89 tests (5 files)
- `@fc26/worker` → 25 tests (4 files)
- `@fc26/web`    → 5 tests (2 files)
- **Total: 119 passing, 0 failing**

If any of these fail on a clean checkout, the fault is in the repo, not
your machine — investigate before proceeding.

---

## 6. Running dev servers

### Option A — via Claude Code preview harness (preferred for AI agents)

This repo ships a `.claude/launch.json` describing both dev servers:

```json
{
  "version": "0.0.1",
  "configurations": [
    {
      "name": "web",
      "runtimeExecutable": "pnpm",
      "runtimeArgs": ["--filter", "@fc26/web", "dev"],
      "port": 5173
    },
    {
      "name": "worker",
      "runtimeExecutable": "pnpm",
      "runtimeArgs": ["--filter", "@fc26/worker", "dev"],
      "port": 8787
    }
  ]
}
```

From a Claude Code agent, call the MCP tools in parallel:

```
mcp__Claude_Preview__preview_start { name: "worker" }
mcp__Claude_Preview__preview_start { name: "web" }
```

`preview_start` reuses an existing server if one is already running, so it
is safe to call repeatedly. Use `preview_logs` / `preview_console_logs` for
log tailing and `preview_stop` to shut a server down.

> **Rule for AI agents:** never use `Bash` to run `pnpm dev`, `vite`,
> `wrangler dev`, or any other long-running server. Always go through
> `preview_start`. Bash lacks lifecycle management and you will leak
> background processes.

### Option B — via plain pnpm (humans)

Two terminals:

```bash
# Terminal 1 — Worker (Wrangler dev)
pnpm dev:worker          # runs `pnpm --filter @fc26/worker dev` → `wrangler dev`
# → Listening on http://localhost:8787

# Terminal 2 — Web (Vite)
pnpm dev:web             # runs `pnpm --filter @fc26/web dev` → `vite`
# → Local: http://localhost:5173/
```

Both commands also work inside their respective package directories:
```bash
cd worker && pnpm dev
cd apps/web && pnpm dev
```

### Port reference

| Service | Port | Source of truth |
|---|---|---|
| Vite SPA | **5173** | `apps/web/vite.config.ts` → `server.port: 5173` |
| Wrangler Worker | **8787** | Wrangler default — no override in `worker/wrangler.toml` |

If you need different ports, override `server.port` in `vite.config.ts` and
pass `--port <n>` to `wrangler dev`. Remember to update `.env.local` and
`.claude/launch.json` in lockstep.

---

## 7. Verification — proving the stack works end-to-end

With both servers running:

### 7.1 Worker direct smoke tests

```bash
curl http://localhost:8787/api/health
# → {"ok":true}

curl http://localhost:8787/api/version
# → {"workerVersion":"0.1.0","schemaVersion":1,"minClientVersion":"0.1.0","gitSha":null,"builtAt":"..."}

curl http://localhost:8787/api/squads/versions
# → {"versions":[]}   (in-memory fallback, empty registry)

curl -i http://localhost:8787/api/squads/latest
# → HTTP/1.1 503 Service Unavailable
# → {"error":"no_squad_data"}   (honest: nothing ingested yet)
```

Every response carries an `x-fc26-logs` header with Base64-encoded JSON —
this is how Worker logs reach the client Console. Decode with:
```bash
curl -sI http://localhost:8787/api/health | grep -i x-fc26-logs | \
  cut -d' ' -f2- | tr -d '\r' | base64 -d | jq .
```

### 7.2 Web end-to-end

1. Open **http://localhost:5173** in a browser.
2. You should see the Phase 0 shell with:
   - A heading
   - A status line showing the Worker version (fetched from `/api/version`)
   - A fixed bottom nav with four mode buttons and a round FC26 logo in the center
3. **Triple-tap the logo** (three taps within ~600 ms). The Debug Console
   slides up from the bottom. You should see:
   - Client entries: `[system] app booted`, `[http] → GET /api/version`
   - Worker entries (piped via `x-fc26-logs`): `[http] request received`,
     `[system] version requested`, `[http] request completed`
4. Check the browser DevTools Network tab — every `/api/*` request should
   carry an `x-correlation-id` header (client → worker) and an `x-fc26-logs`
   response header (worker → client).

---

## 8. Running tests

### Whole workspace (CI-style)

```bash
pnpm -r test:run      # single run, exits when done
pnpm -r typecheck     # tsc --noEmit in every package
```

### Watch mode (single package)

```bash
pnpm --filter @fc26/shared test
pnpm --filter @fc26/worker test
pnpm --filter @fc26/web    test
```

### Run a single file

```bash
pnpm --filter @fc26/shared exec vitest run src/squad/diff.test.ts
pnpm --filter @fc26/worker exec vitest run src/routes/squads.test.ts
```

### Filter by test name

```bash
pnpm --filter @fc26/shared exec vitest run -t "diffSquads"
```

### Coverage targets (from `FC26_TeamPicker_Handoff.md` §22)

| Directory | Coverage target |
|---|---|
| `packages/shared/src/selection/` | **100% lines** — safety-critical |
| `worker/src/services/` (future) | 80% lines |
| `apps/web/src/game/` (future) | 80% lines |
| React presentational components | not tracked |

---

## 9. Building

```bash
pnpm -r build         # whole workspace
pnpm --filter @fc26/web run build   # web only → apps/web/dist
pnpm --filter @fc26/worker run build # worker only → typecheck only, no bundle
```

The web build is what gets deployed to GitHub Pages by
`.github/workflows/deploy.yml`. The Worker does not have a traditional
build step — `wrangler deploy` bundles on the fly.

---

## 10. What works without Cloudflare bindings

As of Phase 1 read-side, the Worker boots and serves **every** route with
in-memory fallbacks when `env.DB` or `env.SQUADS` are undefined:

| Route | Works in-memory? | Notes |
|---|---|---|
| `GET /api/health` | ✅ | No deps |
| `GET /api/version` | ✅ | Reads env vars |
| `GET /api/squads/versions` | ✅ | Returns `{"versions":[]}` from `InMemorySquadVersionRepository` |
| `GET /api/squads/latest` | ⚠️ | Returns 503 `no_squad_data` (honest — nothing ingested) |
| `GET /api/squads/:version/clubs` | ⚠️ | Returns 404 unless you seed the in-memory store programmatically |
| `GET /api/squads/:version/players/:clubId` | ⚠️ | Same |
| `GET /api/squads/:version/diff` | ⚠️ | Same |

The in-memory store is per-process and per-request-chain — it **does not
persist across Worker restarts**. This is deliberate: it lets the scaffold
boot on any machine, but forces you to stand up real D1/R2 (even locally)
before Phase 2 begins.

---

## 11. Configuring local Cloudflare resources (when you need them)

**You do not need any of this until Phase 2 (Rooms & Gamers) or Phase 1
write-side (squad-sync cron).** Skip this section until the README says
otherwise.

When the time comes:

### 11.1 Local-only D1 (no Cloudflare account)

```bash
# Uncomment the [[d1_databases]] block in worker/wrangler.toml first.
# Then:
cd worker
pnpm exec wrangler d1 create fc26                      # prints a database_id
# Paste database_id into wrangler.toml.
pnpm exec wrangler d1 migrations apply fc26 --local   # seeds .wrangler/state/
```

`wrangler dev` will pick up the local SQLite file automatically and bind it
to `env.DB`. `dependencies.ts` will then return `D1SquadVersionRepository`
instead of the in-memory fallback.

### 11.2 Local-only R2

```bash
# Uncomment the [[r2_buckets]] block in worker/wrangler.toml first.
cd worker
pnpm exec wrangler r2 bucket create fc26-squads       # --local flag for dev-only
```

Wrangler emulates R2 in `.wrangler/state/`. `dependencies.ts` will return
`R2SquadStorage` once the binding is present.

### 11.3 Remote Cloudflare (only for deploys)

Needed only to run `wrangler deploy` or the GitHub Actions workflow. See
`FC26_TeamPicker_Handoff.md` and `.github/workflows/deploy.yml`:

| Kind | Name | Where to set |
|---|---|---|
| Secret | `CLOUDFLARE_API_TOKEN` | GitHub repo → Settings → Secrets |
| Secret | `CLOUDFLARE_ACCOUNT_ID` | same |
| Variable | `VITE_API_BASE` | GitHub repo → Settings → Variables |
| Variable | `RUN_D1_MIGRATIONS` | set to `true` once D1 binding is provisioned |

---

## 12. Common workflows

### Adding a new Worker route

1. Create `worker/src/routes/<name>.ts`. Import `AppContext` from `../app.js`.
2. Export a `Hono<AppContext>` instance. Mount it in `worker/src/app.ts` via
   `app.route('/api', <name>Routes)`.
3. Access dependencies via `c.get('deps').<whatever>` — never construct R2
   or D1 clients directly in a route.
4. Write the test in `worker/src/routes/<name>.test.ts` using
   `buildApp({ dependencies: () => ({ ... in-memory fakes ... }) })`.
5. Run `pnpm --filter @fc26/worker test:run` to confirm.

### Adding a new selection strategy (Phase 3 is already complete — use as template)

1. Create `packages/shared/src/selection/strategies/<name>.ts` implementing
   `IGamerSelectionStrategy`. Pure; inject `rng` and `now`; never call
   `Math.random` or `Date.now`.
2. Register it in `packages/shared/src/selection/registry.ts`:
   `register(yourStrategy)` — this auto-wraps it in `withValidator`.
3. Tests auto-expand via `describe.each` in `strategies.test.ts` — your
   strategy gets the full contract suite for free. Add strategy-specific
   behaviour tests in the same file.

### Adding a DB table

1. Create `worker/src/db/migrations/NNNN_description.sql` with the next
   number. Additive only — never edit past migrations.
2. Update the schema version in `worker/wrangler.toml` (`SCHEMA_VERSION`)
   and the `schema_migrations` insert at the bottom of your SQL file.
3. Add an `IFooRepository` interface, an `InMemoryFooRepository` (for tests),
   a `D1FooRepository` (for prod), and wire both into `dependencies.ts`.
4. Apply locally: `pnpm exec wrangler d1 migrations apply fc26 --local`.

---

## 13. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `pnpm: command not found` | pnpm not installed | `npm install -g pnpm@9.15.0` |
| `ERR_PNPM_WORKSPACE_PKG_NOT_FOUND @fc26/shared` | Fresh checkout, never installed | `pnpm install --frozen-lockfile` from repo root |
| Web shows "failed to fetch version" | Worker not running, or wrong `VITE_API_BASE` | Check Terminal 1 is running wrangler; confirm `apps/web/.env.local` exists |
| Web calls `/api/version` on port 5173 (404) | Missing or stale `.env.local` | Create `apps/web/.env.local` with `VITE_API_BASE=http://localhost:8787`, **restart Vite** (env vars are read at startup) |
| CORS error in browser console | Request origin doesn't match Worker CORS | Worker CORS echoes any origin — if you see this, the Worker is probably not running; check port 8787 |
| Wrangler: `Error: No bindings found` | Uncommented binding block in wrangler.toml without provisioning | Either re-comment the block or run `wrangler d1 create` / `wrangler r2 bucket create` |
| Typecheck fails with `Cannot find module '@fc26/shared'` | Workspace not installed | `pnpm install` from repo root (not from a sub-package) |
| Vitest hangs forever | Watch mode | Use `test:run` (non-watch) or press `q` |
| Triple-tap Console does not appear | Taps too slow (> 600 ms apart) | Try faster; see `apps/web/src/debug/use-triple-tap.ts` for the window constant |
| iOS Safari bottom nav covered by home indicator | Missing safe-area CSS | `BottomNav.tsx` already uses `env(safe-area-inset-bottom)`; check `index.html` has `viewport-fit=cover` |
| `wrangler dev` port 8787 already in use | Leftover process | `pnpm exec wrangler dev --port 8788` and update `VITE_API_BASE` + `.claude/launch.json` |
| Phone can reach `http://<IP>:5173` but the SPA shows a network error | `VITE_API_BASE` still `localhost:8787` | Update `.env.local` to your LAN IP; **restart Vite** (env vars are read at startup only) |
| Phone gets a timeout on `http://<IP>:5173` | Windows Defender Firewall blocking inbound | Allow Node.js on "Private networks" in the Windows firewall prompt, or add explicit rules — see §17 |
| Phone gets a timeout on `http://<IP>:8787` but `:5173` works | Stale Wrangler child process from earlier session | `netstat -ano \| grep :8787` — kill any extra PIDs bound to `127.0.0.1:8787`, then restart the worker |
| Phone resolves `<hostname>` via desktop but not from iPhone | No mDNS responder + iOS won't use unicast DNS for bare names | See §17 — install Bonjour Print Services, or just use the LAN IP with a DHCP reservation |
| Phone cannot reach anything on the LAN | AP isolation / guest Wi-Fi | Switch to a trusted network; guest networks block LAN-to-LAN traffic by design |
| Windows firewall prompt never appears on first phone connection | Already dismissed, or creating rule without a prompt | Create explicit rules in an elevated PowerShell — see §17 for the exact commands |

---

## 14. Shutting down

### Via Claude Code preview harness

```
mcp__Claude_Preview__preview_stop { name: "web" }
mcp__Claude_Preview__preview_stop { name: "worker" }
```

### Via plain pnpm

`Ctrl-C` in each terminal. Wrangler and Vite both clean up on SIGINT.

---

## 15. Current phase status (for AI agents picking up work)

As of this document's last update:

| Phase | Status |
|---|---|
| 0 — Scaffold | ✅ done |
| 1 — Squad Sync read-side (types, `diffSquads`, storage, repo, routes) | ✅ done |
| 1 — Squad Sync write-side (`tools/squad-sync`, cron worker, logo caching) | ⏳ pending |
| 2 — Rooms & Gamers | ⏭ next |
| 3 — Selection Strategies | ✅ done (landed in Phase 0) |
| 4–11 | ⏳ pending |

See `FC26_TeamPicker_Handoff.md` §23 for the full phase plan.

**Green-field indicators to verify before declaring a phase complete:**
- `pnpm -r typecheck` clean
- `pnpm -r test:run` green
- New work has tests in the same commit (rule from `FC26_TeamPicker_Handoff.md` §22)
- No `Math.random` or `Date.now` in logic paths — inject `rng` / `now`

---

## 16. Quick reference card

```bash
# Install
pnpm install --frozen-lockfile

# Verify
pnpm -r typecheck && pnpm -r test:run

# Run (two terminals)
pnpm dev:worker   # → http://localhost:8787
pnpm dev:web      # → http://localhost:5173

# Smoke test
curl http://localhost:8787/api/health
curl http://localhost:8787/api/version
open http://localhost:5173    # macOS; use `start` on Windows, `xdg-open` on Linux

# Build
pnpm -r build

# Required config file
apps/web/.env.local:
  VITE_API_BASE=http://localhost:8787
```

---

## 17. Accessing dev servers from a phone on the same Wi-Fi

Testing Game mode on an actual iPhone is part of the normal inner loop —
the UX decisions in the handoff (triple-tap Console, thumb-reach bottom nav,
100dvh keyboard handling) cannot be judged in Chrome DevTools alone.

### 17.1 What the repo already does

- `apps/web/vite.config.ts` sets `server.host: true` → Vite binds `0.0.0.0`.
- `worker/wrangler.toml` has `[dev] ip = "0.0.0.0"` → Wrangler binds the LAN interface too.
- Worker CORS is permissive: `cors({ origin: (origin) => origin, credentials: true })`.
- `.claude/launch.json` runs both servers via `preview_start`.

So the only thing you need to configure per-machine is your LAN IP in
`apps/web/.env.local`, plus (if you want hostname access) the mDNS
question covered below.

### 17.2 Step-by-step: connect by LAN IP

1. **Find your LAN IP on the dev machine.**
   ```bash
   ipconfig                        # Windows — look at the "Wi-Fi" adapter IPv4
   ifconfig en0 | grep "inet "     # macOS
   ip -4 addr show wlan0           # Linux
   ```
   Example result: `10.0.0.95`.

2. **Set that IP in `apps/web/.env.local`:**
   ```
   VITE_API_BASE=http://10.0.0.95:8787
   ```
   > **Why not `localhost`?** On the iPhone, `localhost` resolves to the
   > iPhone itself. When the SPA (served by Vite over the LAN) tries to fetch
   > `http://localhost:8787/api/version`, the phone asks itself — which is
   > not where your Worker lives. You must use an address the phone can
   > route to, so the LAN IP (or a hostname that resolves to it).

3. **Restart Vite** (env vars are read only at startup):
   ```
   preview_stop { serverId: ... web }
   preview_start { name: "web" }
   ```

4. **On iPhone Safari, open:**
   ```
   http://10.0.0.95:5173
   ```

5. **Triple-tap the round FC26 logo** in the bottom nav to open the Debug
   Console. You should see both client entries and worker entries (piped
   via the `x-fc26-logs` response header). If only client entries appear,
   the XHR to the Worker is failing — check `VITE_API_BASE` or the firewall.

### 17.3 Windows Firewall (first connection)

First time a phone connects, Windows Defender usually pops a prompt asking
whether to allow Node.js (or `workerd.exe`) on private networks. **Click
Allow** for "Private networks" only.

If you already dismissed the prompt and now the phone times out, add
explicit rules in an **elevated** PowerShell (run once):

```powershell
New-NetFirewallRule -DisplayName "Vite dev 5173"     -Direction Inbound -LocalPort 5173 -Protocol TCP -Action Allow -Profile Private
New-NetFirewallRule -DisplayName "Wrangler dev 8787" -Direction Inbound -LocalPort 8787 -Protocol TCP -Action Allow -Profile Private
```

To remove them later:
```powershell
Remove-NetFirewallRule -DisplayName "Vite dev 5173"
Remove-NetFirewallRule -DisplayName "Wrangler dev 8787"
```

### 17.4 Hostname access — why `http://<hostname>:5173` usually fails from iPhone

Working by IP is enough for most dev work, but hostnames are nicer to type
and survive IP changes. Here's why the bare hostname typically fails and
how to fix it.

**Root cause:** iOS Safari (since iOS 14) refuses to send single-label
names like `vugi-lt` through unicast DNS for security reasons — it will
only query them via **mDNS/Bonjour** (which expects a `.local` suffix).
Consumer Wi-Fi routers usually have an internal DNS that resolves short
DHCP hostnames to LAN IPs, but the iPhone never asks it.

**Diagnostic trio** (run all three to confirm the cause on any new network):
```bash
# 1. Does Windows resolve the short name locally?
powershell -Command "Resolve-DnsName -Name <hostname>"

# 2. Does the router publish the short name via DNS?
nslookup <hostname> <router-IP>

# 3. Does any mDNS responder exist on Windows?
powershell -Command "Get-Service -Name 'Bonjour Service' -ErrorAction SilentlyContinue"
```

If (1) works but (3) shows nothing, you're in the "works from dev machine
but not from iPhone" state. Pick one of the three fixes below.

#### Fix A — Install Bonjour Print Services for Windows (recommended for daily phone use)

Apple's free mDNS responder for Windows. ~3 MB, clean single-service
install (`Bonjour Service`). Download from Apple Support and run the
installer. Once running, it publishes `<COMPUTERNAME>.local` on every
interface. From iPhone: `http://<computername>.local:5173` just works.

Remember to update `apps/web/.env.local` accordingly:
```
VITE_API_BASE=http://<computername>.local:8787
```
…and restart Vite.

> **Uninstall path:** Control Panel → Programs → Bonjour → Uninstall. Clean.

#### Fix B — DHCP reservation + keep using the IP (no install)

Open the router admin (usually http://10.0.0.1 or http://192.168.1.1),
find **DHCP Reservations** / **Static Leases**, and pin the dev machine's
Wi-Fi MAC to the current IP. IP now survives reboots, router restarts,
and lease renewals. No software install, works instantly. This is what
most devs actually do.

#### Fix C — Cloudflare Tunnel (HTTPS + stable hostname + works off-network)

Needed anyway from Phase 9 onward (Service Workers and install-to-home-screen
require HTTPS on iOS Safari).

```bash
# One-time install (winget, or download from cloudflare.com)
winget install --id Cloudflare.cloudflared

# Ephemeral tunnel, no account needed
cloudflared tunnel --url http://localhost:5173
# → prints a random https://*.trycloudflare.com URL
```

Update `apps/web/.env.local` to point at a second tunnel for the Worker,
or wire both through a single tunnel with routing. This is more setup than
A or B, but pays off at Phase 9.

### 17.5 AP isolation / guest networks

If the phone can reach the internet but not the dev machine, you're
probably on a network with **AP isolation** (also called "client
isolation", "guest mode", "privacy separator"). Guest SSIDs on home
routers and almost all corporate/café Wi-Fi enable this by default —
it blocks LAN-to-LAN traffic entirely, so no amount of firewall or
hostname tweaking will help.

**Fixes:**
- Switch both devices to the same non-guest SSID on your home router.
- Or use a Cloudflare Tunnel (§17.4 Fix C) — that routes through the
  internet and bypasses AP isolation entirely.
- Or enable personal hotspot on the phone and join the laptop to it;
  hotspots usually don't isolate clients.

### 17.6 Reverting to desktop-only dev

When the phone tests are done and you want to scope things back down:

```bash
# apps/web/.env.local
VITE_API_BASE=http://localhost:8787
```

The `host: true` / `[dev] ip = "0.0.0.0"` settings can stay — they're
harmless on a loopback-only desktop session (Vite and Wrangler still
listen on `localhost` as a subset of `0.0.0.0`). Only remove them if
you're on an untrusted network and want to be paranoid.
