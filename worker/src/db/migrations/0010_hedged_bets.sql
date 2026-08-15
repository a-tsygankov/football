-- Migration 0010: allow hedged positions.
--
-- `idx_bets_game_gamer` enforced one bet per gamer per game, which made
-- backing a second outcome impossible: the place-or-replace route treated it
-- as moving the position rather than adding one. A gamer who wanted to cover
-- both sides had no way to say so.
--
-- The uniqueness moves to (game, gamer, outcome). That still collapses repeat
-- bets on the *same* outcome into one row, which is what makes "another 20 on
-- Home" a top-up rather than a duplicate — while leaving room for a separate
-- position on each outcome.
--
-- Settlement was rekeyed by row rather than by gamer in the same change. It
-- had to be: a hedger appears on both a winning and a losing row, and paying
-- the winning amount against every row they hold would create chips.

DROP INDEX idx_bets_game_gamer;

CREATE UNIQUE INDEX idx_bets_game_gamer_outcome ON bets(game_id, gamer_id, outcome);

INSERT INTO schema_migrations (version, applied_at, description)
VALUES (10, (strftime('%s','now') * 1000), 'allow one bet per outcome per gamer');
