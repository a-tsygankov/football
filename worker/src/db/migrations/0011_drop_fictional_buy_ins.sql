-- Migration 0011: stop crediting chips for nights that never had wagering.
--
-- Migrations 0008 and 0009 backfilled a `chips_purchased` event for every
-- (night, pool gamer) pair, so that rooms which already had balances under the
-- old per-night model kept them. That was right for nights people actually bet
-- on. It was wrong for every night that predates wagering entirely: those
-- gamers were credited 100 chips apiece for an evening where no bet was ever
-- placed, and with a season of history behind them the totals ran into the
-- thousands — a balance nobody earned and nobody can explain.
--
-- Only migration-created rows are removed, matched on their deterministic ids.
-- Purchases the route wrote carry random ids and are real actions by real
-- people; none of those are touched.
--
-- A night counts as having had wagering if any bet event mentions it. That is
-- the honest test: `bets` rows are deleted at settlement, so the event log is
-- the only durable record that a book ever existed.

DELETE FROM game_events
WHERE event_type = 'chips_purchased'
  AND (id LIKE 'buyin-backfill-%' OR id LIKE 'buyin-latejoin-%')
  AND NOT EXISTS (
    SELECT 1
    FROM game_events bet
    WHERE bet.event_type IN ('bet_placed', 'bet_removed', 'bets_locked', 'bets_discarded')
      AND json_extract(bet.payload, '$.gameNightId')
          = json_extract(game_events.payload, '$.gameNightId')
  );

INSERT INTO schema_migrations (version, applied_at, description)
VALUES (11, (strftime('%s','now') * 1000), 'drop backfilled buy-ins for nights without wagering');
