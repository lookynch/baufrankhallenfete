import type { Settings } from '../../shared/settings.ts';

export const BUCKET_MS = 15 * 60_000;

export class LedgerError extends Error {}

export interface LedgerEntry {
  id: number;
  booking_no: string;
  booked_at: number;
  effective_at: number;
  kind: 'consumption' | 'purchase' | 'manual' | 'reversal';
  debit_account: string;
  credit_account: string;
  amount_cents: number;
  quantity: number;
  text: string;
  reversal_of: number | null;
  reversed_by: number | null;
  created_by: number | null;
  created_by_name: string | null;
}

export function bookingNo(id: number): string {
  return `BF-${String(id).padStart(4, '0')}`;
}

export function bucketOf(at: number): number {
  return Math.floor(at / BUCKET_MS) * BUCKET_MS;
}

export function bucketStatement(db: D1Database, bucketStart: number): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO stat_buckets (bucket_start, crates, cost_cents)
       SELECT ?1, COALESCE(SUM(quantity), 0),
              COALESCE(SUM(CASE WHEN quantity > 0 THEN amount_cents WHEN quantity < 0 THEN -amount_cents ELSE 0 END), 0)
       FROM ledger_entries WHERE effective_at >= ?1 AND effective_at < ?2 AND quantity <> 0
       ON CONFLICT (bucket_start) DO UPDATE SET crates = excluded.crates, cost_cents = excluded.cost_cents`,
    )
    .bind(bucketStart, bucketStart + BUCKET_MS);
}

export interface BuzzerBooking {
  eventId: string;
  agentId: string;
  sourceCode: string | null;
  pressedAt: number;
  receivedAt: number;
}

export async function bookBuzzerPress(
  db: D1Database,
  settings: Settings,
  press: BuzzerBooking,
): Promise<{ status: 'accepted' | 'duplicate'; bookingNo: string | null; flagged: boolean }> {
  const reviewMs = settings.buzzer.reviewIntervalSeconds * 1000;
  const results = await db.batch([
    db
      .prepare(
        `INSERT OR IGNORE INTO buzzer_events (event_id, agent_id, source_code, pressed_at, received_at, flagged)
         SELECT ?1, ?2, ?3, ?4, ?5,
                EXISTS (SELECT 1 FROM buzzer_events WHERE pressed_at > ?4 - ?6 AND pressed_at < ?4 + ?6)`,
      )
      .bind(press.eventId, press.agentId, press.sourceCode, press.pressedAt, press.receivedAt, reviewMs),
    db
      .prepare(
        `INSERT OR IGNORE INTO ledger_entries
           (booked_at, effective_at, kind, debit_account, credit_account, amount_cents, quantity, text, ref_type, ref_id)
         VALUES (?1, ?2, 'consumption', ?3, ?4, ?5, 1, 'Kasten Getränke (Buzzer)', 'buzzer', ?6)`,
      )
      .bind(
        press.receivedAt,
        press.pressedAt,
        settings.ledger.expenseAccount,
        settings.ledger.inventoryAccount,
        settings.ledger.cratePriceCents,
        press.eventId,
      ),
    bucketStatement(db, bucketOf(press.pressedAt)),
  ]);
  const row = await db
    .prepare(
      `SELECT e.id, b.flagged FROM ledger_entries e JOIN buzzer_events b ON b.event_id = e.ref_id
       WHERE e.ref_type = 'buzzer' AND e.ref_id = ?1`,
    )
    .bind(press.eventId)
    .first<{ id: number; flagged: number }>();
  return {
    status: (results[0]?.meta.changes ?? 0) === 1 ? 'accepted' : 'duplicate',
    bookingNo: row ? bookingNo(row.id) : null,
    flagged: row?.flagged === 1,
  };
}

export interface ManualEntryInput {
  kind: 'consumption' | 'purchase' | 'manual';
  debitAccount: string;
  creditAccount: string;
  amountCents: number;
  quantity: number;
  text: string;
  effectiveAt: number;
}

export async function bookManual(db: D1Database, input: ManualEntryInput, userId: number, now: number): Promise<number> {
  if (input.debitAccount === input.creditAccount) throw new LedgerError('same_account');
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) throw new LedgerError('invalid_amount');
  const quantity = input.kind === 'consumption' ? Math.max(1, input.quantity) : 0;
  const accounts = await db
    .prepare('SELECT COUNT(*) AS n FROM ledger_accounts WHERE code IN (?1, ?2)')
    .bind(input.debitAccount, input.creditAccount)
    .first<{ n: number }>();
  if ((accounts?.n ?? 0) !== 2) throw new LedgerError('unknown_account');
  const results = await db.batch([
    db
      .prepare(
        `INSERT INTO ledger_entries (booked_at, effective_at, kind, debit_account, credit_account, amount_cents, quantity, text, created_by)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9) RETURNING id`,
      )
      .bind(now, input.effectiveAt, input.kind, input.debitAccount, input.creditAccount, input.amountCents, quantity, input.text, userId),
    bucketStatement(db, bucketOf(input.effectiveAt)),
  ]);
  const id = (results[0]?.results[0] as { id: number } | undefined)?.id;
  if (!id) throw new LedgerError('not_booked');
  return id;
}

export async function reverseEntry(db: D1Database, entryId: number, userId: number, now: number, reason: string): Promise<number> {
  const original = await db
    .prepare('SELECT * FROM ledger_entries WHERE id = ?1')
    .bind(entryId)
    .first<LedgerEntry & { ref_type: string | null }>();
  if (!original) throw new LedgerError('entry_not_found');
  if (original.kind === 'reversal') throw new LedgerError('cannot_reverse_reversal');
  const results = await db.batch([
    db
      .prepare(
        `INSERT OR IGNORE INTO ledger_entries
           (booked_at, effective_at, kind, debit_account, credit_account, amount_cents, quantity, text, ref_type, ref_id, reversal_of, created_by)
         VALUES (?1, ?2, 'reversal', ?3, ?4, ?5, ?6, ?7, 'reversal', ?8, ?8, ?9) RETURNING id`,
      )
      .bind(
        now,
        original.effective_at,
        original.credit_account,
        original.debit_account,
        original.amount_cents,
        -original.quantity,
        `Storno ${bookingNo(original.id)}: ${reason}`.slice(0, 200),
        String(original.id),
        userId,
      ),
    bucketStatement(db, bucketOf(original.effective_at)),
  ]);
  const id = (results[0]?.results[0] as { id: number } | undefined)?.id;
  if (!id) throw new LedgerError('already_reversed');
  return id;
}

export async function journal(db: D1Database, limit: number): Promise<LedgerEntry[]> {
  const { results } = await db
    .prepare(
      `SELECT e.id, e.booked_at, e.effective_at, e.kind, e.debit_account, e.credit_account, e.amount_cents, e.quantity, e.text,
              e.reversal_of, r.id AS reversed_by, e.created_by, u.display_name AS created_by_name
       FROM ledger_entries e
       LEFT JOIN ledger_entries r ON r.reversal_of = e.id
       LEFT JOIN admin_users u ON u.id = e.created_by
       ORDER BY e.id DESC LIMIT ?1`,
    )
    .bind(limit)
    .all<Omit<LedgerEntry, 'booking_no'>>();
  return results.map((e) => ({ ...e, booking_no: bookingNo(e.id) }));
}

export interface AccountBalance {
  code: string;
  name: string;
  type: string;
  debit_cents: number;
  credit_cents: number;
}

export async function accountBalances(db: D1Database): Promise<AccountBalance[]> {
  const { results } = await db
    .prepare(
      `SELECT a.code, a.name, a.type,
              COALESCE((SELECT SUM(amount_cents) FROM ledger_entries WHERE debit_account = a.code), 0) AS debit_cents,
              COALESCE((SELECT SUM(amount_cents) FROM ledger_entries WHERE credit_account = a.code), 0) AS credit_cents
       FROM ledger_accounts a ORDER BY a.code`,
    )
    .all<AccountBalance>();
  return results;
}

export interface Bucket {
  bucket_start: number;
  crates: number;
  cost_cents: number;
}

export async function buckets(db: D1Database, from: number, to: number): Promise<Bucket[]> {
  const { results } = await db
    .prepare('SELECT bucket_start, crates, cost_cents FROM stat_buckets WHERE bucket_start >= ?1 AND bucket_start < ?2 ORDER BY bucket_start')
    .bind(bucketOf(from), to)
    .all<Bucket>();
  return results;
}

export interface ConsumptionStats {
  totalCrates: number;
  totalCostCents: number;
  cratesLastHour: number;
  ratePerHour: number;
  forecastCrates: number;
  forecastCostCents: number;
  peakBucket: Bucket | null;
  series: Array<{ at: number; crates: number; cumulative: number; costCents: number }>;
}

export function consumptionStats(rows: Bucket[], settings: Settings, now: number): ConsumptionStats {
  const start = bucketOf(Math.min(settings.event.startsAt, rows[0]?.bucket_start ?? settings.event.startsAt));
  const end = Math.max(bucketOf(Math.min(now, settings.event.endsAt)), start);
  const byStart = new Map(rows.map((r) => [r.bucket_start, r]));
  const series: ConsumptionStats['series'] = [];
  let cumulative = 0;
  for (let at = start; at <= end; at += BUCKET_MS) {
    const row = byStart.get(at);
    cumulative += row?.crates ?? 0;
    series.push({ at, crates: row?.crates ?? 0, cumulative, costCents: row?.cost_cents ?? 0 });
  }
  const totalCrates = rows.reduce((s, r) => s + r.crates, 0);
  const totalCostCents = rows.reduce((s, r) => s + r.cost_cents, 0);
  const cratesLastHour = rows.filter((r) => r.bucket_start >= now - 3_600_000).reduce((s, r) => s + r.crates, 0);
  const elapsedHours = Math.max(0.25, (Math.min(now, settings.event.endsAt) - settings.event.startsAt) / 3_600_000);
  const ratePerHour = cratesLastHour > 0 ? cratesLastHour : totalCrates / elapsedHours;
  const remainingHours = Math.max(0, (settings.event.endsAt - now) / 3_600_000);
  const forecastCrates = Math.round(totalCrates + ratePerHour * remainingHours);
  const peakBucket = rows.reduce<Bucket | null>((best, r) => (!best || r.crates > best.crates ? r : best), null);
  return {
    totalCrates,
    totalCostCents,
    cratesLastHour,
    ratePerHour: Math.round(ratePerHour * 10) / 10,
    forecastCrates,
    forecastCostCents: forecastCrates * settings.ledger.cratePriceCents,
    peakBucket: peakBucket && peakBucket.crates > 0 ? peakBucket : null,
    series,
  };
}
