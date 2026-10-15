ALTER TABLE votes ADD COLUMN net_key TEXT;

CREATE INDEX votes_round_net ON votes (round_id, net_key);

ALTER TABLE wish_upvotes ADD COLUMN ip_key TEXT;

CREATE INDEX wish_upvotes_ip ON wish_upvotes (wish_id, ip_key);

ALTER TABLE rounds ADD COLUMN min_close_at INTEGER;

UPDATE kv SET value = '2' WHERE key = 'schema_version';
