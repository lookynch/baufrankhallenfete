export interface AuditEntry {
  userId: number | null;
  action: string;
  entity?: string;
  entityId?: string | number | null;
  before?: unknown;
  after?: unknown;
  ipHash?: string | null;
}

export function auditStatement(db: D1Database, now: number, entry: AuditEntry): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO audit_log (at, user_id, action, entity, entity_id, before_json, after_json, ip_hash)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
    )
    .bind(
      now,
      entry.userId,
      entry.action,
      entry.entity ?? null,
      entry.entityId === undefined || entry.entityId === null ? null : String(entry.entityId),
      entry.before === undefined ? null : JSON.stringify(entry.before),
      entry.after === undefined ? null : JSON.stringify(entry.after),
      entry.ipHash ?? null,
    );
}

export async function audit(db: D1Database, now: number, entry: AuditEntry): Promise<void> {
  await auditStatement(db, now, entry).run();
}
