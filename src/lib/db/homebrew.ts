import { getDatabase, nowIso, parseJson } from "@/lib/db/core";
import { gearFromHomebrewData } from "@/lib/homebrew/gear";
import type { CreateHomebrewInput, HomebrewKind } from "@/lib/schemas/homebrew";
import type { EquipmentItem } from "@/lib/schemas/sheet";

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

// A sheet's equipment with every homebrew item's mechanics snapshotted onto
// its line (src/lib/homebrew/gear.ts). Matched by slug first, then by name
// against the owner's own items, so a line typed by hand still finds the
// entry it was named after. Run on every read, so an item edited in the
// workshop reaches the sheets that carry it; an entry that has been deleted
// leaves its last snapshot in place rather than stripping a sword mid-fight.
export function hydrateHomebrewGear(userId: string, equipment: EquipmentItem[]): EquipmentItem[] {
  if (!equipment.length) {
    return equipment;
  }
  let items: HomebrewEntry[] | null = null;
  const load = () => (items ??= listHomebrew(userId, "item"));
  return equipment.map((item) => {
    const slugId = item.slug?.startsWith("homebrew:") ? item.slug.slice("homebrew:".length) : null;
    const wanted = item.name.trim().toLowerCase();
    const entry = slugId
      ? load().find((candidate) => candidate.id === slugId)
      : load().find((candidate) => candidate.name.trim().toLowerCase() === wanted);
    if (!entry) {
      return item;
    }
    const gear = gearFromHomebrewData(entry.name, entry.data);
    if (!gear) {
      return item.gear ? { ...item, gear: undefined } : item;
    }
    return {
      ...item,
      gear,
      ...(item.weight === undefined && gear.weight !== undefined ? { weight: gear.weight } : {}),
    };
  });
}

export function deleteHomebrew(userId: string, id: string): boolean {
  const result = getDatabase()
    .prepare(`DELETE FROM homebrew_entries WHERE id = ? AND user_id = ?`)
    .run(id, userId);
  return result.changes > 0;
}
