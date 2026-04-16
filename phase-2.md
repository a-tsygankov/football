# Phase 2 — Rooms, Gamers, Game Nights

## Goal

Phase 2 turns the scaffold into a usable local product:

- create or join a room
- persist gamers in D1
- issue a 30-day room session cookie
- manage a room roster with avatars
- support a single active `game_night` per room
- prepare the API and shared types for manual game selection flows

This phase does not finish the full match lifecycle. It lays the room, roster,
auth, and active-session foundation needed before game creation, results
entry, and scoreboard refinement.

## Core terminology

- `gamer`: a human in the friend group
- `fc_player`: an EA footballer
- `room`: a persistent group of gamers
- `game_night`: a series of sequential games in one room
- `game`: one FC match inside a game night

## Product decisions locked for this phase

- room access uses an optional 4-digit numeric PIN
- successful room access creates a signed cookie valid for 30 days
- a room may have 0 or 1 active game night
- a game night ends after 12 hours without recorded game activity
- a game can involve `1v1`, `1v2`, `2v1`, or `2v2`
- gamer selection is manual-first; random fills remain available as helpers

## Shared domain model

### Room

`Room` is the persisted worker-side model. `RoomSummary` is the safe shape sent
to the client.

Important fields:

- `avatarUrl: string | null`
- `pinHash: string | null`
- `pinSalt: string | null`
- `defaultSelectionStrategy: string`

### Gamer

Each gamer belongs to exactly one room and has:

- `rating: 1..5`
- `active: boolean`
- `avatarUrl: string | null`

### Game formats

The shared model exposes:

- `GameFormat = '1v1' | '1v2' | '2v1' | '2v2'`
- `GameSize = 2 | 3 | 4`
- `GAME_FORMATS` as the canonical side-size lookup

Selection strategies still choose a lineup count. The later game-setup UI
chooses how those selected gamers are split across the left and right sides.

### Game night

`GameNight` represents the active evening session for a room.

Fields:

- `status: 'active' | 'completed'`
- `startedAt`
- `endedAt`
- `lastGameAt`

`GameNightActiveGamer` stores which room gamers are currently participating in
that game night. This is the source for the green-dot “playing now” indicator.

## Event model

The append-only event log remains the source of truth for recorded matches.
Phase 2 expands the event payload shape so each game result is tied to:

- `gameNightId`
- `format`
- `size`

The shared event types now include:

- `game_recorded`
- `game_interrupted`
- `game_voided`

`game_interrupted` is the dedicated path for ending a started game without
applying wins, losses, draws, or points.

## Avatar model

Every room, gamer, club, and fc_player has an avatar entry point.

### Persistence

- rooms and gamers store `avatar_url` in D1
- clubs and fc_players expose avatar fields in the shared read model
- avatar binaries will live in R2 once upload endpoints land

### Key layout

Planned R2 keys:

- `avatars/rooms/{roomId}.webp`
- `avatars/gamers/{gamerId}.webp`
- `avatars/clubs/{clubId}.webp`
- `avatars/fc-players/{playerId}.webp`

### UX

- standard file picker
- client-side crop/scale before upload
- fallback silhouettes per entity type

Upload and crop UI are subsequent tasks. This phase only carries the schema and
API fields so those flows can be added without another domain rewrite.

## Auth and room access

### PIN handling

- only `^\d{4}$` is accepted for now
- stored as PBKDF2 hash plus random salt
- never returned to the client

### PIN throttling

`pin_attempts` tracks consecutive failures per `(room_id, ip)`.

Policy:

- attempts 1–4: no lockout
- attempt 5: 60 second lockout
- each later failed attempt doubles the lockout after the previous lock ends

### Session cookie

- signed, not encrypted
- payload contains `roomId` and `exp`
- valid for 30 days
- one room-scoped cookie is enough for the current UI

## Worker APIs for this phase

### Room bootstrap

- `POST /api/rooms`
  - create room
  - set session cookie
  - return room bootstrap payload
- `POST /api/rooms/:roomId/sessions`
  - verify optional PIN
  - set session cookie
  - return room bootstrap payload
- `GET /api/rooms/:roomId/bootstrap`
  - requires valid room session
  - returns room, gamers, active game night, and active game-night gamers

### Roster management

- `POST /api/rooms/:roomId/gamers`
- `PATCH /api/rooms/:roomId/gamers/:gamerId`

### Game night foundation

- `POST /api/rooms/:roomId/game-nights`
  - starts the active game night if none exists
  - optionally seeds the first active gamer set

## Database shape

### Existing tables kept

- `rooms`
- `gamers`
- `game_events`
- `gamer_points`
- `gamer_team_points`
- `pin_attempts`
- `squad_versions`

### Added in this phase

- `rooms.avatar_url`
- `gamers.avatar_url`
- `game_nights`
- `game_night_active_gamers`

Because this project has not been deployed with a real database yet, updating
`0001_init.sql` is still acceptable. Once the first persistent environment
exists, all further schema changes must be additive migrations.

## Local development target

Phase 2 local development should run with:

- web on `5173`
- worker on `8787`
- local D1 bound as `DB`
- no Cloudflare account requirement for daily dev

`wrangler.toml` should keep a local-ready D1 binding, and migrations should be
applied with:

```bash
pnpm --filter @fc26/worker exec wrangler d1 migrations apply fc26 --local
```

## Web scope after backend readiness

Once the worker APIs are ready, the first UI slice is:

1. room create / join
2. room bootstrap load
3. gamer roster management
4. active game-night banner and "start game night" button

The game-setup flow comes next, built on top of these APIs.

## Definition of done for this checkpoint

- shared types cover game nights, avatars, and 3-player formats
- worker schema and dependencies support local D1
- room create/join/bootstrap works end-to-end with cookies
- gamers can be created and updated from the web app
- a room can start one active game night
- typecheck and tests pass
