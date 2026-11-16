-- 2026-11-16 the app version of the stored probe: a probe from a newer app version replaces it (the readers changed), so a
-- game whose issue was closed after a fix reports again from the release that carries the fix; rows before this read as 1.4.12
ALTER TABLE probe_games ADD COLUMN app TEXT NOT NULL DEFAULT '';
