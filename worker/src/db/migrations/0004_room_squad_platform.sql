ALTER TABLE rooms ADD COLUMN squad_platform TEXT NOT NULL DEFAULT 'PS5';

UPDATE rooms
SET squad_platform = 'PS5'
WHERE squad_platform IS NULL OR trim(squad_platform) = '';

INSERT INTO schema_migrations (version, applied_at, description)
VALUES (4, (strftime('%s','now') * 1000), 'room squad platform');
