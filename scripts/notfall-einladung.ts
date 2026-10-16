import { INVITE_TTL_MS } from '../src/server/routes/admin/auth.ts';
import { randomToken, sha256Hex } from '../src/server/security/crypto.ts';

const [username = '', displayName = username] = process.argv.slice(2);
if (!/^[a-zA-Z0-9._-]{3,40}$/.test(username)) {
  console.error('Aufruf: node scripts/notfall-einladung.ts <benutzername> [anzeigename]');
  process.exit(1);
}

const token = randomToken(32);
const now = Date.now();
const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
const sql = `INSERT INTO admin_invites (token_hash, username, display_name, role, created_at, expires_at) VALUES (${quote(await sha256Hex(token))}, ${quote(username)}, ${quote(displayName)}, 'owner', ${now}, ${now + INVITE_TTL_MS})`;
const origin = process.env.PRODUCTION_URL ?? 'https://<projekt>.pages.dev';

console.info(`npx wrangler d1 execute fete --remote --command "${sql}"`);
console.info(
  `\nDanach diesen Link öffnen (24 h gültig, setzt den Zugang als Owner zurück):\n${origin}/admin/invite#${token}`,
);
