-- Migration 0009: buy-ins for gamers who joined a night after it started.
--
-- 0008 backfilled a purchase per (night, gamer) pair, and starting a night
-- issues one to everyone in the pool. Neither covers a gamer added to the pool
-- *after* the night began: the active-gamers route replaced pool membership
-- without issuing anything. Balances are room-wide now, so such a gamer sat
-- down with nothing and could not bet at all — where the old per-night model
-- gave them the buy-in regardless of when they arrived.
--
-- The route now issues the purchase itself. This closes the gap for pairs that
-- already exist.
--
-- NOT EXISTS rather than a prefix match on the id: purchases made by the route
-- carry random ids, so only "has this pair been bought in at all" is a sound
-- test — and it makes this migration safe to re-run.

INSERT INTO game_events
  (id, room_id, event_type, payload, schema_version, correlation_id, occurred_at, recorded_at)
SELECT
  'buyin-latejoin-' || gn.id || '-' || gnag.gamer_id,
  gn.room_id,
  'chips_purchased',
  json_object(
    'type',          'chips_purchased',
    'schemaVersion', 1,
    'roomId',        gn.room_id,
    'gamerId',       gnag.gamer_id,
    'amount',        gn.buy_in,
    'gameNightId',   gn.id,
    'occurredAt',    gnag.joined_at,
    'reason',        'game_night_buy_in'
  ),
  1,
  NULL,
  gnag.joined_at,
  (strftime('%s','now') * 1000)
FROM game_nights gn
INNER JOIN game_night_active_gamers gnag ON gnag.game_night_id = gn.id
WHERE gn.buy_in > 0
  AND NOT EXISTS (
    SELECT 1
    FROM game_events e
    WHERE e.event_type = 'chips_purchased'
      AND json_extract(e.payload, '$.gameNightId') = gn.id
      AND json_extract(e.payload, '$.gamerId') = gnag.gamer_id
  );

INSERT INTO schema_migrations (version, applied_at, description)
VALUES (9, (strftime('%s','now') * 1000), 'buy-ins for gamers who joined a night late');
