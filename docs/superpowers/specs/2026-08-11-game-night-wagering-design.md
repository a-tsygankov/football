# Game Night Wagering — Design

Date: 2026-08-11

## Summary

Add virtual-chip wagering to a Game Night. While a game is live, anyone in the
night's active gamer pool can stake chips on the outcome. All stakes on a game
form one pari-mutuel pool; backers of the actual result split it in proportion
to their stake. Chips are imaginary, there is no wallet and no balance to draw
down — a gamer's position is derived from the event log as winnings minus
stakes.

## Goals

- Stake chips on the live game, from the phone already being passed around.
- Live odds that move as bets land, because that is the entertainment.
- A running "who is up tonight" standing.
- No real money, no payments surface, no balance that can drift out of sync.

## Non-goals

- Real-currency stakes or settlement.
- A lifetime chip leaderboard on the room scoreboard. Positions derive from the
  event log, so this is cheap to add later; it is out of scope now.
- Betting on anything other than the current live game (no futures, no props).
- A house or bookmaker account.

## Decisions

| Question | Decision |
|---|---|
| Stake type | Virtual chips, no real money |
| Who may bet | Everyone in the night's pool, players included |
| Payout model | Pari-mutuel pool |
| Balances | None. Arbitrary stake amounts; position is derived |
| Self-betting | A participant may back only their own side |
| Bettor identity | Pick your name from the pool, no PIN, device-remembered default |
| Window closes | On `Lock bets`, on opening the photo capture, or on recording |

## Architecture

Bets are mutable live state while a game is running, and become immutable
history at settlement. This mirrors the pattern the codebase already uses for
games themselves: the `games` table holds live state, and only at resolution
does a `game_recorded` event get written.

- A `bets` table holds bets while the game is live. Placeable, replaceable and
  removable until the book closes.
- At settlement the worker computes the pari-mutuel split and writes it into
  the `game_recorded` event payload under a new optional `wagers` field.
- Chip positions derive from the event log, the same derive-from-the-log shape
  the scoreboard already uses. No balance column exists, so none can drift.

Voiding a game therefore removes its wagers along with the match, because both
live in the same payload.

### Data model

New migration `worker/src/db/migrations/0006_bets.sql`:

```sql
CREATE TABLE bets (
  id            TEXT PRIMARY KEY,
  room_id       TEXT NOT NULL REFERENCES rooms(id),
  game_night_id TEXT NOT NULL REFERENCES game_nights(id),
  game_id       TEXT NOT NULL REFERENCES games(id),
  gamer_id      TEXT NOT NULL REFERENCES gamers(id),
  outcome       TEXT NOT NULL,            -- 'home' | 'away' | 'draw'
  stake         INTEGER NOT NULL,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE UNIQUE INDEX idx_bets_game_gamer ON bets(game_id, gamer_id);
CREATE INDEX idx_bets_game ON bets(game_id);

ALTER TABLE games ADD COLUMN bets_locked_at INTEGER;
```

The unique index enforces one bet per gamer per game at the database level.

Rows are deleted once the game they belong to settles — the durable record is
the event. This keeps the table bounded to the live game.

### Event payload extension

In `packages/shared/src/types/events.ts`:

```ts
export interface WagerSettlement {
  gamerId: GamerId
  /** Which outcome this gamer backed. */
  outcome: GameResult
  stake: number
  /** 0 for a losing bet; equals `stake` on a refund. */
  payout: number
}

export interface GameRecordedEvent {
  // ...existing fields
  /**
   * Settled wagers for this game. Optional because events recorded before
   * wagering existed will not have it, and because a game with no bets
   * placed writes nothing.
   */
  wagers?: readonly WagerSettlement[]
}
```

`EVENT_SCHEMA_VERSION` stays at 1. The field is additive and optional, matching
the precedent set by `GameSide.clubName?`.

## Settlement rules

Let `pot` be the sum of every stake on the game and `W` the sum of stakes on
the winning outcome.

- **`W > 0`** — each winner receives `floor(stake_i × pot / W)`. Flooring leaves
  a remainder of at most `winnerCount - 1` chips; those go to the largest
  fractional remainders first, with the larger stake breaking a tie, and the
  lower `gamerId` breaking that. The pot balances to the chip and the result is
  deterministic.
