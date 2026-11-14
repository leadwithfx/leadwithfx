-- Failure-only outbox. A row exists only while a Brevo call is failing and being retried.
-- Applied once to the D1 database "clarity-outbox" (see README). Sent rows are deleted; dead rows are purged after 7 days.
CREATE TABLE IF NOT EXISTS outbox (
  id TEXT PRIMARY KEY,
  path TEXT NOT NULL,
  payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 1,
  next_at INTEGER NOT NULL,
  last_error TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS outbox_due ON outbox (status, next_at);
