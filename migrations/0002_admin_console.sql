ALTER TABLE users ADD COLUMN photo_data TEXT;
ALTER TABLE deployments ADD COLUMN created_by_uid TEXT REFERENCES users(uid);
ALTER TABLE deployments ADD COLUMN import_id TEXT;
ALTER TABLE season_dates ADD COLUMN created_by_uid TEXT REFERENCES users(uid);
ALTER TABLE season_dates ADD COLUMN created_at TEXT;

CREATE TABLE IF NOT EXISTS admin_imports (
  id TEXT PRIMARY KEY,
  original_owner_uid TEXT REFERENCES users(uid),
  imported_by_uid TEXT NOT NULL REFERENCES users(uid),
  source_type TEXT NOT NULL CHECK (source_type IN ('manual', 'text', 'photo', 'historical')),
  source_text TEXT NOT NULL DEFAULT '',
  source_file_data TEXT,
  extracted_json TEXT NOT NULL DEFAULT '{}',
  confirmation_status TEXT NOT NULL CHECK (confirmation_status IN ('unconfirmed', 'reviewed', 'rejected')),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS event_backgrounds (
  event_type TEXT PRIMARY KEY,
  image_data TEXT NOT NULL,
  updated_by_uid TEXT NOT NULL REFERENCES users(uid),
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS profile_photo_proposals (
  id TEXT PRIMARY KEY,
  uid TEXT NOT NULL REFERENCES users(uid),
  image_data TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
  submitted_at TEXT NOT NULL,
  reviewed_by_uid TEXT REFERENCES users(uid),
  reviewed_at TEXT
);
CREATE INDEX IF NOT EXISTS profile_photo_proposals_status ON profile_photo_proposals (status, submitted_at);