- **`W = 0`** — nobody backed the actual result. Every bet is refunded
  (`payout = stake`), everyone nets zero.
- **Game interrupted** — no `game_recorded` event exists, so nothing is
  written. Live bet rows are deleted. Everyone nets zero.
- **Game voided** — position derivation skips any `game_recorded` whose
  `gameId` has a matching `game_voided` event. The wagers vanish with the
  match. Nothing is written back, so no reversal path is needed.

Because the pool is closed, net positions across a settled game always sum to
zero. This is a useful invariant to assert in tests.

## Eligibility rules

A bet is accepted only when all of these hold:

- The gamer is in the game night's active gamer pool.
- The game is live and its book is open (`bets_locked_at` is null).
- The stake is an integer in `1..1_000_000`. The cap exists because
  `settleWagers` multiplies `stake × pot` in ordinary JS numbers; past `2^53`
  that loses integer precision and the pot stops balancing to the chip, which
  would break the zero-sum invariant. A million chips is far beyond any real
  bet here, so the cap costs nothing and keeps the maths exact.
- The outcome is permitted for that gamer:
  - in `homeGamerIds` → only `home`
  - in `awayGamerIds` → only `away`
  - not playing → any of `home`, `draw`, `away`

Participants are blocked from `draw` as well as from the opposing side. A draw
stake would pay a participant for not winning, which is the same perverse
incentive as backing the opponent, only softer.

One bet per gamer per game. Placing again replaces the existing bet rather than
adding a second, so a non-participant cannot cover two outcomes and the bet
list stays readable.

## The betting window

The book opens when the game is created, since teams and clubs are known then.
It closes on whichever comes first:

- someone taps **Lock bets**;
- the TV photo capture is opened; or
- the result is recorded.

The lock is therefore available but never required. The photo-capture trigger
is what closes the realistic late-bet hole: the gap between the final whistle
and someone tapping record. Opening `TvPhotoCapture` means the match is over
and the score is on screen, so the book has no business still being open. It
costs no extra taps and needs no timer.

A bet placed after the book closes is rejected by the server, not just hidden
by the UI, so a stale phone cannot slip one through.

## Components

### `packages/shared/src/wager/`

Pure functions, no I/O, directly unit-testable.

- `settle.ts` — `settleWagers(bets, result): WagerSettlement[]`. The
  pari-mutuel split and remainder distribution.
- `eligibility.ts` — `canBack(gamerId, game, outcome): boolean` and a
  `describeIneligibility()` helper returning the short reason the UI shows.
- `positions.ts` — `nightChipPositions(events, gameNightId): Map<GamerId, number>`.
  Sums `payout - stake` across recorded events, skipping voided games and
  events with no `wagers` field.
- `types.ts`, `index.ts` — barrel, following the layout of
  `packages/shared/src/selection/`.

### `worker/src/bets/`

- `repository.ts` — `IBetRepository` with `InMemoryBetRepository` and
  `D1BetRepository`, following `worker/src/games/repository.ts`.
- `settlement-service.ts` — `settleGameWagers()`, called by the record-result
  path to produce the `wagers` payload and delete the live rows, and by the
  interrupt path to delete the live rows only.

### `worker/src/routes/bets.ts`

New file rather than growing `worker/src/routes/rooms.ts`, which is already
1867 lines.

```
POST   /rooms/:roomId/game-nights/:gameNightId/games/:gameId/bets
DELETE /rooms/:roomId/game-nights/:gameNightId/games/:gameId/bets/:betId
POST   /rooms/:roomId/game-nights/:gameNightId/games/:gameId/bets/lock
GET    /rooms/:roomId/game-nights/:gameNightId/chips
```

All are room-session guarded like every other room mutation.

The photo-capture auto-lock needs no endpoint of its own: `TvPhotoCapture`
calls the same `bets/lock` route when it opens. The route is idempotent — a
lock on an already-locked book returns the existing `betsLockedAt` rather than
erroring — so a re-opened capture, a double tap, or a manual lock followed by a
photo all behave the same.

Existing worker code changes in two places only, each a call into
`settlement-service.ts`: the record-result route and the interrupt route.

### API types

In `packages/shared/src/types/room-api.ts`:

