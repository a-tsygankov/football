-- Migration 0008: backfill chip purchases for nights that predate them.
--
-- Balances used to be derived per night as `buy_in + that night's winnings`.
-- They are now derived room-wide from `chips_purchased` events, which carries
-- them across nights. Without this backfill every existing room would fold to
-- `0 + lifetime net`, so anyone who had lost would sit at a negative balance
-- and be unable to bet at all.
--
-- One purchase per gamer per night they were in the pool, at that night's
-- buy-in and dated to when the night started — which reproduces exactly the
-- chips the old model had already handed out. The id is derived from the pair
-- rather than random so the row is deterministic and this cannot double-issue.
--
-- Nights with a buy-in of 0 granted nothing and so backfill nothing.

INSERT INTO game_events
  (id, room_id, event_type, payload, schema_version, correlation_id, occurred_at, recorded_at)
SELECT
  'buyin-backfill-' || gn.id || '-' || gnag.gamer_id,
  gn.room_id,
  'chips_purchased',
  json_object(
    'type',          'chips_purchased',
    'schemaVersion', 1,
    'roomId',        gn.room_id,
    'gamerId',       gnag.gamer_id,
    'amount',        gn.buy_in,
    'gameNightId',   gn.id,
    'occurredAt',    gn.started_at,
    'reason',        'game_night_buy_in'
  ),
  1,
  NULL,
  gn.started_at,
  (strftime('%s','now') * 1000)
FROM game_nights gn
INNER JOIN game_night_active_gamers gnag ON gnag.game_night_id = gn.id
WHERE gn.buy_in > 0;

INSERT INTO schema_migrations (version, applied_at, description)
VALUES (8, (strftime('%s','now') * 1000), 'backfill chip purchases for existing game nights');
