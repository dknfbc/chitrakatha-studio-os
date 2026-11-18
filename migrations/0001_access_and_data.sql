PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS bootstrap (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  owner_uid TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  uid TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  display_name TEXT NOT NULL,
  professional_role TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
  role TEXT NOT NULL CHECK (role IN ('pending', 'rejected', 'superAdmin', 'deployer', 'freelancer')),
  created_at TEXT NOT NULL,
  CHECK ((status = 'pending' AND role = 'pending') OR
         (status = 'rejected' AND role = 'rejected') OR
         (status = 'approved' AND role IN ('superAdmin', 'deployer', 'freelancer')))
);

CREATE TABLE IF NOT EXISTS deployments (
  id TEXT PRIMARY KEY,
  creator_uid TEXT NOT NULL REFERENCES users(uid),
  status TEXT NOT NULL CHECK (status IN ('draft', 'details_pending', 'ready_for_review', 'confirmed', 'cancelled')),
  event_type TEXT NOT NULL,
  title TEXT,
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS deployments_creator_status ON deployments (creator_uid, status);

CREATE TABLE IF NOT EXISTS deployment_days (
  id TEXT PRIMARY KEY,
  deployment_id TEXT NOT NULL REFERENCES deployments(id) ON DELETE CASCADE,
  work_date TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS deployment_days_date ON deployment_days (work_date);

CREATE TABLE IF NOT EXISTS assignments (
  id TEXT PRIMARY KEY,
  deployment_id TEXT NOT NULL REFERENCES deployments(id) ON DELETE CASCADE,
  day_id TEXT NOT NULL REFERENCES deployment_days(id) ON DELETE CASCADE,
  freelancer_uid TEXT NOT NULL REFERENCES users(uid),
  professional_role TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('offered', 'accepted', 'declined', 'confirmed', 'withdrawal_requested'))
);
CREATE INDEX IF NOT EXISTS assignments_freelancer ON assignments (freelancer_uid, status);
CREATE INDEX IF NOT EXISTS assignments_deployment ON assignments (deployment_id);

-- Financial fields live in separate tables. No Super Admin endpoint may query these.
CREATE TABLE IF NOT EXISTS finance_deployment (
  deployment_id TEXT PRIMARY KEY REFERENCES deployments(id) ON DELETE CASCADE,
  creator_uid TEXT NOT NULL REFERENCES users(uid),
  client_total_minor INTEGER,
  advance_minor INTEGER,
  currency TEXT NOT NULL DEFAULT 'INR'
);
CREATE TABLE IF NOT EXISTS finance_assignments (
  assignment_id TEXT PRIMARY KEY REFERENCES assignments(id) ON DELETE CASCADE,
  freelancer_uid TEXT NOT NULL REFERENCES users(uid),
  deployment_creator_uid TEXT NOT NULL REFERENCES users(uid),
  offered_minor INTEGER,
  advance_paid_minor INTEGER,
  currency TEXT NOT NULL DEFAULT 'INR'
);

CREATE TABLE IF NOT EXISTS availability (
  id TEXT PRIMARY KEY,
  freelancer_uid TEXT NOT NULL REFERENCES users(uid),
  work_date TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('unavailable', 'external_work')),
  private_reason TEXT
);
CREATE INDEX IF NOT EXISTS availability_owner_date ON availability (freelancer_uid, work_date);

CREATE TABLE IF NOT EXISTS season_dates (
  id TEXT PRIMARY KEY,
  work_date TEXT NOT NULL,
  source TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('bengali_panjika', 'hindu_panchang')),
  confirmation_status TEXT NOT NULL CHECK (confirmation_status IN ('unconfirmed', 'confirmed', 'rejected')),
  notes TEXT
);
CREATE INDEX IF NOT EXISTS season_dates_date ON season_dates (work_date, confirmation_status);
