import { getDatabase, nowIso, parseJson } from "@/lib/db/core";
import { getHomebrew, isPublishedGearName, listHomebrew, tableAuthors, updateHomebrew, type HomebrewEntry } from "@/lib/db/homebrew";
import { getSheetById } from "@/lib/db/sheets";
import { getCampaignById } from "@/lib/db/campaigns";
import { publishPersisted } from "@/lib/events";
import { resolveMonster } from "@/lib/bestiary";
import { featFactsFor, spellFactsFor, subclassIsOffered } from "@/lib/characters/catalog";
import { matchGear } from "@/lib/srd/adventuring-gear";
import { normalizeHomebrewData } from "@/lib/homebrew/gear";
import { renamerOf, renameSheetRefs, type SheetRefKind, type SheetRenamer } from "@/lib/homebrew/sheet-refs";
import { renameHomebrewDataRefs, renameMonsterStatsSpells } from "@/lib/homebrew/data-refs";
import { renamePrepRefs } from "@/lib/db/prep-refs";
import { textKey } from "@/lib/language/text-logic";
import type { GameSettings } from "@/lib/schemas/game-settings";

// A rename in the author's own Homebrew or bestiary, carried to everything
// that names the entry by its old name (workshop import audit F02).
//
// A subclass, a spell, a feat and most items and monsters are held by NAME
// (src/lib/homebrew/sheet-refs.ts, src/lib/db/prep-refs.ts). Renaming the
// entry used to leave every sheet and every table row on the old name: a
// fighter kept "Bog Knight" as their subclass, lost its features at the next
// level, and the legality check no longer offered it. Now the sheets, the
// author's other entries and their tables' prep follow the rename in the
// same transaction, wherever the renamed entry was the one that answered to
// the old name:
//
//   - the author's library characters, unless they keep another entry of
//     that kind and name (which then answered, and still does);
//   - the sheets and prep of every table the author runs (owner, DM or
//     assistant DM, src/lib/db/homebrew.ts tableAuthors), unless an author
//     ahead of them in that order keeps one of that name, which answered
//     there first;
//   - the author's own entries that name it (a subclass's spells, an item's
//     spells, a monster's spells, a background's kit).
//
// A name the books publish is never carried: the published entry answered
// to it all along, and it still does.

export type RenameCarried = { characters: number; entries: number; prep: number };

const NOTHING: RenameCarried = { characters: 0, entries: 0, prep: 0 };

const sheetKind = (kind: HomebrewEntry["kind"]): SheetRefKind | null =>
  kind === "archetype" || kind === "spell" || kind === "feat" || kind === "item" ? kind : kind === "hazard" ? "item" : null;

// Whether the books answer to the old name before any workshop entry does.
function published(entry: HomebrewEntry, name: string, settings: GameSettings | null): boolean {
  switch (entry.kind) {
    case "spell":
      return spellFactsFor(name) !== null;
    case "feat":
      return featFactsFor(name) !== null;
    case "archetype":
      return subclassIsOffered(String(entry.data.classSlug ?? ""), name);
    case "item":
      return isPublishedGearName(name) || matchGear(name) !== null;
    case "monster":
      return resolveMonster(name, settings ?? ({} as GameSettings)) !== null;
    default:
      return false;
  }
}

// The same reference: one kind, one name, and for a subclass one class.
function answersTo(candidate: HomebrewEntry, entry: HomebrewEntry, name: string): boolean {
  return (
    candidate.id !== entry.id &&
    candidate.kind === entry.kind &&
    textKey(candidate.name) === textKey(name) &&
    (entry.kind !== "archetype" || String(candidate.data.classSlug ?? "").toLowerCase() === String(entry.data.classSlug ?? "").toLowerCase())
  );
}

// Whether the renamed entry was what answered to the old name for these
// authors, in their order.
function answeredFor(authors: string[], userId: string, entry: HomebrewEntry, name: string): boolean {
  for (const author of authors) {
    const holds = listHomebrew(author, entry.kind, { archived: true }).some((candidate) => answersTo(candidate, entry, name));
    if (author === userId) return !holds;
    if (holds) return false;
  }
  return false;
}

