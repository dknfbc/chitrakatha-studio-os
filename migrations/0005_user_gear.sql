-- 0005_user_gear.sql
-- Store camera bodies and gear/lighting kits for studio team members
CREATE TABLE IF NOT EXISTS user_gear (
  uid TEXT PRIMARY KEY REFERENCES users(uid) ON DELETE CASCADE,
  camera TEXT NOT NULL DEFAULT '',
  gear TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS user_gear_uid_idx ON user_gear (uid);
