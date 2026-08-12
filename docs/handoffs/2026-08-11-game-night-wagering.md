# Hand-off: Game Night Wagering (feature/game-night-wagering)

**Date:** 2026-08-11
**Status:** Implementation complete — all 10 plan tasks done, branch pushed, draft PR open against upstream.

## What this branch does

Lets anyone in a Game Night stake virtual chips on the live game. All stakes form one
pari-mutuel pool; backers of the actual result split the pot in proportion to their stake,
and if nobody backed the result every stake is refunded. Chips are purely virtual and
per-night — positions are derived from the event log, never stored as balances.

- **Spec:** `docs/superpowers/specs/2026-08-11-game-night-wagering-design.md`
- **Plan (all checkboxes implemented):** `docs/superpowers/plans/2026-08-11-game-night-wagering.md`

## Commit map (oldest first)

| Commit | Plan task |
|---|---|
| Add pari-mutuel wager settlement | 1 |
| Cap stakes at 1,000,000 | 1 (follow-up) |
| Add wager eligibility rules | 2 |
| Derive night chip positions from the event log | 3 |
| Add bets table, types and repository | 4 |
| Extract room route guards for reuse | 5 |
| Extract shared worker route test fixtures | 5b |
| Add bet placement, removal and lock routes | 6 |
| Settle wagers when a game is recorded or interrupted | 7 |
| Expose night chip standings and live bets | 8 |
| Add the live betting panel | 9 |
| Wire wagering into the game night UI | 10 |

## Key architecture decisions

- Live bets are mutable state in the `bets` table (migration `0006_bets.sql`), mirroring
  how `games` holds live state. At settlement the worker computes the split and writes it
  into the `game_recorded` event payload under an optional `wagers` field, then deletes the
  live rows. The durable record is the event; there is no balance column to drift.
- `EVENT_SCHEMA_VERSION` stays 1 — `wagers` is additive and optional.
- Standings (`/chips` endpoint) are derived per request from the event log via
  `nightChipPositions` / `lastSettledGameDeltas` in `packages/shared/src/wager/positions.ts`;
  voided games drop out automatically.
- Eligibility: participants may back only their own side (draw blocked for them);
  non-participants may back anything; only gamers in the night's active pool may bet.
  Enforced server-side in `worker/src/routes/bets.ts`, mirrored in the UI via
  `canBack` / `describeIneligibility`.
- Stakes are integers 1..1,000,000 (keeps `stake × pot` far below 2^53 so the integer
  split always balances to the chip).
- The book locks manually, or automatically when the TV photo capture opens
  (`TvPhotoCapture` `onOpen` → lock route; the route is idempotent).

## Deviations from the plan discovered during implementation

1. `seedLiveGame` fixture: gamer name `'Cy'` violated the 3-char name minimum → `'Cyd'`
   (`worker/src/routes/test-support.ts`).
2. "Gamer outside the night pool" test: creating an *active* gamer during a live night
   auto-appends them to the pool (rooms.ts behaviour), so the outsider is created with
   `active: false` (`worker/src/routes/bets.test.ts`).
3. `BetsPanel` ineligibility notice shows whenever the picked bettor is a participant
   (computed from any blocked outcome), not just when the selected outcome is blocked —
   required by the panel tests.
4. Bet routes read path params through the shared untyped `RouteContext`, so
   `c.req.param(...)!` non-null assertions are used (params guaranteed by the route paths).
5. Web tests need explicit `afterEach(cleanup)` — the vitest config has `globals: false`,
   so testing-library auto-cleanup does not run.

## Verification state

- `pnpm -r typecheck` clean.
- `packages/shared`: 180 tests pass. `worker`: 110 tests pass.
- `apps/web`: all wagering suites pass (BetsPanel 8, ChipStandingsPanel 3).
  **Pre-existing, unrelated:** 17 failures in `src/debug/console-store.test.ts` and
  `src/App.test.tsx` (`localStorage` undefined in this machine's jsdom run) — they fail
  identically on `main` and are not touched by this branch.
- Manual end-to-end smoke against `wrangler dev` + local D1: room → 3 gamers → night →
  1v1 → bets (eligibility rejection observed) → lock (late bet 409) → record 2:1 →
  `/chips` returned +50/−50 as expected.

## Next steps

- Draft PR into `a-tsygankov/football` needs review + merge.
- Remote D1 needs migration `worker/src/db/migrations/0006_bets.sql` on deploy
  (the deploy workflow gates migrations on `vars.RUN_D1_MIGRATIONS`).
- Possible follow-ups (not in scope): show remembered last bettor
  (`readLastBettor` exists in `apps/web/src/lib/api.ts` but the picker does not
  pre-select yet), chip standings on completed/historical nights in the UI.
