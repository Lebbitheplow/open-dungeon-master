import { getDatabase, nowIso, parseJson } from "@/lib/db/core";
import { getContentDb } from "@/lib/content/db";
import { gearFromHomebrewData } from "@/lib/homebrew/gear";
import { SRD_ARMOR } from "@/lib/srd/armor";
import { matchMagicItem } from "@/lib/srd/magic-items";
import { SRD_WEAPONS } from "@/lib/srd/weapons";
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
  // When its author forgot it, or null. A forgotten entry is off the shelf
  // and out of every picker; what already carries it keeps its rules.
  archivedAt: string | null;
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
  archived_at?: string | null;
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
    archivedAt: row.archived_at ?? null,
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

// A user's shelf. `archived`: false (the default) leaves forgotten entries
// out, which is what every picker and list wants; true reads them too, for
// play, where a sheet or a table that already carries one keeps its rules;
// "only" lists the forgotten ones, for the shelf's Forgotten view.
export function listHomebrew(userId: string, kind?: HomebrewKind, options: { archived?: boolean | "only" } = {}): HomebrewEntry[] {
  const db = getDatabase();
  const archived = options.archived ?? false;
  const filter = archived === "only" ? " AND archived_at IS NOT NULL" : archived ? "" : " AND archived_at IS NULL";
  const rows = (
    kind
      ? db
          .prepare(`SELECT * FROM homebrew_entries WHERE user_id = ? AND kind = ?${filter} ORDER BY name`)
          .all(userId, kind)
      : db.prepare(`SELECT * FROM homebrew_entries WHERE user_id = ?${filter} ORDER BY kind, name`).all(userId)
  ) as HomebrewRow[];
  // A live entry is listed before a forgotten one of the same name, so the
  // first match by name is always the live one.
  return rows.map(mapEntry).sort((a, b) => Number(Boolean(a.archivedAt)) - Number(Boolean(b.archivedAt)));
}

export function getHomebrew(userId: string, id: string): HomebrewEntry | null {
  const row = getDatabase()
    .prepare(`SELECT * FROM homebrew_entries WHERE id = ? AND user_id = ?`)
    .get(id, userId) as HomebrewRow | undefined;
  return row ? mapEntry(row) : null;
}

// An entry of one of these authors by kind and slug (the slug createHomebrew
// derives from the name), the first author's first; forgotten ones too,
// since what reads a name in play still answers for it.
export function findHomebrewBySlug(userIds: string[], kind: HomebrewKind, slug: string): HomebrewEntry | null {
  const wanted = slug.trim().toLowerCase();
  for (const userId of [...new Set(userIds.filter(Boolean))]) {
    const row = getDatabase()
      .prepare(`SELECT * FROM homebrew_entries WHERE user_id = ? AND kind = ? AND slug = ? ORDER BY archived_at IS NOT NULL LIMIT 1`)
      .get(userId, kind, wanted) as HomebrewRow | undefined;
    if (row) {
      return mapEntry(row);
    }
  }
  return null;
}

