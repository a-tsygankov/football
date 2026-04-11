CREATE TABLE games (
  id                    TEXT PRIMARY KEY,
  room_id               TEXT NOT NULL REFERENCES rooms(id),
  game_night_id         TEXT NOT NULL REFERENCES game_nights(id),
  status                TEXT NOT NULL,
  allocation_mode       TEXT NOT NULL,
  format                TEXT NOT NULL,
  home_gamer_ids_json   TEXT NOT NULL,
  away_gamer_ids_json   TEXT NOT NULL,
  selection_strategy_id TEXT NOT NULL,
  random_seed           INTEGER,
  created_at            INTEGER NOT NULL,
  updated_at            INTEGER NOT NULL
);

CREATE UNIQUE INDEX idx_games_game_night_active
  ON games(game_night_id)
  WHERE status = 'active';

CREATE INDEX idx_games_room_created ON games(room_id, created_at DESC);

INSERT INTO schema_migrations (version, applied_at, description)
VALUES (2, (strftime('%s','now') * 1000), 'live games');
