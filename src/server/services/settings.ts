import { defaultSettings, settingsSchemas, type Settings, type SettingsKey } from '../../shared/settings.ts';

export class SettingsError extends Error {}

export async function loadSettings(db: D1Database, now: number): Promise<Settings> {
  const settings = defaultSettings(now);
  const { results } = await db.prepare('SELECT key, value FROM settings').all<{ key: string; value: string }>();
  for (const row of results) {
    if (!(row.key in settingsSchemas)) continue;
    const key = row.key as SettingsKey;
    try {
      const parsed = settingsSchemas[key].safeParse({ ...settings[key], ...JSON.parse(row.value) });
      if (parsed.success) (settings as Record<SettingsKey, unknown>)[key] = parsed.data;
    } catch {
      continue;
    }
  }
  return settings;
}

export function validateSettings(settings: Settings): void {
  if (settings.event.endsAt <= settings.event.startsAt) throw new SettingsError('event_end_before_start');
  if (settings.voting.endsAt !== null && settings.voting.endsAt <= settings.voting.startsAt) {
    throw new SettingsError('voting_end_before_start');
  }
  const { inventoryAccount, expenseAccount, payableAccount } = settings.ledger;
  if (new Set([inventoryAccount, expenseAccount, payableAccount]).size !== 3) {
    throw new SettingsError('ledger_accounts_must_differ');
  }
}

async function assertLedgerAccountsExist(db: D1Database, ledger: Settings['ledger']): Promise<void> {
  const codes = [ledger.inventoryAccount, ledger.expenseAccount, ledger.payableAccount];
  const row = await db
    .prepare('SELECT COUNT(*) AS n FROM ledger_accounts WHERE code IN (?1, ?2, ?3)')
    .bind(...codes)
    .first<{ n: number }>();
  if ((row?.n ?? 0) !== codes.length) throw new SettingsError('unknown_ledger_account');
}

export async function saveSettings<K extends SettingsKey>(
  db: D1Database,
  key: K,
  patch: Partial<Settings[K]>,
  now: number,
  userId: number | null,
): Promise<{ before: Settings[K]; after: Settings[K] }> {
  const current = await loadSettings(db, now);
  const before = current[key];
  const parsed = settingsSchemas[key].safeParse({ ...before, ...patch });
  if (!parsed.success)
    throw new SettingsError(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  const after = parsed.data as Settings[K];
  const next = { ...current, [key]: after };
  validateSettings(next);
  if (key === 'ledger') await assertLedgerAccountsExist(db, next.ledger);
  await db
    .prepare(
      `INSERT INTO settings (key, value, updated_at, updated_by) VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
    )
    .bind(key, JSON.stringify(after), now, userId)
    .run();
  return { before, after };
}
