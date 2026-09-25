-- ULTRAPLAN 0.4 / ADR-0003: enable the Postgres extensions every future module relies
-- on, before any of them exist. Hand-written (via `drizzle-kit generate --custom`,
-- not a schema diff) since there is no Drizzle table yet to generate this from — see
-- apps/api/src/database/schema.ts.
--
--   postgis     — geography(Point,4326) on parking_lots.location + GiST distance/radius
--                 search (Phase 2, facilities module).
--   btree_gist  — lets a GiST index mix equality (spot_id) with range overlap (period),
--                 required by reservations' EXCLUDE USING gist constraint (Phase 9).
--   pg_trgm     — trigram indexes for fuzzy plate search (parking_sessions.plate_normalized,
--                 plate_reads.plate_normalized — Phase 3/6).
--   citext      — case-insensitive text, used for users.email (Phase 1, identity module).
--
-- `IF NOT EXISTS`: safe to re-run, and matches this repo's Postgres image
-- (postgis/postgis:16-3.4 — infra/docker/compose.yml) already bundling these libraries.
CREATE EXTENSION IF NOT EXISTS postgis;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS citext;
