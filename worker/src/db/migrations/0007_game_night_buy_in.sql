-- Migration 0007: game-night buy-ins.
--
-- Wagering had no bankroll: a gamer could stake any number they could type,
-- so "chips tonight" measured nothing in particular. A buy-in gives every
-- participant the same starting stack, which is what makes a balance — and a
-- limit on what can be staked — mean anything.
--
-- Per night rather than per room: the stack is the thing you sit down with,
-- and it should be settable for tonight without editing room configuration.
-- The default backfills nights that started before buy-ins existed, so their
-- standings keep working; it matches DEFAULT_BUY_IN in @fc26/shared.

ALTER TABLE game_nights ADD COLUMN buy_in INTEGER NOT NULL DEFAULT 100;

INSERT INTO schema_migrations (version, applied_at, description)
VALUES (7, (strftime('%s','now') * 1000), 'game night buy-ins');
