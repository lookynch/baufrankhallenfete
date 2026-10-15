CREATE TABLE kv (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  lock_until INTEGER
);

INSERT INTO kv (key, value, updated_at) VALUES ('schema_version', '1', 0);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  updated_by INTEGER
);

CREATE TABLE admin_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin')),
  password_hash TEXT NOT NULL,
  totp_secret_enc TEXT NOT NULL,
  totp_last_step INTEGER NOT NULL DEFAULT 0,
  disabled INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  last_login_at INTEGER
);

CREATE TABLE admin_invites (
  token_hash TEXT PRIMARY KEY,
  username TEXT NOT NULL COLLATE NOCASE,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin')),
  created_by INTEGER,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);

CREATE TABLE admin_recovery_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES admin_users (id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  used_at INTEGER
);

CREATE INDEX admin_recovery_codes_user ON admin_recovery_codes (user_id);

CREATE TABLE admin_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES admin_users (id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  reauth_at INTEGER NOT NULL,
  ip_hash TEXT,
  user_agent TEXT
);

CREATE INDEX admin_sessions_user ON admin_sessions (user_id);

CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  user_id INTEGER,
  action TEXT NOT NULL,
  entity TEXT,
  entity_id TEXT,
  before_json TEXT,
  after_json TEXT,
  ip_hash TEXT
);

CREATE INDEX audit_log_at ON audit_log (at);

CREATE TABLE rate_limits (
  key TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (key, window_start)
);

CREATE TABLE songs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  spotify_uri TEXT NOT NULL UNIQUE,
  isrc TEXT,
  title TEXT NOT NULL,
  artist TEXT NOT NULL,
  album TEXT,
  image_url TEXT,
  duration_ms INTEGER NOT NULL CHECK (duration_ms > 0),
  explicit INTEGER NOT NULL DEFAULT 0,
  mood_level INTEGER CHECK (mood_level BETWEEN 1 AND 5),
  title_norm TEXT NOT NULL,
  artist_norm TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);

CREATE INDEX songs_isrc ON songs (isrc);
CREATE INDEX songs_norm ON songs (title_norm, artist_norm);

CREATE TABLE sets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  starts_at INTEGER NOT NULL,
  ends_at INTEGER NOT NULL CHECK (ends_at > starts_at),
  default_level INTEGER NOT NULL CHECK (default_level BETWEEN 1 AND 5),
  created_at INTEGER NOT NULL
);

CREATE TABLE set_songs (
  set_id INTEGER NOT NULL REFERENCES sets (id) ON DELETE CASCADE,
  song_id INTEGER NOT NULL REFERENCES songs (id) ON DELETE CASCADE,
  added_at INTEGER NOT NULL,
  PRIMARY KEY (set_id, song_id)
);

CREATE INDEX set_songs_song ON set_songs (song_id);

CREATE TABLE devices (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  verified INTEGER NOT NULL DEFAULT 0,
  fp_hash TEXT,
  ip_key TEXT,
  last_seen_at INTEGER NOT NULL
);

CREATE TABLE wishes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  song_id INTEGER NOT NULL REFERENCES songs (id),
  device_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open', 'approved', 'rejected', 'played')),
  created_at INTEGER NOT NULL,
  decided_at INTEGER,
  decided_by INTEGER
);

CREATE UNIQUE INDEX wishes_active_song ON wishes (song_id) WHERE status IN ('open', 'approved');
CREATE INDEX wishes_device ON wishes (device_id);
CREATE INDEX wishes_status ON wishes (status);

CREATE TABLE wish_upvotes (
  wish_id INTEGER NOT NULL REFERENCES wishes (id) ON DELETE CASCADE,
  device_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (wish_id, device_id)
);

CREATE TABLE rounds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  seq INTEGER NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('open', 'closed', 'skipped')),
  mood_level INTEGER NOT NULL CHECK (mood_level BETWEEN 1 AND 5),
  set_id INTEGER,
  opened_at INTEGER NOT NULL,
  close_at INTEGER,
  closed_at INTEGER,
  close_token TEXT,
  anchor_at INTEGER
);

