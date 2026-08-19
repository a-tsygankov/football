-- Migration 0013: everybody starts from zero.
--
-- 0012 removed the chips nights handed out, which left balances equal to
-- lifetime net — two people in credit, two in the red, and nobody able to bet
-- until they bought in. This wipes the wagering record itself so every balance
-- is exactly 0 and nobody owes anybody: a clean slate to start tracking from.
--
-- The football survives untouched. `game_recorded` carries the match — teams,
-- result, how the sides were picked — and only *also* carries the settled
-- wagers, so the event stays and loses one key. Deleting these rows would take
-- the scoreboard and the whole season's history with them.
--
-- Bets are cleared from three places because they live in three: the open
-- `bets` rows for any game still unsettled, the bet events that record how a
-- book was built, and the settlements folded into `game_recorded`. Leaving any
-- one behind would show a history of stakes that no longer add up to anything.

-- Open positions on games that never settled.
DELETE FROM bets;

-- How each book was built. Nothing derives a balance from these; they are the
-- Wager page's story of a game, and a story about chips nobody holds any more
-- is worse than no story.
DELETE FROM game_events
WHERE event_type IN ('bet_placed', 'bet_removed', 'bets_locked', 'bets_discarded');

-- The settlements. `json_remove` on a payload without the key is a no-op, so
-- games played before wagering existed pass through unchanged.
UPDATE game_events
SET payload = json_remove(payload, '$.wagers')
WHERE event_type = 'game_recorded'
  AND json_extract(payload, '$.wagers') IS NOT NULL;

-- A night in progress still carries the buy-in it was started with, and adding
-- somebody to its pool issues that buy-in. Leaving it set would let tonight
-- hand out chips again and quietly undo this reset. Finished nights keep their
-- figure: it is a true record of how they were played, and nothing can issue
-- against them.
UPDATE game_nights SET buy_in = 0, updated_at = (strftime('%s','now') * 1000)
WHERE status = 'active' AND buy_in > 0;

INSERT INTO schema_migrations (version, applied_at, description)
VALUES (13, (strftime('%s','now') * 1000), 'reset every chip balance to zero');
