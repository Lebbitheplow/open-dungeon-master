import { getDatabase, nowIso, parseJson } from "@/lib/db/core";
import type { CreateHomebrewInput, HomebrewKind } from "@/lib/schemas/homebrew";

export type HomebrewEntry = {
  id: string;
  userId: string;
  kind: HomebrewKind;
  slug: string;
  name: string;
  data: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

type HomebrewRow = {
  id: string;
  user_id: string;
  kind: HomebrewKind;
  slug: string;
  name: string;
  data_json: string;
  created_at: string;
  updated_at: string;
};

function mapEntry(row: HomebrewRow): HomebrewEntry {
  return {
    id: row.id,
    userId: row.user_id,
    kind: row.kind,
    slug: row.slug,
    name: row.name,
    data: parseJson<Record<string, unknown>>(row.data_json, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function slugify(value: string) {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "entry"
  );
}

export function listHomebrew(userId: string, kind?: HomebrewKind): HomebrewEntry[] {
  const db = getDatabase();
  const rows = (
    kind
      ? db
          .prepare(`SELECT * FROM homebrew_entries WHERE user_id = ? AND kind = ? ORDER BY name`)
          .all(userId, kind)
      : db.prepare(`SELECT * FROM homebrew_entries WHERE user_id = ? ORDER BY kind, name`).all(userId)
  ) as HomebrewRow[];
  return rows.map(mapEntry);
}

export function getHomebrew(userId: string, id: string): HomebrewEntry | null {
  const row = getDatabase()
    .prepare(`SELECT * FROM homebrew_entries WHERE id = ? AND user_id = ?`)
    .get(id, userId) as HomebrewRow | undefined;
  return row ? mapEntry(row) : null;
}

export function createHomebrew(userId: string, input: CreateHomebrewInput): HomebrewEntry {
  const db = getDatabase();
  const id = crypto.randomUUID();
  const base = slugify(input.name);
  // Keep the (user, kind, slug) key unique by suffixing on collision.
  let slug = base;
  for (let attempt = 2; attempt < 50; attempt += 1) {
    const clash = db
      .prepare(`SELECT 1 FROM homebrew_entries WHERE user_id = ? AND kind = ? AND slug = ?`)
      .get(userId, input.kind, slug);
    if (!clash) {
      break;
    }
    slug = `${base}-${attempt}`;
  }
  const now = nowIso();
  db.prepare(
    `
      INSERT INTO homebrew_entries (id, user_id, kind, slug, name, data_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
  ).run(id, userId, input.kind, slug, input.name, JSON.stringify(input.data), now, now);
  const entry = getHomebrew(userId, id);
  if (!entry) {
    throw new Error("Failed to create homebrew entry.");
  }
  return entry;
}

export function updateHomebrew(
  userId: string,
  id: string,
  patch: { name?: string; data?: Record<string, unknown> },
): HomebrewEntry | null {
  const existing = getHomebrew(userId, id);
  if (!existing) {
    return null;
  }
  getDatabase()
    .prepare(`UPDATE homebrew_entries SET name = ?, data_json = ?, updated_at = ? WHERE id = ?`)
    .run(
      patch.name ?? existing.name,
      JSON.stringify(patch.data ?? existing.data),
      nowIso(),
      id,
    );
  return getHomebrew(userId, id);
}

export function deleteHomebrew(userId: string, id: string): boolean {
  const result = getDatabase()
    .prepare(`DELETE FROM homebrew_entries WHERE id = ? AND user_id = ?`)
    .run(id, userId);
  return result.changes > 0;
}
