-- Migration 0014: a gamer's name only has to be unique in their own room.
--
-- `idx_gamers_name_key` was unique on `name_key` alone, so two rooms could not
-- both have an Ann. That is wrong for an app whose whole shape is "a room is a
-- group of friends": the second group to sign up finds the common names gone,
-- taken by people they will never play against and cannot see.
--
-- Rooms keep their global uniqueness. A room is joined by typing its name
-- (`resolveRoomByLookup`), so two rooms sharing one would make that lookup
-- ambiguous. Nothing resolves a *gamer* by name, so nothing needed theirs to
-- be global.
--
-- No data can violate the new index: every surviving name_key is unique across
-- the whole table today, which is strictly stronger than unique per room.

DROP INDEX IF EXISTS idx_gamers_name_key;

CREATE UNIQUE INDEX idx_gamers_room_name_key ON gamers(room_id, name_key);

INSERT INTO schema_migrations (version, applied_at, description)
VALUES (14, (strftime('%s','now') * 1000), 'gamer names unique per room, not globally');
