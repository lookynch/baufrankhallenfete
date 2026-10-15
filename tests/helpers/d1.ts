import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

type Row = Record<string, unknown>;

class TestStatement {
  constructor(
    private readonly db: DatabaseSync,
    readonly sql: string,
    readonly params: SQLInputValue[] = [],
  ) {}

  bind(...values: unknown[]): TestStatement {
    return new TestStatement(this.db, this.sql, values.map(toSqlValue));
  }

  async first<T = Row>(column?: string): Promise<T | null> {
    const row = this.db.prepare(this.sql).get(...this.params) as Row | undefined;
    if (!row) return null;
    return (column ? row[column] : { ...row }) as T;
  }

  async all<T = Row>() {
    return this.allSync<T>();
  }

  allSync<T = Row>() {
    const stmt = this.db.prepare(this.sql);
    if (stmt.columns().length === 0) {
      const info = stmt.run(...this.params);
      return { success: true, results: [] as T[], meta: meta(info.changes, info.lastInsertRowid) };
    }
    const results = stmt.all(...this.params).map((r) => ({ ...r })) as T[];
    const changes = (this.db.prepare('SELECT changes() AS c').get() as { c: number }).c;
    const lastId = (this.db.prepare('SELECT last_insert_rowid() AS id').get() as { id: number }).id;
    return { success: true, results, meta: meta(isWrite(this.sql) ? changes : 0, lastId) };
  }

  async run() {
    return this.allSync();
  }

  async raw<T = unknown[]>(): Promise<T[]> {
    const stmt = this.db.prepare(this.sql);
    stmt.setReturnArrays(true);
    return stmt.all(...this.params) as T[];
  }
}

function isWrite(sql: string): boolean {
  return /^\s*(insert|update|delete|replace|with)/i.test(sql);
}

function meta(changes: number | bigint, lastRowId: number | bigint) {
  return { changes: Number(changes), last_row_id: Number(lastRowId), duration: 0, rows_read: 0, rows_written: 0 };
}

function toSqlValue(value: unknown): SQLInputValue {
  if (value === undefined) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  return value as SQLInputValue;
}

export class TestD1 {
  readonly db: DatabaseSync;

  constructor() {
    this.db = new DatabaseSync(':memory:');
    this.db.exec('PRAGMA foreign_keys = ON;');
  }

  prepare(sql: string): TestStatement {
    return new TestStatement(this.db, sql);
  }

  async batch(statements: TestStatement[]) {
    this.db.exec('BEGIN');
    try {
      const results = statements.map((s) => s.allSync());
      this.db.exec('COMMIT');
      return results;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  async exec(sql: string) {
    this.db.exec(sql);
    return { count: 0, duration: 0 };
  }
}

export function createTestDb(): D1Database {
  const d1 = new TestD1();
  const dir = join(import.meta.dirname, '..', '..', 'migrations');
  for (const file of readdirSync(dir).sort()) {
    if (file.endsWith('.sql')) d1.db.exec(readFileSync(join(dir, file), 'utf8'));
  }
  return d1 as unknown as D1Database;
}
