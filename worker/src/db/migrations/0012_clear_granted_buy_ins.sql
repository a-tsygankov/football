-- Migration 0012: a balance is what you bought plus what you won, nothing else.
--
-- Game nights used to buy in everyone in the pool automatically, and balances
-- are room-wide and carry between nights, so the grants piled up: turn up ten
-- evenings without placing a bet and you were a thousand chips richer for
-- having done nothing. Nights now grant nothing by default, which stops the
-- pile growing but leaves every chip already handed out sitting in the ledger.
--
-- This removes them. Every `chips_purchased` event the system issued on a
-- gamer's behalf goes; every one somebody asked for stays, matched on `reason`
-- rather than on an id prefix so it catches both the migration backfills and
-- the grants the route wrote at the time.
--
-- Two consequences, both intended. Anyone whose wagering is down now holds a
-- negative balance, which is the honest number — they are behind, and the
-- settle-up figures have always said so, being computed from net alone and
-- never touched by purchases. And nobody can place a bet until they buy chips,
-- because that is now the only way chips enter a room.

DELETE FROM game_events
WHERE event_type = 'chips_purchased'
  AND json_extract(payload, '$.reason') = 'game_night_buy_in';

INSERT INTO schema_migrations (version, applied_at, description)
VALUES (12, (strftime('%s','now') * 1000), 'clear automatically granted buy-ins');