// A JSON value with every `field` that reads `from` rewritten to `to`, for
// the play-state columns that name a spell or a hazard in passing (a
// condition's spell, a summon's spell, a trap hold's source).
function rewriteField(value: unknown, field: string, from: string, to: string): { value: unknown; changed: boolean } {
  let changed = false;
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === "object") {
      return Object.fromEntries(
        Object.entries(node as Record<string, unknown>).map(([key, child]) => {
          if (key === field && typeof child === "string" && textKey(child) === textKey(from)) {
            changed = true;
            return [key, to];
          }
          return [key, walk(child)];
        }),
      );
    }
    return node;
  };
  const next = walk(value);
  return { value: changed ? next : value, changed };
}

// One table's sheets, renamed in place; the ids of the ones that changed.
function carrySheets(campaignId: string, kind: SheetRefKind, rename: SheetRenamer, entry: HomebrewEntry, from: string, to: string): string[] {
  const db = getDatabase();
  const rows = db.prepare(`SELECT * FROM character_sheets WHERE campaign_id = ?`).all(campaignId) as Array<Record<string, unknown>>;
  const changedIds: string[] = [];
  for (const row of rows) {
    const json = (column: string, fallback: unknown) => parseJson<unknown>(typeof row[column] === "string" ? (row[column] as string) : "", fallback);
    const sheet = {
      class: String(row.class ?? ""),
      subclass: String(row.subclass ?? ""),
      classes: json("classes_json", []),
      spellcasting: json("spellcasting_json", null),
      feats: json("feats_json", []),
      features: json("features_json", []),
      equipment: json("equipment_json", []),
      featChoices: json("feat_choices_json", undefined),
      concentratingOn: typeof row.concentrating_on === "string" ? row.concentrating_on : null,
    };
    const out = renameSheetRefs(sheet, rename);
    // The play state that names a spell or a hazard in passing.
    const field = entry.kind === "spell" ? "spell" : entry.kind === "hazard" ? "source" : null;
    const meta = field ? rewriteField(json("condition_meta_json", {}), field, from, to) : { value: null, changed: false };
    const summon = entry.kind === "spell" ? rewriteField(json("summon_json", null), "spell", from, to) : { value: null, changed: false };
    if (!out.changed && !meta.changed && !summon.changed) continue;
    const next = out.sheet;
    db.prepare(
      `UPDATE character_sheets SET subclass = ?, classes_json = ?, spellcasting_json = ?, feats_json = ?, features_json = ?,
         equipment_json = ?, feat_choices_json = ?, concentrating_on = ?, updated_at = ? WHERE id = ?`,
    ).run(
      next.subclass,
      row.classes_json === null || row.classes_json === undefined ? null : JSON.stringify(next.classes),
      JSON.stringify(next.spellcasting),
      JSON.stringify(next.feats),
      JSON.stringify(next.features),
      JSON.stringify(next.equipment),
      row.feat_choices_json === null || row.feat_choices_json === undefined ? null : JSON.stringify(next.featChoices ?? {}),
      next.concentratingOn,
      nowIso(),
      String(row.id),
    );
    if (meta.changed) db.prepare(`UPDATE character_sheets SET condition_meta_json = ? WHERE id = ?`).run(JSON.stringify(meta.value), String(row.id));
    if (summon.changed) db.prepare(`UPDATE character_sheets SET summon_json = ? WHERE id = ?`).run(JSON.stringify(summon.value), String(row.id));
    changedIds.push(String(row.id));
  }
  return changedIds;
}

