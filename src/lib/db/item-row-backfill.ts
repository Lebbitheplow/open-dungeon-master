// One pass, at the first boot after item names began to be read whole
// (src/lib/srd/item-row.ts): a line saved before then carries no srdName,
// and the finders read a weapon or armor out of the words of its name
// ("Silvered Longsword" was a longsword, "Steel Shield" a shield, "Elven
// Longbow" a longbow, and as much "Dinner plate" plate armor). Each stored
// line that no row answers to now gets, as its srdName, the weapon or armor
// that old reading gave it, so a character, a party pack, a shelf, what lies
// on the ground, a chapter a rewind brings back and a grant awaiting its
// player keep what each was. A line that says what it is by itself keeps
// what it says: one with its own tags, and an unidentified one, whose name
// is the party's description, never the thing. The old reading lives here
// for this pass only: nothing reads a name this way any more.
import type { SqliteDatabase } from "@/lib/db/driver";
import { parseJson } from "@/lib/db/core";
import { textKey } from "@/lib/language/text-logic";
import { pluralForms } from "@/lib/srd/name-forms";
import { matchWeapon, SRD_WEAPONS } from "@/lib/srd/weapons";
import { matchArmor } from "@/lib/srd/armor";
import { SRD_ARMOR } from "@/lib/srd/armor-table";
import { itemRow } from "@/lib/srd/item-tags";
import { gearDefFor } from "@/lib/srd/magic-gear";

// A stored line: a carried item, or a shelf line named by itemName.
type Line = { name?: unknown; itemName?: unknown; srdName?: unknown; slug?: unknown; gear?: unknown; tags?: unknown; identified?: unknown };

const unspaced = (key: string) => key.replace(/ /g, "");
const WEAPON_FORMS = SRD_WEAPONS.map((weapon) => ({ weapon, spellings: pluralForms(textKey(weapon.name)).map(unspaced) }));
const MOST_WORDS = Math.max(...SRD_WEAPONS.map((weapon) => textKey(weapon.name).split(" ").length));
const GEAR_NOT_WEAPONS = new Set(["hammer", "censer"].flatMap(pluralForms));
const AMMUNITION_WORDS = new Set(["arrow", "bolt", "bullet", "needle"].flatMap(pluralForms));

