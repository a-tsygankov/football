ALTER TABLE rooms ADD COLUMN name_key TEXT;

CREATE TABLE _room_name_keys (
  id TEXT PRIMARY KEY,
  final_name_key TEXT NOT NULL
);

INSERT INTO _room_name_keys (id, final_name_key)
WITH RECURSIVE room_chars AS (
  SELECT
    id,
    created_at,
    lower(name) AS source_name,
    1 AS position,
    '' AS stem
  FROM rooms

  UNION ALL

  SELECT
    id,
    created_at,
    source_name,
    position + 1,
    stem || CASE
      WHEN substr(source_name, position, 1) GLOB '[a-z0-9]' THEN substr(source_name, position, 1)
      ELSE ''
    END
  FROM room_chars
  WHERE position <= length(source_name)
),
room_stems AS (
  SELECT
    id,
    created_at,
    CASE
      WHEN stem = '' THEN 'room' || lower(substr(id, 1, 6))
      ELSE stem
    END AS base_name_key
  FROM room_chars
  WHERE position = length(source_name) + 1
),
ranked_rooms AS (
  SELECT
    id,
    base_name_key,
    row_number() OVER (
      PARTITION BY base_name_key
      ORDER BY created_at ASC, id ASC
    ) AS duplicate_index
  FROM room_stems
)
SELECT
  id,
  CASE
    WHEN duplicate_index = 1 THEN base_name_key
    ELSE base_name_key || '--' || lower(substr(id, 1, 6))
  END AS final_name_key
FROM ranked_rooms;

UPDATE rooms
SET name_key = (
  SELECT final_name_key
  FROM _room_name_keys
  WHERE _room_name_keys.id = rooms.id
)
WHERE name_key IS NULL;

DROP TABLE _room_name_keys;

CREATE UNIQUE INDEX idx_rooms_name_key ON rooms(name_key);

ALTER TABLE gamers ADD COLUMN name_key TEXT;
ALTER TABLE gamers ADD COLUMN pin_hash TEXT;
ALTER TABLE gamers ADD COLUMN pin_salt TEXT;

CREATE TABLE _gamer_name_keys (
  id TEXT PRIMARY KEY,
  final_name_key TEXT NOT NULL
);

INSERT INTO _gamer_name_keys (id, final_name_key)
WITH RECURSIVE gamer_chars AS (
  SELECT
    id,
    created_at,
    lower(name) AS source_name,
    1 AS position,
    '' AS stem
  FROM gamers

  UNION ALL

  SELECT
    id,
    created_at,
    source_name,
    position + 1,
    stem || CASE
      WHEN substr(source_name, position, 1) GLOB '[a-z0-9]' THEN substr(source_name, position, 1)
      ELSE ''
    END
  FROM gamer_chars
  WHERE position <= length(source_name)
),
gamer_stems AS (
  SELECT
    id,
    created_at,
    CASE
      WHEN stem = '' THEN 'gamer' || lower(substr(id, 1, 6))
      ELSE stem
    END AS base_name_key
  FROM gamer_chars
  WHERE position = length(source_name) + 1
),
ranked_gamers AS (
  SELECT
    id,
    base_name_key,
    row_number() OVER (
      PARTITION BY base_name_key
      ORDER BY created_at ASC, id ASC
    ) AS duplicate_index
  FROM gamer_stems
)
SELECT
  id,
  CASE
    WHEN duplicate_index = 1 THEN base_name_key
    ELSE base_name_key || '--' || lower(substr(id, 1, 6))
  END AS final_name_key
FROM ranked_gamers;

UPDATE gamers
SET name_key = (
  SELECT final_name_key
  FROM _gamer_name_keys
  WHERE _gamer_name_keys.id = gamers.id
)
WHERE name_key IS NULL;

DROP TABLE _gamer_name_keys;

CREATE UNIQUE INDEX idx_gamers_name_key ON gamers(name_key);

INSERT INTO schema_migrations (version, applied_at, description)
VALUES (3, (strftime('%s','now') * 1000), 'name keys and gamer pins');
