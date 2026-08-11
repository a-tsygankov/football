# Game Night Wagering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let anyone in a Game Night stake virtual chips on the live game, with all stakes forming one pari-mutuel pool that the backers of the actual result split in proportion to their stake.

**Architecture:** Bets are mutable live state in a new `bets` table while a game runs, mirroring how `games` already holds live state. At settlement the worker computes the split and writes it into the `game_recorded` event payload under a new optional `wagers` field, so the durable record is the event and no balance column exists to drift. Chip positions are derived from the event log, the same way the scoreboard already works.

**Tech Stack:** TypeScript (strict), pnpm workspaces, Cloudflare Workers + Hono + D1, React 18 + Vite, Vitest, Zod.

**Spec:** `docs/superpowers/specs/2026-08-11-game-night-wagering-design.md`

## Global Constraints

- Chips are integers only. Stakes must be `> 0`, with no upper bound.
- One bet per gamer per game. Placing again replaces; it never adds a second row.
- A participant may back only their own side: home players `home` only, away players `away` only. Non-participants may back any of `home`, `draw`, `away`.
- Only gamers in the game night's active pool may bet.
- `EVENT_SCHEMA_VERSION` stays `1`. The `wagers` field is additive and optional.
- Every new route is room-session guarded, exactly like existing room mutations.
- Follow existing conventions: `.js` extensions on relative imports, colocated `*.test.ts`, `type` imports for types.
- Test commands: `pnpm --filter @fc26/shared test:run`, `pnpm --filter @fc26/worker test:run`, `pnpm --filter @fc26/web test:run`. Typecheck: `pnpm -r typecheck`.
- Do not push. The branch is local; `main` tracks `origin/main` (the fork), never `upstream`.

## File Structure

**Created:**

| Path | Responsibility |
|---|---|
| `packages/shared/src/wager/types.ts` | `WagerBet`, `WagerGameSides` input shapes |
| `packages/shared/src/wager/settle.ts` | `settleWagers` — the pari-mutuel split |
| `packages/shared/src/wager/eligibility.ts` | `canBack`, `describeIneligibility` |
| `packages/shared/src/wager/positions.ts` | `nightChipPositions`, `lastSettledGameDeltas` |
| `packages/shared/src/wager/index.ts` | barrel |
| `worker/src/db/migrations/0006_bets.sql` | `bets` table + `games.bets_locked_at` |
| `worker/src/bets/repository.ts` | `IBetRepository`, in-memory + D1 |
| `worker/src/bets/settlement-service.ts` | `settleGameWagers`, `discardGameWagers` |
| `worker/src/routes/room-context.ts` | route guards extracted from `rooms.ts` |
| `worker/src/routes/test-support.ts` | shared route-test fixtures and seeding helpers |
| `worker/src/routes/bets.ts` | the four bet routes |
| `apps/web/src/features/gameNight/BetsPanel.tsx` | live betting UI |
| `apps/web/src/features/gameNight/ChipStandingsPanel.tsx` | night chip standings |

**Modified:** `packages/shared/src/types/{ids,events,domain,room-api}.ts`, `packages/shared/src/index.ts`, `worker/src/{dependencies.ts,app.ts,env.ts}`, `worker/src/games/repository.ts`, `worker/src/routes/rooms.ts`, `worker/wrangler.toml`, `apps/web/src/lib/api.ts`, `apps/web/src/features/gameNight/{CurrentGameCard,GameCreationPanel,TvPhotoCapture}.tsx`, `apps/web/src/features/room/RoomScreen.tsx`.

---

### Task 1: Wager settlement maths

The pari-mutuel split, as a pure function. This is the heart of the feature and has no I/O, so it is tested exhaustively before anything else exists.

**Files:**
- Create: `packages/shared/src/wager/types.ts`
- Create: `packages/shared/src/wager/settle.ts`
- Create: `packages/shared/src/wager/index.ts`
- Modify: `packages/shared/src/types/events.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/src/wager/settle.test.ts`

**Interfaces:**
- Consumes: `GameResult`, `GamerId` from existing shared types.
- Produces: `WagerBet { gamerId: GamerId; outcome: GameResult; stake: number }`, `WagerSettlement { gamerId: GamerId; outcome: GameResult; stake: number; payout: number }`, `settleWagers(bets: ReadonlyArray<WagerBet>, result: GameResult): WagerSettlement[]`.

- [ ] **Step 1: Add `WagerSettlement` to the event schema**

`WagerSettlement` lives in `events.ts` rather than in `wager/` because `GameRecordedEvent` references it, and `wager/` may import from `types/` but not the reverse.

In `packages/shared/src/types/events.ts`, add after the `GameSide` interface:

```ts
/**
 * One gamer's settled position on a game. Written into the recorded event, so
 * this is the durable record — the live `bets` row is deleted at settlement.
 */
export interface WagerSettlement {
  gamerId: GamerId
  /** Which outcome this gamer backed. */
  outcome: GameResult
  stake: number
  /** 0 for a losing bet; equals `stake` when the pool was refunded. */
  payout: number
}
```

Then add the field to `GameRecordedEvent`, immediately after `entryMethod`:

```ts
  /**
   * Settled wagers for this game. Optional because events recorded before
   * wagering existed will not have it, and a game with no bets writes nothing.
   */
  wagers?: readonly WagerSettlement[]
```

- [ ] **Step 2: Write the failing tests**

Create `packages/shared/src/wager/settle.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { GamerId } from '../types/ids.js'
import type { WagerBet } from './types.js'
import { settleWagers } from './settle.js'

const ann = GamerId('ann')
const bob = GamerId('bob')
const cy = GamerId('cy')
const dee = GamerId('dee')

function bet(gamerId: ReturnType<typeof GamerId>, outcome: 'home' | 'away' | 'draw', stake: number): WagerBet {
  return { gamerId, outcome, stake }
}

/** A closed pool must neither create nor destroy chips. */
function netTotal(settlements: ReadonlyArray<{ stake: number; payout: number }>): number {
  return settlements.reduce((sum, s) => sum + (s.payout - s.stake), 0)
}

describe('settleWagers', () => {
  it('splits the pot in proportion to stake', () => {
    const settled = settleWagers([bet(ann, 'home', 50), bet(bob, 'away', 30), bet(cy, 'away', 20)], 'away')

    expect(settled).toEqual([
      { gamerId: ann, outcome: 'home', stake: 50, payout: 0 },
      { gamerId: bob, outcome: 'away', stake: 30, payout: 60 },
      { gamerId: cy, outcome: 'away', stake: 20, payout: 40 },
    ])
    expect(netTotal(settled)).toBe(0)
  })

  it('distributes indivisible chips to the largest fractional remainders', () => {
    // pot 10, winning stake 3 → 10/3 each is 3.33. Whole shares 3+3+3 = 9,
    // one chip left over, and all three remainders tie, so the largest stake
    // takes it. Stakes tie too, so the lowest gamerId wins: ann.
    const settled = settleWagers(
      [bet(ann, 'home', 1), bet(bob, 'home', 1), bet(cy, 'home', 1), bet(dee, 'away', 7)],
      'home',
    )

    expect(settled.map((s) => s.payout)).toEqual([4, 3, 3, 0])
    expect(netTotal(settled)).toBe(0)
  })

  it('breaks a remainder tie by the larger stake', () => {
    // pot 12, winning stake 5 → ann 2*12/5 = 4.8, bob 3*12/5 = 7.2.
    // Whole 4 + 7 = 11, one chip over. Remainders 4/5 vs 1/5 → ann takes it.
    const settled = settleWagers([bet(ann, 'home', 2), bet(bob, 'home', 3), bet(cy, 'away', 7)], 'home')

    expect(settled.map((s) => s.payout)).toEqual([5, 7, 0])
    expect(netTotal(settled)).toBe(0)
  })

  it('refunds everyone when nobody backed the result', () => {
    const settled = settleWagers([bet(ann, 'home', 50), bet(bob, 'home', 30)], 'draw')

    expect(settled.map((s) => s.payout)).toEqual([50, 30])
    expect(netTotal(settled)).toBe(0)
  })

  it('returns every stake when all bets backed the winner', () => {
    const settled = settleWagers([bet(ann, 'home', 50), bet(bob, 'home', 30)], 'home')

    expect(settled.map((s) => s.payout)).toEqual([50, 30])
    expect(netTotal(settled)).toBe(0)
  })

  it('pays a lone bettor their own stake back', () => {
    const settled = settleWagers([bet(ann, 'home', 40)], 'home')

    expect(settled).toEqual([{ gamerId: ann, outcome: 'home', stake: 40, payout: 40 }])
  })

  it('returns nothing when no bets were placed', () => {
    expect(settleWagers([], 'home')).toEqual([])
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm --filter @fc26/shared test:run settle`
Expected: FAIL — `Failed to resolve import "./settle.js"`.

- [ ] **Step 4: Write the input types**

Create `packages/shared/src/wager/types.ts`:

```ts
import type { GameResult } from '../types/events.js'
import type { GamerId } from '../types/ids.js'

/** A bet as it exists while the book is open, before settlement. */
export interface WagerBet {
  gamerId: GamerId
  outcome: GameResult
  stake: number
}

/** The two sides of a game, as far as the wagering rules care. */
export interface WagerGameSides {
  homeGamerIds: readonly GamerId[]
  awayGamerIds: readonly GamerId[]
}
```

- [ ] **Step 5: Implement the split**

Create `packages/shared/src/wager/settle.ts`:

```ts
import type { GameResult, WagerSettlement } from '../types/events.js'
import type { GamerId } from '../types/ids.js'
import type { WagerBet } from './types.js'

/**
 * Settle a pari-mutuel pool.
 *
 * Every stake on the game forms one pot. Backers of `result` split it in
 * proportion to their stake. Flooring each share leaves at most
 * `winnerCount - 1` chips over; those go to the largest fractional
 * remainders, ties broken by the larger stake and then the lower gamer ID so
 * the outcome is deterministic and testable.
 *
 * When nobody backed `result` the pool cannot be divided, so every stake is
 * refunded and the game is a wash.
 *
 * Keying payouts by gamer ID is safe because the schema enforces one bet per
 * gamer per game.
 */
export function settleWagers(
  bets: ReadonlyArray<WagerBet>,
  result: GameResult,
): WagerSettlement[] {
  if (bets.length === 0) return []

  const pot = bets.reduce((sum, item) => sum + item.stake, 0)
  const winners = bets.filter((item) => item.outcome === result)
  const winningStake = winners.reduce((sum, item) => sum + item.stake, 0)

  if (winningStake === 0) {
    return bets.map((item) => ({
      gamerId: item.gamerId,
      outcome: item.outcome,
      stake: item.stake,
      payout: item.stake,
    }))
  }

  const shares = winners.map((item) => ({
    bet: item,
    whole: Math.floor((item.stake * pot) / winningStake),
    remainder: (item.stake * pot) % winningStake,
  }))

  const payoutByGamer = new Map<GamerId, number>(
    shares.map((share) => [share.bet.gamerId, share.whole]),
  )

  let leftover = pot - shares.reduce((sum, share) => sum + share.whole, 0)
  const byClaim = [...shares].sort(
    (a, b) =>
      b.remainder - a.remainder ||
      b.bet.stake - a.bet.stake ||
      (a.bet.gamerId < b.bet.gamerId ? -1 : a.bet.gamerId > b.bet.gamerId ? 1 : 0),
  )
  for (const share of byClaim) {
    if (leftover <= 0) break
    payoutByGamer.set(share.bet.gamerId, (payoutByGamer.get(share.bet.gamerId) ?? 0) + 1)
    leftover -= 1
  }

  return bets.map((item) => ({
    gamerId: item.gamerId,
    outcome: item.outcome,
    stake: item.stake,
    payout: payoutByGamer.get(item.gamerId) ?? 0,
  }))
}
```

- [ ] **Step 6: Create the barrel and export it**

Create `packages/shared/src/wager/index.ts`:

```ts
export * from './types.js'
export * from './settle.js'
```

In `packages/shared/src/index.ts`, add after the `./squad/index.js` line:

