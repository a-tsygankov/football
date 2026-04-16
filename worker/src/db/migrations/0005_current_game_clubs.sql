ALTER TABLE games ADD COLUMN home_club_id INTEGER;
ALTER TABLE games ADD COLUMN away_club_id INTEGER;

INSERT INTO schema_migrations (version, applied_at, description)
VALUES (5, (strftime('%s','now') * 1000), 'optional FC club assignment for current games');
