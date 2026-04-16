-- Migration 0001: initial schema
-- Keep additive-only edits after this file. New migrations = new files.

CREATE TABLE rooms (
  id                         TEXT PRIMARY KEY,
  name                       TEXT NOT NULL,
  avatar_url                 TEXT,
  pin_hash                   TEXT,
  pin_salt                   TEXT,
  default_selection_strategy TEXT NOT NULL DEFAULT 'uniform-random',
  created_at                 INTEGER NOT NULL,
  updated_at                 INTEGER NOT NULL
);

CREATE TABLE gamers (
  id         TEXT PRIMARY KEY,
  room_id    TEXT NOT NULL REFERENCES rooms(id),
  name       TEXT NOT NULL,
  rating     INTEGER NOT NULL DEFAULT 3,
  active     INTEGER NOT NULL DEFAULT 1,
  avatar_url TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_gamers_room ON gamers(room_id, active);

CREATE TABLE game_nights (
  id           TEXT PRIMARY KEY,
  room_id      TEXT NOT NULL REFERENCES rooms(id),
  status       TEXT NOT NULL,
  started_at   INTEGER NOT NULL,
  ended_at     INTEGER,
  last_game_at INTEGER,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);
CREATE UNIQUE INDEX idx_game_nights_room_active ON game_nights(room_id) WHERE status = 'active';
CREATE INDEX idx_game_nights_room_created ON game_nights(room_id, created_at DESC);

CREATE TABLE game_night_active_gamers (
  game_night_id TEXT NOT NULL REFERENCES game_nights(id),
  gamer_id      TEXT NOT NULL REFERENCES gamers(id),
  joined_at     INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  PRIMARY KEY (game_night_id, gamer_id)
);
CREATE INDEX idx_game_night_active_gamers_gamer ON game_night_active_gamers(gamer_id);

-- Append-only. Repository layer enforces "no UPDATE, no DELETE" — the table
-- does not carry a DB-level trigger for this because SQLite triggers would
-- fail silently in D1; we prefer a loud repository test.
CREATE TABLE game_events (
  id             TEXT PRIMARY KEY,
  room_id        TEXT NOT NULL REFERENCES rooms(id),
  event_type     TEXT NOT NULL,
  payload        TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  correlation_id TEXT,
  occurred_at    INTEGER NOT NULL,
  recorded_at    INTEGER NOT NULL
);
CREATE INDEX idx_events_room_time ON game_events(room_id, occurred_at);
CREATE INDEX idx_events_correlation ON game_events(correlation_id);

CREATE TABLE gamer_points (
  gamer_id      TEXT PRIMARY KEY REFERENCES gamers(id),
  room_id       TEXT NOT NULL REFERENCES rooms(id),
  games_played  INTEGER NOT NULL DEFAULT 0,
  wins          INTEGER NOT NULL DEFAULT 0,
  draws         INTEGER NOT NULL DEFAULT 0,
  losses        INTEGER NOT NULL DEFAULT 0,
  goals_for     INTEGER NOT NULL DEFAULT 0,
  goals_against INTEGER NOT NULL DEFAULT 0,
  last_event_id TEXT NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE INDEX idx_gamer_points_room ON gamer_points(room_id);

CREATE TABLE gamer_team_points (
  gamer_team_key TEXT PRIMARY KEY,
  room_id        TEXT NOT NULL REFERENCES rooms(id),
  members_json   TEXT NOT NULL,
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
  version      TEXT PRIMARY KEY,
  released_at  INTEGER,            -- upstream publish time, nullable when unknown
  ingested_at  INTEGER NOT NULL,   -- when this Worker wrote it to R2
  clubs_bytes  INTEGER NOT NULL DEFAULT 0,
  club_count   INTEGER NOT NULL DEFAULT 0,
  player_count INTEGER NOT NULL DEFAULT 0,
  source_url   TEXT NOT NULL,
  notes        TEXT
);
CREATE INDEX idx_squad_versions_ingested ON squad_versions(ingested_at);

CREATE TABLE pin_attempts (
  room_id      TEXT NOT NULL,
  ip           TEXT NOT NULL,
  attempts     INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER,
  PRIMARY KEY (room_id, ip)
);

CREATE TABLE schema_migrations (
  version     INTEGER PRIMARY KEY,
  applied_at  INTEGER NOT NULL,
  description TEXT NOT NULL
);

INSERT INTO schema_migrations (version, applied_at, description)
VALUES (1, (strftime('%s','now') * 1000), 'initial schema');
