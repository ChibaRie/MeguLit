-- 2026-11-15 closed-beta full probes (relay/src/probe-full.js): one .mlfp per game identity in R2 under
-- probe-full/<identity>/<sha256>.mlfp, uploaded as an R2 multipart upload (parts in probe_full_parts until complete).
-- state: uploading | ready | done (the maintainer adapted it; file deleted, row kept a while so apps do not resend).
CREATE TABLE IF NOT EXISTS probe_full (
  identity TEXT PRIMARY KEY,
  upload TEXT NOT NULL,
  r2_upload TEXT NOT NULL DEFAULT '',
  object_key TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  size INTEGER NOT NULL,
  parts INTEGER NOT NULL,
  state TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  vndb TEXT NOT NULL DEFAULT '',
  step TEXT NOT NULL DEFAULT '',
  app TEXT NOT NULL DEFAULT '',
  ip_hash TEXT NOT NULL DEFAULT '',
  reporters INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS probe_full_upload ON probe_full(upload);
CREATE TABLE IF NOT EXISTS probe_full_parts (
  identity TEXT NOT NULL,
  part INTEGER NOT NULL,
  etag TEXT NOT NULL,
  size INTEGER NOT NULL,
  PRIMARY KEY (identity, part)
);