// Carries a rename that has just been written. `before` is the entry as it
// was. Runs inside the caller's transaction; returns what it carried and the
// table sheets to announce once that transaction has committed.
function carry(userId: string, before: HomebrewEntry, to: string): { carried: RenameCarried; announce: Array<{ campaignId: string; sheetId: string }> } {
  const from = before.name;
  if (!from.trim() || textKey(from) === textKey(to)) {
    return { carried: NOTHING, announce: [] };
  }
  const db = getDatabase();
  const kind = sheetKind(before.kind);
  const rename = renamerOf(kind ? [{ kind, from, to, ...(before.kind === "archetype" ? { classId: String(before.data.classSlug ?? "") } : {}) }] : []);
  const carried = { characters: 0, entries: 0, prep: 0 };
  const announce: Array<{ campaignId: string; sheetId: string }> = [];

  // The author's library.
  if (kind && answeredFor([userId], userId, before, from) && !published(before, from, null)) {
    const rows = db.prepare(`SELECT id, sheet_json FROM library_characters WHERE user_id = ?`).all(userId) as Array<{ id: string; sheet_json: string }>;
    for (const row of rows) {
      const out = renameSheetRefs(parseJson<Record<string, unknown>>(row.sheet_json, {}), rename);
      if (!out.changed) continue;
      db.prepare(`UPDATE library_characters SET sheet_json = ?, subclass = ?, updated_at = ? WHERE id = ?`).run(
        JSON.stringify(out.sheet),
        String(out.sheet.subclass ?? ""),
        nowIso(),
        row.id,
      );
      carried.characters += 1;
    }
  }

  // The author's own entries that name it.
  if ((before.kind === "spell" || before.kind === "item") && answeredFor([userId], userId, before, from)) {
    const rename2 = renamerOf([{ kind: before.kind, from, to }]);
    for (const other of listHomebrew(userId, undefined, { archived: true })) {
      if (other.id === before.id) continue;
      const out =
        other.kind === "monster"
          ? (() => {
              const stats = renameMonsterStatsSpells(other.data.stats, rename2);
              return { data: stats.changed ? { ...other.data, stats: stats.stats } : other.data, changed: stats.changed };
            })()
          : renameHomebrewDataRefs(other.kind, other.data, rename2);
      if (!out.changed) continue;
      const normalized = other.kind === "monster" ? { data: out.data } : normalizeHomebrewData(other.kind, out.data, other.name);
      const data = "error" in normalized ? out.data : normalized.data;
      db.prepare(`UPDATE homebrew_entries SET data_json = ?, updated_at = ? WHERE id = ?`).run(JSON.stringify(data), nowIso(), other.id);
      carried.entries += 1;
    }
  }

  // Every table the author runs, where theirs was the entry that answered.
  const tables = db
    .prepare(`SELECT id FROM campaigns WHERE owner_user_id = ? OR human_dm_user_id = ? OR assistant_dm_user_id = ?`)
    .all(userId, userId, userId) as Array<{ id: string }>;
  for (const table of tables) {
    const settings = getCampaignById(table.id)?.gameSettings ?? null;
    if (!answeredFor(tableAuthors(table.id), userId, before, from) || published(before, from, settings)) continue;
    if (kind) {
      for (const sheetId of carrySheets(table.id, kind, rename, before, from, to)) {
        announce.push({ campaignId: table.id, sheetId });
        carried.characters += 1;
      }
    }
    if (before.kind === "monster" || before.kind === "item") {
      carried.prep += renamePrepRefs(table.id, { [before.kind]: new Map([[textKey(from), to]]) });
    }
  }
  return { carried, announce };
}

// The rename-aware update every writer of a Homebrew entry goes through
// (the Homebrew route and the bestiary's): the entry, and what its new name
// was carried to. Null when the entry is not the author's.
export function updateHomebrewCarried(
  userId: string,
  id: string,
  patch: { name?: string; data?: Record<string, unknown> },
): { entry: HomebrewEntry; carried: RenameCarried } | null {
  const before = getHomebrew(userId, id);
  if (!before) {
    return null;
  }
  const db = getDatabase();
  const result = db.transaction(() => {
    const entry = updateHomebrew(userId, id, patch);
    if (!entry) return null;
    const moved = patch.name !== undefined ? carry(userId, before, entry.name) : { carried: NOTHING, announce: [] };
    return { entry, ...moved };
  })();
  if (!result) {
    return null;
  }
  // Open tables see the sheets as they now read.
  for (const { campaignId, sheetId } of result.announce) {
    const sheet = getSheetById(sheetId);
    if (sheet) publishPersisted(campaignId, "sheet_updated", { sheet });
  }
  return { entry: result.entry, carried: result.carried };
}
