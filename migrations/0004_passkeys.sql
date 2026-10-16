ALTER TABLE admin_users ADD COLUMN webauthn_user_id TEXT;

CREATE UNIQUE INDEX admin_users_webauthn_user_id ON admin_users (webauthn_user_id);

CREATE TABLE admin_passkeys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  credential_id TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL REFERENCES admin_users (id) ON DELETE CASCADE,
  public_key TEXT NOT NULL,
  sign_count INTEGER NOT NULL DEFAULT 0,
  transports TEXT,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER
);

CREATE INDEX admin_passkeys_user ON admin_passkeys (user_id);

CREATE TABLE webauthn_challenges (
  challenge_hash TEXT PRIMARY KEY,
  purpose TEXT NOT NULL CHECK (purpose IN ('register_invite', 'register_account', 'login', 'reauth')),
  subject TEXT,
  webauthn_user_id TEXT,
  expires_at INTEGER NOT NULL
);

UPDATE kv SET value = '4' WHERE key = 'schema_version';