```ts
export * from './wager/index.js'
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `pnpm --filter @fc26/shared test:run settle`
Expected: PASS, 7 tests.

Then `pnpm -r typecheck` — expected: clean.

- [ ] **Step 8: Commit**

```bash
git add packages/shared/src/wager packages/shared/src/types/events.ts packages/shared/src/index.ts
git commit --no-gpg-sign -m "Add pari-mutuel wager settlement"
```

---

### Task 2: Eligibility rules

Who may back what. Pure, and the UI reuses `describeIneligibility` verbatim for its disabled-option copy, so the wording lives here rather than in the component.

**Files:**
- Create: `packages/shared/src/wager/eligibility.ts`
- Modify: `packages/shared/src/wager/index.ts`
- Test: `packages/shared/src/wager/eligibility.test.ts`

**Interfaces:**
- Consumes: `WagerGameSides` from Task 1.
- Produces: `canBack(gamerId: GamerId, game: WagerGameSides, outcome: GameResult): boolean`, `describeIneligibility(gamerId: GamerId, game: WagerGameSides, outcome: GameResult): string | null`.

- [ ] **Step 1: Write the failing tests**

Create `packages/shared/src/wager/eligibility.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { GamerId } from '../types/ids.js'
import { canBack, describeIneligibility } from './eligibility.js'
import type { WagerGameSides } from './types.js'

const ann = GamerId('ann')
const bob = GamerId('bob')
const spectator = GamerId('cy')

const game: WagerGameSides = { homeGamerIds: [ann], awayGamerIds: [bob] }

describe('canBack', () => {
  it('lets a home player back only home', () => {
    expect(canBack(ann, game, 'home')).toBe(true)
    expect(canBack(ann, game, 'away')).toBe(false)
    expect(canBack(ann, game, 'draw')).toBe(false)
  })

  it('lets an away player back only away', () => {
    expect(canBack(bob, game, 'away')).toBe(true)
    expect(canBack(bob, game, 'home')).toBe(false)
    expect(canBack(bob, game, 'draw')).toBe(false)
  })

  it('lets a non-participant back any outcome', () => {
    expect(canBack(spectator, game, 'home')).toBe(true)
    expect(canBack(spectator, game, 'away')).toBe(true)
    expect(canBack(spectator, game, 'draw')).toBe(true)
  })

  it('applies the rule to both members of a 2v2 side', () => {
    const dee = GamerId('dee')
    const doubles: WagerGameSides = { homeGamerIds: [ann, dee], awayGamerIds: [bob] }
    expect(canBack(dee, doubles, 'home')).toBe(true)
    expect(canBack(dee, doubles, 'draw')).toBe(false)
  })
})

