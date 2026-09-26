// The broker's storage: one SQLite table inside a Durable Object, exposed
// to the handlers in src/broker.js with the shape of Workers KV, which is
// where the broker lived until 2026-09-26.

// ---------- the store ----------
//
// SqlStore gives the handlers the KV shape over one SQLite table. exec is
// injected: in the Durable Object it is ctx.storage.sql.exec(...).toArray(),
// in tests it is node:sqlite. Expired rows are invisible from the moment
// they expire and swept by the cron.
export class SqlStore {
  constructor(exec) {
    this.exec = exec;
    this.exec(
      "CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL, expires_at INTEGER)",
    );
    this.exec("CREATE INDEX IF NOT EXISTS kv_expires ON kv (expires_at)");
  }
  async get(key) {
    const rows = this.exec(
      "SELECT value FROM kv WHERE key = ? AND (expires_at IS NULL OR expires_at > ?)",
      key,
      Date.now(),
    );
    return rows.length > 0 ? rows[0].value : null;
  }
  async put(key, value, options = {}) {
    const ttl = Number(options.expirationTtl);
    const expiresAt = Number.isFinite(ttl) && ttl > 0 ? Date.now() + ttl * 1000 : null;
    this.exec(
      "INSERT INTO kv (key, value, expires_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at",
      key,
      String(value),
      expiresAt,
    );
  }
  async delete(key) {
    this.exec("DELETE FROM kv WHERE key = ?", key);
  }
  async list({ prefix = "" } = {}) {
    const rows = this.exec(
      "SELECT key FROM kv WHERE substr(key, 1, ?) = ? AND (expires_at IS NULL OR expires_at > ?) ORDER BY key",
      prefix.length,
      prefix,
      Date.now(),
    );
    return { keys: rows.map((row) => ({ name: row.key })) };
  }
  // The cron's sweep. Returns how many rows went.
  async sweep() {
    const before = this.exec("SELECT count(*) AS n FROM kv WHERE expires_at IS NOT NULL AND expires_at <= ?", Date.now());
    this.exec("DELETE FROM kv WHERE expires_at IS NOT NULL AND expires_at <= ?", Date.now());
    return Number(before[0]?.n ?? 0);
  }
}

// The one-time move off Workers KV: every table claim (a host's secret and
// where it points), every live session (so the cron still tears its tunnel
// down), and the cached zone id. Runs once, marked by a row, and is a no-op
// without the legacy binding. KV's own rows expire on their own.
export async function importLegacy(store, kv) {
  if (!kv || (await store.get("legacy-imported"))) return 0;
  let moved = 0;
  for (const prefix of ["table:", "session:"]) {
    const list = await kv.list({ prefix });
    for (const key of list.keys) {
      const value = await kv.get(key.name);
      if (value === null || value === undefined) continue;
      const ttl = key.expiration ? Math.max(60, key.expiration - Math.floor(Date.now() / 1000)) : undefined;
      await store.put(key.name, value, ttl ? { expirationTtl: ttl } : {});
      moved += 1;
    }
  }
  const zone = await kv.get("zone-id");
  if (zone) await store.put("zone-id", zone);
  await store.put("legacy-imported", new Date().toISOString());
  return moved;
}

