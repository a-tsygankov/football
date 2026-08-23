# FC 26 Team Picker — Architecture & Implementation Handoff

**Stack:** TypeScript · Vite · React · Cloudflare Workers · D1 · R2
**Target devices:** Android and iPhone phones (mobile-first PWA)
**Document version:** 7 (2026-08-21) — supersedes the original `.docx` handoff

---

## Recent Changes (2026-08-21)

Shipped as PRs #48–#50 — #48 landed late on the 20th and is recorded here
because that day's entry was already written. Versions at the end of it:
`@fc26/web` → `0.1.30`, `@fc26/worker` → `0.1.19`, `@fc26/shared` → `0.1.16`,
`WORKER_VERSION` → `0.1.19`. `SCHEMA_VERSION` is still `14` and `EVENT_SCHEMA_VERSION` still `1`:
nothing about the data changed, only what the worker will accept.

Three things landed. The health check stopped reimplementing the ledger fold in
SQL and now shares `roomChipLedger` with the app (§27, *Operational note*). The
wager viewer's seeding guard turned out to be a real fix and is now pinned by a
unit test — "Everyone" had never been selectable since #23, and the end-to-end
suite could not tell. And **a bet no longer has to fit inside a balance.**

### Betting on credit (#50)

Chips are a tally of who is up and who is down, not a bankroll that has to be
funded before anyone may play. Buying in is optional; a gamer who never bought
a chip and lost 20 sits at −20, which is a debt `settleUp` collects rather than
a fault.

What went:

- the solvency check in `POST …/bets`, and with it a whole-room event read on
  every bet placed
- the same check in `BetsPanel`, and the "out of chips — buy some on the Wager
  page" message that went with it
- `maxStakeOnGame`, which had no other caller

What stayed: `MAX_STAKE` (1,000,000), which is about integer precision in
`settleWagers` rather than about credit, and is still enforced on the running
total of a position. Eligibility (`canBack`) is untouched — a player still
cannot bet against themselves.

The invariant this rests on was already true: wagering only *moves* chips, so a
pot is covered by the losers of that same pot however little anybody bought.
Every net still sums to zero, which is what the health check verifies against
production and what `settleUp` divides into payments.

Wording followed the model. A balance below zero now reads "owes 20 chips"
rather than "-20 chips", which is true and reads like a fault. The bet form
shows what is *in play* rather than what is "available", because a number that
reads as an allowance would be a promise nothing keeps.

Sabotage-checked: restoring the old ceiling fails 9 of the 11 worker tests and
the credit end-to-end spec. Two survivors were the tell that they were checking
something else — the sums-to-zero test passes on an empty ledger, and the
interrupted-game test on an empty book — so both now assert that somebody
actually bet.

### Tests

571 unit (257 shared, 174 worker, 140 web) plus 7 end-to-end.

`worker/src/routes/bets-balance.test.ts` became `bets-credit.test.ts`: the
subject changed from what gets refused to what the ledger does when there is no
bankroll. The end-to-end suite is still seven specs — the one that checked the
refusal now plays a night nobody bought into, from the empty room to the
settled debt.

---

## Recent Changes (2026-08-20)

Shipped as PRs #35–#46. Versions at the end of it: `@fc26/web` → `0.1.28`,
`@fc26/worker` → `0.1.18`, `@fc26/shared` → `0.1.14`, `WORKER_VERSION` →
`0.1.18`, `SCHEMA_VERSION` → `14` (migration 0014). `EVENT_SCHEMA_VERSION` is
still `1`; the new event type was additive.

Three threads: settling up became a thing the app can record rather than only
compute, the money side of the ledger became visible, and the project gained
browser tests — which immediately found two bugs nothing else could see, and
then went on to find a third in the workflow meant to run them.

### Settling up (#35, #37)

The room could say who owed whom and never that they had **paid**. The ledger
kept folding the same lifetime result forever, so a room that squared up last
week still showed last week's debts, and the only way out was a hand-written
migration — which is exactly how the gap surfaced.