describe('describeIneligibility', () => {
  it('returns null when the bet is allowed', () => {
    expect(describeIneligibility(ann, game, 'home')).toBeNull()
    expect(describeIneligibility(spectator, game, 'draw')).toBeNull()
  })

  it('explains why a participant cannot back another outcome', () => {
    expect(describeIneligibility(ann, game, 'draw')).toBe("You're playing home — you can only back Home.")
    expect(describeIneligibility(bob, game, 'home')).toBe("You're playing away — you can only back Away.")
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @fc26/shared test:run eligibility`
Expected: FAIL — `Failed to resolve import "./eligibility.js"`.

- [ ] **Step 3: Implement**

Create `packages/shared/src/wager/eligibility.ts`:

```ts
import type { GameResult } from '../types/events.js'
import type { GamerId } from '../types/ids.js'
import type { WagerGameSides } from './types.js'

/**
 * A gamer playing in the game may back only their own side.
 *
 * Draw is blocked for participants as well as the opposing side: a draw stake
 * pays a participant for not winning, which is the same perverse incentive as
 * backing the opponent, only softer.
 */
export function canBack(
  gamerId: GamerId,
  game: WagerGameSides,
  outcome: GameResult,
): boolean {
  if (game.homeGamerIds.includes(gamerId)) return outcome === 'home'
  if (game.awayGamerIds.includes(gamerId)) return outcome === 'away'
  return true
}

/**
 * The reason `canBack` refused, phrased for the bettor. Null when allowed.
 * The UI shows this beside the disabled option, so the copy lives here rather
 * than in the component.
 */
export function describeIneligibility(
  gamerId: GamerId,
  game: WagerGameSides,
  outcome: GameResult,
): string | null {
  if (canBack(gamerId, game, outcome)) return null
  return game.homeGamerIds.includes(gamerId)
    ? "You're playing home — you can only back Home."
    : "You're playing away — you can only back Away."
}
```

- [ ] **Step 4: Export from the barrel**

In `packages/shared/src/wager/index.ts`, add:

```ts
export * from './eligibility.js'
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @fc26/shared test:run eligibility`
Expected: PASS, 6 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/wager
git commit --no-gpg-sign -m "Add wager eligibility rules"
```

---

### Task 3: Night chip positions

Derives each gamer's net chips from the event log. Voided games are skipped here rather than reversed anywhere, which is why voiding needs no wager-specific rollback.

**Files:**
- Create: `packages/shared/src/wager/positions.ts`
- Modify: `packages/shared/src/wager/index.ts`
- Test: `packages/shared/src/wager/positions.test.ts`

**Interfaces:**
- Consumes: `PersistedGameEvent`, `WagerSettlement` from shared types.
- Produces: `nightChipPositions(events: ReadonlyArray<PersistedGameEvent>, gameNightId: GameNightId): Map<GamerId, number>`, `lastSettledGameDeltas(events: ReadonlyArray<PersistedGameEvent>, gameNightId: GameNightId): Map<GamerId, number>`.

- [ ] **Step 1: Write the failing tests**

Create `packages/shared/src/wager/positions.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { EVENT_SCHEMA_VERSION, type PersistedGameEvent, type WagerSettlement } from '../types/events.js'
import { EventId, GameId, GameNightId, GamerId, GamerTeamKey, RoomId } from '../types/ids.js'
import { lastSettledGameDeltas, nightChipPositions } from './positions.js'

const roomId = RoomId('room-1')
const nightId = GameNightId('night-1')
const otherNightId = GameNightId('night-2')
const ann = GamerId('ann')
const bob = GamerId('bob')

function side(gamerId: ReturnType<typeof GamerId>) {
  return {
    gamerIds: [gamerId],
    gamerTeamKey: GamerTeamKey(gamerId),
    clubId: 1,
    score: 1,
  }
}

function recorded(
  gameId: string,
  occurredAt: number,
  wagers: WagerSettlement[] | undefined,
  gameNightId = nightId,
): PersistedGameEvent {
  return {
    id: EventId(`event-${gameId}`),
    roomId,
    eventType: 'game_recorded',
    schemaVersion: EVENT_SCHEMA_VERSION,
    correlationId: null,
    occurredAt,
    recordedAt: occurredAt,
    payload: {
      type: 'game_recorded',
      schemaVersion: EVENT_SCHEMA_VERSION,
      gameId: GameId(gameId),
      gameNightId,
      roomId,
      format: '1v1',
      size: 2,
      occurredAt,
      home: side(ann),
      away: side(bob),
      result: 'home',
      squadVersion: 'v1',
      selectionStrategyId: 'manual',
      entryMethod: 'manual',
      ...(wagers ? { wagers } : {}),
    },
  }
}

function voided(gameId: string, occurredAt: number): PersistedGameEvent {
  return {
    id: EventId(`void-${gameId}`),
    roomId,
    eventType: 'game_voided',
    schemaVersion: EVENT_SCHEMA_VERSION,
    correlationId: null,
    occurredAt,
    recordedAt: occurredAt,
    payload: {
      type: 'game_voided',
      schemaVersion: EVENT_SCHEMA_VERSION,
      gameId: GameId(gameId),
      gameNightId: nightId,
      roomId,
      occurredAt,
      reason: 'test',
    },
  }
}

describe('nightChipPositions', () => {
  it('nets payouts against stakes across the night', () => {
    const events = [
      recorded('g1', 100, [
        { gamerId: ann, outcome: 'home', stake: 50, payout: 100 },
        { gamerId: bob, outcome: 'away', stake: 50, payout: 0 },
      ]),
      recorded('g2', 200, [
        { gamerId: ann, outcome: 'away', stake: 20, payout: 0 },
        { gamerId: bob, outcome: 'home', stake: 20, payout: 40 },
      ]),
    ]

    const positions = nightChipPositions(events, nightId)

    expect(positions.get(ann)).toBe(30)
    expect(positions.get(bob)).toBe(-30)
  })

  it('excludes voided games', () => {
    const events = [
      recorded('g1', 100, [
        { gamerId: ann, outcome: 'home', stake: 50, payout: 100 },
        { gamerId: bob, outcome: 'away', stake: 50, payout: 0 },
      ]),
      voided('g1', 150),
    ]

    expect(nightChipPositions(events, nightId).size).toBe(0)
  })

  it('ignores events from other game nights', () => {
    const events = [
      recorded('g1', 100, [{ gamerId: ann, outcome: 'home', stake: 50, payout: 100 }], otherNightId),
    ]

    expect(nightChipPositions(events, nightId).size).toBe(0)
  })

  it('ignores recorded events with no wagers field', () => {
    expect(nightChipPositions([recorded('g1', 100, undefined)], nightId).size).toBe(0)
  })

  it('omits a gamer who never bet', () => {
    const events = [recorded('g1', 100, [{ gamerId: ann, outcome: 'home', stake: 10, payout: 10 }])]

    expect(nightChipPositions(events, nightId).has(bob)).toBe(false)
  })
})

describe('lastSettledGameDeltas', () => {
  it('returns only the most recently settled game', () => {
    const events = [
      recorded('g1', 100, [{ gamerId: ann, outcome: 'home', stake: 50, payout: 100 }]),
      recorded('g2', 200, [{ gamerId: bob, outcome: 'home', stake: 20, payout: 60 }]),
    ]

    const deltas = lastSettledGameDeltas(events, nightId)

    expect(deltas.get(bob)).toBe(40)
    expect(deltas.has(ann)).toBe(false)
  })

  it('skips a voided most-recent game and falls back to the one before', () => {
    const events = [
      recorded('g1', 100, [{ gamerId: ann, outcome: 'home', stake: 50, payout: 100 }]),
      recorded('g2', 200, [{ gamerId: bob, outcome: 'home', stake: 20, payout: 60 }]),
      voided('g2', 250),
    ]

    const deltas = lastSettledGameDeltas(events, nightId)

    expect(deltas.get(ann)).toBe(50)
  })

  it('returns an empty map when nothing has settled', () => {
    expect(lastSettledGameDeltas([], nightId).size).toBe(0)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @fc26/shared test:run positions`
Expected: FAIL — `Failed to resolve import "./positions.js"`.

- [ ] **Step 3: Implement**

Create `packages/shared/src/wager/positions.ts`:

```ts
import type { GameRecordedEvent, PersistedGameEvent } from '../types/events.js'
import type { GameNightId, GamerId } from '../types/ids.js'

/**
 * Recorded events for one game night that still count: right game night, not
 * voided, and carrying settled wagers. Sorted oldest-first by when the game
 * was played.
 *
 * Voided games are filtered out here rather than reversed anywhere, which is
 * why voiding a game needs no wager-specific rollback — the wagers simply stop
 * being derived.
 */
function settledGames(
  events: ReadonlyArray<PersistedGameEvent>,
  gameNightId: GameNightId,
): GameRecordedEvent[] {
  const voidedGameIds = new Set(
    events
      .filter((event) => event.payload.type === 'game_voided')
      .map((event) => event.payload.gameId),
  )

  return events
    .map((event) => event.payload)
    .filter(
      (payload): payload is GameRecordedEvent =>
        payload.type === 'game_recorded' &&
        payload.gameNightId === gameNightId &&
        !voidedGameIds.has(payload.gameId) &&
        payload.wagers !== undefined &&
        payload.wagers.length > 0,
    )
    .sort((a, b) => a.occurredAt - b.occurredAt)
}

function accumulate(
  target: Map<GamerId, number>,
  payload: GameRecordedEvent,
): void {
  for (const wager of payload.wagers ?? []) {
    target.set(wager.gamerId, (target.get(wager.gamerId) ?? 0) + (wager.payout - wager.stake))
  }
}

/** Net chips per gamer for one game night: winnings minus stakes. */
export function nightChipPositions(
  events: ReadonlyArray<PersistedGameEvent>,
  gameNightId: GameNightId,
): Map<GamerId, number> {
  const positions = new Map<GamerId, number>()
  for (const payload of settledGames(events, gameNightId)) {
    accumulate(positions, payload)
  }
  return positions
}

/**
 * Per-gamer deltas from the most recently settled game of the night, so the
 * standings panel can highlight what just changed.
 */
export function lastSettledGameDeltas(
  events: ReadonlyArray<PersistedGameEvent>,
  gameNightId: GameNightId,
): Map<GamerId, number> {
  const games = settledGames(events, gameNightId)
  const latest = games[games.length - 1]
  const deltas = new Map<GamerId, number>()
  if (latest) accumulate(deltas, latest)
  return deltas
}
```

- [ ] **Step 4: Export from the barrel**

In `packages/shared/src/wager/index.ts`, add:

```ts
export * from './positions.js'
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @fc26/shared test:run positions`
Expected: PASS, 8 tests.

Then the whole shared suite: `pnpm --filter @fc26/shared test:run` — expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/wager
git commit --no-gpg-sign -m "Derive night chip positions from the event log"
```

---

### Task 4: Bets table, types and repository

Storage for live bets, plus the `betsLockedAt` column that records when the book closed.

**Files:**
- Create: `worker/src/db/migrations/0006_bets.sql`
- Create: `worker/src/bets/repository.ts`
- Modify: `packages/shared/src/types/ids.ts`
- Modify: `packages/shared/src/types/domain.ts`
- Modify: `packages/shared/src/types/room-api.ts`
- Modify: `worker/src/games/repository.ts`
- Modify: `worker/src/dependencies.ts`
- Modify: `worker/wrangler.toml`
- Test: `worker/src/bets/repository.test.ts`

**Interfaces:**
- Produces: `BetId` branded id; `Bet { id: BetId; roomId: RoomId; gameNightId: GameNightId; gameId: GameId; gamerId: GamerId; outcome: GameResult; stake: number; createdAt: number; updatedAt: number }`; `IBetRepository` with `listByGame`, `upsert`, `remove`, `deleteByGame`, `deleteByGameNight`; `CurrentGame.betsLockedAt: number | null`; `deps.bets`.

- [ ] **Step 1: Write the migration**

Create `worker/src/db/migrations/0006_bets.sql`:

```sql
-- Migration 0006: game-night wagering.
-- Live bets only. Settled wagers live in the game_recorded event payload, so
-- these rows are deleted once their game resolves.

CREATE TABLE bets (
  id            TEXT PRIMARY KEY,
  room_id       TEXT NOT NULL REFERENCES rooms(id),
  game_night_id TEXT NOT NULL REFERENCES game_nights(id),
  game_id       TEXT NOT NULL REFERENCES games(id),
  gamer_id      TEXT NOT NULL REFERENCES gamers(id),
  outcome       TEXT NOT NULL,
  stake         INTEGER NOT NULL,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

-- Enforces one bet per gamer per game at the database level, so the
-- place-or-replace route cannot race itself into two rows.
CREATE UNIQUE INDEX idx_bets_game_gamer ON bets(game_id, gamer_id);
CREATE INDEX idx_bets_game ON bets(game_id);
CREATE INDEX idx_bets_game_night ON bets(game_night_id);

ALTER TABLE games ADD COLUMN bets_locked_at INTEGER;

INSERT INTO schema_migrations (version, applied_at, description)
VALUES (6, (strftime('%s','now') * 1000), 'game night wagering');
```

Then in `worker/wrangler.toml` change `SCHEMA_VERSION = "5"` to:

```toml
SCHEMA_VERSION = "6"
```

- [ ] **Step 2: Add the shared types**

In `packages/shared/src/types/ids.ts`, add `BetId` alongside the others — both the type and the constructor:

```ts
export type BetId = Brand<string, 'BetId'>
```

```ts
export const BetId = (s: string): BetId => s as BetId
```

In `packages/shared/src/types/domain.ts`, add to `CurrentGame` after `randomSeed`:

```ts
  /** When the betting book closed. Null while bets are still open. */
  betsLockedAt: number | null
```

In `packages/shared/src/types/room-api.ts`, add the `BetId` and `GameResult` imports to the existing import blocks, then append:

```ts
export interface Bet {
  id: BetId
  roomId: RoomId
  gameNightId: GameNightId
  gameId: GameId
  gamerId: GamerId
  outcome: GameResult
  stake: number
  createdAt: number
  updatedAt: number
}
```

- [ ] **Step 3: Write the failing repository tests**

Create `worker/src/bets/repository.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { BetId, GameId, GameNightId, GamerId, RoomId, type Bet } from '@fc26/shared'
import { InMemoryBetRepository } from './repository.js'

const roomId = RoomId('room-1')
const gameNightId = GameNightId('night-1')
const gameId = GameId('game-1')

function bet(id: string, gamerId: string, stake: number): Bet {
  return {
    id: BetId(id),
    roomId,
    gameNightId,
    gameId,
    gamerId: GamerId(gamerId),
    outcome: 'home',
    stake,
    createdAt: 1,
    updatedAt: 1,
  }
}

describe('InMemoryBetRepository', () => {
  it('lists bets for a game', async () => {
    const repo = new InMemoryBetRepository()
    await repo.upsert(bet('b1', 'ann', 10))
    await repo.upsert(bet('b2', 'bob', 20))

    expect((await repo.listByGame(gameId)).map((item) => item.stake)).toEqual([10, 20])
  })

  it('replaces an existing bet by the same gamer rather than adding one', async () => {
    const repo = new InMemoryBetRepository()
    await repo.upsert(bet('b1', 'ann', 10))
    await repo.upsert({ ...bet('b2', 'ann', 75), outcome: 'draw' })

    const bets = await repo.listByGame(gameId)
    expect(bets).toHaveLength(1)
    expect(bets[0]!.stake).toBe(75)
    expect(bets[0]!.outcome).toBe('draw')
  })

  it('removes a single bet', async () => {
    const repo = new InMemoryBetRepository()
    await repo.upsert(bet('b1', 'ann', 10))
    await repo.upsert(bet('b2', 'bob', 20))
    await repo.remove(BetId('b1'), gameId)

    expect(await repo.listByGame(gameId)).toHaveLength(1)
  })

  it('deletes every bet on a game', async () => {
    const repo = new InMemoryBetRepository()
    await repo.upsert(bet('b1', 'ann', 10))
    await repo.upsert(bet('b2', 'bob', 20))
    await repo.deleteByGame(gameId)

    expect(await repo.listByGame(gameId)).toEqual([])
  })

  it('deletes every bet in a game night', async () => {
    const repo = new InMemoryBetRepository()
    await repo.upsert(bet('b1', 'ann', 10))
    await repo.deleteByGameNight(gameNightId)

    expect(await repo.listByGame(gameId)).toEqual([])
  })
})
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `pnpm --filter @fc26/worker test:run bets`
Expected: FAIL — cannot resolve `./repository.js`.

- [ ] **Step 5: Implement the repository**

Create `worker/src/bets/repository.ts`:

```ts
import {
  type Bet,
  BetId,
  GameId,
  GameNightId,
  GamerId,
  RoomId,
  type GameResult,
} from '@fc26/shared'

export interface IBetRepository {
  listByGame(gameId: GameId): Promise<ReadonlyArray<Bet>>
  /** Places a bet, replacing any existing bet by the same gamer on the game. */
  upsert(bet: Bet): Promise<void>
  remove(betId: BetId, gameId: GameId): Promise<void>
  /** Called at settlement: the event payload becomes the durable record. */
  deleteByGame(gameId: GameId): Promise<void>
  /** Sweeps bets belonging to a night that ended without resolving a game. */
  deleteByGameNight(gameNightId: GameNightId): Promise<void>
}

export class InMemoryBetRepository implements IBetRepository {
  private readonly bets = new Map<BetId, Bet>()

  async listByGame(gameId: GameId): Promise<ReadonlyArray<Bet>> {
    return [...this.bets.values()]
      .filter((bet) => bet.gameId === gameId)
      .sort((a, b) => a.createdAt - b.createdAt)
  }

  async upsert(bet: Bet): Promise<void> {
    const existing = [...this.bets.values()].find(
      (item) => item.gameId === bet.gameId && item.gamerId === bet.gamerId,
    )
    if (existing) this.bets.delete(existing.id)
    this.bets.set(bet.id, bet)
  }

  async remove(betId: BetId, gameId: GameId): Promise<void> {
    const existing = this.bets.get(betId)
    if (existing && existing.gameId === gameId) this.bets.delete(betId)
  }

  async deleteByGame(gameId: GameId): Promise<void> {
    for (const [id, bet] of this.bets) {
      if (bet.gameId === gameId) this.bets.delete(id)
    }
  }

  async deleteByGameNight(gameNightId: GameNightId): Promise<void> {
    for (const [id, bet] of this.bets) {
      if (bet.gameNightId === gameNightId) this.bets.delete(id)
    }
  }
}

interface BetRow {
  id: string
  room_id: string
  game_night_id: string
  game_id: string
  gamer_id: string
  outcome: GameResult
  stake: number
  created_at: number
  updated_at: number
}

function rowToBet(row: BetRow): Bet {
  return {
    id: BetId(row.id),
    roomId: RoomId(row.room_id),
    gameNightId: GameNightId(row.game_night_id),
    gameId: GameId(row.game_id),
    gamerId: GamerId(row.gamer_id),
    outcome: row.outcome,
    stake: row.stake,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export class D1BetRepository implements IBetRepository {
  constructor(private readonly db: D1Database) {}

  async listByGame(gameId: GameId): Promise<ReadonlyArray<Bet>> {
    const result = await this.db
      .prepare('SELECT * FROM bets WHERE game_id = ? ORDER BY created_at ASC')
      .bind(gameId)
      .all<BetRow>()
    return (result.results ?? []).map(rowToBet)
  }

  async upsert(bet: Bet): Promise<void> {
    // `idx_bets_game_gamer` makes (game_id, gamer_id) unique, so a repeat bet
    // updates the existing row in place and keeps its original created_at.
    await this.db
      .prepare(
        `INSERT INTO bets
           (id, room_id, game_night_id, game_id, gamer_id, outcome, stake, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(game_id, gamer_id) DO UPDATE SET
           outcome = excluded.outcome,
           stake = excluded.stake,
           updated_at = excluded.updated_at`,
      )
      .bind(
        bet.id,
        bet.roomId,
        bet.gameNightId,
        bet.gameId,
        bet.gamerId,
        bet.outcome,
        bet.stake,
        bet.createdAt,
        bet.updatedAt,
      )
      .run()
  }

  async remove(betId: BetId, gameId: GameId): Promise<void> {
    await this.db
      .prepare('DELETE FROM bets WHERE id = ? AND game_id = ?')
      .bind(betId, gameId)
      .run()
  }

  async deleteByGame(gameId: GameId): Promise<void> {
    await this.db.prepare('DELETE FROM bets WHERE game_id = ?').bind(gameId).run()
  }

  async deleteByGameNight(gameNightId: GameNightId): Promise<void> {
    await this.db
      .prepare('DELETE FROM bets WHERE game_night_id = ?')
      .bind(gameNightId)
      .run()
  }
}
```

- [ ] **Step 6: Map the new game column**

In `worker/src/games/repository.ts`, add to `GameRow`:

```ts
  bets_locked_at: number | null
```

Add to `rowToCurrentGame`, after `randomSeed`:

```ts
    betsLockedAt: row.bets_locked_at,
```

In `create`, add `bets_locked_at` as the final column and one more `?` placeholder, binding `game.betsLockedAt` after `game.updatedAt`:

```ts
        `INSERT INTO games
           (id, room_id, game_night_id, status, allocation_mode, format,
            home_gamer_ids_json, away_gamer_ids_json, home_club_id, away_club_id, selection_strategy_id,
            random_seed, created_at, updated_at, bets_locked_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
```

In `update`, add `bets_locked_at = ?` to the SET list after `random_seed = ?`, binding `game.betsLockedAt` in the matching position:

```ts
        `UPDATE games
         SET status = ?, allocation_mode = ?, format = ?, home_gamer_ids_json = ?,
             away_gamer_ids_json = ?, home_club_id = ?, away_club_id = ?,
             selection_strategy_id = ?, random_seed = ?, bets_locked_at = ?, updated_at = ?
         WHERE id = ? AND room_id = ? AND game_night_id = ?`,
```

- [ ] **Step 7: Wire into the dependency graph**

In `worker/src/dependencies.ts`, add the import:

```ts
import {
  D1BetRepository,
  InMemoryBetRepository,
  type IBetRepository,
} from './bets/repository.js'
```

Add `bets: new InMemoryBetRepository(),` to `inMemoryFallbacks`, `readonly bets: IBetRepository` to `AppDependencies`, and to `buildDependencies`:

```ts
    bets: env.DB ? new D1BetRepository(env.DB) : inMemoryFallbacks.bets,
```

- [ ] **Step 8: Fix the existing test fixture**

`worker/src/routes/rooms.test.ts` builds the dependency object literally, so it needs the new repository. Add the import:

```ts
import { InMemoryBetRepository } from '../bets/repository.js'
```

In `buildTestApp`, add `const bets = new InMemoryBetRepository()` beside the other repositories and `bets,` to the returned dependency object. Add `bets,` to the `Object.assign` list so later tasks' tests can reach it.

Any existing test that constructs a `CurrentGame` literal now needs `betsLockedAt: null`. Run the typecheck in the next step to find them.

- [ ] **Step 9: Run the tests and typecheck**

Run: `pnpm --filter @fc26/worker test:run`
Expected: PASS, including the 5 new repository tests.

Run: `pnpm -r typecheck`
Expected: clean. If it reports a missing `betsLockedAt` on a `CurrentGame` literal, add `betsLockedAt: null` there.

- [ ] **Step 10: Apply the migration locally**

```bash
cd worker && pnpm exec wrangler d1 migrations apply fc26 --local
```

Expected: reports migration `0006_bets.sql` applied. Skip without failing the task if no local D1 database exists yet.

- [ ] **Step 11: Commit**

```bash
git add worker/src/db/migrations/0006_bets.sql worker/src/bets worker/src/dependencies.ts \
        worker/src/games/repository.ts worker/src/routes/rooms.test.ts worker/wrangler.toml \
        packages/shared/src/types
git commit --no-gpg-sign -m "Add bets table, types and repository"
```

---

### Task 5: Extract route guards

`bets.ts` needs `requireRoomSession`, `requireActiveGameNight` and `parseJson`, all currently private to a 1867-line `rooms.ts`. Extract them so both route modules share one copy. Pure move — no behaviour change.

**Files:**
- Create: `worker/src/routes/room-context.ts`
- Modify: `worker/src/routes/rooms.ts`

**Interfaces:**
- Produces: `RouteContext`, `GAME_NIGHT_IDLE_TIMEOUT_MS`, `getFreshActiveGameNight`, `requireRoomSession`, `requireActiveGameNight`, `parseJson`, `ResolvedRoomSession`.

- [ ] **Step 1: Create the shared module**

Create `worker/src/routes/room-context.ts`. Move the bodies of `getFreshActiveGameNight`, `requireRoomSession`, `requireActiveGameNight` and `parseJson` verbatim from `rooms.ts`, plus the `RouteContext` alias and the `GAME_NIGHT_IDLE_TIMEOUT_MS` constant:

```ts
import {
  type GameNight,
  type GameNightId,
  ROOM_SESSION_HEADER,
  type RoomId as RoomIdType,
} from '@fc26/shared'
import type { Context } from 'hono'
import { getCookie } from 'hono/cookie'
import type { AppContext } from '../app.js'
import {
  ROOM_SESSION_COOKIE,
  type RoomSessionPayload,
  verifyRoomSession,
} from '../auth/session.js'

/** A game night with no games for this long is treated as finished. */
export const GAME_NIGHT_IDLE_TIMEOUT_MS = 12 * 60 * 60 * 1000

export type RouteContext = Context<AppContext>

export interface ResolvedRoomSession extends RoomSessionPayload {
  token: string
  source: 'header' | 'cookie'
}
```

Then paste the four function bodies unchanged, each with `export` added. Do not alter their logic.

Note: `rooms.ts` currently declares `ResolvedRoomSession`; check its exact shape there and move that declaration rather than the sketch above if it differs.

- [ ] **Step 2: Update `rooms.ts` to import them**

Delete the four moved functions, the `RouteContext` alias, the `GAME_NIGHT_IDLE_TIMEOUT_MS` constant and the moved `ResolvedRoomSession` declaration from `rooms.ts`. Add:

```ts
import {
  GAME_NIGHT_IDLE_TIMEOUT_MS,
  getFreshActiveGameNight,
  parseJson,
  requireActiveGameNight,
  requireRoomSession,
  type ResolvedRoomSession,
  type RouteContext,
} from './room-context.js'
```

Remove any now-unused imports from `rooms.ts` (`getCookie` may still be used by `issueRoomSession`; `verifyRoomSession` and `ROOM_SESSION_COOKIE` likely become unused). The typecheck in Step 3 will confirm.

- [ ] **Step 3: Verify nothing changed**

Run: `pnpm --filter @fc26/worker test:run`
Expected: PASS, same count as before this task — a pure move breaks nothing.

Run: `pnpm -r typecheck`
Expected: clean. Fix any unused-import errors by deleting the import.

- [ ] **Step 4: Commit**

```bash
git add worker/src/routes/room-context.ts worker/src/routes/rooms.ts
git commit --no-gpg-sign -m "Extract room route guards for reuse"
```

---

### Task 5b: Shared worker test fixtures

Tasks 6, 7 and 8 each need a room, a pool and a live game before they can assert anything. Without this task each would copy `buildTestApp` from `rooms.test.ts`, giving four copies that drift apart every time the dependency graph changes. Extract them once.

**Files:**
- Create: `worker/src/routes/test-support.ts`
- Modify: `worker/src/routes/rooms.test.ts`

**Interfaces:**
- Produces: `env`, `execCtx()`, `cookieFrom(res)`, `buildTestApp()`, `req(app, path, init)`, `createGamer(app, roomId, cookie, name)`, `seedLiveGame(app)`, `placeBet(app, seed, gamerId, outcome, stake)`, `recordResult(app, seed, body)`.

- [ ] **Step 1: Create the support module**

Create `worker/src/routes/test-support.ts`. Move `env`, `execCtx`, `cookieFrom` and `buildTestApp` out of `rooms.test.ts` verbatim (they are already written there — do not rewrite them), adding `export` to each and including the `bets` repository from Task 4. Then add:

```ts
/**
 * Every worker route test drives the app through `app.fetch(new Request(...))`
 * — Hono's `app.request` shorthand does not take the `env` and
 * `ExecutionContext` arguments these routes need. This wrapper keeps that
 * shape in one place.
 */
export async function req(
  app: ReturnType<typeof buildTestApp>,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  return app.fetch(new Request(`http://localhost${path}`, init), env, execCtx())
}

function jsonInit(cookie: string, body: unknown): RequestInit {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json', Cookie: cookie },
    body: JSON.stringify(body),
  }
}

export async function createGamer(
  app: ReturnType<typeof buildTestApp>,
  roomId: string,
  cookie: string,
  name: string,
): Promise<string> {
  const res = await req(app, `/api/rooms/${roomId}/gamers`, jsonInit(cookie, { name }))
  const body = (await res.json()) as { gamer: { id: string } }
  return body.gamer.id
}

export interface LiveGameSeed {
  roomId: string
  nightId: string
  gameId: string
  /** Home side. */
  ann: string
  /** Away side. */
  bob: string
  /** In the pool but not playing, so it may back any outcome. */
  cy: string
  cookie: string
}

/**
 * Room + three gamers, all three in the night's pool, with a live 1v1 between
 * ann (home) and bob (away). cy sits out, which is what makes it possible to
 * test both the participant and non-participant betting rules.
 */
export async function seedLiveGame(
  app: ReturnType<typeof buildTestApp>,
): Promise<LiveGameSeed> {
  const createRes = await req(app, '/api/rooms', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Wager Night' }),
  })
  const room = (await createRes.json()) as { room: { id: string } }
  const roomId = room.room.id
  const cookie = cookieFrom(createRes)

  const ann = await createGamer(app, roomId, cookie, 'Ann')
  const bob = await createGamer(app, roomId, cookie, 'Bob')
  const cy = await createGamer(app, roomId, cookie, 'Cy')

  const nightRes = await req(
    app,
    `/api/rooms/${roomId}/game-nights`,
    jsonInit(cookie, { activeGamerIds: [ann, bob, cy] }),
  )
  const night = (await nightRes.json()) as { gameNight: { id: string } }
  const nightId = night.gameNight.id

  const gameRes = await req(
    app,
    `/api/rooms/${roomId}/game-nights/${nightId}/games`,
    jsonInit(cookie, {
      allocationMode: 'manual',
      homeGamerIds: [ann],
      awayGamerIds: [bob],
    }),
  )
  const game = (await gameRes.json()) as { currentGame: { id: string } }

  return { roomId, nightId, gameId: game.currentGame.id, ann, bob, cy, cookie }
}

export async function placeBet(
  app: ReturnType<typeof buildTestApp>,
  seed: LiveGameSeed,
  gamerId: string,
  outcome: 'home' | 'away' | 'draw',
  stake: number,
): Promise<Response> {
  return req(
    app,
    `/api/rooms/${seed.roomId}/game-nights/${seed.nightId}/games/${seed.gameId}/bets`,
    jsonInit(seed.cookie, { gamerId, outcome, stake }),
  )
}

export async function recordResult(
  app: ReturnType<typeof buildTestApp>,
  seed: LiveGameSeed,
  body: { result: 'home' | 'away' | 'draw'; homeScore?: number; awayScore?: number },
): Promise<Response> {
  return req(
    app,
    `/api/rooms/${seed.roomId}/game-nights/${seed.nightId}/games/${seed.gameId}/result`,
    jsonInit(seed.cookie, body),
  )
}
```

`seedLiveGame` and the helpers below it are new code, so assert nothing inside them — a failing seed surfaces as a failing assertion in the test that used it. `cookieFrom` already calls `expect`, which is why it stays as-is.

- [ ] **Step 2: Point `rooms.test.ts` at the module**

Delete the moved declarations from `worker/src/routes/rooms.test.ts` and import them instead:

```ts
import { buildTestApp, cookieFrom, env, execCtx } from './test-support.js'
```

Leave every existing test body unchanged.

- [ ] **Step 3: Verify nothing changed**

Run: `pnpm --filter @fc26/worker test:run`
Expected: PASS, the same test count as before this task. This is a pure move.

Run: `pnpm -r typecheck`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add worker/src/routes/test-support.ts worker/src/routes/rooms.test.ts
git commit --no-gpg-sign -m "Extract shared worker route test fixtures"
```

---

### Task 6: Bet routes

Place, replace, remove and lock. All validation lives here; the maths is already done.

**Files:**
- Create: `worker/src/routes/bets.ts`
- Modify: `worker/src/app.ts`
- Modify: `packages/shared/src/types/room-api.ts`
- Test: `worker/src/routes/bets.test.ts`

**Interfaces:**
- Consumes: `IBetRepository` (Task 4), `canBack` (Task 2), route guards (Task 5).
- Produces: `betRoutes` Hono router; `PlaceBetRequest { gamerId: string; outcome: GameResult; stake: number }`; `BetsResponse { bets: ReadonlyArray<Bet>; betsLockedAt: number | null }`.

- [ ] **Step 1: Add the API types**

In `packages/shared/src/types/room-api.ts`, append:

```ts
export interface PlaceBetRequest {
  gamerId: string
  outcome: GameResult
  stake: number
}

export interface BetsResponse {
  bets: ReadonlyArray<Bet>
  /** Null while the book is open. Mirrors `CurrentGame.betsLockedAt`. */
  betsLockedAt: number | null
}
```

- [ ] **Step 2: Write the failing route tests**

Create `worker/src/routes/bets.test.ts`, importing every fixture from Task 5b:

```ts
import { buildTestApp, createGamer, env, execCtx, placeBet, req, seedLiveGame } from './test-support.js'
```

**The test snippets below are written with `app.request(path, init, env, execCtx())` for brevity. Write them as `req(app, path, init)` instead** — that is the wrapper Task 5b provides, and it matches how every existing worker route test drives the app. The same applies to the snippets in Tasks 7 and 8.

```ts
import { describe, expect, it } from 'vitest'
import type { BetsResponse } from '@fc26/shared'
import { buildApp } from '../app.js'
// ...fixture imports mirroring rooms.test.ts, plus:
import { InMemoryBetRepository } from '../bets/repository.js'

/**
 * Creates a room with three gamers, starts a game night with all three in the
 * pool, and starts a 1v1 between ann (home) and bob (away). Returns the ids
 * and the session cookie every request needs.
 */
async function seedLiveGame(app: ReturnType<typeof buildTestApp>) {
  // Implement using the same request sequence rooms.test.ts uses for its
  // live-game tests: POST /api/rooms, POST /api/rooms/:id/gamers ×3,
  // POST /api/rooms/:id/game-nights with all three gamer ids, then
  // POST /api/rooms/:id/game-nights/:nightId/games with allocationMode
  // 'manual', homeGamerIds [ann], awayGamerIds [bob].
  // Return { roomId, nightId, gameId, ann, bob, cy, cookie }.
}

describe('bet routes', () => {
  it('places a bet and returns the book', async () => {
    const app = buildTestApp()
    const seed = await seedLiveGame(app)

    const res = await app.request(
      `/api/rooms/${seed.roomId}/game-nights/${seed.nightId}/games/${seed.gameId}/bets`,
      { method: 'POST', headers: { cookie: seed.cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ gamerId: seed.cy, outcome: 'draw', stake: 25 }) },
      env, execCtx(),
    )

    expect(res.status).toBe(201)
    const body = (await res.json()) as BetsResponse
    expect(body.bets).toHaveLength(1)
    expect(body.bets[0]!.stake).toBe(25)
    expect(body.betsLockedAt).toBeNull()
  })

  it('replaces a repeat bet by the same gamer', async () => {
    const app = buildTestApp()
    const seed = await seedLiveGame(app)
    const place = (outcome: string, stake: number) =>
      app.request(
        `/api/rooms/${seed.roomId}/game-nights/${seed.nightId}/games/${seed.gameId}/bets`,
        { method: 'POST', headers: { cookie: seed.cookie, 'content-type': 'application/json' },
          body: JSON.stringify({ gamerId: seed.cy, outcome, stake }) },
        env, execCtx(),
      )

    await place('draw', 25)
    const res = await place('home', 60)

    const body = (await res.json()) as BetsResponse
    expect(body.bets).toHaveLength(1)
    expect(body.bets[0]!.stake).toBe(60)
    expect(body.bets[0]!.outcome).toBe('home')
  })

  it('rejects a participant backing another outcome', async () => {
    const app = buildTestApp()
    const seed = await seedLiveGame(app)

    const res = await app.request(
      `/api/rooms/${seed.roomId}/game-nights/${seed.nightId}/games/${seed.gameId}/bets`,
      { method: 'POST', headers: { cookie: seed.cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ gamerId: seed.ann, outcome: 'away', stake: 10 }) },
      env, execCtx(),
    )

    expect(res.status).toBe(400)
    expect((await res.json()) as { error: string }).toEqual({ error: 'outcome_not_allowed' })
  })

  it('rejects a participant backing a draw', async () => {
    const app = buildTestApp()
    const seed = await seedLiveGame(app)

    const res = await app.request(
      `/api/rooms/${seed.roomId}/game-nights/${seed.nightId}/games/${seed.gameId}/bets`,
      { method: 'POST', headers: { cookie: seed.cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ gamerId: seed.ann, outcome: 'draw', stake: 10 }) },
      env, execCtx(),
    )

    expect(res.status).toBe(400)
  })

  it('lets a participant back their own side', async () => {
    const app = buildTestApp()
    const seed = await seedLiveGame(app)

    const res = await app.request(
      `/api/rooms/${seed.roomId}/game-nights/${seed.nightId}/games/${seed.gameId}/bets`,
      { method: 'POST', headers: { cookie: seed.cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ gamerId: seed.ann, outcome: 'home', stake: 10 }) },
      env, execCtx(),
    )

    expect(res.status).toBe(201)
  })

  it.each([0, -5, 2.5])('rejects a stake of %s', async (stake) => {
    const app = buildTestApp()
    const seed = await seedLiveGame(app)

    const res = await app.request(
      `/api/rooms/${seed.roomId}/game-nights/${seed.nightId}/games/${seed.gameId}/bets`,
      { method: 'POST', headers: { cookie: seed.cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ gamerId: seed.cy, outcome: 'draw', stake }) },
      env, execCtx(),
    )

    expect(res.status).toBe(400)
  })

  it('rejects a gamer outside the night pool', async () => {
    const app = buildTestApp()
    const seed = await seedLiveGame(app)
    // Add a fourth gamer to the room but not to the night's pool.
    const outsider = await createGamer(app, seed.roomId, seed.cookie, 'Dee')

    const res = await app.request(
      `/api/rooms/${seed.roomId}/game-nights/${seed.nightId}/games/${seed.gameId}/bets`,
      { method: 'POST', headers: { cookie: seed.cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ gamerId: outsider, outcome: 'draw', stake: 10 }) },
      env, execCtx(),
    )

    expect(res.status).toBe(400)
    expect((await res.json()) as { error: string }).toEqual({ error: 'gamer_not_in_pool' })
  })

  it('removes a bet', async () => {
    const app = buildTestApp()
    const seed = await seedLiveGame(app)
    const placed = (await (await placeBet(app, seed, seed.cy, 'draw', 25)).json()) as BetsResponse
    const betId = placed.bets[0]!.id

    const res = await app.request(
      `/api/rooms/${seed.roomId}/game-nights/${seed.nightId}/games/${seed.gameId}/bets/${betId}`,
      { method: 'DELETE', headers: { cookie: seed.cookie } },
      env, execCtx(),
    )

    expect(res.status).toBe(200)
    expect(((await res.json()) as BetsResponse).bets).toEqual([])
  })

  it('locks the book and rejects later bets', async () => {
    const app = buildTestApp()
    const seed = await seedLiveGame(app)

    const lock = await app.request(
      `/api/rooms/${seed.roomId}/game-nights/${seed.nightId}/games/${seed.gameId}/bets/lock`,
      { method: 'POST', headers: { cookie: seed.cookie } },
      env, execCtx(),
    )
    expect(lock.status).toBe(200)
    expect(((await lock.json()) as BetsResponse).betsLockedAt).toBeTypeOf('number')

    const late = await placeBet(app, seed, seed.cy, 'draw', 10)
    expect(late.status).toBe(409)
    expect((await late.json()) as { error: string }).toEqual({ error: 'bets_locked' })
  })

  it('is idempotent when locking twice', async () => {
    const app = buildTestApp()
    const seed = await seedLiveGame(app)
    const lockUrl = `/api/rooms/${seed.roomId}/game-nights/${seed.nightId}/games/${seed.gameId}/bets/lock`

    const first = (await (await app.request(lockUrl, { method: 'POST', headers: { cookie: seed.cookie } }, env, execCtx())).json()) as BetsResponse
    const second = (await (await app.request(lockUrl, { method: 'POST', headers: { cookie: seed.cookie } }, env, execCtx())).json()) as BetsResponse

    expect(second.betsLockedAt).toBe(first.betsLockedAt)
  })

  it('rejects a bet without a room session', async () => {
    const app = buildTestApp()
    const seed = await seedLiveGame(app)

    const res = await app.request(
      `/api/rooms/${seed.roomId}/game-nights/${seed.nightId}/games/${seed.gameId}/bets`,
      { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ gamerId: seed.cy, outcome: 'draw', stake: 10 }) },
      env, execCtx(),
    )

    expect(res.status).toBe(401)
  })
})
```

`placeBet` and `createGamer` already exist in `test-support.js` — import them rather than redefining them here.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm --filter @fc26/worker test:run bets`
Expected: FAIL — 404 responses, because the routes do not exist yet.

- [ ] **Step 4: Implement the routes**

Create `worker/src/routes/bets.ts`:

```ts
import { nanoid } from 'nanoid'
import {
  type Bet,
  BetId,
  canBack,
  type CurrentGame,
  GameId,
  GameNightId,
  GamerId,
  type PlaceBetRequest,
  RoomId,
} from '@fc26/shared'
import { Hono } from 'hono'
import { z } from 'zod'
import type { AppContext } from '../app.js'
import {
  parseJson,
  requireActiveGameNight,
  requireRoomSession,
  type RouteContext,
} from './room-context.js'

const placeBetSchema = z.object({
  gamerId: z.string().min(1),
  outcome: z.enum(['home', 'away', 'draw']),
  stake: z.number().int().positive(),
})

export const betRoutes = new Hono<AppContext>()

const BETS_PATH = '/rooms/:roomId/game-nights/:gameNightId/games/:gameId/bets'

/**
 * Resolves the live game a bet route is targeting, or the error response to
 * return instead. Every bet route needs the same four checks, so they live
 * here rather than being repeated three times.
 */
async function resolveLiveGame(
  c: RouteContext,
): Promise<
  | { ok: true; roomId: ReturnType<typeof RoomId>; game: CurrentGame }
  | { ok: false; status: 401 | 404; error: string }
> {
  const roomId = RoomId(c.req.param('roomId'))
  const session = await requireRoomSession(c, roomId)
  if (!session) return { ok: false, status: 401, error: 'unauthorized' }

  const gameNight = await requireActiveGameNight(
    c,
    roomId,
    GameNightId(c.req.param('gameNightId')),
  )
  if (!gameNight) return { ok: false, status: 404, error: 'active_game_night_not_found' }

  const game = await c.get('deps').games.getActive(gameNight.id)
  if (!game || game.id !== GameId(c.req.param('gameId'))) {
    return { ok: false, status: 404, error: 'active_game_not_found' }
  }

  return { ok: true, roomId, game }
}

async function betsResponse(c: RouteContext, game: CurrentGame) {
  return {
    bets: await c.get('deps').bets.listByGame(game.id),
    betsLockedAt: game.betsLockedAt,
  }
}

betRoutes.post(BETS_PATH, async (c) => {
  const resolved = await resolveLiveGame(c)
  if (!resolved.ok) return c.json({ error: resolved.error }, resolved.status)
  const { roomId, game } = resolved

  if (game.betsLockedAt !== null) {
    return c.json({ error: 'bets_locked' }, 409)
  }

  const parsed = placeBetSchema.safeParse(await parseJson(c))
  if (!parsed.success) {
    return c.json({ error: 'invalid_body', issues: parsed.error.flatten() }, 400)
  }
  const body = parsed.data satisfies PlaceBetRequest
  const gamerId = GamerId(body.gamerId)

  const pool = await c.get('deps').gameNights.listActiveGamers(game.gameNightId)
  if (!pool.some((entry) => entry.gamerId === gamerId)) {
    return c.json({ error: 'gamer_not_in_pool' }, 400)
  }

  if (!canBack(gamerId, game, body.outcome)) {
    return c.json({ error: 'outcome_not_allowed' }, 400)
  }

  const now = Date.now()
  const bet: Bet = {
    id: BetId(nanoid()),
    roomId,
    gameNightId: game.gameNightId,
    gameId: game.id,
    gamerId,
    outcome: body.outcome,
    stake: body.stake,
    createdAt: now,
    updatedAt: now,
  }
  await c.get('deps').bets.upsert(bet)

  return c.json(await betsResponse(c, game), 201)
})

betRoutes.delete(`${BETS_PATH}/:betId`, async (c) => {
  const resolved = await resolveLiveGame(c)
  if (!resolved.ok) return c.json({ error: resolved.error }, resolved.status)
  const { game } = resolved

  if (game.betsLockedAt !== null) {
    return c.json({ error: 'bets_locked' }, 409)
  }

  await c.get('deps').bets.remove(BetId(c.req.param('betId')), game.id)
  return c.json(await betsResponse(c, game))
})

/**
 * Closes the book. Idempotent: locking an already-locked game returns the
 * existing timestamp rather than erroring, so a re-opened photo capture, a
 * double tap, or a manual lock followed by a photo all behave the same.
 */
betRoutes.post(`${BETS_PATH}/lock`, async (c) => {
  const resolved = await resolveLiveGame(c)
  if (!resolved.ok) return c.json({ error: resolved.error }, resolved.status)
  const { game } = resolved

  if (game.betsLockedAt !== null) {
    return c.json(await betsResponse(c, game))
  }

  const now = Date.now()
  const locked = { ...game, betsLockedAt: now, updatedAt: now }
  await c.get('deps').games.update(locked)
  return c.json(await betsResponse(c, locked))
})
```

Note the `lock` route is registered after the `:betId` DELETE but on a different method, so there is no path conflict. If `listActiveGamers` is not the actual method name on `IGameNightRepository`, check `worker/src/game-nights/repository.ts` and use the real one.

- [ ] **Step 5: Mount the router**

In `worker/src/app.ts`, add the import beside the other route imports:

```ts
import { betRoutes } from './routes/bets.js'
```

And mount it after `roomRoutes`:

```ts
  app.route('/api', betRoutes)
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm --filter @fc26/worker test:run bets`
Expected: PASS, 13 tests.

- [ ] **Step 7: Commit**

```bash
git add worker/src/routes/bets.ts worker/src/routes/bets.test.ts worker/src/app.ts packages/shared/src/types/room-api.ts
git commit --no-gpg-sign -m "Add bet placement, removal and lock routes"
```

---

### Task 7: Settlement on record and interrupt

Wires the maths into the game lifecycle. Two call sites, one service.

**Files:**
- Create: `worker/src/bets/settlement-service.ts`
- Modify: `worker/src/routes/rooms.ts`
- Test: `worker/src/routes/bets-settlement.test.ts`

**Interfaces:**
- Consumes: `settleWagers` (Task 1), `IBetRepository` (Task 4).
- Produces: `settleGameWagers(deps, gameId, result): Promise<WagerSettlement[]>`, `discardGameWagers(deps, gameId): Promise<void>`.

- [ ] **Step 1: Write the failing tests**

Create `worker/src/routes/bets-settlement.test.ts`, importing the fixtures from Task 5b:

```ts
import { buildTestApp, env, execCtx, placeBet, recordResult, req, seedLiveGame } from './test-support.js'
```

```ts
import { describe, expect, it } from 'vitest'
import type { GameRecordedEvent } from '@fc26/shared'

describe('wager settlement', () => {
  it('writes settled wagers into the recorded event and clears live bets', async () => {
    const app = buildTestApp()
    const seed = await seedLiveGame(app)
    await placeBet(app, seed, seed.ann, 'home', 50)
    await placeBet(app, seed, seed.cy, 'draw', 50)

    await recordResult(app, seed, { result: 'home', homeScore: 2, awayScore: 1 })

    const recorded = app.events.events.find(
      (event) => event.payload.type === 'game_recorded',
    )!.payload as GameRecordedEvent
    expect(recorded.wagers).toEqual([
      { gamerId: seed.ann, outcome: 'home', stake: 50, payout: 100 },
      { gamerId: seed.cy, outcome: 'draw', stake: 50, payout: 0 },
    ])
    expect(await app.bets.listByGame(seed.gameId)).toEqual([])
  })

  it('omits the wagers field when no bets were placed', async () => {
    const app = buildTestApp()
    const seed = await seedLiveGame(app)

    await recordResult(app, seed, { result: 'home', homeScore: 1, awayScore: 0 })

    const recorded = app.events.events.find(
      (event) => event.payload.type === 'game_recorded',
    )!.payload as GameRecordedEvent
    expect(recorded.wagers).toBeUndefined()
  })

  it('discards live bets when the game is interrupted', async () => {
    const app = buildTestApp()
    const seed = await seedLiveGame(app)
    await placeBet(app, seed, seed.cy, 'draw', 30)

    await app.request(
      `/api/rooms/${seed.roomId}/game-nights/${seed.nightId}/games/${seed.gameId}/interrupt`,
      { method: 'POST', headers: { cookie: seed.cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ comment: 'pizza' }) },
      env, execCtx(),
    )

    expect(await app.bets.listByGame(seed.gameId)).toEqual([])
    const interrupted = app.events.events.find((event) => event.payload.type === 'game_interrupted')
    expect(interrupted).toBeDefined()
  })

  it('refunds every bet when nobody backed the result', async () => {
    const app = buildTestApp()
    const seed = await seedLiveGame(app)
    await placeBet(app, seed, seed.ann, 'home', 50)

    await recordResult(app, seed, { result: 'away', homeScore: 0, awayScore: 1 })

    const recorded = app.events.events.find(
      (event) => event.payload.type === 'game_recorded',
    )!.payload as GameRecordedEvent
    expect(recorded.wagers).toEqual([
      { gamerId: seed.ann, outcome: 'home', stake: 50, payout: 50 },
    ])
  })
})
```

`recordResult` comes from `test-support.js` — do not redefine it.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @fc26/worker test:run bets-settlement`
Expected: FAIL — `recorded.wagers` is `undefined` where settlements are expected.

- [ ] **Step 3: Implement the service**

Create `worker/src/bets/settlement-service.ts`:

```ts
import { type GameId, type GameResult, settleWagers, type WagerSettlement } from '@fc26/shared'
import type { AppDependencies } from '../dependencies.js'

/**
 * Settles the pool on a game and clears its live rows.
 *
 * The returned settlements go into the `game_recorded` payload, which becomes
 * the durable record — that is why the rows can be deleted here.
 */
export async function settleGameWagers(
  deps: AppDependencies,
  gameId: GameId,
  result: GameResult,
): Promise<WagerSettlement[]> {
  const bets = await deps.bets.listByGame(gameId)
  if (bets.length === 0) return []

  const settlements = settleWagers(
    bets.map((bet) => ({ gamerId: bet.gamerId, outcome: bet.outcome, stake: bet.stake })),
    result,
  )
  await deps.bets.deleteByGame(gameId)
  return settlements
}

/**
 * Drops a game's bets without settling. Used when a game is interrupted: no
 * recorded event exists, so there is nothing to write and everyone nets zero.
 */
export async function discardGameWagers(
  deps: AppDependencies,
  gameId: GameId,
): Promise<void> {
  await deps.bets.deleteByGame(gameId)
}
```

- [ ] **Step 4: Wire into the record route**

In `worker/src/routes/rooms.ts`, add the import:

```ts
import { discardGameWagers, settleGameWagers } from '../bets/settlement-service.js'
```

In the `/result` route, immediately before the `const recordedEvent: GameRecordedEvent = {` line, add:

```ts
  const wagers = await settleGameWagers(c.get('deps'), activeGame.id, body.result)
```

And inside the `recordedEvent` literal, after the `...(body.ocrModel ? { ocrModel: body.ocrModel } : {})` spread, add:

```ts
    ...(wagers.length > 0 ? { wagers } : {}),
```

- [ ] **Step 5: Wire into the interrupt route**

In the `/interrupt` route in `worker/src/routes/rooms.ts`, after the existing `await c.get('deps').games.update({ ... status: 'interrupted' ... })` call, add:

```ts
  await discardGameWagers(c.get('deps'), activeGame.id)
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm --filter @fc26/worker test:run`
Expected: PASS, all suites including the 4 new settlement tests.

- [ ] **Step 7: Commit**

```bash
git add worker/src/bets/settlement-service.ts worker/src/routes/rooms.ts worker/src/routes/bets-settlement.test.ts
git commit --no-gpg-sign -m "Settle wagers when a game is recorded or interrupted"
```

---

### Task 8: Chips endpoint and bets in bootstrap

Exposes the derived standings and puts the live book in the payloads a joining phone already fetches.

**Files:**
- Modify: `worker/src/routes/bets.ts`
- Modify: `worker/src/routes/rooms.ts`
- Modify: `packages/shared/src/types/room-api.ts`
- Test: `worker/src/routes/bets-chips.test.ts`

**Interfaces:**
- Consumes: `nightChipPositions`, `lastSettledGameDeltas` (Task 3).
- Produces: `ChipPosition { gamerId: GamerId; net: number }`, `GameNightChipsResponse { gameNightId: GameNightId; positions: ReadonlyArray<ChipPosition>; lastGameDeltas: ReadonlyArray<ChipPosition> }`; `RoomBootstrapResponse.bets`; `CurrentGameResponse.bets`.

- [ ] **Step 1: Add the API types**

In `packages/shared/src/types/room-api.ts`, append:

```ts
export interface ChipPosition {
  gamerId: GamerId
  /** Net chips tonight: winnings minus stakes. */
  net: number
}

export interface GameNightChipsResponse {
  gameNightId: GameNightId
  positions: ReadonlyArray<ChipPosition>
  /** Per-gamer deltas from the most recently settled game, for highlighting. */
  lastGameDeltas: ReadonlyArray<ChipPosition>
}
```

Add `bets: ReadonlyArray<Bet>` to `RoomBootstrapResponse` and to `CurrentGameResponse`.

- [ ] **Step 2: Write the failing tests**

Create `worker/src/routes/bets-chips.test.ts`, importing the fixtures from Task 5b:

```ts
import { buildTestApp, env, execCtx, placeBet, recordResult, req, seedLiveGame } from './test-support.js'
```

```ts
import { describe, expect, it } from 'vitest'
import type { GameNightChipsResponse, RoomBootstrapResponse } from '@fc26/shared'

describe('chips endpoint', () => {
  it('reports net positions after a settled game', async () => {
    const app = buildTestApp()
    const seed = await seedLiveGame(app)
    await placeBet(app, seed, seed.ann, 'home', 50)
    await placeBet(app, seed, seed.cy, 'draw', 50)
    await recordResult(app, seed, { result: 'home', homeScore: 2, awayScore: 1 })

    const res = await app.request(
      `/api/rooms/${seed.roomId}/game-nights/${seed.nightId}/chips`,
      { headers: { cookie: seed.cookie } },
      env, execCtx(),
    )

    expect(res.status).toBe(200)
    const body = (await res.json()) as GameNightChipsResponse
    expect(body.positions).toEqual(
      expect.arrayContaining([
        { gamerId: seed.ann, net: 50 },
        { gamerId: seed.cy, net: -50 },
      ]),
    )
    expect(body.lastGameDeltas).toEqual(body.positions)
  })

  it('returns empty positions before anything settles', async () => {
    const app = buildTestApp()
    const seed = await seedLiveGame(app)

    const res = await app.request(
      `/api/rooms/${seed.roomId}/game-nights/${seed.nightId}/chips`,
      { headers: { cookie: seed.cookie } },
      env, execCtx(),
    )

    const body = (await res.json()) as GameNightChipsResponse
    expect(body.positions).toEqual([])
  })

  it('excludes a voided game from the standings', async () => {
    const app = buildTestApp()
    const seed = await seedLiveGame(app)
    await placeBet(app, seed, seed.ann, 'home', 50)
    await recordResult(app, seed, { result: 'home', homeScore: 2, awayScore: 1 })

    await app.request(
      `/api/rooms/${seed.roomId}/game-nights/${seed.nightId}/games/${seed.gameId}/void`,
      { method: 'POST', headers: { cookie: seed.cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ reason: 'mistake' }) },
      env, execCtx(),
    )

    const res = await app.request(
      `/api/rooms/${seed.roomId}/game-nights/${seed.nightId}/chips`,
      { headers: { cookie: seed.cookie } },
      env, execCtx(),
    )

    expect(((await res.json()) as GameNightChipsResponse).positions).toEqual([])
  })

  it('includes live bets in the bootstrap payload', async () => {
    const app = buildTestApp()
    const seed = await seedLiveGame(app)
    await placeBet(app, seed, seed.cy, 'draw', 25)

    const res = await app.request(
      `/api/rooms/${seed.roomId}/bootstrap`,
      { headers: { cookie: seed.cookie } },
      env, execCtx(),
    )

    const body = (await res.json()) as RoomBootstrapResponse
    expect(body.bets).toHaveLength(1)
    expect(body.bets[0]!.stake).toBe(25)
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm --filter @fc26/worker test:run bets-chips`
Expected: FAIL — 404 on `/chips`, and `body.bets` undefined.

- [ ] **Step 4: Implement the chips route**

In `worker/src/routes/bets.ts`, add to the imports:

```ts
import { type ChipPosition, lastSettledGameDeltas, nightChipPositions } from '@fc26/shared'
```

Append the route:

```ts
function toPositions(net: ReadonlyMap<ReturnType<typeof GamerId>, number>): ChipPosition[] {
  return [...net.entries()]
    .map(([gamerId, value]) => ({ gamerId, net: value }))
    .sort((a, b) => b.net - a.net)
}

betRoutes.get('/rooms/:roomId/game-nights/:gameNightId/chips', async (c) => {
  const roomId = RoomId(c.req.param('roomId'))
  const session = await requireRoomSession(c, roomId)
  if (!session) return c.json({ error: 'unauthorized' }, 401)

  const gameNightId = GameNightId(c.req.param('gameNightId'))
  const events = await c.get('deps').events.listByRoom(roomId)

  return c.json({
    gameNightId,
    positions: toPositions(nightChipPositions(events, gameNightId)),
    lastGameDeltas: toPositions(lastSettledGameDeltas(events, gameNightId)),
  })
})
```

This route deliberately does not call `requireActiveGameNight` — standings stay readable after the night completes.

- [ ] **Step 5: Add bets to bootstrap and the create-game response**

In `worker/src/routes/rooms.ts`, find `buildBootstrap` and add the live book to its return value. Where it already resolves `currentGame`, add:

```ts
  const bets = currentGame ? await c.get('deps').bets.listByGame(currentGame.id) : []
```

and include `bets,` in the returned object.

In the create-game route, change the final response to include the (empty) book so the client's shape is uniform:

```ts
  return c.json({ currentGame, bets: [] }, 201)
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm --filter @fc26/worker test:run`
Expected: PASS, all suites.

Run: `pnpm -r typecheck`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add worker/src/routes packages/shared/src/types/room-api.ts
git commit --no-gpg-sign -m "Expose night chip standings and live bets"
```

---

### Task 9: Web API client and BetsPanel

The live betting UI.

**Files:**
- Modify: `apps/web/src/lib/api.ts`
- Create: `apps/web/src/features/gameNight/BetsPanel.tsx`
- Test: `apps/web/src/features/gameNight/BetsPanel.test.tsx`

**Interfaces:**
- Consumes: `Bet`, `BetsResponse`, `canBack`, `describeIneligibility`, `GAME_FORMATS`.
- Produces: `BetsPanel` accepting `{ busy, currentGame, gamers, poolGamerIds, bets, onPlaceBet, onRemoveBet, onLockBets }`.

- [ ] **Step 1: Add the client calls**

In `apps/web/src/lib/api.ts`, append:

```ts
const LAST_BETTOR_KEY = 'fc26:last-bettor'

/**
 * The gamer who last bet from this device, per room. Defaults the picker so a
 * shared phone saves a tap and a stale name is less likely to be left
 * selected by the previous bettor.
 */
export function readLastBettor(roomId: string): string | null {
  try {
    return window.localStorage.getItem(`${LAST_BETTOR_KEY}:${roomId}`)
  } catch {
    return null
  }
}

export function persistLastBettor(roomId: string, gamerId: string): void {
  try {
    window.localStorage.setItem(`${LAST_BETTOR_KEY}:${roomId}`, gamerId)
  } catch {
    // Private-mode Safari throws on localStorage writes. The default is a
    // convenience, so losing it is not worth surfacing.
  }
}
```

- [ ] **Step 2: Write the failing component tests**

Create `apps/web/src/features/gameNight/BetsPanel.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { BetId, GameId, GameNightId, GamerId, RoomId, type Bet, type CurrentGame, type Gamer } from '@fc26/shared'
import { BetsPanel } from './BetsPanel.jsx'

const ann = GamerId('ann')
const bob = GamerId('bob')
const cy = GamerId('cy')

function gamer(id: ReturnType<typeof GamerId>, name: string): Gamer {
  return {
    id, roomId: RoomId('room-1'), name, rating: 3, active: true,
    hasPin: false, avatarUrl: null, createdAt: 1, updatedAt: 1,
  }
}

const currentGame: CurrentGame = {
  id: GameId('game-1'),
  roomId: RoomId('room-1'),
  gameNightId: GameNightId('night-1'),
  status: 'active',
  allocationMode: 'manual',
  format: '1v1',
  homeGamerIds: [ann],
  awayGamerIds: [bob],
  homeClubId: null,
  awayClubId: null,
  selectionStrategyId: 'manual',
  randomSeed: null,
  betsLockedAt: null,
  createdAt: 1,
  updatedAt: 1,
}

function bet(id: string, gamerId: ReturnType<typeof GamerId>, outcome: 'home' | 'away' | 'draw', stake: number): Bet {
  return {
    id: BetId(id), roomId: RoomId('room-1'), gameNightId: GameNightId('night-1'),
    gameId: GameId('game-1'), gamerId, outcome, stake, createdAt: 1, updatedAt: 1,
  }
}

function renderPanel(overrides: Partial<Parameters<typeof BetsPanel>[0]> = {}) {
  const props = {
    busy: null,
    currentGame,
    gamers: [gamer(ann, 'Ann'), gamer(bob, 'Bob'), gamer(cy, 'Cy')],
    poolGamerIds: [ann, bob, cy],
    bets: [] as Bet[],
    onPlaceBet: vi.fn(),
    onRemoveBet: vi.fn(),
    onLockBets: vi.fn(),
    ...overrides,
  }
  render(<BetsPanel {...props} />)
  return props
}

describe('BetsPanel', () => {
  it('shows the pot and each outcome multiplier', () => {
    renderPanel({ bets: [bet('b1', ann, 'home', 50), bet('b2', cy, 'draw', 50)] })

    expect(screen.getByText(/pot 100/i)).toBeInTheDocument()
    // Home has 50 of a 100 pot backing it → pays 2.0x.
    expect(screen.getByText(/home pays 2\.0×/i)).toBeInTheDocument()
  })

  it('shows a dash for an outcome nobody backed', () => {
    renderPanel({ bets: [bet('b1', ann, 'home', 50)] })

    expect(screen.getByText(/away pays —/i)).toBeInTheDocument()
  })

  it('disables outcomes a participant may not back, with a reason', () => {
    renderPanel()
    fireEvent.change(screen.getByLabelText(/who's betting/i), { target: { value: ann } })

    expect(screen.getByRole('button', { name: /^draw$/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /^away$/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /^home$/i })).toBeEnabled()
    expect(screen.getByText(/you're playing home/i)).toBeInTheDocument()
  })

  it('lets a non-participant back any outcome', () => {
    renderPanel()
    fireEvent.change(screen.getByLabelText(/who's betting/i), { target: { value: cy } })

    expect(screen.getByRole('button', { name: /^draw$/i })).toBeEnabled()
    expect(screen.getByRole('button', { name: /^away$/i })).toBeEnabled()
  })

  it('places a bet', () => {
    const props = renderPanel()
    fireEvent.change(screen.getByLabelText(/who's betting/i), { target: { value: cy } })
    fireEvent.click(screen.getByRole('button', { name: /^draw$/i }))
    fireEvent.change(screen.getByLabelText(/stake/i), { target: { value: '25' } })
    fireEvent.click(screen.getByRole('button', { name: /place bet/i }))

    expect(props.onPlaceBet).toHaveBeenCalledWith({ gamerId: cy, outcome: 'draw', stake: 25 })
  })

  it('rejects a non-positive stake without calling the handler', () => {
    const props = renderPanel()
    fireEvent.change(screen.getByLabelText(/who's betting/i), { target: { value: cy } })
    fireEvent.click(screen.getByRole('button', { name: /^draw$/i }))
    fireEvent.change(screen.getByLabelText(/stake/i), { target: { value: '0' } })
    fireEvent.click(screen.getByRole('button', { name: /place bet/i }))

    expect(props.onPlaceBet).not.toHaveBeenCalled()
    expect(screen.getByText(/stake must be at least 1/i)).toBeInTheDocument()
  })

  it('removes a bet', () => {
    const props = renderPanel({ bets: [bet('b1', cy, 'draw', 25)] })
    fireEvent.click(screen.getByRole('button', { name: /remove cy's bet/i }))

    expect(props.onRemoveBet).toHaveBeenCalledWith(BetId('b1'))
  })

  it('renders read-only once the book is locked', () => {
    renderPanel({
      currentGame: { ...currentGame, betsLockedAt: 123 },
      bets: [bet('b1', cy, 'draw', 25)],
    })

    expect(screen.getByText(/bets locked/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /place bet/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /remove/i })).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm --filter @fc26/web test:run BetsPanel`
Expected: FAIL — cannot resolve `./BetsPanel.jsx`.

- [ ] **Step 4: Implement the component**

Create `apps/web/src/features/gameNight/BetsPanel.tsx`:

```tsx
import { useMemo, useState } from 'react'
import {
  type Bet,
  type BetId,
  canBack,
  type CurrentGame,
  describeIneligibility,
  type Gamer,
  type GamerId,
  type GameResult,
} from '@fc26/shared'
import { Field } from '../../components/Field.jsx'
import { InlineNotice } from '../../components/InlineNotice.jsx'
import { inputStyle, primaryButtonStyle, secondaryButtonStyle } from '../../styles/controls.js'
import type { BusyState } from '../../types/busyState.js'

const OUTCOMES: ReadonlyArray<{ id: GameResult; label: string }> = [
  { id: 'home', label: 'Home' },
  { id: 'draw', label: 'Draw' },
  { id: 'away', label: 'Away' },
]

export function BetsPanel({
  busy,
  currentGame,
  gamers,
  poolGamerIds,
  bets,
  onPlaceBet,
  onRemoveBet,
  onLockBets,
}: {
  busy: BusyState
  currentGame: CurrentGame
  gamers: ReadonlyArray<Gamer>
  poolGamerIds: ReadonlyArray<GamerId>
  bets: ReadonlyArray<Bet>
  onPlaceBet: (request: { gamerId: GamerId; outcome: GameResult; stake: number }) => void
  onRemoveBet: (betId: BetId) => void
  onLockBets: () => void
}) {
  const [bettorId, setBettorId] = useState<GamerId | ''>('')
  const [outcome, setOutcome] = useState<GameResult>('home')
  const [stake, setStake] = useState('')
  const [error, setError] = useState<string | null>(null)

  const locked = currentGame.betsLockedAt !== null
  const pot = useMemo(() => bets.reduce((sum, item) => sum + item.stake, 0), [bets])

  const backedByOutcome = useMemo(() => {
    const totals = new Map<GameResult, number>()
    for (const item of bets) {
      totals.set(item.outcome, (totals.get(item.outcome) ?? 0) + item.stake)
    }
    return totals
  }, [bets])

  const pool = useMemo(
    () => gamers.filter((gamer) => poolGamerIds.includes(gamer.id)),
    [gamers, poolGamerIds],
  )

  function nameOf(gamerId: GamerId): string {
    return gamers.find((gamer) => gamer.id === gamerId)?.name ?? 'Unknown'
  }

  /**
   * What a winning chip returns: the whole pot divided by what backs this
   * outcome. Shown as a multiplier because that reads faster than raw totals
   * when the pot is moving between bets.
   */
  function multiplierLabel(id: GameResult): string {
    const backed = backedByOutcome.get(id) ?? 0
    if (backed === 0) return '—'
    return `${(pot / backed).toFixed(1)}×`
  }

  const ineligibility =
    bettorId === '' ? null : describeIneligibility(bettorId, currentGame, outcome)

  function submit(): void {
    if (bettorId === '') {
      setError('Pick who is betting.')
      return
    }
    const parsed = Number.parseInt(stake.trim(), 10)
    if (!Number.isFinite(parsed) || parsed < 1) {
      setError('Stake must be at least 1 chip.')
      return
    }
    if (!canBack(bettorId, currentGame, outcome)) {
      setError(describeIneligibility(bettorId, currentGame, outcome))
      return
    }
    setError(null)
    onPlaceBet({ gamerId: bettorId, outcome, stake: parsed })
    setStake('')
  }

  return (
    <div
      style={{
        padding: 12,
        borderRadius: 18,
        background: '#ffffff',
        border: '1px solid #c7d2fe',
        display: 'grid',
        gap: 12,
      }}
    >
      <strong style={{ fontSize: 16 }}>{locked ? 'Bets locked' : 'Bets'}</strong>

      <div style={{ fontSize: 13, opacity: 0.8 }}>Pot {pot} chips</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
        {OUTCOMES.map((item) => (
          <div key={item.id} style={{ fontSize: 12, opacity: 0.75 }}>
            {item.label} pays {multiplierLabel(item.id)}
          </div>
        ))}
      </div>

      {bets.length === 0 ? (
        <p style={{ margin: 0, fontSize: 13, opacity: 0.7 }}>No bets yet.</p>
      ) : (
        <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 6 }}>
          {bets.map((item) => (
            <li
              key={item.id}
              style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}
            >
              <span style={{ flex: 1 }}>
                {nameOf(item.gamerId)} — {item.outcome} — {item.stake}
              </span>
              {locked ? null : (
                <button
                  type="button"
                  aria-label={`Remove ${nameOf(item.gamerId)}'s bet`}
                  disabled={busy !== null}
                  onClick={() => onRemoveBet(item.id)}
                  style={{ ...secondaryButtonStyle, padding: '4px 10px', fontSize: 13 }}
                >
                  ×
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {locked ? null : (
        <>
          <Field label="Who's betting">
            <select
              value={bettorId}
              onChange={(event) => setBettorId(event.target.value as GamerId)}
              style={inputStyle}
            >
              <option value="">Pick a gamer</option>
              {pool.map((gamer) => (
                <option key={gamer.id} value={gamer.id}>
                  {gamer.name}
                </option>
              ))}
            </select>
          </Field>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
            {OUTCOMES.map((item) => {
              const allowed = bettorId === '' || canBack(bettorId, currentGame, item.id)
              return (
                <button
                  key={item.id}
                  type="button"
                  disabled={!allowed || busy !== null}
                  aria-pressed={outcome === item.id}
                  onClick={() => setOutcome(item.id)}
                  style={outcome === item.id ? primaryButtonStyle : secondaryButtonStyle}
                >
                  {item.label}
                </button>
              )
            })}
          </div>

          {ineligibility ? <InlineNotice tone="warn" message={ineligibility} /> : null}

          <Field label="Stake">
            <input
              value={stake}
              onChange={(event) => setStake(event.target.value)}
              inputMode="numeric"
              placeholder="Chips"
              style={inputStyle}
            />
          </Field>

          {error ? <InlineNotice tone="warn" message={error} /> : null}

          <button type="button" disabled={busy !== null} onClick={submit} style={primaryButtonStyle}>
            Place bet
          </button>
          <button
            type="button"
            disabled={busy !== null}
            onClick={onLockBets}
            style={secondaryButtonStyle}
          >
            Lock bets
          </button>
        </>
      )}
    </div>
  )
}
```

Check `InlineNotice`'s actual prop names in `apps/web/src/components/InlineNotice.tsx` and match them; the sketch above assumes `{ tone, message }`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @fc26/web test:run BetsPanel`
Expected: PASS, 8 tests.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/gameNight/BetsPanel.tsx apps/web/src/features/gameNight/BetsPanel.test.tsx apps/web/src/lib/api.ts
git commit --no-gpg-sign -m "Add the live betting panel"
```

---

### Task 10: Chip standings and wiring

Puts both panels on screen and closes the book when the photo capture opens.

**Files:**
- Create: `apps/web/src/features/gameNight/ChipStandingsPanel.tsx`
- Modify: `apps/web/src/features/gameNight/CurrentGameCard.tsx`
- Modify: `apps/web/src/features/gameNight/GameCreationPanel.tsx`
- Modify: `apps/web/src/features/gameNight/TvPhotoCapture.tsx`
- Modify: `apps/web/src/features/room/RoomScreen.tsx`
- Modify: `apps/web/src/App.tsx`
- Test: `apps/web/src/features/gameNight/ChipStandingsPanel.test.tsx`

**Interfaces:**
- Consumes: `BetsPanel` (Task 9), `GameNightChipsResponse` (Task 8).
- Produces: `ChipStandingsPanel` accepting `{ gamers, positions, lastGameDeltas }`.

- [ ] **Step 1: Write the failing standings tests**

Create `apps/web/src/features/gameNight/ChipStandingsPanel.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { GamerId, RoomId, type Gamer } from '@fc26/shared'
import { ChipStandingsPanel } from './ChipStandingsPanel.jsx'

const ann = GamerId('ann')
const bob = GamerId('bob')

function gamer(id: ReturnType<typeof GamerId>, name: string): Gamer {
  return {
    id, roomId: RoomId('room-1'), name, rating: 3, active: true,
    hasPin: false, avatarUrl: null, createdAt: 1, updatedAt: 1,
  }
}

describe('ChipStandingsPanel', () => {
  it('renders each gamer net position', () => {
    render(
      <ChipStandingsPanel
        gamers={[gamer(ann, 'Ann'), gamer(bob, 'Bob')]}
        positions={[{ gamerId: ann, net: 50 }, { gamerId: bob, net: -50 }]}
        lastGameDeltas={[]}
      />,
    )

    expect(screen.getByText('Ann')).toBeInTheDocument()
    expect(screen.getByText('+50')).toBeInTheDocument()
    expect(screen.getByText('-50')).toBeInTheDocument()
  })

  it('shows the delta from the game just settled', () => {
    render(
      <ChipStandingsPanel
        gamers={[gamer(ann, 'Ann')]}
        positions={[{ gamerId: ann, net: 50 }]}
        lastGameDeltas={[{ gamerId: ann, net: 20 }]}
      />,
    )

    expect(screen.getByText(/\+20 last game/i)).toBeInTheDocument()
  })

  it('renders nothing when no chips have moved', () => {
    const { container } = render(
      <ChipStandingsPanel gamers={[gamer(ann, 'Ann')]} positions={[]} lastGameDeltas={[]} />,
    )

    expect(container).toBeEmptyDOMElement()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @fc26/web test:run ChipStandingsPanel`
Expected: FAIL — cannot resolve `./ChipStandingsPanel.jsx`.

- [ ] **Step 3: Implement the standings panel**

Create `apps/web/src/features/gameNight/ChipStandingsPanel.tsx`:

```tsx
import type { ChipPosition, Gamer, GamerId } from '@fc26/shared'

function formatNet(net: number): string {
  return net > 0 ? `+${net}` : String(net)
}

/**
 * Net chips per gamer for the night.
 *
 * Lives outside `CurrentGameCard` on purpose: recording a result sets
 * `currentGame` to null and unmounts that card, so a settlement summary inside
 * it would flash and vanish before anyone read it.
 */
export function ChipStandingsPanel({
  gamers,
  positions,
  lastGameDeltas,
}: {
  gamers: ReadonlyArray<Gamer>
  positions: ReadonlyArray<ChipPosition>
  lastGameDeltas: ReadonlyArray<ChipPosition>
}) {
  if (positions.length === 0) return null

  const deltaByGamer = new Map<GamerId, number>(
    lastGameDeltas.map((entry) => [entry.gamerId, entry.net]),
  )

  return (
    <section
      style={{
        marginTop: 18,
        padding: 12,
        borderRadius: 18,
        background: '#ffffff',
        border: '1px solid #c7d2fe',
        display: 'grid',
        gap: 8,
      }}
    >
      <strong style={{ fontSize: 16 }}>Chips tonight</strong>
      <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 6 }}>
        {positions.map((entry) => {
          const delta = deltaByGamer.get(entry.gamerId)
          const name = gamers.find((gamer) => gamer.id === entry.gamerId)?.name ?? 'Unknown'
          return (
            <li
              key={entry.gamerId}
              style={{ display: 'flex', alignItems: 'baseline', gap: 8, fontSize: 14 }}
            >
              <span style={{ flex: 1 }}>{name}</span>
              {delta !== undefined && delta !== 0 ? (
                <span style={{ fontSize: 12, opacity: 0.7 }}>{formatNet(delta)} last game</span>
              ) : null}
              <strong style={{ color: entry.net >= 0 ? '#15803d' : '#b91c1c' }}>
                {formatNet(entry.net)}
              </strong>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
```

- [ ] **Step 4: Run the standings tests**

Run: `pnpm --filter @fc26/web test:run ChipStandingsPanel`
Expected: PASS, 3 tests.

- [ ] **Step 5: Render `BetsPanel` inside the current game**

In `apps/web/src/features/gameNight/CurrentGameCard.tsx`, add `bets`, `poolGamerIds`, `onPlaceBet`, `onRemoveBet` and `onLockBets` to the prop type, threading them from `GameCreationPanel` which in turn takes them from `RoomScreen`. Render the panel between the teams grid and the "Finish game" card — that is, immediately after the closing `</div>` of the `gridTemplateColumns: '1fr 1fr'` block:

```tsx
      <BetsPanel
        busy={busy}
        currentGame={currentGame}
        gamers={gamers}
        poolGamerIds={poolGamerIds}
        bets={bets}
        onPlaceBet={onPlaceBet}
        onRemoveBet={onRemoveBet}
        onLockBets={onLockBets}
      />
```

- [ ] **Step 6: Lock the book when the photo capture opens**

In `apps/web/src/features/gameNight/TvPhotoCapture.tsx`, add an `onOpen?: () => void` prop and call it in the handler that starts the capture — the same handler that opens the camera or file picker. In `CurrentGameCard.tsx`, pass `onOpen={onLockBets}` to the existing `<TvPhotoCapture />`.

The route is idempotent, so calling it on every capture open is safe.

- [ ] **Step 7: Wire the API calls and standings in `App.tsx` / `RoomScreen.tsx`**

In `App.tsx` (where the other room handlers live), add handlers that call the new routes via `apiJson`, refresh bootstrap after each, and refetch chips after a result is recorded or a game is voided:

```ts
async function onPlaceBet(request: { gamerId: string; outcome: GameResult; stake: number }) {
  const response = await apiJson<BetsResponse>(
    `/api/rooms/${roomId}/game-nights/${gameNightId}/games/${gameId}/bets`,
    { method: 'POST', body: JSON.stringify(request) },
  )
  setBets(response.bets)
  persistLastBettor(roomId, request.gamerId)
}
```

Add the matching `onRemoveBet` (DELETE `.../bets/:betId`) and `onLockBets` (POST `.../bets/lock`), both setting `bets` from the response. Add a `loadChips()` that GETs `/api/rooms/:roomId/game-nights/:gameNightId/chips` into state, called on mount of an active night and after every recorded result or void.

In `RoomScreen.tsx`, render the standings directly after the `fc26-game-live-section` section:

```tsx
      {bootstrap.activeGameNight ? (
        <ChipStandingsPanel
          gamers={bootstrap.gamers}
          positions={chips.positions}
          lastGameDeltas={chips.lastGameDeltas}
        />
      ) : null}
```

and pass `bets`, `poolGamerIds={activeGameNightGamerIds}` and the three handlers into `GameCreationPanel`.

- [ ] **Step 8: Run the full suite and typecheck**

Run: `pnpm -r test:run`
Expected: PASS, every package.

Run: `pnpm -r typecheck`
Expected: clean.

- [ ] **Step 9: Verify in the running app**

```bash
pnpm dev:worker   # terminal 1
pnpm dev:web      # terminal 2
```

Walk the flow at <http://localhost:5173>: create a room, add three gamers, start a game night with all three, start a 1v1. Confirm the Bets panel appears; that picking a playing gamer disables Draw and the opposing side with a reason; that placing two bets moves the pot and the multipliers; that Lock bets makes the panel read-only; and that recording a score makes "Chips tonight" appear with the right nets.

- [ ] **Step 10: Commit**

```bash
git add apps/web/src
git commit --no-gpg-sign -m "Wire wagering into the game night UI"
```

---

## Self-Review Notes

Checked against the spec:

- **Settlement rules** → Task 1 (`W > 0`, `W = 0` refund), Task 7 (interrupt discards), Task 8 (void excluded via Task 3's derivation).
- **Eligibility rules** → Task 2 (own-side-only, draw blocked), Task 6 (pool membership, stake validation, lock check — all server-side).
- **Betting window** → Task 6 (manual lock, idempotent), Task 7 (recording settles), Task 10 Step 6 (photo-capture auto-lock).
- **Data model** → Task 4 (`bets` table, unique index, `bets_locked_at`, `SCHEMA_VERSION` bump).
- **Event payload extension** → Task 1 Step 1.
- **Components** → Tasks 1–3 (`packages/shared/src/wager/`), Task 4 + 7 (`worker/src/bets/`), Task 6 + 8 (`worker/src/routes/bets.ts`), Tasks 9–10 (web).
- **Device-remembered bettor** → Task 9 Step 1 (`readLastBettor` / `persistLastBettor`).
- **Testing plan** → every listed case has a test in Tasks 1, 2, 3, 4, 6, 7, 8, 9, 10, on fixtures from Task 5b.

Two places where the plan tells the implementer to verify against real code rather than trusting the sketch, because these were not read in full while planning: `IGameNightRepository`'s active-gamer list method name (Task 6 Step 4) and `InlineNotice`'s prop names (Task 9 Step 4). Both are one-line confirmations at implementation time.
