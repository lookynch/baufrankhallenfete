ALTER TABLE playback ADD COLUMN wish_id INTEGER REFERENCES wishes (id);

CREATE INDEX playback_wish ON playback (wish_id);
CREATE INDEX wishes_status_device ON wishes (status, device_id, created_at);

UPDATE kv SET value = '6' WHERE key = 'schema_version';
