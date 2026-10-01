CREATE TABLE user_identities (
  user_id TEXT NOT NULL REFERENCES users(id),
  provider TEXT NOT NULL CHECK (provider IN ('google','github')),
  subject TEXT NOT NULL,
  username TEXT,
  email TEXT,
  profile_json TEXT NOT NULL DEFAULT '{}',
  linked_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (provider, subject)
);

CREATE UNIQUE INDEX idx_identity_user_provider ON user_identities(user_id, provider);

CREATE TABLE sessions (
  id_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL CHECK (kind IN ('console','admin')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  revoked_at TEXT
);

ALTER TABLE users ADD COLUMN community_eligible INTEGER NOT NULL DEFAULT 0;

ALTER TABLE users ADD COLUMN sybil_assessed_at TEXT;

ALTER TABLE users ADD COLUMN registration_status TEXT NOT NULL DEFAULT 'PENDING_CONSENT' CHECK (registration_status IN ('PENDING_CONSENT','ACTIVE','SUSPENDED'));

INSERT OR IGNORE INTO user_identities (user_id, provider, subject, email)
SELECT id, 'google', substr(id, 10), email FROM users WHERE id LIKE 'usr_goog_%';

UPDATE users SET registration_status = 'PENDING_CONSENT' WHERE id LIKE 'usr_goog_%';
