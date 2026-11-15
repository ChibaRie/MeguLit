-- 2026-11-15 adaptation contribution packages (relay/src/contrib.js, services/adapter-contrib.cjs). Parts live in R2 under
-- contrib/<upload>/<part> only until the maintainer marks the game adapted (state done) or expires_at (30 days) passes
-- (state expired); the rows stay without data so a game is not asked for twice, and go after a year.
CREATE TABLE IF NOT EXISTS contrib_uploads (
  upload TEXT PRIMARY KEY,
  identity TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  app TEXT NOT NULL DEFAULT '',
  size INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  parts INTEGER NOT NULL,
  state TEXT NOT NULL,
  ip_hash TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  completed_at INTEGER,
  done_at INTEGER,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS contrib_uploads_identity ON contrib_uploads(identity);
CREATE INDEX IF NOT EXISTS contrib_uploads_state ON contrib_uploads(state, expires_at);
CREATE TABLE IF NOT EXISTS contrib_parts (
  upload TEXT NOT NULL,
  part INTEGER NOT NULL,
  size INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (upload, part)
);
