CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  recipient_uid TEXT NOT NULL,
  recipient_name TEXT,
  actor_uid TEXT,
  actor_name TEXT,
  deployment_id TEXT,
  kind TEXT NOT NULL DEFAULT 'work_update',
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  is_read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS notifications_recipient_idx ON notifications (recipient_uid, is_read, created_at);
CREATE INDEX IF NOT EXISTS notifications_name_idx ON notifications (recipient_name, is_read, created_at);