```ts
export interface Bet {
  id: BetId
  gameId: GameId
  gamerId: GamerId
  outcome: GameResult
  stake: number
  createdAt: number
}

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

`BetId` joins the branded ids in `packages/shared/src/types/ids.ts`.

`CurrentGame` in `packages/shared/src/types/domain.ts` gains
`betsLockedAt: number | null`, mapped from the new `games.bets_locked_at`
column by `worker/src/games/repository.ts`. `RoomBootstrapResponse` and
`CurrentGameResponse` gain `bets`, so a phone joining mid-game sees the book
immediately; the lock state rides along on the game itself.

### Web

- `apps/web/src/features/gameNight/BetsPanel.tsx` — rendered inside
  `CurrentGameCard`, between the teams grid and the "Finish game" card. Shows
  the pot, each outcome's live multiplier (`pot / W`, displayed as `Home pays
  2.4×`, or `—` when nothing backs that outcome), the placed bets as removable
  rows, and the entry form: gamer picker from the night's pool, a Home/Draw/Away
  segmented control with ineligible options disabled and their reason shown, and
  a numeric stake field. A secondary **Lock bets** button sits at the bottom.
  When locked, the panel renders read-only under a "Bets locked" header.

  The gamer picker defaults to the last gamer who bet from this device, held in
  `localStorage` keyed by room. On a shared phone this saves a tap for whoever
  bets most; on a personal phone the picker effectively disappears. It also
  removes the likelier attribution failure — a stale name left selected by the
  previous bettor — without putting a PIN in front of every stake. Deliberate
  joke bets stay possible, and stay a social problem rather than a technical
  one.

- `apps/web/src/features/gameNight/ChipStandingsPanel.tsx` — game-night level,
  outside the current game. Net chips per gamer tonight, with the deltas from
  the game just settled highlighted. This lives outside `CurrentGameCard`
  deliberately: when a result is recorded `currentGame` becomes null and that
  card unmounts, so a settlement summary inside it would flash and disappear.

No bottom-nav change. The nav's four slots are full and both surfaces belong to
the Game section.

## Testing

Vitest throughout, colocated `*.test.ts` files, matching existing convention.

**`packages/shared/src/wager/`** — the bulk of the coverage, since this is
where the rules live:

- `settle.test.ts` — proportional split; remainder distribution when the
  division is not exact; tie-break order; `W = 0` refunds everyone; every bet
  on the winning outcome (each gamer gets their stake back); a single bettor;
  no bets at all; net positions sum to zero for every case.
- `eligibility.test.ts` — home participant may back home, may not back away or
  draw; away participant symmetrically; non-participant may back all three;
  a gamer outside the pool is rejected.
- `positions.test.ts` — nets across several games; voided games excluded;
  events with no `wagers` field ignored; a gamer who never bet is absent.

**`worker/`** — route-level, following `worker/src/routes/rooms.test.ts`:

- place, replace, remove and lock a bet;
- reject a bet after lock, an ineligible outcome, a zero, negative or
  fractional stake, and a gamer outside the pool;
- opening the photo capture locks the book, and a bet arriving afterwards is
  rejected by the server rather than merely hidden by the UI;
- recording a result writes `wagers` into the event and deletes live rows;
- interrupting deletes live rows and writes no wagers;
- a voided game's wagers are excluded from the chips endpoint.

**`apps/web/`** — component-level, following `MatchHistoryList.test.tsx`:

- `BetsPanel` disables ineligible outcomes and shows the reason;
- multipliers render, including the no-backers case;
- a bet can be removed while open, and the panel is read-only once locked;
- `ChipStandingsPanel` renders nets and last-game deltas.

## Risks and open points

- **Late bets.** Opening the photo capture closes the book, which covers the
  realistic case. A group that records scores by hand, without a photo, still
  relies on the honour system for the gap between the whistle and the tap. The
  remaining fix is to make the lock compulsory before a result can be recorded
  — deliberately deferred, since it costs a mandatory tap on every game to
  close a hole that only exists for manual-entry groups.
- **Bet attribution.** Picking a name with no PIN means anyone holding the
  phone can stake in someone else's name. The device-remembered default covers
  the accidental case; the deliberate one is accepted, because a per-bet PIN
  was judged too heavy for a living-room app.
- **Chips table growth.** Live bet rows are deleted at settlement, so the table
  stays bounded to the current game. An interrupted game that is never resolved
  would leave rows behind; ending a game night deletes any bets belonging to it.
