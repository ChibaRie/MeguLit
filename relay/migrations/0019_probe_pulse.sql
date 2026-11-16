-- 2026-11-16 live-usage pulse for the beta dashboard (relay/src/probe-stats.js). A MeguLit client that touches the relay
-- is recorded once per 10-minute bucket (INSERT OR IGNORE); "online" = distinct ip_hash in the last bucket. Only a salted
-- IP hash and the bucket are kept, nothing personal; rows older than a day are deleted by cleanupProbeStats.
CREATE TABLE IF NOT EXISTS probe_pulse (
  ip_hash TEXT NOT NULL,
  bucket INTEGER NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (ip_hash, bucket)
);
CREATE INDEX IF NOT EXISTS probe_pulse_bucket ON probe_pulse(bucket);
