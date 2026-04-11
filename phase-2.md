Good — memory is empty. Let me write the analysis, then persist the key decisions.

## Incorporating your clarifications

### 1. Terminology: `gamers` (not `players`)
Clean rename. Tables become `gamers`, `gamer_stats`, `game_gamers`. This also resolves the collision with FC26 footballers (`fc_players`). I'll use "gamer" throughout from now on.

### 2. Max 4 gamers per game — with overflow selection
The current Step 1 ("Player Select") assumes N = session size. With a hard cap of 4, Step 1 splits into two sub-steps when more than 4 active gamers exist:

**Sub-step 1a — Roster selection:** who is around tonight (any N ≥ 2).
**Sub-step 1b — Lineup selection:** if roster > 4, pick exactly 4.

**UX suggestions for 1b:**
- Counter pill: `3 / 4 selected` at the top, sticky.
- Tap to toggle. A fourth tap disables further adds (hard cap, no silent deselection — it's disorienting).
- "🎲 Random 4" button fills/replaces the selection with a uniform random 4 from the roster.
- **Lock mechanism:** long-press a gamer to "lock" them in (they must play). Then "🎲 Random fill" randomizes only the unlocked slots. This is the killer UX for "Alice is definitely playing, randomize the other 3."
- "Shuffle remaining" animates the random pick so it feels fair.
- Skip = random 4, no locks.

Knock-on schema: `games.max_gamers` is always 4 in this product, so no column needed — just enforce in the write path.

### 3. Optional room password
The handoff already has "optional 4-digit PIN." Clarifications:

- Store as `bcrypt`/`scrypt` hash, never plaintext (Workers has Web Crypto — use PBKDF2 with 100k iterations if bcrypt feels heavy; PBKDF2 is built-in and fine for a 4-digit PIN as long as you throttle attempts).
- **Throttle PIN attempts per room + IP.** 5 wrong attempts → 60s lockout, doubling. Store in a D1 `pin_attempts` table or Workers KV with TTL. Otherwise a 4-digit PIN falls in ~5000 tries.
- Session after PIN entry: signed JWT in cookie, `roomId` + `exp`, 30 days. Worker verifies on every room-scoped request. No accounts, still zero-friction.
- "Password" vs "PIN": I'd keep 4-digit PIN as default (thumb-friendly on a phone) but allow longer alphanumeric if the user opts in. Single `pin_hash` column covers both.

### 4. UX convenience is the key factor
Suggestions by screen, all assume one-handed phone use:

- **Bottom nav, not top.** Thumbs don't reach the top of a phone. Primary actions (Next, Skip, Back) live in a sticky bottom bar.
- **Skip is always visible but visually de-emphasized** (text button, not a filled CTA). Next is the filled CTA.
- **Progress bar with tappable dots** so you can back-navigate to any completed step without a stack of back-presses.
- **Haptics on every state change** (`navigator.vibrate(10)`). Cheap, transforms the feel of the app.
- **No modals for confirmations** on destructive-but-reversible actions. Use undoable toasts ("Game deleted. Undo") instead. Modals only for truly irreversible things.
- **Zero spinners on <300 ms waits.** Use optimistic updates and roll back on error (the D1/Worker edge latency is ~20–50 ms typical).
- **Team Draw re-roll:** giant "🎲 Re-roll" button, swipe-left-to-reroll gesture as power-user shortcut. Animate the dice.
- **Side Assign (drag on phone is fiddly):** Replace drag with **tap-to-flip**. Each gamer chip sits in a "dock," tapping it moves it to the opposite side with a slide animation. Drag stays as a fallback. Add a "🎲" button for rated-random.
- **Forms as wizards, never as long scroll.** One question per screen when it's a decision; grouped only when visually related.
- **Font size ≥ 16px on all inputs** to suppress iOS Safari's auto-zoom.
- **Install-to-home-screen nudge** appears after the first completed game, never on first load.

### 5. Design principles (SOLID, Clean Code, DRY, KISS, testable, tests required)
Concretely translating this to the stack:

- **IRepository pattern stays** — it's already SRP + DIP.
- **Pure functions for the draw engine, side assignment, and stats projection.** Plain TS, no I/O, unit-testable without mocks.
- **Hono middleware for cross-cutting concerns** (auth, repos, logging) — OCP-friendly.
- **No anemic DTOs bouncing around.** Domain types in `@fc26/shared`, validation at the boundary with Zod. The boundary parse is the only place untrusted data becomes a typed object.
- **Tests colocated:** `foo.ts` + `foo.test.ts`. Vitest with the InMemory repositories. Goal: unit tests run in < 2 s, no wrangler spin-up.
- **KISS over cleverness:** no DI container, no effect libraries, no monads. Plain constructor injection and plain functions.
- **Coverage target:** 80% lines on `worker/src/services/` and `apps/web/src/game/` (the logic-heavy parts). Don't chase coverage on React components.
- **DRY carefully:** three repetitions before extracting. Premature abstraction is worse than duplication here.

### 6. Logging — server logs piped to client Console
This is a cool requirement. Concrete design:

**Log format** (shared in `@fc26/shared`):
```ts
interface LogEntry {
  id: string           // nanoid
  ts: string           // ISO UTC
  level: 'debug'|'info'|'warn'|'error'
  source: 'web'|'worker'
  category: 'game'|'db'|'http'|'system'|'squad-sync'
  message: string
  context?: Record<string, unknown>
  correlationId?: string   // ties worker logs to a client request
}
```

**Client side:**
- A `Logger` singleton with a ring buffer (last 500 entries in memory, last 2000 mirrored in IndexedDB for post-reload debugging).
- All mutations and state-machine transitions call `logger.info('game', 'step advanced', {from, to})`.
- Console UI reads the buffer and auto-follows.

**Worker side:**
- Every request gets a `correlationId` (from header, or generated).
- A `WorkerLogger` collects entries for the duration of the request.
- On response, the Worker attaches logs via **response header `x-fc26-logs` (base64 JSON, capped at ~8 KB)** for small cases, and via **`GET /api/logs?correlationId=...`** for overflow. The client merges them into its ring buffer under `source: 'worker'`.
- Avoid SSE/WebSocket — cost and complexity aren't worth it for a friend-group app.

**What gets logged (mandatory):**
- Every game fact: `gamers_selected`, `sides_assigned`, `draw_rolled`, `result_entered`, `game_saved`, `projection_updated`.
- Every DB write with affected row count.
- Every squad sync: version detected, bytes downloaded, diffs computed, errors.
- Every client state machine transition.

**Console UI:**
- Triple-tap on logo → slide-up panel, 60% of viewport height, draggable to resize.
- Tabs: **Live** (auto-follow), **Filter** (by level/category/source), **Search**, **System** (build version, worker version, schema version, user agent).
- Each entry expandable to show full context JSON.
- Swipe-down or triple-tap logo again to dismiss.
- "Copy all" and "Export JSON" buttons — invaluable for bug reports.
- Position: logo must be always visible → put it in the bottom nav bar (or as a small fixed corner badge). Header logos get hidden behind iOS notches.

### 7. Game results UX + OCR with Gemini fallback
**Manual path (primary, must be sub-3-tap):**
- Big three buttons: `HOME WIN` / `DRAW` / `AWAY WIN`, each full-width, ~80 px tall, color-coded.
- Tap-and-hold or a small `Enter exact score` link opens a numeric pad (two digits per side, default 0-0).
- One confirm button. Done.

**Photo path (optional):**
- A `📷 Photo of result screen` secondary button on the same screen.
- Opens native camera via `<input type=file capture="environment">`.
- Upload to `POST /api/games/:id/result/parse` — **returns the parsed result and the Worker pre-fills the manual form, rather than writing directly.** User always confirms.
- **Gemini fallback chain** (per your spec): `gemini-2.5-flash-lite` → `gemini-2.5-flash` → `gemini-2.5-pro`. Start cheap, escalate on low-confidence or parse errors. Schema:
  ```ts
  interface ParsedResult {
    homeScore: number | null
    awayScore: number | null
    confidence: 'high' | 'medium' | 'low'
    modelUsed: string
    rawResponse?: string
  }
  ```
  **Note:** I cannot verify the exact current Gemini model IDs from my training data. Before implementing, check Google's current model catalog — `gemini-2.5-flash-lite` may need a dated suffix, and the fallback order might change if a newer family ships. Lock the IDs in env vars so swaps don't require redeploys.
- **Server-side contract:** Worker calls Gemini with a strict JSON-only prompt, validates with Zod, retries on parse failure at next tier, fails open (returns `null` scores with `confidence: 'low'`) so the user can still type manually.
- Keep the Claude vision path from the original handoff as an alternative provider behind the same interface — `IScoreExtractor` — one more SOLID win.

### 8. Append-only event log with two read models (CQRS-lite)
This is a real architectural shift. Swap the mutable `player_stats` table for event sourcing:

**Event log (write model):**
```sql
CREATE TABLE game_events (
  id            TEXT PRIMARY KEY,     -- nanoid
  room_id       TEXT NOT NULL,
  event_type    TEXT NOT NULL,        -- 'game_recorded' | 'game_voided' | ...
  payload       TEXT NOT NULL,        -- JSON
  schema_version INTEGER NOT NULL,    -- event schema version
  occurred_at   INTEGER NOT NULL,     -- UTC millis
  recorded_at   INTEGER NOT NULL      -- UTC millis (may differ from occurred_at)
);
CREATE INDEX idx_events_room_time ON game_events(room_id, occurred_at);
```
`game_recorded` event payload references: gamers, their sides (= gamer-teams), fc clubs, score, winner. Nothing else touches this table except appends.

**Read models (projections) — regenerable from the log:**
```sql
-- Per-gamer projection
CREATE TABLE gamer_points (
  gamer_id      TEXT PRIMARY KEY,
  games_played  INTEGER NOT NULL DEFAULT 0,
  wins          INTEGER NOT NULL DEFAULT 0,
  draws         INTEGER NOT NULL DEFAULT 0,
  losses        INTEGER NOT NULL DEFAULT 0,
  goals_for     INTEGER NOT NULL DEFAULT 0,
  goals_against INTEGER NOT NULL DEFAULT 0,
  last_event_id TEXT NOT NULL         -- high-water mark for rebuild
);

-- Per-gamer-team projection (a gamer-team = set of gamers on one side)
CREATE TABLE gamer_team_points (
  gamer_team_key TEXT PRIMARY KEY,    -- hash of sorted gamer IDs
  room_id        TEXT NOT NULL,
  members_json   TEXT NOT NULL,       -- [gamerId, ...] for display
  games_played   INTEGER NOT NULL DEFAULT 0,
  wins           INTEGER NOT NULL DEFAULT 0,
  draws          INTEGER NOT NULL DEFAULT 0,
  losses         INTEGER NOT NULL DEFAULT 0,
  goals_for      INTEGER NOT NULL DEFAULT 0,
  goals_against  INTEGER NOT NULL DEFAULT 0,
  last_event_id  TEXT NOT NULL
);
```

**Write path:**
```
POST /api/games/:id/result →
  1. INSERT INTO game_events (append-only)
  2. UPDATE gamer_points       (apply delta)
  3. UPDATE gamer_team_points  (apply delta)
  -- all in a single D1 transaction
```

**Why this is better than the original schema here:**
- Correcting a bad result = append a `game_voided` event + a new `game_recorded`, never mutate history.
- Rebuild-from-log script for free: `pnpm rebuild-projections --room=XYZ`. Crucial when schema changes.
- Natural audit trail for the Console ("show me the last 20 events").
- CQRS read models are exactly the "gamer points" and "gamer-team points" you described.

**Tradeoffs:** 1 extra table; 2 writes instead of 1 per result. Both are trivial at this scale (a friend group generates << 1000 events/year).

### 9. UTC timestamps + local display
Straightforward rules:

- **Every `*_at` column stores `INTEGER NOT NULL` as UTC milliseconds since epoch.** No TEXT ISO strings in the DB (harder to sort, larger).
- **Every mutable entity has `created_at` and `updated_at`.** Immutable ones (events) have `occurred_at` + `recorded_at`.
- **Drizzle helpers** for this: a `timestamps()` helper that returns `{ created_at, updated_at }` column spec, reused on every table. Triggers on `UPDATE` to auto-bump `updated_at`.
- **Shared `@fc26/shared/time.ts` helpers:**
  - `toUtcMillis(date: Date): number`
  - `formatLocal(ms: number, opts?): string` using `Intl.DateTimeFormat` with the user's `Intl.DateTimeFormat().resolvedOptions().timeZone`.
  - `formatRelative(ms: number): string` (e.g. "3 minutes ago") for the Console and game history.
- **Never format dates on the Worker.** Worker returns raw ms; client renders. This avoids locale surprises and makes caching simple.

### 10. Versioning: client, worker, schemas
Three independent version axes:

- **Client version:** `apps/web/package.json` → embedded at build time via Vite `define` → exposed as `__APP_VERSION__`. Shown in Console "System" tab. Followed by git SHA short.
- **Worker version:** `worker/package.json` → embedded at build. Exposed via `GET /api/version` → `{ workerVersion, schemaVersion, minClientVersion, builtAt }`.
- **Schema version:** Drizzle migrations numbered `0001_init.sql`, `0002_add_events.sql`, etc. A `schema_migrations` table tracks applied migrations. `pnpm migrate` applies unapplied ones. A **data migration hook** per migration (optional) runs after the DDL for historical data moves.

**Compatibility enforcement:**
- Client on startup calls `GET /api/version` → if `clientVersion < minClientVersion`, show a full-screen "Please refresh — a new version is available" banner. Don't auto-reload (user might be mid-game).
- Worker on boot checks `schemaVersion === expectedSchemaVersion`; refuses requests if mismatch (500 with a clear message). Prevents the classic "worker deployed, migrations not applied" footgun.
- Migrations run manually via `pnpm wrangler d1 migrations apply` — don't autorun on request. CI pipeline applies before the new Worker goes live.
- All three versions show in Console System tab + `/api/version` for debugging.

**Schema upgrade script:**
- Template: `migrations/NNNN_description.sql` + optional `migrations/NNNN_description.ts` for data transforms.
- The TS file exports `async function up(db: D1Database)`. Runs after the SQL file.
- For the append-only log, an upgrade that changes event payload shape bumps `schema_version` on new events and projections know to handle both. No retroactive rewrites needed — that's the point of event sourcing.

## Updated top concerns / decisions for you to confirm

1. **Event sourcing for game results — yes?** Adds one table and one write, gives you voidable history, audit trail, and rebuildable projections. I recommend yes.
2. **Gamer-team key = stable hash of sorted gamer IDs** so "Alice+Bob" and "Bob+Alice" collapse to one row. Confirm.
3. **PIN storage: PBKDF2 via Web Crypto** — confirm, or do you want bcrypt (requires a WASM package)?
4. **Gemini model IDs — I need you to verify current IDs.** I don't have confident knowledge of `gemini-2.5-flash-lite`'s exact ID suffix. Point me at Google's docs or paste the current ID and I'll wire it in.
5. **Worker→client log transport: response header (8 KB cap) + on-demand fetch for overflow.** Simple. Confirm you don't want SSE.
6. **Console triple-tap target: put the logo in the bottom nav** so it's reliably thumb-reachable. OK?
7. **Overflow selection UX: tap + long-press lock + 🎲 random-fill** — want me to sketch this in more detail before Phase 3?

Now saving the durable context to memory.