CREATE UNIQUE INDEX rounds_single_open ON rounds (status) WHERE status = 'open';

CREATE TABLE round_candidates (
  round_id INTEGER NOT NULL REFERENCES rounds (id) ON DELETE CASCADE,
  song_id INTEGER NOT NULL REFERENCES songs (id),
  position INTEGER NOT NULL,
  tiebreak INTEGER NOT NULL,
  wish_id INTEGER,
  PRIMARY KEY (round_id, song_id)
);

CREATE TABLE votes (
  round_id INTEGER NOT NULL REFERENCES rounds (id) ON DELETE CASCADE,
  device_id TEXT NOT NULL,
  ip_key TEXT NOT NULL,
  fp_hash TEXT,
  song_id INTEGER NOT NULL,
  verified INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  invalidated INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (round_id, device_id)
);

CREATE INDEX votes_round_song ON votes (round_id, song_id);
CREATE INDEX votes_round_ip ON votes (round_id, ip_key);

CREATE TABLE playback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  seq INTEGER NOT NULL UNIQUE,
  round_id INTEGER,
  song_id INTEGER NOT NULL REFERENCES songs (id),
  source TEXT NOT NULL CHECK (source IN ('winner', 'manual')),
  position INTEGER NOT NULL,
  votes INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (
    status IN ('planned', 'queuing', 'queued', 'unknown', 'playing', 'played', 'skipped', 'missed', 'cancelled')
  ),
  claim TEXT,
  retry_at INTEGER,
  attempts INTEGER NOT NULL DEFAULT 0,
  queued_at INTEGER,
  started_at INTEGER,
  ended_at INTEGER,
  error TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX playback_status ON playback (status);
CREATE INDEX playback_round ON playback (round_id);
CREATE INDEX playback_song ON playback (song_id);

CREATE TABLE observed_plays (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  spotify_uri TEXT,
  title TEXT,
  artist TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('preshow', 'emergency'))
);

CREATE TABLE displays (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('tv', 'bar_stats', 'bar_ledger', 'player')),
  token_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  created_by INTEGER,
  last_seen_at INTEGER,
  revoked_at INTEGER
);

CREATE TABLE display_pairings (
  code TEXT PRIMARY KEY,
  secret_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  display_id INTEGER,
  token_enc TEXT
);

CREATE TABLE buzzer_events (
  event_id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  source_code TEXT,
  pressed_at INTEGER NOT NULL,
  received_at INTEGER NOT NULL,
  flagged INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX buzzer_events_pressed ON buzzer_events (pressed_at);

CREATE TABLE ledger_accounts (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('asset', 'liability', 'expense', 'income', 'equity'))
);

INSERT INTO ledger_accounts (code, name, type) VALUES
  ('3980', 'Getränkevorrat Fete', 'asset'),
  ('4140', 'Freiwillige soziale Aufwendungen (Betriebsveranstaltung)', 'expense'),
  ('1600', 'Verbindlichkeiten aus Lieferungen und Leistungen', 'liability'),
  ('1000', 'Kasse', 'asset');

CREATE TABLE ledger_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booked_at INTEGER NOT NULL,
  effective_at INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('consumption', 'purchase', 'manual', 'reversal')),
  debit_account TEXT NOT NULL REFERENCES ledger_accounts (code),
  credit_account TEXT NOT NULL REFERENCES ledger_accounts (code),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  quantity INTEGER NOT NULL DEFAULT 0,
  text TEXT NOT NULL,
  ref_type TEXT,
  ref_id TEXT,
  reversal_of INTEGER UNIQUE REFERENCES ledger_entries (id),
  created_by INTEGER,
  CHECK (debit_account <> credit_account),
  UNIQUE (ref_type, ref_id)
);

CREATE INDEX ledger_entries_effective ON ledger_entries (effective_at);

CREATE TABLE stat_buckets (
  bucket_start INTEGER PRIMARY KEY,
  crates INTEGER NOT NULL,
  cost_cents INTEGER NOT NULL
);

CREATE TABLE search_cache (
  query TEXT PRIMARY KEY,
  results TEXT NOT NULL,
  fetched_at INTEGER NOT NULL
);
