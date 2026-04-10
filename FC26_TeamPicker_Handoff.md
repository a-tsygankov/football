# FC 26 Team Picker — Architecture & Implementation Handoff

**Stack:** TypeScript · Vite · React · Cloudflare Workers · D1 · R2
**Target devices:** Android and iPhone phones (mobile-first PWA)
**Document version:** 2 (2026-04-10) — supersedes the original `.docx` handoff

---

## Table of Contents

1. [Product Overview](#1-product-overview)
2. [Target Devices & UX Principles](#2-target-devices--ux-principles)
3. [Terminology](#3-terminology)
4. [System Architecture](#4-system-architecture)
5. [Monorepo Layout](#5-monorepo-layout)
6. [Technology Choices & Rationale](#6-technology-choices--rationale)
7. [IRepository Pattern](#7-irepository-pattern)
8. [Database Schema (D1 / SQLite)](#8-database-schema-d1--sqlite)
9. [Event Sourcing & Read Models](#9-event-sourcing--read-models)
10. [Squad Data Pipeline](#10-squad-data-pipeline)
11. [Worker API Routes](#11-worker-api-routes)
12. [Frontend Feature Map](#12-frontend-feature-map)
13. [Game Flow (Detailed)](#13-game-flow-detailed)
14. [Gamer Selection Strategies](#14-gamer-selection-strategies)
15. [Draw Engine](#15-draw-engine)
16. [Rooms & Authentication](#16-rooms--authentication)
17. [Logging Architecture](#17-logging-architecture)
18. [Hidden Console UI](#18-hidden-console-ui)
19. [Game Result Entry & OCR](#19-game-result-entry--ocr)
20. [Time Handling (UTC / Local)](#20-time-handling-utc--local)
21. [Versioning Strategy](#21-versioning-strategy)
22. [Design Principles & Testing](#22-design-principles--testing)
23. [Implementation Phases](#23-implementation-phases)
24. [Key Decisions Summary](#24-key-decisions-summary)
25. [Open Items](#25-open-items)
26. [Appendix: External Dependencies](#26-appendix-external-dependencies)

---

## 1. Product Overview

A browser-based, mobile-first game companion that automates the ritual of picking squads for FC 26 sessions among a group of friends. Gamers are persistent across devices via a room system. Every step of the game flow can be skipped. All squad data is sourced from EA's official content delivery network and refreshed daily.

The web app has **four major modes**:

| # | Mode | Purpose |
|---|---|---|
| 1 | **Game** | 7-step wizard to pick gamers, sides, constraints, clubs, and record the result. Every step has a Skip button. |
| 2 | **Dashboard** | Per-gamer and per-gamer-team stats, scoreboards, head-to-head, recent games. |
| 3 | **View Teams** | Browse FC26 clubs and individual footballers. Attribute tables, radar diagrams, change indicators. |
| 4 | **Update Changes** | Diff browser over historical squad versions. Shows player/club deltas between EA releases. |

### Game Flow (7 Steps)

| Step | Description |
|---|---|
| 1 — Gamer Select | Choose who is playing. Game size is **exactly 2 or 4**. If the roster is larger than the chosen game size, pick a subset manually or via a selection strategy. |
| 2 — Side Assignment | Split gamers to Home / Away. Tap-to-flip, pure random, or rating-weighted random. |
| 3 — Constraints | Set filters: star range, leagues, same-league toggle. All optional. |
| 4 — Team Draw | Draw two clubs matching constraints. Show logo, stars, ATT/MID/DEF. Re-roll freely. |
| 5 — Enter Result | Tap winner (Home / Draw / Away), enter numeric score, or photograph the result screen for OCR. |
| 6 — Stats Update | `game_recorded` event appended; `gamer_points` and `gamer_team_points` projections updated atomically. |
| 7 — Summary | Per-gamer win rates, goal diff, recent games, head-to-head breakdowns. |

> **Note:** Every step exposes a Skip button that applies a sensible default and advances to the next step. No step is mandatory.

---

## 2. Target Devices & UX Principles

**Primary devices:** Android and iPhone phones. Install-to-home-screen PWA. No native wrapper planned (Capacitor is an option if App Store presence is ever needed).

**Convenience and usability are the overriding design criteria.** Principles:

- **Bottom nav, not top.** Thumbs don't reach the top of a phone. Primary actions (Next, Skip, Back) live in a sticky bottom bar.
- **Skip is always visible but visually de-emphasized** (text button). Next is the filled CTA.
- **Progress bar with tappable dots** — back-navigate to any completed step without a back-button stack.
- **Haptics on every state change** (`navigator.vibrate(10)`).
- **Undoable toasts instead of confirmation modals** for destructive-but-reversible actions ("Game deleted. Undo"). Modals only for truly irreversible things.
- **Optimistic updates; no spinners under 300 ms.** Roll back on error. Edge latency is typically 20–50 ms.
- **Tap-to-flip instead of drag-and-drop** on Side Assignment — drag is fiddly on small screens. Drag stays as a fallback.
- **Forms as wizards, never as long scroll.** One decision per screen.
- **Font size ≥ 16px on all inputs** to suppress iOS Safari's auto-zoom.
- **Install-to-home-screen nudge** appears after the first completed game, never on first load.
- **`100dvh` everywhere** (not `100vh`) to survive the iOS Safari bottom-bar bug.
- **Camera access requires HTTPS** — fine on Cloudflare Pages.

---

## 3. Terminology

| Term | Meaning | Table / Type |
|---|---|---|
| **gamer** | A human in the friend group who plays FC 26 | `gamers` |
| **gamer-team** | Ad-hoc pairing of gamers on one side of a match | `gamer_team_points` (key = hash of sorted gamer IDs) |
| **fc player** | Individual FC26 footballer inside a club | Stored in R2 shards `squads/{version}/players/{clubId}.json` |
| **club / fc club** | FC26 team (Man City, Real Madrid, etc.) | Stored in R2 `squads/{version}/clubs.json` |
| **game** | A single match played in a session | `game_events` (append-only write model) |
| **room** | A group of friends sharing a leaderboard | `rooms` |

**Never use "players" for humans.** It collides with FC26 footballers. Always "gamers" for humans.

---

## 4. System Architecture

The entire stack runs on Cloudflare's edge network. There is no separate origin server.

| Layer | Technology |
|---|---|
| Frontend SPA | Vite + React + TypeScript → Cloudflare Pages |
| API Layer | Cloudflare Workers (Hono framework) |
| Relational Database | Cloudflare D1 (SQLite at edge) |
| Asset / Blob Storage | Cloudflare R2 (squad JSON, club logos) |
| Cron / Background Jobs | Cloudflare Workers Cron Triggers |
| Shared Types | pnpm workspace package `@fc26/shared` |

---

## 5. Monorepo Layout

```
fc26-picker/
  apps/web/                    # Vite + React SPA
    src/
      game/                    # session state machine
      features/                # one folder per screen
      modes/                   # game | dashboard | view-teams | update-changes
      components/              # shared UI primitives
      stores/                  # Zustand slices
      lib/                     # API client, utils, logger
      debug/                   # hidden Console
  worker/                      # Cloudflare Worker
    src/
      routes/                  # Hono route handlers
      services/                # squad sync, score extraction, projection
      db/
        repositories/          # IRepository impls
        schema.ts              # Drizzle schema
        migrations/            # NNNN_desc.sql + optional NNNN_desc.ts
      middleware/              # repos, auth, logging, correlation
  tools/
    squad-sync/                # Node.js one-shot scraper (local use)
  packages/
    shared/                    # DTOs, types, selection strategies, time utils
      src/
        selection/             # IGamerSelectionStrategy + strategies
        time/                  # UTC <-> local helpers
        types/                 # domain types, DTOs, events
  package.json                 # pnpm workspaces root
```

---

## 6. Technology Choices & Rationale

### Hono (Worker API Framework)
Cloudflare Workers expose a raw `fetch(request, env)` handler. Hono provides Express-style routing with zero Node.js dependencies, first-class TypeScript support, and the smallest bundle overhead (~12 KB) of any comparable router.

**Alternatives considered:**
- `itty-router` — smaller but no middleware chain; unergonomic for 15+ routes.
- Express — incompatible with Workers (requires Node.js APIs).
- Raw fetch handler — viable for 3 routes, unmanageable beyond that.

### Zustand (Frontend State)
The game session is a multi-step wizard where each step reads and writes shared state. Zustand is ~1 KB, requires no Provider wrapping, triggers re-renders only in subscribed components, and has devtools support.

**Alternatives considered:**
- Redux Toolkit — correct for large apps; excessive boilerplate for this scope.
- Context + useReducer — causes full subtree re-renders on every change.

### TanStack Router
Route parameters (`/rooms/:roomId/game/:step`) feed directly into typed API calls. TanStack Router is type-safe from the ground up; React Router v6 bolts types on after the fact.

### Drizzle ORM
D1 is SQLite. Raw D1 queries return `unknown[]`; you cast manually everywhere. Drizzle defines the schema in TypeScript, generates migrations from it, and makes query results fully typed. **The schema IS the source of truth** for both the DB and TypeScript types.

### Why D1 and not R2 JSON files for mutable data
R2 is object storage, not a database. It has no query capability. D1 runs aggregations in under 5 ms on the edge.

| Need | R2 | D1 |
|---|---|---|
| "All gamers in room X" | Load whole JSON blob | `WHERE room_id = ?` |
| Win rate per gamer | Load all games, compute in JS | Aggregation query |
| Last 10 games | Load all, sort, slice | `ORDER BY LIMIT 10` |
| Concurrent writes (2 phones) | Race condition → data loss | Atomic transaction |
| Add a column later | Rewrite all JSON blobs | `ALTER TABLE` migration |

R2 is still used for its strengths: versioned squad JSON and club logo images — large static assets that never need querying.

### Recharts
Already in the stack for the Dashboard. Radar charts cover the "View Teams" per-player attribute diagrams with no new dependency.

---

## 7. IRepository Pattern

All database access is isolated behind interfaces. No business logic or route handler ever touches D1 directly. This gives:

- **Production** uses D1 implementations.
- **Tests** use in-memory implementations (no `wrangler dev`, no D1 spin-up, millisecond test runs).
- **Future storage migration** requires swapping only the implementation class.

### Base Interface

```ts
// packages/shared/src/types/repository.ts
export interface IRepository<T, CreateDTO, UpdateDTO = Partial<CreateDTO>> {
  findById(id: string):           Promise<T | null>
  create(dto: CreateDTO):         Promise<T>
  update(id: string, dto: UpdateDTO): Promise<T>
  delete(id: string):             Promise<void>
}
```

### Domain Interfaces

| Interface | Extends / Extra Methods |
|---|---|
| `IRoomRepository` | `IRepository<Room, CreateRoomDTO>` + `findByIdWithGamers(id)` |
| `IGamerRepository` | `IRepository<Gamer, ...>` + `findAllByRoom(roomId)` + `findActive(roomId)` |
| `IGameEventRepository` | `append(event)` + `findByRoom(roomId, since?, limit?)` + `findByCorrelation(id)` — **append-only, no update/delete** |
| `IGamerPointsRepository` | `findByRoom(roomId)` + `findByGamer(gid)` + `applyDelta(gid, delta)` |
| `IGamerTeamPointsRepository` | `findByRoom(roomId)` + `findByKey(teamKey)` + `applyDelta(key, delta)` |
| `ISquadVersionRepository` | `listVersions()` + `findLatest()` + `findByVersion(v)` |
| `IPinAttemptRepository` | `recordAttempt(roomId, ip)` + `isLockedOut(roomId, ip)` |

### Dependency Injection via Hono Middleware

```ts
// worker/src/middleware/repositories.ts
export function withRepositories(): MiddlewareHandler {
  return async (c, next) => {
    const db = c.env.DB
    c.set('repos', {
      rooms:          new D1RoomRepository(db),
      gamers:         new D1GamerRepository(db),
      events:         new D1GameEventRepository(db),
      gamerPoints:    new D1GamerPointsRepository(db),
      teamPoints:     new D1GamerTeamPointsRepository(db),
      squadVersions:  new D1SquadVersionRepository(db),
      pinAttempts:    new D1PinAttemptRepository(db),
    } satisfies Repos)
    await next()
  }
}
```

Route handlers receive typed repos via `c.get('repos')` and never reference D1 bindings directly.

---

## 8. Database Schema (D1 / SQLite)

### Tables

| Table | Purpose |
|---|---|
| `rooms` | A group of friends sharing a leaderboard. Optional PIN hash. |
| `gamers` | Humans belonging to a room. Soft-deleted via `active` flag. |
| `game_events` | **Append-only write model.** Every game fact lives here. |
| `gamer_points` | Projection: per-gamer win/loss/goal counters. |
| `gamer_team_points` | Projection: per-gamer-team (ad-hoc pairing) counters. |
| `squad_versions` | Registry of historical squad versions stored in R2. |
| `pin_attempts` | Throttle table for room PIN retries. |
| `schema_migrations` | Tracks applied Drizzle migrations. |

### DDL

```sql
CREATE TABLE rooms (
  id                         TEXT PRIMARY KEY,     -- nanoid, share-friendly
  name                       TEXT NOT NULL,
  pin_hash                   TEXT,                 -- nullable; PBKDF2
  pin_salt                   TEXT,                 -- nullable
  default_selection_strategy TEXT NOT NULL DEFAULT 'uniform-random',
  created_at                 INTEGER NOT NULL,     -- UTC millis
  updated_at                 INTEGER NOT NULL      -- UTC millis
);

CREATE TABLE gamers (
  id         TEXT PRIMARY KEY,
  room_id    TEXT NOT NULL REFERENCES rooms(id),
  name       TEXT NOT NULL,
  rating     INTEGER NOT NULL DEFAULT 3,           -- 1..5
  active     INTEGER NOT NULL DEFAULT 1,           -- soft delete
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_gamers_room ON gamers(room_id, active);

-- Append-only event log — NO UPDATE or DELETE allowed by repository
CREATE TABLE game_events (
  id             TEXT PRIMARY KEY,                 -- nanoid
  room_id        TEXT NOT NULL REFERENCES rooms(id),
  event_type     TEXT NOT NULL,                    -- 'game_recorded' | 'game_voided'
  payload        TEXT NOT NULL,                    -- JSON
  schema_version INTEGER NOT NULL,                 -- event schema version
  correlation_id TEXT,                             -- ties to a request for log merging
  occurred_at    INTEGER NOT NULL,                 -- UTC millis (when the game was played)
  recorded_at    INTEGER NOT NULL                  -- UTC millis (when the row was inserted)
);
CREATE INDEX idx_events_room_time ON game_events(room_id, occurred_at);
CREATE INDEX idx_events_correlation ON game_events(correlation_id);

-- Per-gamer projection
CREATE TABLE gamer_points (
  gamer_id      TEXT PRIMARY KEY REFERENCES gamers(id),
  room_id       TEXT NOT NULL REFERENCES rooms(id),
  games_played  INTEGER NOT NULL DEFAULT 0,
  wins          INTEGER NOT NULL DEFAULT 0,
  draws         INTEGER NOT NULL DEFAULT 0,
  losses        INTEGER NOT NULL DEFAULT 0,
  goals_for     INTEGER NOT NULL DEFAULT 0,
  goals_against INTEGER NOT NULL DEFAULT 0,
  last_event_id TEXT NOT NULL,                     -- high-water mark for rebuild
  updated_at    INTEGER NOT NULL
);
CREATE INDEX idx_gamer_points_room ON gamer_points(room_id);

-- Per-gamer-team projection
CREATE TABLE gamer_team_points (
  gamer_team_key TEXT PRIMARY KEY,                 -- hash of sorted gamer IDs
  room_id        TEXT NOT NULL REFERENCES rooms(id),
  members_json   TEXT NOT NULL,                    -- [gamerId, ...] for display
  games_played   INTEGER NOT NULL DEFAULT 0,
  wins           INTEGER NOT NULL DEFAULT 0,
  draws          INTEGER NOT NULL DEFAULT 0,
  losses         INTEGER NOT NULL DEFAULT 0,
  goals_for      INTEGER NOT NULL DEFAULT 0,
  goals_against  INTEGER NOT NULL DEFAULT 0,
  last_event_id  TEXT NOT NULL,
  updated_at     INTEGER NOT NULL
);
CREATE INDEX idx_team_points_room ON gamer_team_points(room_id);

CREATE TABLE squad_versions (
  version      TEXT PRIMARY KEY,                   -- e.g. 'fc26-r12'
  released_at  INTEGER NOT NULL,
  ingested_at  INTEGER NOT NULL,
  source_url   TEXT NOT NULL,                      -- GitHub release URL
  notes        TEXT
);

CREATE TABLE pin_attempts (
  room_id       TEXT NOT NULL,
  ip            TEXT NOT NULL,
  attempts      INTEGER NOT NULL DEFAULT 0,
  locked_until  INTEGER,                           -- UTC millis
  PRIMARY KEY (room_id, ip)
);

CREATE TABLE schema_migrations (
  version     INTEGER PRIMARY KEY,
  applied_at  INTEGER NOT NULL,
  description TEXT NOT NULL
);
```

### Constraints and conventions

- **Every `*_at` column is `INTEGER NOT NULL` UTC milliseconds.** Never TEXT ISO strings.
- **Every mutable table has `created_at` and `updated_at`.** Drizzle `timestamps()` helper.
- **`game_events` is append-only.** The repository interface does not expose update or delete. Corrections are expressed as new events (`game_voided` + a new `game_recorded`).
- **Game size constraint:** `GameSize = 2 | 4` enforced at the type layer, Zod boundary, and event payload validation. No `CHECK(size IN (2, 4))` column because size lives inside the event payload.

---

## 9. Event Sourcing & Read Models

### Why

The user requirement: *"Game results should be kept in append-only log with references to gamer-teams, fc-teams, individual gamers, (score, winner-draw). We may need to have 2 read-models for gamers and gamer teams points."*

This is CQRS-lite. The write model is a log of facts; the read models are derived counters that can always be rebuilt from the log.

### Event Types

```ts
// packages/shared/src/types/events.ts

export type EventType = 'game_recorded' | 'game_voided'

export interface GameRecordedEvent {
  type: 'game_recorded'
  schemaVersion: 1
  gameId: string                      // nanoid, unique per game
  roomId: string
  size: 2 | 4
  occurredAt: number                  // UTC millis (when it was played)

  home: {
    gamerIds: string[]                // length 1 (for 2) or 2 (for 4)
    gamerTeamKey: string              // hash of sorted gamerIds
    clubId: number
    score: number | null              // null if only winner was recorded
  }
  away: {
    gamerIds: string[]
    gamerTeamKey: string
    clubId: number
    score: number | null
  }

  result: 'home' | 'away' | 'draw'
  squadVersion: string                // which squad dataset was used

  selectionStrategyId: string         // which strategy picked these gamers
  entryMethod: 'manual' | 'ocr'       // how the result was entered
  ocrModel?: string                   // if entryMethod === 'ocr'
}

export interface GameVoidedEvent {
  type: 'game_voided'
  schemaVersion: 1
  gameId: string                      // refers to a previous game_recorded
  roomId: string
  occurredAt: number
  reason: string
}
```

### Write Path

```
POST /api/rooms/:roomId/games/:gameId/result
  1. Validate payload with Zod
  2. BEGIN TRANSACTION
  3. INSERT INTO game_events (append)
  4. UPDATE gamer_points       (apply delta per gamer)
  5. UPDATE gamer_team_points  (apply delta per side)
  6. COMMIT
  7. Log every step to the correlation-scoped logger
```

All four writes happen in a single D1 transaction. If any fails, the event is not persisted.

### Projection Service

```ts
// worker/src/services/projections.ts
export interface IProjectionService {
  apply(event: GameEvent): Promise<void>
  rebuild(roomId: string): Promise<void>   // replays all events for the room
}
```

`rebuild()` is how you recover from a projection bug: `pnpm rebuild-projections --room=XYZ`. It zeroes the two projection tables for that room, reads all events in `occurred_at` order, and re-applies them. Because strategies and projection logic are pure, this is deterministic.

### Gamer-Team Key

```ts
// packages/shared/src/types/gamer-team.ts
export function gamerTeamKey(gamerIds: readonly string[]): string {
  const sorted = [...gamerIds].sort()
  return `gt_${sorted.join('_')}`   // stable, human-readable, collision-free per room
}
```

`{Alice, Bob}` and `{Bob, Alice}` collapse to the same key. This means the `gamer_team_points` table naturally aggregates across all games that pairing has played together — regardless of which side they were on.

---

## 10. Squad Data Pipeline

EA pushes squad updates to a public CDN used by the game client. The community tool [`xAranaktu/FIFASquadFileDownloader`](https://github.com/xAranaktu/FIFASquadFileDownloader) reverse-engineers the endpoint and decodes the binary `.sqb` files into usable data.

A Cloudflare Worker Cron checks daily for a new GitHub Release from that tool and re-ingests when the version changes. **Historical versions are retained** so the "Update Changes" mode can diff across releases.

### Pipeline Steps

1. Cron Worker fires at 06:00 UTC daily.
2. Fetch latest release metadata from the GitHub Releases API (public, no auth).
3. Compare version tag against `squad_versions` in D1.
4. **On version change:**
   1. Download the release asset (squad data).
   2. Parse and normalize to `Club[]` and `FcPlayer[]`.
   3. Fetch club logos from EA asset CDN, store in R2 keyed by club ID (only for new clubs).
   4. Write sharded data to R2 under `squads/{version}/`:
      - `clubs.json` (~500 KB — drives the teams list)
      - `players/{clubId}.json` (~5 KB each, loaded on demand)
      - `diff-from-{prevVersion}.json` (precomputed delta vs previous version)
   5. Update the `latest` pointer: `squads/latest.json` = `{ "version": "fc26-r12" }`.
   6. Insert a row into `squad_versions`.
   7. Delete oldest version if total exceeds 12.
5. Log every step through the correlation-scoped logger.

### R2 Layout

```
squads/
  latest.json                      # { "version": "fc26-r12" }
  fc26-r12/
    clubs.json
    players/
      1.json
      2.json
      ...
    diff-from-fc26-r11.json
  fc26-r11/
    ...
logos/
  1.png
  2.png
  ...
```

### Club Shape

```ts
interface Club {
  id:            number
  name:          string
  shortName:     string
  leagueId:      number
  leagueName:    string
  nationId:      number
  overallRating: number    // 1-99
  attackRating:  number
  midfieldRating: number
  defenseRating: number
  logoUrl:       string    // R2 public URL, stable
  starRating:    number    // Math.round(overallRating / 20)
}
```

### FC Player Shape

```ts
interface FcPlayer {
  id:        number
  clubId:    number
  name:      string
  position:  string       // 'ST', 'CAM', etc.
  nationId:  number
  overall:   number       // 1-99
  attributes: {
    pace:       number
    shooting:   number
    passing:    number
    dribbling:  number
    defending:  number
    physical:   number
  }
}
```

### Diff Shape (for Update Changes mode)

```ts
interface SquadDiff {
  fromVersion: string
  toVersion:   string
  generatedAt: number                    // UTC millis

  playerChanges: Array<{
    playerId: number
    clubId:   number
    name:     string
    changes:  Array<{
      field: 'overall' | keyof FcPlayer['attributes']
      from:  number
      to:    number
    }>
  }>

  clubChanges: Array<{
    clubId: number
    field:  'overallRating' | 'attackRating' | 'midfieldRating' | 'defenseRating' | 'starRating'
    from:   number
    to:     number
  }>

  addedPlayers:    Array<{ clubId: number, playerId: number, name: string }>
  removedPlayers:  Array<{ clubId: number, playerId: number, name: string }>
}
```

> **Note:** Logos are fetched from EA CDN only at ingest time and cached in R2. The app never depends on EA CDN at runtime, eliminating a live dependency.

---

## 11. Worker API Routes

| Endpoint | Description |
|---|---|
| `GET /api/version` | `{ workerVersion, schemaVersion, minClientVersion, builtAt }` |
| `GET /api/squads/latest` | Returns latest `clubs.json` from R2 |
| `GET /api/squads/:version/clubs` | Returns `clubs.json` for a specific version |
| `GET /api/squads/:version/players/:clubId` | Returns `players/{clubId}.json` for a club |
| `GET /api/squads/:version/diff` | Returns `diff-from-{prev}.json` |
| `GET /api/squads/versions` | Lists all stored versions |
| `POST /api/rooms` | Create room → `{ id, name }` |
| `POST /api/rooms/:id/unlock` | Submit PIN, returns signed session cookie |
| `GET /api/rooms/:id` | Room info + active gamers (requires session if PIN set) |
| `POST /api/rooms/:id/gamers` | Add gamer to room |
| `PATCH /api/rooms/:id/gamers/:gid` | Update gamer (name, rating, active) |
| `POST /api/rooms/:id/games` | Create game record (gamers, sides, clubs, strategy used) |
| `POST /api/rooms/:id/games/:gid/result` | Append `game_recorded` event, update projections |
| `POST /api/rooms/:id/games/:gid/void` | Append `game_voided` event, reverse projections |
| `POST /api/rooms/:id/games/:gid/result/parse` | Optional: photo → parsed score (OCR) |
| `GET /api/rooms/:id/events` | Paginated event log (for Dashboard and Console) |
| `GET /api/rooms/:id/points/gamers` | `gamer_points` projection |
| `GET /api/rooms/:id/points/teams` | `gamer_team_points` projection |
| `GET /api/logs?correlationId=...` | On-demand retrieval of Worker logs (overflow path) |

All room-scoped endpoints require a valid session cookie if the room has a PIN.

---

## 12. Frontend Feature Map

| Feature Module | Key Components |
|---|---|
| `room/` | `RoomJoin.tsx` (enter ID + PIN), `RoomCreate.tsx`, `RoomSettings.tsx` (strategy picker, PIN change) |
| `gamers/` | `GamerRoster.tsx` (CRUD + active toggle), `GamerCard.tsx` (name + star editor) |
| `game/select/` | `RosterSelect.tsx` (Step 1a), `LineupSelect.tsx` (Step 1b, 2/4 toggle, locks, 🎲) |
| `game/sides/` | `SideAssign.tsx` (tap-to-flip, auto-assign, drag fallback) |
| `game/draw/` | `LeagueFilter.tsx`, `TeamDraw.tsx` (club cards + re-roll) |
| `game/result/` | `GameResult.tsx` (three big buttons + numeric pad), `OcrCapture.tsx` |
| `modes/dashboard/` | `Dashboard.tsx` (charts + win rates), `GamerProfile.tsx`, `GamerTeamProfile.tsx`, `GameHistory.tsx` |
| `modes/view-teams/` | `TeamsBrowser.tsx` (list + filter), `TeamDetail.tsx`, `FcPlayerDetail.tsx` (radar + change chips) |
| `modes/update-changes/` | `VersionPicker.tsx`, `DiffBrowser.tsx`, `DiffPlayerRow.tsx` |
| `layout/` | `StepLayout.tsx` (progress dots + Skip/Back/Next controls), `BottomNav.tsx` |
| `debug/` | `Console.tsx` (triple-tap target), `LogEntryRow.tsx`, `SystemTab.tsx` |

### Game Session State Machine

```ts
type GameStep =
  | 'roster-select'     // Step 1a (if roster > chosen size)
  | 'lineup-select'     // Step 1b
  | 'side-assign'       // Step 2
  | 'league-filter'     // Step 3
  | 'team-draw'         // Step 4
  | 'game-result'       // Step 5
  | 'summary'           // Step 6/7
```

State lives in a Zustand store and survives navigation between steps. Steps advance forward only; skip applies a default. The machine is a plain TypeScript class with `next(data)`, `skip()`, and `back()` methods.

---

## 13. Game Flow (Detailed)

### Step 1 — Gamer Select

**Hard constraint:** game size ∈ `{2, 4}`.

| Roster size | Allowed game size | Flow |
|---|---|---|
| 0 or 1 | — | Blocked with "need ≥ 2 active gamers" |
| 2 | 2 | Auto-select both; skip 1b |
| 3 | 2 | Skip size toggle; pick 2 of 3 |
| 4 | 2 or 4 | Show toggle; default 4 |
| 5+ | 2 or 4 | Show toggle; default 4 |

**Sub-step 1a — Roster Select:** checklist of all active gamers. Tap to include/exclude. "Select all" and "Random toggle" shortcuts.

**Sub-step 1b — Lineup Select (only if roster > chosen size):**

- **Size toggle** (segmented control `[ 2v2 ][ 1v1 ]`) at the top. Only rendered when the roster allows both sizes. Default `4` if roster ≥ 4, else `2`. Remember last choice in localStorage per room.
- **Counter pill:** `3 / 4 selected`, sticky at top.
- **Tap to toggle.** Fourth tap disables further adds (hard cap, no silent deselection).
- **Long-press to lock** a gamer in. Locked gamers are always included by random fill.
- **`🎲 Random fill` button** — runs the active selection strategy against the unlocked slots.
- **`🎲 Random (replace)` button** — fully randomizes ignoring non-lock state.
- **Skip** = random fill, no locks.
- **Animated shuffle** when rolling — feels fair.

### Step 2 — Side Assignment

- **Tap-to-flip** is the primary interaction. Each gamer chip sits in a dock; tapping moves it to the opposite side.
- **Drag-and-drop** as a fallback (for desktop / larger screens).
- **🎲 Pure Random** — shuffle array, split at midpoint.
- **🎲 Rated Random** — sort by rating desc, alternate assignment with ±1 shuffle to prevent perfectly obvious balance.

### Step 3 — Constraints

- Star range slider (min, max).
- League multi-select (populated from current squad version).
- "Same league" toggle — when on, the draw restricts to a single league containing ≥ 2 clubs.
- Skip = no constraints.

### Step 4 — Team Draw

- Two large club cards with logo, stars, ATT/MID/DEF bars.
- **Giant re-roll button.** Swipe-left-to-reroll gesture as a shortcut.
- Animated dice on roll.
- Skip = keep current draw.

### Step 5 — Enter Result

- **Three full-width buttons** `HOME WIN` / `DRAW` / `AWAY WIN`, ~80 px tall, color-coded.
- **"Enter exact score"** link opens a numeric pad (two digits per side, default 0–0).
- **📷 Photo of result screen** secondary button for the OCR path (see §19).
- Skip = `DRAW` with no score.

### Step 6 — Save

- Atomic transaction: append `game_recorded` event + update `gamer_points` + update `gamer_team_points`.
- Log every sub-step to the correlation-scoped logger.
- Optimistic UI update; roll back on error with an undoable toast.

### Step 7 — Summary

- Per-gamer delta since last game ("Alice +1 win, +2 goals").
- Head-to-head preview against opponents.
- Big "Play again" CTA returns to Step 1.

---

## 14. Gamer Selection Strategies

**Critical:** selection logic is isolated in `packages/shared/src/selection/` so it can be iterated frequently for balance without touching the rest of the game flow.

### Interface

```ts
// packages/shared/src/selection/types.ts
import type { Gamer, GamerId, GamerPoints, GameEvent } from '../types'

export type GameSize = 2 | 4

export interface SelectionContext {
  /** Current gamer_points projection for the room */
  stats: ReadonlyMap<GamerId, GamerPoints>
  /** Recent events, newest first — strategies can look at who just played */
  recentEvents: ReadonlyArray<GameEvent>
  /** Deterministic RNG seeded per call — strategies NEVER touch Math.random */
  rng: () => number
  /** UTC millis when the selection happens */
  now: number
}

export interface IGamerSelectionStrategy {
  readonly id: string                  // 'uniform-random', 'least-recent', 'fair-play', ...
  readonly displayName: string
  readonly description: string

  select(
    roster: ReadonlyArray<Gamer>,
    slots: GameSize,
    locks: ReadonlySet<GamerId>,       // must be included in the result
    ctx: SelectionContext,
  ): ReadonlyArray<Gamer>               // length === slots, includes all locks
}
```

### Design rules (non-negotiable)

- **Pure and deterministic.** `rng` is injected per call. No `Math.random`, no `Date.now` — all from `ctx`. This makes every strategy trivially unit-testable and replayable.
- **Locks are hard constraints, not hints.** A strategy that returns fewer than `slots` or drops a locked gamer throws. The registry wraps every strategy in a validator that enforces this.
- **Strategies are stateless singletons.** Register them in a map; no classes with internal state.
- **The active strategy ID is persisted in every `game_recorded` event**, so the event log doubles as A/B test data: "which strategies produce the most balanced rating distributions?"

### Registry

```ts
// packages/shared/src/selection/registry.ts
const strategies = new Map<string, IGamerSelectionStrategy>()

export function register(s: IGamerSelectionStrategy): void {
  strategies.set(s.id, wrapWithValidator(s))
}
export function get(id: string): IGamerSelectionStrategy {
  const s = strategies.get(id)
  if (!s) throw new Error(`Unknown selection strategy: ${id}`)
  return s
}
export function list(): IGamerSelectionStrategy[] {
  return [...strategies.values()]
}
```

### Initial strategies (v1)

| ID | Behavior |
|---|---|
| `uniform-random` | Flat random N from the roster. Baseline. |
| `least-recently-played` | Sort by time since last game, pick the `slots` longest-waiting. Fairness across sessions. |
| `balanced-rating` | Picks a set whose rating variance is minimal. Keeps teams even. |
| `fair-play-weighted` | Weighted random, weight = `1 / (1 + recentGamesCount)`. Everyone gets a chance. |

Each strategy lives in its own file: `packages/shared/src/selection/strategies/{id}.ts` + `{id}.test.ts`.

### Required tests per strategy

- Returns exactly `slots` gamers.
- Returns all locks.
- Returns only roster members.
- Deterministic: same input + same `rng` seed → same output.
- Edge cases: roster == slots, all gamers locked, one lock + random fill.

### Iteration workflow

1. Edit or add a strategy file + its tests.
2. Run `pnpm test` — if green, you're done.
3. Deploy the shared package via the web app build (strategies run client-side by default).
4. Room admin flips the `default_selection_strategy` dropdown in room settings.
5. No DB migration, no Worker deploy needed.

### Where the selection call happens

Client-side, in Step 1b of the game wizard. No network round-trip, instant UX. The selected gamer IDs flow into the next step's state. On final `POST /games/:id/result`, the `strategyId` is included in the event payload.

---

## 15. Draw Engine

```ts
// packages/shared/src/draw/engine.ts
export function drawTeams(
  clubs: readonly Club[],
  constraints: DrawConstraints,
  rng: () => number,
): readonly [Club, Club] {
  let pool = clubs.filter(c =>
    c.starRating >= constraints.minStars &&
    c.starRating <= constraints.maxStars &&
    (constraints.leagues.length === 0 || constraints.leagues.includes(c.leagueId))
  )

  if (constraints.sameLeague) {
    const byLeague = groupBy(pool, c => c.leagueId)
    const eligibleLeagues = [...byLeague.entries()].filter(([, cs]) => cs.length >= 2)
    if (eligibleLeagues.length === 0) throw new DrawError('NO_LEAGUE_WITH_2_CLUBS')
    const picked = uniformPick(eligibleLeagues, rng)
    pool = picked[1]
  }

  if (pool.length < 2) throw new DrawError('INSUFFICIENT_POOL')

  const home = uniformPick(pool, rng)
  const away = uniformPick(pool.filter(c => c.id !== home.id), rng)
  return [home, away]
}
```

Pure function. Re-roll = call again. No side effects, no state mutation. Fully unit-testable with a seeded RNG.

---

## 16. Rooms & Authentication

A Room is the top-level tenant. It has a human-readable short ID (nanoid with a no-ambiguous-characters alphabet) and an **optional** password/PIN.

| Concern | Solution |
|---|---|
| Room discovery | Share the room ID as a link or QR code |
| Room security | Optional 4-digit PIN (default) or longer alphanumeric password |
| PIN storage | PBKDF2 via Web Crypto, 100k iterations, per-room salt |
| PIN throttling | `pin_attempts` table; 5 wrong attempts → 60s lockout, doubling |
| Session | Signed JWT cookie (`roomId` + `exp`), 30 days, HttpOnly + Secure + SameSite=Lax |
| New device | Enter room ID → optional PIN → session cookie → full access |
| Gamer identity | Gamers are room-scoped; no accounts or login required |
| Concurrent games | Multiple games can be in-flight in the same room simultaneously |

### PIN flow

```
POST /api/rooms/:id/unlock { pin }
  1. Check pin_attempts for lockout — if locked, 429
  2. Load room, derive key with PBKDF2(pin, room.pin_salt, 100_000)
  3. Compare to room.pin_hash (constant-time)
  4. If match: issue session cookie, reset pin_attempts
  5. If miss: increment pin_attempts, maybe lock out
  6. Log every outcome
```

---

## 17. Logging Architecture

**Requirement:** every game fact and system state change must be recorded and visible from the client app Console. Worker logs must reach the client Console (piped via response header or fetched on demand).

### Log entry schema

```ts
// packages/shared/src/types/log.ts
export interface LogEntry {
  id: string                                     // nanoid
  ts: string                                     // ISO 8601 UTC
  level: 'debug' | 'info' | 'warn' | 'error'
  source: 'web' | 'worker'
  category: 'game' | 'db' | 'http' | 'system' | 'squad-sync' | 'auth' | 'selection' | 'projection' | 'ocr'
  message: string
  context?: Record<string, unknown>
  correlationId?: string                         // ties worker logs to a client request
}
```

### Client logger

- Singleton `Logger` instance.
- Ring buffer: **last 500 entries in memory, last 2000 mirrored in IndexedDB** for post-reload debugging.
- All mutations and state-machine transitions call `logger.info('game', 'step advanced', { from, to })`.
- Writes to IndexedDB batched every 500 ms.

### Worker logger

- Every request gets a `correlationId` from the `x-correlation-id` header, or generated if absent.
- A `WorkerLogger` instance is created per request and collects entries for that request.
- On response:
  - **Small case:** entries serialize to base64 JSON on the `x-fc26-logs` response header, capped at ~8 KB.
  - **Overflow case:** the header contains `{ truncated: true, correlationId }` and the client fetches `GET /api/logs?correlationId=...` lazily when the user opens the Console.
- No SSE/WebSocket — cost and complexity aren't worth it for this scale.

### API client middleware (web)

```ts
// apps/web/src/lib/api.ts
async function request(path: string, opts: RequestInit) {
  const correlationId = nanoid()
  const res = await fetch(path, {
    ...opts,
    headers: { ...opts.headers, 'x-correlation-id': correlationId },
  })

  const logHeader = res.headers.get('x-fc26-logs')
  if (logHeader) {
    const parsed = JSON.parse(atob(logHeader))
    if (parsed.truncated) {
      // Lazy fetch only when Console is open
      logger.markTruncated(correlationId)
    } else {
      logger.merge(parsed.entries)
    }
  }
  return res
}
```

### Mandatory log points

- Every game fact: `gamers_selected`, `sides_assigned`, `draw_rolled`, `result_entered`, `game_saved`, `projection_updated`.
- Every DB write with affected row count.
- Every squad sync: version detected, bytes downloaded, diffs computed, errors.
- Every client state machine transition.
- Every auth event: PIN attempted, lockout triggered, session issued, session expired.
- Every selection call: strategy ID, roster size, slots, locks, result.
- Every OCR call: model used, latency, confidence.

---

## 18. Hidden Console UI

**Gesture:** triple-tap on the app logo toggles the Console.

**Logo placement:** in the **bottom nav bar** (not the header) so it's reliably thumb-reachable on phones and not hidden by iOS notches. Small fixed-position badge style.

**Layout:**
- Slide-up panel, 60% of viewport height by default.
- Draggable top handle to resize.
- Swipe-down or triple-tap logo again to dismiss.

**Tabs:**
1. **Live** — auto-follow, newest entries at the bottom.
2. **Filter** — filter by level (debug/info/warn/error), category, source (web/worker).
3. **Search** — full-text search over message and context JSON.
4. **System** — build metadata: `appVersion`, `workerVersion`, `schemaVersion`, `minClientVersion`, `gitSha`, `userAgent`, `timeZone`, `roomId`, `sessionExpiresAt`.

**Entry row:**
- Time (local), level badge, category, message.
- Tap to expand and show full `context` JSON.
- Long-press to copy entry as JSON.

**Footer actions:**
- `Copy all` — copies the entire buffer as JSON.
- `Export` — downloads a `fc26-logs-{roomId}-{ts}.json` file.
- `Clear` — wipes the in-memory buffer (IndexedDB mirror retained for audit).

---

## 19. Game Result Entry & OCR

### Manual path (primary — must be sub-3-tap)

- **Three full-width buttons:** `HOME WIN` / `DRAW` / `AWAY WIN`, ~80 px tall, color-coded.
- **"Enter exact score"** link reveals an inline numeric pad (two digits per side, default 0–0).
- **Single confirm button** finalizes.
- Total taps for winner-only: 2 (pick + confirm). For exact score: 4–5.

### Photo path (optional)

- **📷 Photo of result screen** secondary button on the same screen.
- Opens native camera via `<input type="file" accept="image/*" capture="environment">`.
- Image uploaded to `POST /api/rooms/:id/games/:gid/result/parse`.
- **Response pre-fills the manual form.** The user always confirms before saving. No auto-commit.

### Score extraction interface

```ts
// worker/src/services/score-extraction/types.ts
export interface ParsedResult {
  homeScore: number | null
  awayScore: number | null
  confidence: 'high' | 'medium' | 'low'
  modelUsed: string
  rawResponse?: string
}

export interface IScoreExtractor {
  readonly id: string
  extract(imageBytes: Uint8Array): Promise<ParsedResult>
}
```

### Gemini fallback chain

**Primary provider:** Google Gemini 2.5 family, cheapest → smartest fallback.

```ts
// worker/src/services/score-extraction/gemini.ts
const CHAIN = [
  'gemini-2.5-flash-lite',
  'gemini-2.5-flash',
  'gemini-2.5-pro',
]

export class GeminiScoreExtractor implements IScoreExtractor {
  readonly id = 'gemini-chain'
  async extract(bytes: Uint8Array): Promise<ParsedResult> {
    for (const model of CHAIN) {
      try {
        const parsed = await callGemini(model, bytes)
        if (parsed.confidence !== 'low') return { ...parsed, modelUsed: model }
      } catch (err) {
        logger.warn('ocr', 'model failed, falling through', { model, err })
      }
    }
    // Fail open — user types manually
    return { homeScore: null, awayScore: null, confidence: 'low', modelUsed: 'none' }
  }
}
```

> **Open item:** exact Gemini model IDs must be verified against Google's current catalog before implementation. Model IDs are kept in environment variables so swaps don't require a redeploy.

### Alternative provider

The original Claude vision path stays available behind the same `IScoreExtractor` interface as a second implementation. The Worker picks a provider via env var `OCR_PROVIDER=gemini|claude`. This is a textbook OCP win from the IRepository / interface-based design.

### Prompt shape (Gemini)

```
Extract the score from this FC 26 result screen.

Respond ONLY with a JSON object matching this TypeScript type:
{ "homeScore": number | null, "awayScore": number | null, "confidence": "high" | "medium" | "low" }

Do not include any other text.
```

Worker validates with Zod. On parse failure, retry next model in the chain.

---

## 20. Time Handling (UTC / Local)

### Storage rules

- **Every `*_at` column stores `INTEGER NOT NULL` as UTC milliseconds since epoch.** No TEXT ISO strings.
- **Every mutable entity has `created_at` and `updated_at`.** Immutable events have `occurred_at` + `recorded_at`.
- **Drizzle `timestamps()` helper** returns a reusable column spec.
- **Update triggers** auto-bump `updated_at` on every row update:
  ```sql
  CREATE TRIGGER gamers_updated_at AFTER UPDATE ON gamers
  BEGIN
    UPDATE gamers SET updated_at = (strftime('%s','now') * 1000)
    WHERE id = NEW.id;
  END;
  ```

### Display rules

- **Never format dates on the Worker.** Worker returns raw ms; client renders. Avoids locale surprises and makes caching simple.
- **`packages/shared/src/time/` helpers:**
  ```ts
  export function toUtcMillis(date: Date): number
  export function formatLocal(ms: number, opts?: Intl.DateTimeFormatOptions): string
  export function formatRelative(ms: number): string   // "3 minutes ago"
  export function userTimeZone(): string               // Intl.DateTimeFormat().resolvedOptions().timeZone
  ```
- **Client uses `Intl.DateTimeFormat`** with the resolved user time zone — no external date library.
- **The Console displays timestamps in local time**, with UTC on hover / expand.

---

## 21. Versioning Strategy

Three independent version axes, all visible in the Console System tab.

### Client version

- Source: `apps/web/package.json`.
- Embedded at build time via Vite `define` → `__APP_VERSION__` + `__GIT_SHA__`.
- Shown in Console System tab.

### Worker version

- Source: `worker/package.json`.
- Embedded at build via Wrangler `vars`.
- Exposed via `GET /api/version`:
  ```ts
  { workerVersion, schemaVersion, minClientVersion, builtAt, gitSha }
  ```

### Schema version

- Drizzle migrations numbered `NNNN_description.sql` + optional `NNNN_description.ts` for data transforms.
- The TS file exports `async function up(db: D1Database)` — runs after the SQL file.
- `schema_migrations` table tracks applied migrations.
- **Manual application only:** `pnpm wrangler d1 migrations apply`. Never auto-run on request.
- CI pipeline applies migrations **before** the new Worker goes live.

### Compatibility enforcement

- **Client on startup** calls `GET /api/version`. If `clientVersion < minClientVersion`, show a full-screen "Please refresh — a new version is available" banner. **Don't auto-reload** — the user might be mid-game.
- **Worker on boot** checks `schemaVersion === expectedSchemaVersion`. Refuses requests (HTTP 503 with a clear message) if mismatched. Prevents the classic "worker deployed, migrations not applied" footgun.

### Event schema versioning

- Each event payload carries `schemaVersion: number`.
- Projections handle both old and new versions for at least one migration cycle.
- Because the log is append-only, no retroactive rewrites are needed — that's the point of event sourcing.

### Upgrade script template

```ts
// worker/src/db/migrations/0005_add_team_name.ts
export async function up(db: D1Database): Promise<void> {
  // Schema change already applied by 0005_add_team_name.sql.
  // This file is for optional data moves.
  // Example: backfill a new column from existing event payloads.
  const events = await db.prepare('SELECT id, payload FROM game_events').all()
  for (const row of events.results) {
    // ... transform and update projections
  }
}
```

Data migration is optional per migration — many will have only the `.sql` file.

---

## 22. Design Principles & Testing

### Principles (non-negotiable)

- **Human-readability first.** Code that's obvious to read beats code that's clever to write.
- **SOLID.** IRepository pattern already covers SRP/DIP. Interfaces kept small (ISP). Behavior extended via new files, not `if` branches (OCP).
- **Clean Code.** Small functions, meaningful names, no magic numbers.
- **DRY carefully.** Three repetitions before extracting. Premature abstraction is worse than duplication here.
- **KISS.** No DI container, no effect libraries, no monads. Plain constructor injection and plain functions.
- **Testable by construction.** Pure functions for logic (draw engine, selection strategies, projection math). InMemory repositories for DB-touching code.

### Testing rules

- **Tests live alongside source.** `foo.ts` + `foo.test.ts`. Vitest.
- **Unit tests run in < 2 s total** on the logic-heavy dirs. No `wrangler dev`.
- **Every new module ships with tests in the same PR.** No "tests later."
- **Coverage targets:**
  - `worker/src/services/` — 80% lines
  - `apps/web/src/game/` — 80% lines
  - `packages/shared/src/selection/` — **100% lines** (this is a safety-critical area the user will iterate on frequently)
  - React presentational components — not tracked, don't chase
- **Boundary validation via Zod.** Inside the app, types are trusted.
- **Deterministic tests.** Inject `rng` and `now` — never call `Math.random` or `Date.now` in production code paths (except in composition roots that build the context).
- **Integration tests** for the event-sourcing write path: "append event → both projections updated correctly → rebuild from log produces identical projection state."

---

## 23. Implementation Phases

| Phase | Scope | Deliverable |
|---|---|---|
| **0 — Scaffold** | pnpm monorepo, shared types, D1 schema v1, Hono skeleton, Vite app shell, logger (client + worker), Console UI stub, `GET /api/version` | Deployable empty shell on Cloudflare Pages + Workers |
| **1 — Squad Sync (extended)** | Cron Worker with **versioned R2 layout + per-club player shards + precomputed diffs**. Logo caching. `squad_versions` table. | Fresh squad data at `squads/latest/`, 12 historical versions retained |
| **2 — Rooms & Gamers** | D1 repositories, CRUD routes, Room/Gamer UI screens, PIN auth with PBKDF2 + throttle, session cookie | Multi-device gamer registry working end-to-end with optional password |
| **3 — Selection Strategies** | `@fc26/shared/selection/` module with interface, registry, 4 initial strategies, full test suite | Any strategy swappable via room setting |
| **4 — Game Flow 1–4** | Roster select, lineup select (2/4 toggle + locks + random fill), side assign (tap-to-flip), constraints, team draw + re-roll | Core game wizard functional |
| **5 — Results & Event Sourcing** | Score entry UI, `game_recorded` / `game_voided` events, projection service, both read models, rebuild script | Full game cycle with live leaderboard and auditable log |
| **6 — Dashboard Mode** | Per-gamer and per-gamer-team scoreboards, head-to-head, recent games, charts | Mode 2 complete |
| **7 — View Teams Mode** | Teams browser, team detail, fc player detail with radar + change indicators | Mode 3 complete |
| **8 — Update Changes Mode** | Version picker, diff browser over historical squad versions | Mode 4 complete |
| **9 — PWA & Polish** | Manifest, service worker, install prompt, `100dvh` fixes, haptics, iOS-specific fixes, animations | Shippable production build |
| **10 — OCR (optional)** | Camera capture + Gemini chain (flash-lite → flash → pro) + Claude fallback behind `IScoreExtractor` | Photo-to-score feature |
| **11 — Test hardening** | Integration tests for event write path, projection rebuild tests, CI pipeline green | Confidence for ongoing iteration |

Phase 1 is intentionally extended from the original handoff: versioned R2 layout and precomputed diffs are prerequisites for modes 3 and 4, so they must land early. Retrofitting this later means reingesting.

---

## 24. Key Decisions Summary

| Decision | Choice | Reason |
|---|---|---|
| Framework | Vanilla React + Vite (no Next.js) | No SSR needed; Pages handles static hosting |
| State | Zustand | Minimal, slice-based, no Provider boilerplate |
| Router | TanStack Router | Type-safe route params feed API calls |
| Worker ORM | Drizzle + D1 | Schema = TypeScript types; migrations generated |
| Worker framework | Hono | Lightest JS router with full TS support on Workers |
| Relational DB | D1 (SQLite) | Queries, aggregations, transactions; R2 cannot do this |
| Blob storage | R2 | Squad JSON (versioned, sharded) and logo images; never queried |
| DB access | IRepository interfaces + InMemory test doubles | Decouples routes from storage; enables millisecond tests |
| **Game results** | **Append-only `game_events` log + two projections** | Auditable, voidable, rebuildable; matches user requirement |
| **Projections** | `gamer_points` + `gamer_team_points`, updated inside the same D1 transaction as the event append | Atomic; projections can always be rebuilt from the log |
| **Gamer-team key** | `gt_${sortedGamerIds.join('_')}` | Stable across side/order; natural pairing aggregation |
| **Game size** | `2 \| 4` only, enforced at type + Zod + event payload | User requirement |
| **Gamer selection** | Strategy pattern in `@fc26/shared/selection/`, pure + deterministic, runs client-side | User will iterate frequently; isolation is critical |
| **Logging** | Client ring buffer + Worker logs piped via `x-fc26-logs` response header, overflow via `GET /api/logs?correlationId=...` | User requirement; simple, no SSE |
| **Console UI** | Triple-tap on logo (in bottom nav for thumb reach) → slide-up panel | User requirement |
| **Time storage** | UTC millis as `INTEGER` in D1, Worker never formats, client renders with `Intl.DateTimeFormat` | No locale leakage, cache-friendly |
| **Versioning** | Three axes (client, worker, schema), compatibility check on boot + startup, manual migrations | Prevents deploy/migrate race footguns |
| Squad source | xAranaktu tool → GitHub Release → daily Cron → R2 (versioned, 12 retained) | Official EA data, automated, supports Update Changes mode |
| Squad access | R2 shards (`clubs.json` + `players/{clubId}.json`) | Avoids 5–8 MB cold load on phones |
| Auth | Room ID + optional PIN/password (PBKDF2 + throttle + signed cookie) | Zero-friction for a friend group, still protected |
| Result entry | 3 giant buttons + optional OCR pre-fill | Sub-3-tap primary path |
| OCR | Gemini 2.5 flash-lite → flash → pro, behind `IScoreExtractor` | Cheap-first fallback; provider-swappable |
| PWA only | No Capacitor for v1 | Install-to-home-screen covers 95% of the need |

---

## 25. Open Items

1. **Gemini model IDs** — verify the exact current IDs against Google's catalog before Phase 10. Keep them in env vars.
2. **Selection strategy initial weights** — `fair-play-weighted` formula (`1 / (1 + recentGamesCount)`) is a starting point; the user will iterate on this.
3. **Session cookie lifetime** — 30 days proposed; confirm before Phase 2.
4. **Squad retention count** — 12 versions proposed; confirm before Phase 1.
5. **PIN alphabet** — numeric 4-digit default, alphanumeric optional; confirm UI copy.
6. **Bottom nav structure** — which primary mode tabs? Proposed: Game / Dashboard / Teams / Changes, with the logo as a fifth centered element that's also the Console trigger.

---

## 26. Appendix: External Dependencies

| Package | Used In |
|---|---|
| `hono` | worker — HTTP routing |
| `drizzle-orm` | worker — type-safe D1 queries |
| `zod` | both — boundary validation |
| `nanoid` | both — short unique IDs for rooms/games/events/logs |
| `zustand` | web — game session state |
| `@tanstack/react-router` | web — file-based typed routing |
| `recharts` | web — stats dashboard charts and player attribute radars |
| `tailwindcss` (v4) | web — utility CSS via Vite plugin |
| `vitest` | both — unit tests |
| `jose` | worker — JWT signing for session cookies |
| `@google/genai` | worker — Gemini OCR (optional, Phase 10) |
| `@anthropic-ai/sdk` | worker — Claude OCR fallback (optional, Phase 10) |

---

**End of Handoff Document**
