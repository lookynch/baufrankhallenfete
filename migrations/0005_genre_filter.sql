ALTER TABLE songs ADD COLUMN artist_key TEXT;
ALTER TABLE songs ADD COLUMN auto_level INTEGER CHECK (auto_level BETWEEN 1 AND 5);
ALTER TABLE songs ADD COLUMN blocked_tag TEXT;
ALTER TABLE songs ADD COLUMN vetoed INTEGER NOT NULL DEFAULT 0;

ALTER TABLE set_songs ADD COLUMN source TEXT NOT NULL DEFAULT 'admin' CHECK (source IN ('admin', 'wish'));

CREATE TABLE artist_tags (
  artist_key TEXT PRIMARY KEY,
  tags TEXT NOT NULL,
  fetched_at INTEGER NOT NULL,
  failures INTEGER NOT NULL DEFAULT 0,
  failed_until INTEGER
);

CREATE INDEX wishes_device_created ON wishes (device_id, created_at);

DELETE FROM search_cache;

UPDATE kv SET value = '5' WHERE key = 'schema_version';
