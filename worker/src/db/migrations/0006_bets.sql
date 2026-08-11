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