`chips_settled` closes it, and settling clears the debt rather than the
account: chips are not returned, so everyone keeps the stack they bought and
the next night starts from there. See
[§27 Settling up](#settling-up) for the model and the two routes.

#37 followed immediately because all-or-nothing is not how debts get paid.
Somebody pays on Tuesday, somebody else forgets until next month, somebody
pays half now. Each transfer row settles on its own.

The rule that took the most care is the one refusing a payment **between two
people who are both owed money**. Mutation testing found it: replacing `-net`
with `Math.abs(net)` on the payer survived the entire suite, because every
case written by then was already being caught by the *payee* check. Two
creditors could have paid each other and invented debt.

### The money history (#40)

`chips_purchased` had existed since the ledger did and `chips_settled` since
the day before. **Neither was ever displayed.** Settle a debt and it vanished
off the screen with nothing to say anybody had handed over anything.

The Wager page now carries a second collapsed section beside the bet list. See
[§27 The money history](#the-money-history) for how settlements are grouped and
why a multi-party round is not written as pairings.

### End-to-end tests (#41)

See [§29](#29-end-to-end-tests). Worth recording here is what they caught on
the first run, because both were invisible to every existing suite:

- **The money history never refreshed.** Fetched once on mount, so settling a
  debt left the payment absent from the very list that exists to record it.
  Shipped a day earlier and untestable by unit tests, because each half worked
  correctly on its own.
- **A gamer with no ledger row was treated as unknown rather than as holding
  zero.** `ledger.find(...)` returned `undefined`, so the affordability check
  was skipped entirely and the bet went to the worker to be refused there.
  Anybody who had never bought a chip got the raw server error instead of
  "is out of chips — buy some on the Wager page" — which is every gamer in the
  room today, so that message had never once fired.

### Gamer names are per room (#42)

`idx_gamers_name_key` was unique on `name_key` alone, so **two rooms could not
both have an Ann**. Wrong for an app whose whole shape is "a room is a group of
friends": the second group to sign up finds the common names gone, taken by
people they will never play against and cannot see. Migration 0014 moves the
index to `(room_id, name_key)`.

The stem namespace rooms and gamers share was **not** changed, though the first
attempt dissolved it. A room is joined by typing its name, so that pairing is
what keeps the lookup unambiguous — and there was a test saying so, which is
how the overreach was caught. The repository now asks the two questions
separately: `getByNameKey` for "anywhere at all", which room creation needs,
and `getInRoomByNameKey` for "in this room", the only place a gamer's name has
to be unique.

### The health check drifted twice in one day (#36)

Its SQL reimplements the ledger fold, so it went stale when nights stopped
granting chips and again when settlement landed — the second time reporting a
debt the room had already paid. Both were caught by checking it rather than by
it going wrong, but the pattern is the point: **nothing makes that workflow
fail when the model under it moves.** If it drifts a third time, derive it from
`roomChipLedger` instead of hand-writing the arithmetic twice.

### Wagering covered end to end (#44, #45)

Seven specs now, up from the two the harness shipped with. The hedge is the one
that earns its place: cy covers both sides of a game ann is playing, opens two
positions rather than moving one, commits both stakes at once, and finishes
**down 20 despite winning a side**. Paying by gamer rather than by row would
credit that win against both of cy's rows and invent chips, which §27 calls the
single easiest way to reintroduce a serious bug here.

The rest: a repeat bet on one outcome tops the position up rather than opening
a second, a player may back their own side and nothing else, one button clears
a three-way debt, and a settle-up with two payers is recorded as **one round**
rather than three payments.

Then a third bug, this one in the tooling. #45 added two specs and CI ran
neither: the workflow's path filters list the packages that get deployed, so a
change confined to `e2e/` matched nothing and only the version check fired — on
the very suite it was editing. A broken spec could have merged behind a green
tick, which is worse than not having the job. `e2e/**` and
`playwright.config.ts` are in both filters now.

### Paying part of a debt (#46)

The model took a part payment and so did the API; the Paid button always sent
the whole transfer. #45's spec had to seed one over the API and recorded the
gap; #46 closed it. Each row now carries the amount as an editable field,
pre-filled with the whole debt — see
[§27 Settling up](#settling-up).

Worth keeping for the argument it settles about test tiers. Three mutations,
two caught by exactly one of them: a stale override surviving a payment is
**only** caught end to end, because it needs a real round trip, and the
client-side over-payment guard is **only** caught by the unit tests. They are
not duplicating each other.

### Tests

559 unit (245 shared, 174 worker, 140 web) plus 7 end-to-end.

Every behavioural change in this batch was **sabotage-checked**: break the rule,
confirm a test fails, restore. That found the two-creditor hole above, an
earlier settlement test that could not fail, and — pointing the other way — a
change to the wager viewer that survived its own sabotage and is therefore
recorded as unverified rather than claimed as a fix.

*(Settled a day later: it was a real fix. A unit test in `App.test.tsx` fails
without it, so "Everyone" had never been selectable. The browser test could not
tell them apart — see open item 14.)*

---

## Recent Changes (2026-08-19)

Shipped as PRs #22–#29. Versions at the end of the day: `@fc26/web` →
`0.1.20`, `@fc26/worker` → `0.1.14`, `@fc26/shared` → `0.1.8`,
`WORKER_VERSION` → `0.1.14`, `SCHEMA_VERSION` → `13` (migrations 0011–0013).
`EVENT_SCHEMA_VERSION` is still `1`.

Two threads: the chip ledger was taken apart and rebuilt on an honest
definition of a balance, and the client gained a design system and a service
worker. See [§27](#27-wagering--the-chip-ledger) and
[§28](#28-offline--the-service-worker) for the finished shape; this is how it
got there.

### The chip ledger stopped inventing money (#23, #24, #25, #26)

The Wager page showed six gamers holding 220 chips each. None of them had ever
bought one. Working backwards through it took four migrations, each removing a
different layer of fiction, and the sequence is worth keeping because every
step looked reasonable when it was written.

**Migration 0011 — nights nobody bet on.** Migrations 0008 and 0009 had
backfilled a buy-in for every (night, pool gamer) pair so that rooms carrying
balances under the old per-night model kept them. That was right for nights
people wagered on and invention for every evening played before wagering
existed: 100 chips apiece for a season of football nobody had a bet on. 0011
removes the backfill wherever no bet event names the night, matched on the
deterministic migration ids so purchases the route wrote are untouched.
Production went from 306 backfilled rows to 27.

**Nights stopped granting chips (#24).** `DEFAULT_BUY_IN` meant two different
things — the stack a person buys, and what a night hands out — so it split
into `DEFAULT_BUY_IN` (100, still the suggested purchase) and
`DEFAULT_NIGHT_BUY_IN` (**0**). Balances are room-wide and carry between
nights, so a nightly grant handed a free stack to everyone in the pool whether
they wagered or not; sit out ten evenings and you were a thousand chips richer
for having done nothing. A night may still name a buy-in explicitly, and the
old behaviour is exactly that with the amount filled in.

The ledger also learned **where a chip came from**. `purchased` splits into
`bought` (somebody chose to) and `granted` (a night issued it), which is what
makes `hasChipActivity` possible: the Wager page lists a gamer only if they
bought, won, lost, or have a stake riding. Filtering on "net is 0" would have
been wrong — it hides someone who just topped up and hasn't bet, exactly when
they want to see the purchase landed.

**Migration 0012 — the grants themselves.** With nights no longer granting,
every chip already granted was still in the ledger. 0012 removes every
`chips_purchased` event the system issued on a gamer's behalf, matched on
`reason` rather than an id prefix so it catches both the migration backfills
and the grants the route wrote at the time. Balances became `bought + net`.
Production revealed that **nobody had ever bought a chip** — all 27 remaining
purchases were grants — so the room was left holding four non-zero balances,
all of them pure wagering profit and loss.

**Migration 0013 — the slate.** Clearing the wagering record itself so every
balance is exactly 0 and nobody owes anybody. The trap here is that
`game_recorded` carries **the match** — teams, clubs, result, selection
strategy — and only *also* carries the settled wagers, so the event keeps its
row and loses one key via `json_remove`. Deleting those rows would have taken
the scoreboard and the whole season with them. Bets live in three places and
all three are cleared: open `bets` rows, the `bet_*` events, and the
settlements folded into the game.

A night already in progress keeps its buy-in in the `game_nights` row, and
adding somebody to that pool issues it, so 0013 zeroes the buy-in on active
nights too. Without that, tonight would hand out chips again and quietly undo
the reset. Finished nights keep their figure — it is a true record of how they
were played, and nothing can issue against them.

**Consequence, stated plainly:** the room now holds no chips at all, and
nobody can bet until somebody buys some. That is the intended end state of the
Splitwise-style model — chips enter only when a person puts money in — but it
means the first night after this needs a purchase before a book can open. The
refusal says so: `Cy is out of chips — buy some on the Wager page`, rather
than the previous and useless `Cy has -20 chips available`.

*(Superseded 2026-08-21: there is no refusal any more. A room holding no chips
can open a book — everybody starts at zero and the ledger records the debts.
See [§27 Betting on credit](#betting-on-credit).)*

### The health check was asking a dead question (#25)

`ledger-check.yml` counted pool members who had never been bought in. Nobody is
bought in any more, so that count is now "everybody" and always will be — a
permanent false alarm. It asks the arithmetic question instead: chips only
enter by purchase and wagering only moves them between gamers, so every
gamer's net must sum to **exactly zero** room-wide. A non-zero total means
settlement invented or destroyed chips, which is the one bug in this subsystem
worth being woken up for. A second step prints what everyone holds.

Both queries are extracted from the workflow file and run against a seeded
SQLite database before dispatch, covering the voided-game exclusion and the
omission of gamers with no activity. Production D1 is not reachable from a
development session, so a query that fails to parse costs a full round-trip to
discover.

### Wager page (#23)

The history is long and mostly retrospective, so it collapses behind a
`Show N games with bets` toggle; the chip balances above it are what people
open the page for. The gamer filter now always offers **Everyone** — it used
to be gated behind the settings unlock, which stopped nobody, since the
endpoint returns the whole room's ledger to any session that can reach it.
See [§27 Visibility is not access control](#visibility-is-not-access-control).

### Tailwind, shadcn and Motion (#22)

The client gained a real design system: Tailwind v4 via `@tailwindcss/vite`,
shadcn/ui **vendored as source** under `src/components/ui/` (it is not a
package — the components are meant to be edited), Radix primitives underneath,
and Motion 13 for the small amount of animation that earns its place.

Design tokens live in `src/index.css` as CSS custom properties with an
`@theme inline` mapping, so the palette has one home rather than being spread
through inline styles. Touch targets are sized for phones — `size-11` icon
buttons, `py-3` tabs — and a global `prefers-reduced-motion` block turns the
motion off rather than branching the markup.

**The per-page header is gone.** Room controls, the version block and the
Active Room description occupied roughly 470px above every screen. `RoomBar`
replaces them with a 47px sticky bar — a live dot, the room name, a status
badge — and `RoomDetailSheet` holds everything that was displaced: room ID,
gamers, session expiry, Refresh / Install / Settings / Leave, and the three
build versions. Nothing was removed, only folded.

### Offline support (#27, #29)

A service worker, contributed in #27 and finished in #29. See
[§28](#28-offline--the-service-worker).

### Bugs found, and how

- **A test that passed for no reason.** #27's banner-precedence test asserted
  that the version-floor banner wins over the service-worker update banner.
  Registration is once-only by design — `main.tsx` registers at boot and a
  second call would leak a duplicate workbox listener under StrictMode — and
  the store is a module-level singleton, so the first test to register won and
  every later test held a callback that did nothing. The precedence test never
  signalled a waiting worker, so its "no reload button" assertion held
  trivially. Caught by removing the precedence from `App.tsx` so both banners
  render and watching all 21 tests pass anyway. One registration now serves
  the file. **Sabotage the behaviour and re-run — a test that cannot fail is
  not evidence.**
- **A stale version bump.** #27 was branched before `0.1.19` landed, so its
  `0.1.18 → 0.1.19` bump became a no-op against the new base and CI correctly
  refused a 17-file client change carrying no version.

### Tests

496 passing: 219 shared, 155 worker, 122 web. Both migrations 0012 and 0013
were verified against a seeded SQLite database before deploy — grants removed,
manual purchases and settlement history intact, match records byte-for-byte
unchanged, `schema_migrations` stamped.

---

## Recent Changes (2026-08-15)

A full day on wagering, shipped as PRs #14–#20 off
`claude/fix-gamer-activation-k7qtZ`. Versions at the end of the day:
`@fc26/web` → `0.1.11`, `@fc26/worker` → `0.1.10`, `@fc26/shared` → `0.1.7`,
`WORKER_VERSION` → `0.1.10`, `SCHEMA_VERSION` → `10` (migrations 0007–0010).
`EVENT_SCHEMA_VERSION` is still `1`; the new event type was additive.

See [§27 Wagering & the Chip Ledger](#27-wagering--the-chip-ledger) for how
the finished subsystem works. This section is the narrative of how it got
there, including the two bugs found in production.

### Chips became a room ledger (#17)

The largest change of the day, and it replaced the model rather than
extending it. Balances used to be per game night: a stack was that night's
buy-in plus whatever that night's games had paid, and everything reset next
time anyone played.

Chips are now **bought into the room** and stay there. A new `chips_purchased`
event is the only way tokens enter circulation; a gamer's balance is what they
have bought plus everything won or lost across every night, minus anything
riding on an unresolved game. Nothing is stored — the ledger is folded from
the event log and the live bet rows on read, so no balance column can drift
away from the history that produced it.

Because chips only enter by purchase and wagering only moves them between
gamers, every gamer's profit is exactly what they hold beyond what they paid
for, and those profits sum to zero. That makes **settle-up** possible:
greedily matching the largest debt against the largest credit closes the room
out in at most one payment fewer than there are people, the same
simplification a shared-expenses app does.

Migration 0008 backfilled a purchase per (night, gamer) pair for existing
rooms. Without it every room would have folded to nothing but its lifetime
net, and anyone who had lost would have been unable to bet at all.

### Buy-ins and available balance (#15)

Before this, any number under the stake cap was a legal bet, so "chips
tonight" measured nothing. Migration 0007 added `game_nights.buy_in`; the
worker refuses a stake a gamer cannot cover, with a `400 insufficient_chips`
carrying `{ stake, purchased, balance, committed, available }` so the client
can explain the refusal without a second request.

The client computes the same numbers to show them, but the **worker enforces**
— a stale bootstrap, or a second phone betting for the same person, would
otherwise let the pot exceed what the room actually bought.

*(Superseded 2026-08-21: both checks are gone and `insufficient_chips` is no
longer returned. Letting the pot exceed what the room bought turned out to be
harmless — the losers of a pot cover it, not the bank. See
[§27 Betting on credit](#betting-on-credit).)*

### Top-up (#14)

Backing the same outcome again adds to the position rather than replacing it.
"Another 20 on Home" means 20 more, not a silent reset to 20. The running
total is capped against `MAX_STAKE`, not just the increment, or repeated
top-ups would walk past the bound that keeps `stake × pot` inside
exact-integer range in `settleWagers`.

### Hedging (#20)

A gamer may now hold a position on each outcome. Migration 0010 moved
uniqueness from `(game, gamer)` to `(game, gamer, outcome)`, so same-outcome
bets still merge into a top-up while each outcome carries its own stake.

**Settlement had to be rekeyed in the same change.** `settleWagers` looked
payouts up by `gamerId`, which is a bijection only while a gamer holds one
bet. A hedger appears on both a winning and a losing row, and paying by gamer
would have credited the winning amount against every row they hold — creating
chips. Payouts are now keyed by a bet's index in the book.

A hedge is new money: only the position being topped up has its stake added
back when checking what is available. Covering both sides costs both stakes.
Moving a position is now remove-then-place. Participants still cannot
hedge — eligibility already limits them to their own side.

### Two bugs found in production, not by tests

- **Late joiners got no chips (#18).** The active-gamers route replaced pool
  membership without issuing a buy-in, so anyone added mid-night held zero
  and could not bet. Found by comparing production counts after #17 deployed:
  306 backfilled purchases against 314 (night, pool gamer) pairs. The route
  now issues the purchase, guarded on the event log rather than on "was not in
  the pool a moment ago" — a gamer can be dropped and re-added, and that must
  not mint a second stack. Migration 0009 closed the gap in existing data.
- **A latent hang in `settleUp`.** An `if (amount > 0)` guard around the
  transfer meant neither index advanced when it was false, spinning forever.
  `amount` is positive by construction, so the guard protected nothing while
  hiding the termination argument. Surfaced by sabotage-testing that branch,
  which hung the test run rather than failing it.

### Tooling and cleanup

- **Chip ledger health check (#19).** `.github/workflows/ledger-check.yml`,
  manual dispatch with no inputs, counts pool members with no buy-in against
  production D1. Read-only, and it cannot become a console for arbitrary SQL.
  Exists because the agent environment cannot reach `api.cloudflare.com`, so a
  runner is the only place the question can be answered on demand.
- **Dead branch removed (#16).** `StartGameNightPanel` carried a
  "game night live" branch that `RoomScreen` could never render, since it
  swaps in `GameCreationPanel` the moment a night exists.

### Tests

Worker **153** across 17 files, shared **215** across 17, web **77** across 12.
New coverage for top-ups, buy-in ceilings, room-wide balances carrying across
nights, purchases mid-night, late-joiner buy-ins, idempotence when a gamer is
removed and re-added, settle-up transfers, and hedged settlement on both
sides.

Every behavioural change was verified non-vacuous by disabling the mechanism
and confirming the intended tests — and only those — failed. Migrations and
the D1 code paths were additionally exercised against a real `wrangler dev`
database, because the unit suite only touches the in-memory repositories.

---

## Recent Changes (2026-05-29 → 2026-05-31)

Shipped together as part of the `claude/fix-gamer-activation-k7qtZ` line.
Versions: `@fc26/web` → `0.1.2`, `@fc26/worker` → `0.1.1`, `@fc26/shared` →
`0.1.1`, `WORKER_VERSION` env → `0.1.1`. Event payload schema unchanged
(`EVENT_SCHEMA_VERSION = 1`); D1 schema unchanged (`SCHEMA_VERSION = 5`).

### Scoreboard
- **Drill-down on every row.** Tap a gamer or gamer-team row on the
  Scoreboard to expand a list of that side's recent matches (up to 20).
  Backend route `GET /rooms/:roomId/match-history?gamerId|teamKey=…`,
  `MatchHistoryList` component on the frontend.
- **All-games tab.** Third tab on Scoreboard next to Gamers / Gamer
  teams that lists every recorded match in the room (also capped at 20).
  Same endpoint with `?scope=all`.
- **Match-card display fixes.** Score column no longer renders `vs` for
  recorded games without an exact score — shows `Score not recorded`
  instead. Draw scores (2 – 2 etc.) render correctly. Winner names are
  green, losers red, draws dark slate.
- **No more `Club #0`.** Games started without a selected FC team
  (`clubId` = 0 sentinel) used to render `Club #0`. They now show the
  recognised club name from the photo (see OCR section below) or render
  no club row at all when nothing was recognised.
- **Admin delete.** New `POST /rooms/:roomId/game-nights/:gameNightId/
  games/:gameId/void` route writes a `game_voided` event, reverses the
  gamer + gamer-team projections (clamped to 0; `last_event_id` /
  `updated_at` stamped with the void), and 409s on repeat. The
  `buildMatchHistory` query filters out voided games. UI: per-match
  Delete button rendered only when `settingsUnlocked` is true.

### Gamer profiles
- **Avatar editing in Roster.** Existing `PATCH /rooms/:roomId/gamers/
  :gamerId` already accepted `avatarUrl`; the Roster edit form now
  exposes an `AvatarPicker` so admins (or PIN holders) can change a
  gamer's picture in addition to name / rating / PIN.
- **Add-gamer button inside Roster.** The Add Gamer panel is collapsed
  by default behind a `+ Add gamer` toggle at the top of the Roster
  panel, and auto-collapses after a successful create. Used to be a
  separate always-visible panel.

### Active game UI
- **Auto-scroll on room entry.** If `bootstrap.activeGameNight` is
  present, RoomScreen jumps to `fc26-game-live-section` on mount so the
  gamer lands on the action. Guarded against jsdom's missing
  `scrollIntoView`.
- **Side-by-side Home / Away on phones.** The team columns inside
  `CurrentGameCard` now force a 2-column grid and switch the inner
  `EaTeamCard` to the `compact` size so both sides fit a vertical iPhone.
- **TV photo: auto-analyse + progress bar.** Picking a TV photo kicks
  off Gemini analysis immediately — no separate "Analyse" button. A
  green progress bar asymptotes toward 90 % while we wait, then jumps to
  100 % when the response arrives.
- **Single "Accept score" button.** When both home and away scores are
  filled, the three Home/Draw/Away buttons collapse into a single
  `Accept score` button with the derived result shown as a caption. The
  three-button winner-only mode stays for blank scores.
- **Android camera capture.** TV-photo `<input type="file">` now carries
  `capture="environment"` so Android Chrome / WebView opens the rear
  camera directly instead of the gallery.

### Recognised club names (OCR)
- **Persist recognised names on every recorded game.** `GameSide` gained
  an optional `clubName` field on the event payload; the record route
  accepts `homeClubName` / `awayClubName` from the OCR accept flow and
  writes them onto the recorded event. `buildMatchHistory` falls back to
  the recognised name when the squad map can't resolve `clubId`.
- **Override the selected club on mismatch.** Record route also accepts
  optional `homeClubId` / `awayClubId` overrides (positive int / `null`
  / omitted). When the OCR-recognised name disagrees with the club
  picked before the game (full / short / EA-alias aware, case-insensitive,
  generous substring match), the frontend sends `clubId: null` so the
  recognised name becomes the only label on the recorded event.

### Bottom nav + Teams / Changes
- **Changes slot → Roster.** Bottom-nav mode swap: the fourth tab is now
  `Roster` and anchors `fc26-roster-section`. The Changes view was
  folded into the Teams panel as a `Browse teams / Squad changes` tab
  toggle; `ChangesPanel` is now content-only (no `<section>` /
  `<Panel>` wrapper).

### Periodic squad version reminder
- `App.tsx` polls `GET /api/version` every 5 minutes while a room is
  open and `settingsUnlocked === true`. RoomScreen shows a yellow
  banner when the returned `latestSquadVersion` differs from the
  device-acked one stored in `localStorage` under
  `fc26:last-acked-squad-version`. First-ever load acks silently;
  Dismiss writes the current version to localStorage.

### Tests
- Worker: now **83 tests** across 9 files. New coverage for match-history
  drill-down (per-gamer, per-team, all-scope, reject-no-scope),
  recognised-name fallback, club-id mismatch override, gamer avatar
  PATCH, void-game projection rollback + 409 on repeat.
- Web: now **38 tests** across 7 files. New coverage for the All-games
  tab, drill-down row click, gamer avatar edit form, `MatchHistoryList`
  recognised-name / `Score not recorded` / outcome colours / delete
  button visibility and click-removes-row, and the BottomNav rewiring.

---

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
27. [Wagering & the Chip Ledger](#27-wagering--the-chip-ledger)
28. [Offline & the Service Worker](#28-offline--the-service-worker)
29. [End-to-End Tests](#29-end-to-end-tests)

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
| `game_events` | **Append-only write model.** Every game and chip fact lives here. |
| `game_nights` | One evening of play. Carries the night's `buy_in`. |
| `game_night_active_gamers` | Who is in tonight's pool. Editable mid-night. |
| `games` | The single live game of a night, including `bets_locked_at`. |
| `bets` | **Unsettled** wagers only. Deleted at settlement — see §27. |
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
- **`bets` is unique on `(game_id, gamer_id, outcome)`.** One position per outcome, so a repeat bet on the same outcome merges into a top-up while a different outcome opens a hedge. It was `(game_id, gamer_id)` until migration 0010; anything keying settlement by gamer rather than by row depends on the *old* shape and is now wrong.
- **`gamers` is unique on `(room_id, name_key)`.** A name only has to be free inside its own room. It was unique on `name_key` alone until migration 0014, which meant two rooms could not both have an Ann. `rooms.name_key` stays globally unique — a room is joined by typing its name — and the two share one stem namespace in both directions, so a room may not take a gamer's name or a gamer a room's.
- **`event_type` has no CHECK constraint** and every consumer filters on `payload.type`, which is why new event types have needed no migration.

---

## 9. Event Sourcing & Read Models

### Why

The user requirement: *"Game results should be kept in append-only log with references to gamer-teams, fc-teams, individual gamers, (score, winner-draw). We may need to have 2 read-models for gamers and gamer teams points."*

This is CQRS-lite. The write model is a log of facts; the read models are derived counters that can always be rebuilt from the log.

### Event Types

```ts
// packages/shared/src/types/events.ts

export type EventType =
  | 'game_recorded'
  | 'game_interrupted'
  | 'game_voided'
  | 'bet_placed'       // ─┐
  | 'bet_removed'      //  │ the live `bets` table is transient, so these
  | 'bets_locked'      //  │ are the only durable record of a wager's life
  | 'bets_discarded'   // ─┘
  | 'chips_purchased'  // the only way chips enter a room — see §27

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

Wagering, added later and documented in full in [§27](#27-wagering--the-chip-ledger).
`NIGHT` below stands for `/api/rooms/:id/game-nights/:nid`:

| Endpoint | Description |
|---|---|
| `POST NIGHT/games/:gid/bets` | Place or top up a position. Never refused for want of chips — see [§27 Betting on credit](#betting-on-credit) |
| `DELETE NIGHT/games/:gid/bets/:betId` | Remove a position. Removing then placing is how a position moves |
| `POST NIGHT/games/:gid/bets/lock` | Close the book. Idempotent |
| `GET NIGHT/chips` | Tonight's swing per gamer, plus the last settled game's deltas |
| `GET /api/rooms/:id/chips-ledger` | Room balances (folded, never stored) and who pays whom |
| `POST /api/rooms/:id/chips/purchases` | Buy chips, at any time. Optional — a room that never buys still keeps a ledger |
| `POST /api/rooms/:id/chips/settlements` | Settle the whole room. No body: the amounts are whatever the ledger says |
| `POST /api/rooms/:id/chips/settlements/payment` | Record one payment `{ from, to, amount }`, part payments included |
| `GET /api/rooms/:id/bet-history` | Every game's book, plus the purchases and settlements |

All room-scoped endpoints require a valid session cookie if the room has a PIN.

---

## 12. Frontend Feature Map

There is no router library. `useHashRoute` reads a hash route (`#/wager`) and
`RoomScreen` renders one page per route — the bottom nav is real navigation,
not a set of scroll anchors. Everything below lives under `apps/web/src/`.

### Pages

| Route | Renders | Notes |
|---|---|---|
| `game` | `features/gameNight/GameCreationPanel` when a night is live, else `StartGameNightPanel` | The night's buy-in is asked for here and defaults to 0 |
| `scoreboard` | `features/scoreboard/ScoreboardPanel` | Tabs over standings, gamers and gamer-team pairs; `MatchHistoryList` below |
| `wager` | `features/wager/ChipLedgerPanel`, `features/gameNight/ChipStandingsPanel`, `features/wager/WagerPage` | Room balances and settle-up, tonight's swing, then the collapsed bet history |
| `roster` | `features/gamers/RosterPanel` | CRUD and active toggle; add/edit open in Sheets |
| `teams` | `features/squads/TeamsPanel` | Reached by the centre FC26 logo, not a nav label |
| `settings` | `features/room/SettingsPanel` | Reached from the room sheet, not the nav |

Before a room is joined, `App` renders `features/landing/LandingScreen`
(`CreateRoomPanel` + `JoinRoomPanel`) instead.

### Feature modules

| Module | Components |
|---|---|
| `features/room/` | `RoomScreen` (page switch), `RoomBar` (47px sticky header), `RoomDetailSheet` (room ID, gamers, session expiry, Refresh/Install/Settings/Leave, build versions), `SettingsPanel` |
| `features/gameNight/` | `GameCreationPanel`, `StartGameNightPanel`, `CurrentGameCard` (result entry — three buttons or a numeric pad), `TeamColumn`, `InlineTeamPicker`, `BetsPanel` (place/remove/hedge), `ChipStandingsPanel`, `TvPhotoCapture` → `PhotoResultPreview` (OCR path) |
| `features/wager/` | `ChipLedgerPanel` (balances, settle-up, buy chips), `WagerPage` (bet history, collapsed by default) |
| `features/gamers/` | `RosterPanel`, `AddGamerPanel` |
| `features/scoreboard/` | `ScoreboardPanel`, `MatchHistoryList` |
| `features/squads/` | `TeamsPanel`, `ChangesPanel` (version diff, rendered as a tab inside Teams), `HistoricalRatingsChart`, `useSquadBrowser` |
| `features/landing/` | `LandingScreen`, `CreateRoomPanel`, `JoinRoomPanel` |
| `debug/` | `DebugConsole` (triple-tap target), `console-store` |

### Shared components

| Component | Purpose |
|---|---|
| `components/ui/*` | **Vendored shadcn/ui** — `button`, `card`, `badge`, `sheet`, `tabs`. Source, not a dependency; edit in place |
| `Panel`, `Field`, `InlineNotice`, `MiniStat` | The pre-shadcn primitives, still used widely |
| `BottomNav` | Game / Scoreboard / **FC26** / Wager / Roster; the centre logo routes to `teams` and is the Console trigger |
| `UpdateBanner`, `SwUpdateBanner`, `OfflineNotice`, `StatusCard` | The strips above the app. See [§28 Precedence](#precedence) for which banner wins |
| `EntityIdentity` (`FcPlayerAvatar`, `FcPlayerIdentity`), `GamerPanel`, `GamerTeamPanel`, `FcClubPanel`, `entity-shared` | Avatar and identity rendering for the four entity kinds |
| `EaTeamCard`, `EmptyTeamCard`, `EaPremierLeagueLivePanel`, `LeaguePills` | Club cards and league filtering |
| `AvatarPicker` | Gamer avatar selection, used by both roster panels |

### Hooks, lib and utils

| Path | Contents |
|---|---|
| `hooks/` | `useHashRoute`, `useInstallPrompt`, `useOnlineStatus`, `useSwUpdate`, `useLinkedPair` |
| `lib/` | `api` (fetch + correlation-ID middleware), `logger`, `version`, `swUpdate` + `swCacheRules` (see [§28](#28-offline--the-service-worker)), `avatars`, `image`, `utils` (the shadcn `cn` helper) |
| `utils/` | `roster`, `scoreboard`, `squads` — pure derivations kept out of components |
| `index.css` | Tailwind v4 entry plus the design tokens as CSS custom properties with an `@theme inline` mapping |

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
- **End-to-end tests** for wiring the mocked suites cannot see — see [§29](#29-end-to-end-tests). They are the slow tier and deliberately thin: seed over the API, click only the feature under test.
- **Sabotage every new guarantee.** Break the behaviour, confirm a test fails, restore it. A test that cannot fail is not evidence, and this project has shipped several: a service-worker precedence test that never signalled an update, a remainder tie-break whose case had no tie in it, a settlement rule already covered by a check on the other side. All three looked fine in review and passed forever.

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
| **Chips** | A tally of who is up and who is down, not a bankroll — a bet is never refused for want of chips, and buying in is optional | Wagering only moves chips, so a pot is covered by its own losers; what the room wants at the end of the night is who pays whom, not a refusal at the table |
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
6. **Bottom nav structure** — which primary mode tabs? Proposed: Game / Dashboard / Teams / Changes, with the logo as a fifth centered element that's also the Console trigger. *(Shipped since as Game / Scoreboard / FC26 / Wager / Roster.)*

### Open as of 2026-08-19

7. ~~The room holds no chips, so no bet can be placed.~~ **Moot** — betting no
   longer needs a balance (2026-08-21). Migration 0013's reset stands and
   nobody has bought anything, which is fine: a room that never buys a chip
   still records who went up and who went down. See
   [§27 Betting on credit](#betting-on-credit).
8. ~~Offline is unverified on a real device.~~ **Not being pursued** — the app
   is played at home on a stable connection, so offline is not a requirement
   (owner's call, 2026-08-21). Installing to the Home Screen is confirmed on
   iPhone: it launches standalone with no browser chrome (2026-08-20), which
   is what the service worker was actually wanted for. The precache still
   exists and does no harm; nobody has checked what a launch in airplane mode
   renders, and nobody needs to.
9. ~~The sticky `RoomBar` on iOS Safari.~~ **Confirmed** — renders correctly
   both in Safari and in the installed app, on iPhone (2026-08-20).
10. **The GitHub Pages actions are still on older majors** —
    `actions/configure-pages@v5`, `actions/upload-pages-artifact@v3`,
    `actions/deploy-pages@v4`. They were not named in the Node 20 deprecation
    warning, so they are not urgent, but they are the remaining stale pins in
    `deploy.yml`. The three that *were* named — checkout, setup-node and
    pnpm/action-setup — now run on `node24`.

### Open as of 2026-08-20

11. **Nothing has been played for real since the reset.** Every part of
    wagering is covered by tests and none of it by a game night. Nothing blocks
    it any more — item 7 is moot, and a night can now open a book with an empty
    room.
12. ~~The health check reimplements the ledger fold in SQL.~~ **Done** — it
    folds with `roomChipLedger` via `scripts/ledger-report.ts`, reports per
    room, and exits non-zero when a ledger does not add up. See
    [§27 Operational note](#operational-note).
13. ~~A part payment cannot be made from the UI.~~ **Done** — each debt now
    carries an editable amount, pre-filled with the whole thing, so the common
    case is still one tap and paying part of it is a number away.
14. ~~The wager viewer's seeding guard is unverified.~~ **Pinned** — a unit
    test in `App.test.tsx` selects Everyone and asserts the value sticks.
    Reverting the guard fails it with `expected 'g1' to be ''`, so the change
    was a real fix and "Everyone" had never been selectable. The end-to-end
    suite could not tell: it asserted on the history list, and whichever gamer
    the seeding snapped back to had rows of their own.

### Open as of 2026-08-21

15. **Nobody has been told the rules changed.** A gamer who remembers being
    refused for want of chips has no reason to try again, and the panel says
    "bet on credit and settle up after" only where somebody buys chips. Worth a
    sentence at the table rather than a code change.

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
| `motion` (v13) | web — the small amount of animation that earns its place |
| `@radix-ui/*` | web — unstyled primitives under the vendored shadcn components |
| `class-variance-authority`, `clsx`, `tailwind-merge` | web — shadcn's variant and class plumbing |
| `tw-animate-css` | web — the animation utilities shadcn's components expect |
| `vite-plugin-pwa` | web — precache manifest and service worker generation |
| `workbox-window` | web — the client half of the update handshake |
| `@playwright/test` | root — browser tests against the real stack (see [§29](#29-end-to-end-tests)) |

shadcn/ui is **not** in this table on purpose: it is not a dependency. Its
components are vendored as source under `apps/web/src/components/ui/` and are
meant to be edited in place.

---

## 27. Wagering & the Chip Ledger

Gamers bet chips on the live game. The pool is **pari-mutuel**: every stake
forms one pot, and backers of the actual result split it in proportion to
their stake. There is no house and no fixed odds — the multiplier shown in the
UI is just `pot / stake-backing-this-outcome`, and it moves as bets come in.

### The ledger is derived, never stored

```
bought    = Σ chips_purchased where reason = 'manual'      (somebody chose to)
granted   = Σ chips_purchased where reason = 'game_night_buy_in'
purchased = bought + granted                (the only way chips enter)
wagered   = Σ (payout − stake) over every settled, non-voided game
settled   = Σ chips_settled amounts         (signed; debts paid in cash)
net       = wagered − settled               (what is still owed or owing)
committed = stakes riding on games that have not resolved
balance   = purchased + net
available = balance − committed
```

`balance` and `available` may both be **negative**, and that is an ordinary
state rather than an error: nothing refuses a bet for want of chips. A negative
balance is a debt.


`bought` and `granted` are kept apart because a balance made of grants is not
the same claim as one somebody paid for. `hasChipActivity(entry)` — `bought >
0 || net !== 0 || committed > 0` — is what the Wager page lists on. Buying
counts as taking part even before the first bet; being handed a stack does
not. As of migration 0012 no `granted` rows survive in production, but the
distinction stays: it is the difference between money and a gift.

`roomChipLedger(events, openBets)` in `packages/shared/src/wager/ledger.ts`
folds this out of the event log on every read. There is deliberately **no
balance column**: one could drift away from the history that produced it, and
reconciling the two would become someone's job. It also means voiding a game
corrects every balance for free — the wagers simply stop being folded in,
with no wager-specific rollback anywhere.

Balances are **room-scoped**, so they carry from one night to the next.

### Where chips come from

`chips_purchased` is the only source, and in practice there is now only one
way it is written: **`POST /rooms/:roomId/chips/purchases`**, at any time.
Running dry mid-evening is exactly when someone buys in again, and making them
wait for the next night would be the wrong shape.

**A game night grants nothing by default** (`DEFAULT_NIGHT_BUY_IN = 0`).
Balances are room-wide and carry between nights, so a nightly grant mints
chips for everyone in the pool whether they wager or not, and the balance
stops meaning anything. A night may still name a `buy_in` explicitly — the
start form takes it, and both issue paths are guarded on `buyIn > 0` — in
which case starting the night issues one to each gamer in the pool, and adding
a gamer to a live pool issues one too, guarded on the event log so removing
and re-adding cannot mint a second stack.

This is the whole reason a balance means something: **what this person put in,
plus what they won.** Nothing else can move it.

Buying in is **optional**. A room that never buys a chip still works: everybody
starts at zero and the ledger records who went up and who went down. Buying
matters only in that a stack absorbs losses — the debt is the same either way.

### Betting on credit

**Nothing refuses a bet for want of chips.** This is a room of people who know
each other, and what they want at the end of the night is who pays whom, not a
refusal at the table.

The invariant that makes it safe was already true: wagering only *moves* chips
between gamers, so a pot is covered by the losers of that same pot however
little anybody bought. Nets sum to zero whatever the balances are.

`MAX_STAKE` is the only ceiling left, and it is about integer precision rather
than credit. There is deliberately no credit limit and no warning threshold: a
limit that nobody agreed on would refuse a real bet at a real table, which is
the failure this removed.

### The two transient tables

`bets` holds **only unsettled** rows. Settlement writes the outcome into the
`game_recorded` payload and deletes them; that payload is the durable record.
This is why:

- `listByGameNight` is the whole of a night's open exposure — every surviving
  row is still at risk.
- The bet **event log** (`bet_placed` / `bet_removed` / `bets_locked` /
  `bets_discarded`) exists at all. Without it the only trace of a wager would
  be the settled array, losing placement times, replaced stakes, removals, and
  any game whose book was discarded rather than settled.

### Settlement

`settleWagers` in `packages/shared/src/wager/settle.ts`. Flooring each share
leaves at most `winnerCount − 1` chips over; those go to the largest
fractional remainders, ties broken by larger stake then lower gamer ID, so the
result is deterministic and testable. When nobody backed the result the pool
cannot be divided and every stake is refunded.

**Payouts are keyed by a bet's index in the book, not by gamer.** A hedger
appears on both a winning and a losing row; keying by gamer pays the winning
amount against every row they hold and invents chips. This is the single
easiest way to reintroduce a serious bug in this subsystem.

`MAX_STAKE` (1,000,000) keeps `stake × pot` well below 2^53, where JS number
arithmetic would start losing integer precision and the pot would stop
balancing to the chip. Top-ups are capped on the **running total**, not the
increment.

### Positions, top-ups and hedges

One position per `(game, gamer, outcome)`:

| Action | Result |
|---|---|
| Same outcome again | Merges — stake adds, `id` and `created_at` preserved |
| Different outcome | A second position. This is a hedge |
| Moving a position | Remove, then place — which is what it honestly costs |

Covering both sides costs both stakes — the first is committed, not freed — and
that is now a fact about exposure rather than a limit on what may be placed.

Participants may only back their own side (`canBack`), so a player cannot take
money against themselves and cannot hedge. Non-participants may back anything.

### Settling up

`settleUp(entries)` returns who pays whom. Chips only enter by purchase and
wagering only moves them, so the nets sum to zero and every winner can be paid
out of the losers. Greedy largest-debt-against-largest-credit closes the room
in at most *n − 1* transfers rather than having each loser pay each winner.

Open stakes are excluded — an unresolved bet is neither won nor lost, and
settling mid-game would be a guess.

Two routes record that it happened, because debts are rarely cleared in one
round — somebody pays on Tuesday, somebody else forgets until next month,
somebody pays half now.

- **`POST /chips/settlements`** settles the whole room. No body: the amounts
  are whatever the ledger says at that moment, so the button cannot disagree
  with the figures printed above it.
- **`POST /chips/settlements/payment`** records one payment (`from`, `to`,
  `amount`) and leaves everyone else's position untouched. Part payments are
  accepted; paying more than is owed, paying somebody who is not owed, or
  paying between two people who are both owed is rejected as `no_such_debt`,
  since each would invent a position the games never created.

  Each row in the panel carries the amount as an editable field, pre-filled
  with the whole debt: settling outright stays one tap, and paying part of it
  is a number away. The field is keyed by the pair and cleared once the
  payment lands, so paying 15 of 40 leaves 25 showing rather than the 15 that
  was typed. Over-payment is refused before the request, because a refusal
  arriving after a round trip reads as a fault rather than a correction.

Both write one `chips_settled` event per affected gamer, sharing a settlement
id, with amounts that cancel — which is what keeps every net summing to zero
however many payments are recorded.

They are separate routes rather than one with an optional body because
`parseJson` cannot tell a missing body from a malformed one: a single route
keyed on "did a body arrive" would settle the entire room the day a client sent
broken JSON.

**Settling clears the debt, not the account.** Chips are not returned: the
money changed hands in cash, so everyone keeps the stack they bought and the
next night starts from there. That distinction is why the entry carries both
`wagered` and `settled`. Lifetime profit is a statistic and survives; an
unsettled debt is a thing you owe somebody on Friday, and that is what `net`
means and what the panel shows.

Before this existed there was no way to say the payments had been made — the
ledger kept folding the same lifetime result forever, so a room that squared up
last week still showed last week's debts. Zeroing a room took a hand-written
migration, which is how the gap was noticed.

### The money history

`chips_purchased` and `chips_settled` are folded into `MoneyEntry` values by
`moneyHistory(events)` and ride on the bet-history response — the Wager page
wants both halves at once, and a second round trip for one screen buys nothing.

Purchases read as purchases, and a night's automatic buy-in is worded
differently from a stack somebody chose to buy, because they are not the same
claim. Only history predating migration 0012 has the former.

**Settlements group by `settlementId`.** A two-party payment is then the
sentence it is — "Cyd paid Ann 40" — and a round with more than one payer is
reported as the round it was:

```
Settled up — Ann +50, Bob −20, Cyd −30
```

That asymmetry is deliberate. The events record each gamer's **net change**,
not who handed cash to whom, so writing a three-way round as pairings would be
inventing facts the room never recorded. There is a test asserting the
multi-party case does not say "paid".

The page fetches this once on mount, so the room bumps a token whenever chips
move (`historyToken` → `reloadToken`). Without it, settling a debt left the
payment absent from the list that exists to record it — which is precisely the
bug the end-to-end suite caught on its first run.

### Visibility is not access control

`GET /rooms/:roomId/bet-history` returns the whole room's ledger to anyone
holding the room session. The session carries **no per-gamer identity**, so
the server cannot tell members apart and filtering there would be security
theatre. `filterBetHistory` narrows the view client-side; treat it as a
convenience, not a permission. Making it real would need per-gamer sessions.

### Operational note

`.github/workflows/ledger-check.yml` (manual dispatch, read-only, no inputs)
dumps the chip events from production D1 and pipes them into
`scripts/ledger-report.ts`, which folds them with **`roomChipLedger` — the same
function the app uses**.

That sharing is the point. The check used to reimplement the fold in SQL and
drifted twice in a single day: once when game nights stopped granting chips,
once when settlement landed. Each time it reported something untrue about
production while looking perfectly healthy, because nothing made a second copy
fail when the first one moved.

It **fails** rather than only printing. Four things make it exit non-zero:

- lifetime wagering that does not cancel — settlement invented or destroyed chips
- settlements that do not cancel — a round credited somebody without debiting anyone
- any granted chips, which no night has issued since migration 0012
- a ledger row naming a gamer the roster does not have

Reported per room, because that is what a ledger is. Folding every room into
one total keeps the arithmetic honest but makes settle-up nonsense — it would
tell somebody to pay a stranger. The old SQL had that flaw too and nobody
noticed, because production has one room.

`scripts/` is typechecked by `tsconfig.scripts.json`, wired into CI. It is not
part of any workspace package, so `pnpm -r typecheck` missed it — and a script
that imports the ledger, left unchecked, would have relocated the drift rather
than removed it. Adding it immediately found two faults in the script.

Production D1 is not reachable from a development session, so this workflow is
the only read path. The fold is unit-tested against fixtures
(`packages/shared/src/wager/report.test.ts`), including each failure it reports.

---

## 28. Offline & the Service Worker

The installed PWA had a manifest and an install prompt but no service worker,
so opening it without network was a white screen and every load re-downloaded
the bundle. `vite-plugin-pwa` now precaches the app shell.

### What is cached, and what must never be

| Request | Handler | Why |
|---|---|---|
| App shell (js, css, html, svg, png, ico, woff2, manifest) | Precache | The thing that makes offline a screen rather than a white page |
| `/api/squads/<version>/{clubs,leagues,players,diff}` | `StaleWhileRevalidate` | Immutable by construction — an ingest publishes a new tag rather than rewriting an old one |
| Everything else under `/api/` | `NetworkOnly` | A cached scoreboard or bet list is a **wrong** answer, not an old one |

`/api/squads/versions`, `/latest` and `/logos` are excluded from the squad
rule by a negative lookahead: the first two are mutable aliases that must
reflect the newest ingest, and logos carry no version in the path.

Those patterns live in `apps/web/src/lib/swCacheRules.ts` **with tests**,
rather than inline in `vite.config.ts`. Getting one wrong is invisible at
build time and surfaces as a gamer looking at a room that quietly disagrees
with itself.

Sourcemaps are deliberately absent from the precache glob — large, and only
ever wanted by a devtools session that has network.

### Scope

The worker registers at scope `/football/`, which is where
`workers/football-app` serves the client (the prefix is kept so bookmarks and
home-screen shortcuts from the old GitHub Pages URL still map 1:1). Scope
limits which **pages** a worker controls, not which requests it may intercept
— so a page at `/football/` still routes its `/api/*` fetches through the
worker, which is what makes the rules above apply at all.

`navigateFallback` points at the precached shell so an offline navigation
renders something; `navigateFallbackDenylist: [/^\/api\//]` stops that
fallback swallowing API requests, which must fail honestly rather than resolve
to a page of HTML.

### Updates are offered, never forced

`registerType: 'prompt'`. A new build downloads in the background and then
**waits** — it never takes over the page on its own. A game night is a
long-lived tab, and swapping the bundle under someone mid-bet is worse than
running a build a few minutes old. The waiting worker raises a banner with
`Reload to update`; `Later` leaves it waiting until the next launch.

`swUpdateStore` (`src/lib/swUpdate.ts`) is a plain observable rather than a
hook, so registration happens once at boot in `main.tsx` while React
subscribes separately. `register()` ignores repeat calls — StrictMode
double-invokes effects and a second registration leaks a workbox listener.

**That once-only guard has a testing consequence.** The store is a
module-level singleton, so a per-test `register()` is silently ignored and
that test ends up holding a callback that does nothing. `App.test.tsx`
registers once for the whole file via `beforeAll` and shares the handle. A
test that registers its own will pass whatever the app does.

### Precedence

When both the `minClientVersion` floor and a waiting service worker apply, the
**version floor wins**: being under the floor is the more serious of the two,
and two stacked banners would eat the top of a phone screen. The service
worker banner is optional; the floor is not.

### Manifest ownership

`manifest: false`. `public/manifest.json` stays the single source of the
installed identity — name, icons, theme colour. Generating a second manifest
would risk silently re-identifying already-installed apps.

### Testing it

The service worker only runs in a production build, so `vite preview` is
required — `.claude/launch.json` carries a `web-preview` entry for this. The
dev server will not exercise any of the above.

---

## 29. End-to-End Tests

The unit suites mock at every boundary: worker routes run against in-memory
repositories, components against stubbed callbacks. Both are fast and neither
can see the **wiring** between them — a button calling the wrong endpoint, a
response the client never applies, a cookie that does not round trip. That is
what these cover.

`playwright.config.ts`, specs in `e2e/`. Locally `pnpm test:e2e`; in CI a job
that gates both deploys. `e2e/**` and `playwright.config.ts` are in the
workflow's path filters — without them a PR touching only the suite skipped the
job it was editing, which it did once.

### What is covered

Seven specs, all of the wager journey:

| Spec | The thing it pins |
|---|---|
| Debt created, shown, settled | The whole loop, and that the money history refreshes when chips move |
| A night on credit | Nobody buys a chip, the debt is real, a gamer already down keeps betting, and it settles |
| A hedge | Two positions, both stakes committed, **each row settling on its own** |
| Top-up | A repeat bet on one outcome merges rather than opening a second |
| Backing eligibility | A player may back their own side and nothing else |
| Whole-room settle | One click clears a three-way debt, recorded as one round |
| Part payment | Typing over the pre-filled amount leaves the rest owing |

Deliberately absent: game creation, squad browsing, the scoreboard. They are
covered by the worker and component suites, and driving them here would add
fragile selectors to specs whose subject is money.

### The stack under test is real

| Piece | How |
|---|---|
| Worker | `wrangler dev --local` — Miniflare with a SQLite D1 in `.wrangler/state`. No Cloudflare credentials. |
| Database | Wiped and re-migrated before every run: the wager assertions are about exact balances, and leftovers would make them lie. |
| Client | `vite dev`, proxying `/api` to the Worker so the session cookie stays same-origin. Without that proxy every authed request is a 401. |
| Session secret | Supplied on the command line. It normally lives in a gitignored `worker/.dev.vars`, so a fresh checkout cannot sign a cookie and every room creation 500s. |
| Viewport | `devices['Pixel 7']`. The app is mobile-first; desktop width would exercise a shape nobody uses. |

`workers: 1` and `fullyParallel: false` — one local database, and parallel
workers would race on it.

### Seed through the API, click the feature

Everything the room needs to *exist* is seeded over HTTP; everything about
wagering is clicked. Game creation is covered thoroughly by the worker and
component suites, and driving it here would add a dozen fragile selectors to a
test whose subject is money.

Seeding runs on `page.request`, which **shares a cookie jar with the page**, so
the browser is genuinely authenticated as the session that created the room.
The app is then pointed at it by writing `fc26:last-room-id` into
`localStorage` and reloading, which is what a returning visit does.

### Writing one

- **Assert on what the fix changes, not near it.** A first attempt at pinning
  the "Everyone" filter asserted on the list contents and passed with the fix
  reverted, because whichever gamer it snapped back to still had rows of their
  own. Asserting the select's value is what discriminates.
- **Reach for the smaller tier when a browser test cannot decide.** That same
  filter went unpinned for a day because the end-to-end run was too coarse to
  separate the two behaviours, which left a real fix looking unjustified. A
  unit test controlling the render directly settled it in one attempt.
- **Sabotage it.** Break the behaviour, watch the test fail, restore. Two of
  the three fixes shipped with the suite are pinned that way; the third
  survived its own sabotage and is recorded as unverified rather than claimed.
- **Room names are globally unique**, so each test needs its own. Gamer names
  are not — per-room since migration 0014 — and the specs deliberately seed a
  plain "Ann" into each room, so the fix is proven through the whole stack.
- **Read a value from where it lives.** The debt amount moved out of the
  sentence and into an editable field, which silently broke four assertions
  matching `X pays Y 40` as text. `expectOwes` checks both halves, because
  matching the sentence alone would pass whatever the field said — including
  nothing.
- **Expect the tiers to disagree.** Of the three mutations tried against the
  part-payment field, two were caught by exactly one suite: a stale override
  needs a real round trip to surface, and a client-side guard never reaches the
  browser at all. A mutation surviving one tier is not evidence it is safe.

---

**End of Handoff Document**