// An entry by id when it belongs to one of these authors.
export function getAuthorsHomebrew(userIds: string[], id: string): HomebrewEntry | null {
  for (const userId of [...new Set(userIds.filter(Boolean))]) {
    const entry = getHomebrew(userId, id);
    if (entry) {
      return entry;
    }
  }
  return null;
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

// ---- homebrew gear on a sheet ----

function nameKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/[+-]\d+/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

let packItemNames: Set<string> | null = null;

// Every item name the content pack publishes, keyed like nameKey. Read once;
// an install without the pack has only the bundled tables to go by.
function publishedPackNames(): Set<string> {
  if (packItemNames) {
    return packItemNames;
  }
  const names = new Set<string>();
  const db = getContentDb();
  if (db) {
    for (const row of db.prepare(`SELECT name FROM items`).all() as Array<{ name: string }>) {
      names.add(nameKey(row.name));
    }
  }
  packItemNames = names;
  return names;
}

// Whether a name belongs to gear the game already publishes: an SRD weapon
// or suit of armor, a magic item, or an item in the content pack. A homebrew
// entry may share such a name in the workshop, and it never changes what the
// published thing does on a sheet: a dagger is 1d4 at every table.
export function isPublishedGearName(name: string): boolean {
  const key = nameKey(name);
  if (!key) {
    return false;
  }
  return (
    SRD_WEAPONS.some((weapon) => nameKey(weapon.name) === key) ||
    SRD_ARMOR.some((armor) => nameKey(armor.name) === key) ||
    matchMagicItem(name) !== null ||
    publishedPackNames().has(key)
  );
}

// Whose workshop counts at a table: whoever runs it. The owner made the
// campaign and the DM seats referee it; a player's own entries are theirs to
// write and the table's to admit, which a DM does by keeping the entry.
export function tableAuthors(campaignId: string): string[] {
  const row = getDatabase()
    .prepare(
      `SELECT owner_user_id, human_dm_user_id, assistant_dm_user_id FROM campaigns WHERE id = ?`,
    )
    .get(campaignId) as
    | { owner_user_id: string; human_dm_user_id: string | null; assistant_dm_user_id: string | null }
    | undefined;
  if (!row) {
    return [];
  }
  return [
    ...new Set(
      [row.owner_user_id, row.human_dm_user_id, row.assistant_dm_user_id].filter(
        (id): id is string => Boolean(id),
      ),
    ),
  ];
}

// A sheet's equipment with every homebrew item's mechanics snapshotted onto
// its line (src/lib/homebrew/gear.ts). Run on every read, so an item edited
// in the workshop reaches the sheets that carry it.
//
// The snapshot is the server's to write and is rebuilt here from the stored
// entry each time: whatever `gear` a row arrived with is dropped first, so a
// block sent by a client, or left behind by an entry since deleted, gives
// nothing. A row finds its entry by its `homebrew:` slug, or by its name when
// that name is not published gear's.
//
// `table.campaignId` names the table the sheet is played at. In play only the
// entries of whoever runs that table have mechanics; without it (a library
// character, outside any campaign) the sheet owner's own entries are read.
export function hydrateHomebrewGear(
  userId: string,
  equipment: EquipmentItem[],
  table: { campaignId?: string | null } = {},
): EquipmentItem[] {
  if (!equipment.length) {
    return equipment;
  }
  let items: HomebrewEntry[] | null = null;
  // Forgotten entries too: a sheet that carries one keeps its rules
  // (archiveHomebrew), the live one of a name first.
  const load = () =>
    (items ??= (table.campaignId ? tableAuthors(table.campaignId) : [userId]).flatMap((author) =>
      listHomebrew(author, "item", { archived: true }),
    ));
  return equipment.map((item) => {
    const slugId = item.slug?.startsWith("homebrew:") ? item.slug.slice("homebrew:".length) : null;
    const wanted = item.name.trim().toLowerCase();
    const entry = slugId
      ? load().find((candidate) => candidate.id === slugId)
      : isPublishedGearName(item.name)
        ? undefined
        : load().find((candidate) => candidate.name.trim().toLowerCase() === wanted);
    const gear = entry ? gearFromHomebrewData(entry.name, entry.data) : null;
    if (!gear) {
      if (item.gear === undefined) {
        return item;
      }
      const bare = { ...item };
      delete bare.gear;
      return bare;
    }
    return {
      ...item,
      gear,
      ...(item.weight === undefined && gear.weight !== undefined ? { weight: gear.weight } : {}),
    };
  });
}

// Forgetting an entry archives it: it leaves its author's shelf and every
// picker, so nothing new is made with it, and everything that already
// carries it (a sheet's item, a feat, a spell on a list, a species, an NPC's
// stat block) keeps its rules as last saved. restoreHomebrew brings it back;
// deleteHomebrew removes it for good, and then what carried it keeps only
// its name.
export function archiveHomebrew(userId: string, id: string): boolean {
  const result = getDatabase()
    .prepare(`UPDATE homebrew_entries SET archived_at = ? WHERE id = ? AND user_id = ? AND archived_at IS NULL`)
    .run(nowIso(), id, userId);
  return result.changes > 0;
}

export function restoreHomebrew(userId: string, id: string): boolean {
  const result = getDatabase()
    .prepare(`UPDATE homebrew_entries SET archived_at = NULL WHERE id = ? AND user_id = ?`)
    .run(id, userId);
  return result.changes > 0;
}

export function deleteHomebrew(userId: string, id: string): boolean {
  const result = getDatabase()
    .prepare(`DELETE FROM homebrew_entries WHERE id = ? AND user_id = ?`)
    .run(id, userId);
  return result.changes > 0;
}
