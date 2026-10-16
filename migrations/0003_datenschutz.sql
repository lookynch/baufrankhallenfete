UPDATE devices SET fp_hash = NULL WHERE fp_hash IS NOT NULL;

UPDATE votes SET fp_hash = NULL WHERE fp_hash IS NOT NULL;

UPDATE admin_sessions SET ip_hash = NULL, user_agent = NULL WHERE ip_hash IS NOT NULL OR user_agent IS NOT NULL;

UPDATE audit_log SET entity_id = substr(entity_id, 1, instr(entity_id, ':') - 1)
WHERE action = 'ratelimit_clear' AND instr(entity_id, ':') > 0;

DELETE FROM rate_limits WHERE key LIKE 'login:%';

UPDATE kv SET value = '3' WHERE key = 'schema_version';