// The old weapon reading: any run of a name's words that spells a weapon,
// the longest weapon first, never ammunition.
function oldWeapon(name: string): string | null {
  const wanted = textKey(name);
  if (!wanted || GEAR_NOT_WEAPONS.has(wanted)) {
    return null;
  }
  const inverted = /^([^,(]+),\s*([^,(]+)/.exec(name);
  const orders = [wanted, ...(inverted ? [textKey(`${inverted[2]} ${inverted[1]}`)] : [])].map((key) => key.split(" "));
  if (orders[0].some((word) => AMMUNITION_WORDS.has(word))) {
    return null;
  }
  const runs = new Set(
    orders.flatMap((words) =>
      words.flatMap((_, start) => Array.from({ length: Math.min(MOST_WORDS, words.length - start) }, (_, size) => words.slice(start, start + size + 1).join(""))),
    ),
  );
  const found = WEAPON_FORMS.filter(({ spellings }) => spellings.some((form) => runs.has(form))).map(({ weapon }) => weapon);
  return found.sort((a, b) => b.name.length - a.name.length)[0]?.name ?? null;
}

const armorKey = (name: string) =>
  textKey(name)
    .split(" ")
    .filter((part) => !/^[+-]/.test(part))
    .join(" ");

// The old armor reading: a name that ends in an armor's, the longest first.
function oldArmor(name: string): string | null {
  const wanted = armorKey(name);
  const found = SRD_ARMOR.filter((armor) => {
    const key = armorKey(armor.name);
    return [key, `${key} armor`, `${key} armour`].some((form) => wanted.endsWith(` ${form}`));
  });
  return found.sort((a, b) => b.name.length - a.name.length)[0]?.name ?? null;
}

// The row the old reading gave a line no row answers to now, or null.
function legacyRowOf(line: Line): string | null {
  if (typeof line.name !== "string" || line.srdName || line.slug || line.gear || line.tags || line.identified === false) {
    return null;
  }
  const item = { name: line.name };
  if (itemRow(item) || gearDefFor(item) || matchWeapon(item) || matchArmor(item)) {
    return null;
  }
  return oldWeapon(line.name) ?? oldArmor(line.name);
}

// The lines with the row the old reading gave them, or null when none
// changes.
function withLegacyRows<T extends Line>(lines: unknown, nameOf: (line: T) => unknown = (line) => line.name): T[] | null {
  if (!Array.isArray(lines)) {
    return null;
  }
  let changed = false;
  const next = (lines as T[]).map((line) => {
    const srdName = line && typeof line === "object" ? legacyRowOf({ ...line, name: nameOf(line) }) : null;
    if (!srdName) {
      return line;
    }
    changed = true;
    return { ...line, srdName };
  });
  return changed ? next : null;
}

// What one stored blob becomes, or null when no line in it changes: a
// sheet's equipment, a party (its inventory), a shelf (lines by itemName).
const byItemName = (line: Line) => line.itemName;
function equipmentJson(json: string | null): string | null {
  const next = withLegacyRows(parseJson<unknown>(json, null));
  return next ? JSON.stringify(next) : null;
}
function partyJson(json: string | null): string | null {
  const party = parseJson<{ inventory?: unknown } | null>(json, null);
  const next = party ? withLegacyRows(party.inventory) : null;
  return party && next ? JSON.stringify({ ...party, inventory: next }) : null;
}
function stockJson(json: string | null): string | null {
  const next = withLegacyRows(parseJson<unknown>(json, null), byItemName);
  return next ? JSON.stringify(next) : null;
}

// A chapter snapshot's sheets, shelves and party pack, which a rewind writes
// back as they were captured (src/lib/db/snapshots.ts).
function snapshotJson(json: string): string | null {
  const payload = parseJson<{ campaign?: Record<string, unknown>; tables?: Record<string, Array<Record<string, unknown>>> } | null>(json, null);
  if (!payload) {
    return null;
  }
  let changed = false;
  const rewrite = (row: Record<string, unknown>, column: string, next: (json: string | null) => string | null) => {
    const value = row[column];
    const rewritten = typeof value === "string" ? next(value) : null;
    if (rewritten) {
      changed = true;
      return { ...row, [column]: rewritten };
    }
    return row;
  };
  const tables = payload.tables ?? {};
  const sheets = (tables.character_sheets ?? []).map((row) => rewrite(row, "equipment_json", equipmentJson));
  const shops = (tables.shops ?? []).map((row) => rewrite(rewrite(row, "stock_json", stockJson), "prepared_stock_json", stockJson));
  const campaign = payload.campaign ? rewrite(payload.campaign, "party_json", partyJson) : payload.campaign;
  return changed
    ? JSON.stringify({ ...payload, campaign, tables: { ...tables, ...(tables.character_sheets ? { character_sheets: sheets } : {}), ...(tables.shops ? { shops } : {}) } })
    : null;
}

// A grant or purchase awaiting its player's answer, replayed as stored when
// approved (src/lib/db/item-proposals.ts): the item it names.
function proposalJson(json: string): string | null {
  const args = parseJson<Record<string, unknown> | null>(json, null);
  const named = args?.action === "buy" ? args.item : args?.name;
  const srdName = args ? legacyRowOf({ ...args, name: named }) : null;
  return args && srdName ? JSON.stringify({ ...args, srdName }) : null;
}

// Every stored row of a table whose column the pass rewrites.
function rewriteColumn(db: SqliteDatabase, table: string, column: string, next: (json: string) => string | null, where = "") {
  const rows = db.prepare(`SELECT id, ${column} AS json FROM ${table} ${where}`).all() as Array<{ id: string; json: string | null }>;
  const update = db.prepare(`UPDATE ${table} SET ${column} = ? WHERE id = ?`);
  for (const row of rows) {
    const rewritten = row.json ? next(row.json) : null;
    if (rewritten) {
      update.run(rewritten, row.id);
    }
  }
}

export function backfillLegacyItemRows(db: SqliteDatabase): void {
  rewriteColumn(db, "character_sheets", "equipment_json", equipmentJson);
  rewriteColumn(db, "library_characters", "sheet_json", (json) => {
    const sheet = parseJson<{ equipment?: unknown } | null>(json, null);
    const next = sheet ? withLegacyRows(sheet.equipment) : null;
    return sheet && next ? JSON.stringify({ ...sheet, equipment: next }) : null;
  });
  rewriteColumn(db, "campaigns", "party_json", partyJson);
  rewriteColumn(db, "dropped_items", "item_json", (json) => {
    const next = withLegacyRows([parseJson<unknown>(json, null)]);
    return next ? JSON.stringify(next[0]) : null;
  });
  rewriteColumn(db, "shops", "stock_json", stockJson);
  rewriteColumn(db, "shops", "prepared_stock_json", stockJson);
  rewriteColumn(db, "chapter_snapshots", "snapshot_json", snapshotJson);
  rewriteColumn(db, "item_proposals", "args_json", proposalJson, `WHERE status = 'pending' AND tool_name IN ('grant_item', 'purchase')`);
}
