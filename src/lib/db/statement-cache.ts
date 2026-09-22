// A small least-recently-used map from SQL text to a prepared statement.
// Both engine wrappers in driver.ts keep one per open database, so the
// hundreds of inline `getDatabase().prepare(...)` sites stop compiling the
// same SQL on every call. SQLite re-prepares a statement itself when the
// schema changes underneath it (sqlite3_prepare_v2 semantics), so an entry
// stays valid across ensureSchema's ALTERs; a dropped table fails on the
// next step exactly as a fresh prepare would.

export const DEFAULT_STATEMENT_CACHE_SIZE = 500;

export class StatementCache<T> {
  private readonly entries = new Map<string, T>();
  private readonly capacity: number;

  constructor(capacity = DEFAULT_STATEMENT_CACHE_SIZE) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new Error("StatementCache capacity must be a positive integer.");
    }
    this.capacity = capacity;
  }

  get size(): number {
    return this.entries.size;
  }

  has(sql: string): boolean {
    return this.entries.has(sql);
  }

  // The cached statement for this SQL, or a freshly made one that is then
  // remembered. A hit is moved to the most recent end; the least recent
  // entry goes when the cache is full.
  take(sql: string, prepare: (sql: string) => T): T {
    const hit = this.entries.get(sql);
    if (hit !== undefined) {
      this.entries.delete(sql);
      this.entries.set(sql, hit);
      return hit;
    }
    const statement = prepare(sql);
    this.entries.set(sql, statement);
    if (this.entries.size > this.capacity) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) {
        this.entries.delete(oldest);
      }
    }
    return statement;
  }

  clear(): void {
    this.entries.clear();
  }
}
