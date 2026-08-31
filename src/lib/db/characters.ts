import { getDatabase, nowIso, parseJson } from "@/lib/db/core";
import { createSheet, getSheetById, getSheetForUser } from "@/lib/db/sheets";
import { adaptSheetToLevel } from "@/lib/characters/adapt";
import { populateFeatures } from "@/lib/srd/features";
import { dedupeName } from "@/lib/workshop/import";
import { normalizeCampaignKind, type CampaignKind } from "@/lib/workshop/kind";
import type { CampaignStatus } from "@/lib/campaign-types";
import type { CharacterSheet, CreateSheetInput, SheetAttachment } from "@/lib/schemas/sheet";

// The per-user character library (table library_characters). Campaign play
// COPIES a library character into character_sheets (copy-on-instantiate);
// only the copy mutates during play, so a dead or mangled campaign never
// corrupts the library version. Durable progression flows back via
// syncProgressToLibrary (manual button + automatic on campaign end).

// A character somebody plays, or an ally the DM plays. The same sheet and
// the same adaptation either way; what differs is the door they come through
// into a campaign (src/lib/dm/companion-tools.ts).
export const CHARACTER_ROLES = ["pc", "companion"] as const;
export type CharacterRole = (typeof CHARACTER_ROLES)[number];

// Anything that is not literally 'companion' is a player character, which is
// what makes every row written before the column existed read correctly.
export function normalizeCharacterRole(value: unknown): CharacterRole {
  return value === "companion" ? "companion" : "pc";
}

export type LibraryCharacter = {
  id: string;
  userId: string;
  name: string;
  role: CharacterRole;
  race: string;
  class: string;
  subclass: string;
  background: string;
  level: number;
  xp: number;
  sheet: CreateSheetInput;
  createdAt: string;
  updatedAt: string;
};

type LibraryRow = {
  id: string;
  user_id: string;
  name: string;
  role: string | null;
  race: string;
  class: string;
  subclass: string;
  background: string;
  level: number;
  xp: number;
  sheet_json: string;
  created_at: string;
  updated_at: string;
};

function mapCharacter(row: LibraryRow): LibraryCharacter {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    role: normalizeCharacterRole(row.role),
    race: row.race,
    class: row.class,
    subclass: row.subclass,
    background: row.background,
    level: row.level,
    xp: row.xp,
    sheet: parseJson(row.sheet_json, {} as CreateSheetInput),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createCharacter(
  userId: string,
  level: number,
  input: CreateSheetInput,
  role: CharacterRole = "pc",
): LibraryCharacter {
  const db = getDatabase();
  const id = crypto.randomUUID();
  const now = nowIso();
  const stored: CreateSheetInput = {
    ...input,
    features: populateFeatures(input.features ?? [], input.class, input.subclass, input.race, level),
  };
  db.prepare(
    `
      INSERT INTO library_characters (
        id, user_id, name, role, race, class, subclass, background, level, xp,
        sheet_json, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
    `,
  ).run(
    id,
    userId,
    input.name,
    role,
    input.race,
    input.class,
    input.subclass,
    input.background,
    level,
    JSON.stringify(stored),
    now,
    now,
  );
  const character = getCharacter(id);
  if (!character) {
    throw new Error("Failed to create library character.");
  }
  return character;
}

export function getCharacter(id: string): LibraryCharacter | null {
  const row = getDatabase()
    .prepare(`SELECT * FROM library_characters WHERE id = ?`)
    .get(id) as LibraryRow | undefined;
  return row ? mapCharacter(row) : null;
}

export function getCharacterForUser(userId: string, id: string): LibraryCharacter | null {
  const character = getCharacter(id);
  return character && character.userId === userId ? character : null;
}

// Every entry, or only the ones playing one part. Unfiltered by default so
// no existing caller changes meaning.
export function listCharactersForUser(
  userId: string,
  role?: CharacterRole,
): LibraryCharacter[] {
  const rows = getDatabase()
    .prepare(`SELECT * FROM library_characters WHERE user_id = ? ORDER BY updated_at DESC`)
    .all(userId) as LibraryRow[];
  const all = rows.map(mapCharacter);
  return role ? all.filter((character) => character.role === role) : all;
}

export function updateCharacter(
  userId: string,
  id: string,
  level: number,
  input: CreateSheetInput,
): LibraryCharacter | null {
  const existing = getCharacterForUser(userId, id);
  if (!existing) {
    return null;
  }
  const stored: CreateSheetInput = {
    ...input,
    features: populateFeatures(input.features ?? [], input.class, input.subclass, input.race, level),
  };
  getDatabase()
    .prepare(
      `
        UPDATE library_characters SET
          name = ?, race = ?, class = ?, subclass = ?, background = ?,
          level = ?, sheet_json = ?, updated_at = ?
        WHERE id = ?
      `,
    )
    .run(
      input.name,
      input.race,
      input.class,
      input.subclass,
      input.background,
      level,
      JSON.stringify(stored),
      nowIso(),
      id,
    );
  return getCharacter(id);
}

// Portrait-only update from the library page; the rest of the sheet stays
// untouched (the full editor path re-normalizes features and identity).
export function updateCharacterPortrait(
  userId: string,
  id: string,
  portrait: SheetAttachment | null,
): LibraryCharacter | null {
  const character = getCharacterForUser(userId, id);
  if (!character) {
    return null;
  }
  const stored: CreateSheetInput = { ...character.sheet, portrait };
  getDatabase()
    .prepare(`UPDATE library_characters SET sheet_json = ?, updated_at = ? WHERE id = ?`)
    .run(JSON.stringify(stored), nowIso(), id);
  return getCharacter(id);
}

export function deleteCharacter(userId: string, id: string): boolean {
  const result = getDatabase()
    .prepare(`DELETE FROM library_characters WHERE id = ? AND user_id = ?`)
    .run(id, userId);
  return result.changes > 0;
}

// Copy a library character into a campaign as a fresh sheet. When the
// campaign's starting level differs, hit dice, suggested HP, and spell
// slots are recomputed (SRD tables; unknown classes keep their stored HP).
export function instantiateIntoCampaign(
  characterId: string,
  campaignId: string,
  userId: string,
  targetLevel: number,
): CharacterSheet | { error: string } {
  const character = getCharacterForUser(userId, characterId);
  if (!character) {
    return { error: "Character not found in your library." };
  }
  if (getSheetForUser(campaignId, userId)) {
    return { error: "You already have a character in this campaign." };
  }
  const level = Math.max(1, Math.min(20, targetLevel));
  // The adaptation itself lives in src/lib/characters/adapt.ts, pure, so a
  // companion coming out of this same library gets exactly the work done to
  // it and a test can drive every branch without a database.
  const sheet = adaptSheetToLevel(character.sheet, character.level, level);

  return createSheet(campaignId, userId, level, sheet, characterId);
}

// Write durable progression (never HP/conditions) from a campaign sheet
// back to its linked library character.
export function syncProgressToLibrary(sheetId: string): LibraryCharacter | null {
  const sheet = getSheetById(sheetId);
  if (!sheet?.libraryCharacterId) {
    return null;
  }
  const character = getCharacter(sheet.libraryCharacterId);
  if (!character || character.userId !== sheet.userId) {
    return null;
  }
  const merged: CreateSheetInput = {
    ...character.sheet,
    subclass: sheet.subclass,
    // Multiclass progression survives the round-trip (pools rest fresh).
    classes: sheet.classes,
    hitDicePools:
      sheet.hitDicePools?.map((pool) => ({ ...pool, spent: 0 })) ?? null,
    equipment: sheet.equipment,
    gold: sheet.gold,
    feats: sheet.feats,
    features: sheet.features,
    // Level-up ASIs land here as raw scores; the campaign records no
    // AsiChoice for them, so asiChoices keeps only creation-time picks.
    abilities: sheet.abilities,
    spellcasting: sheet.spellcasting
      ? {
          ...sheet.spellcasting,
          slots: Object.fromEntries(
            Object.entries(sheet.spellcasting.slots).map(([slotLevel, slot]) => [
              slotLevel,
              { max: slot.max, used: 0 },
            ]),
          ),
        }
      : sheet.spellcasting,
    maxHp: sheet.maxHp,
    ac: sheet.ac,
    portrait: sheet.portrait,
    notes: sheet.notes,
    backstory: sheet.backstory,
  };
  getDatabase()
    .prepare(
      `
        UPDATE library_characters SET
          subclass = ?, level = ?, xp = ?, sheet_json = ?, updated_at = ?
        WHERE id = ?
      `,
    )
    .run(
      sheet.subclass,
      sheet.level,
      sheet.xp,
      JSON.stringify(merged),
      nowIso(),
      character.id,
    );
  return getCharacter(character.id);
}

// ---- where a character is playing ----

// A library character is a template; each campaign holds its own copy
// (character_sheets.library_character_id). Reading the link backwards is what
// lets the roster say "this one is at two tables", which is the difference
// between a shelf of sheets and a shelf you can navigate.
export type CharacterAssignment = {
  campaignId: string;
  title: string;
  kind: CampaignKind;
  status: CampaignStatus;
};

type AssignmentRow = {
  character_id: string;
  campaign_id: string;
  title: string;
  kind: string | null;
  status: CampaignStatus;
};

// Every assignment for every character this user owns, keyed by character id.
// One query rather than one per tile: the roster renders all of them at once.
export function listAssignmentsForUser(userId: string): Map<string, CharacterAssignment[]> {
  const rows = getDatabase()
    .prepare(
      `SELECT cs.library_character_id AS character_id, c.id AS campaign_id,
              c.title AS title, c.kind AS kind, c.status AS status
       FROM character_sheets cs
       JOIN campaigns c ON c.id = cs.campaign_id
       JOIN library_characters lc ON lc.id = cs.library_character_id
       WHERE lc.user_id = ?
       ORDER BY c.updated_at DESC`,
    )
    .all(userId) as AssignmentRow[];
  const byCharacter = new Map<string, CharacterAssignment[]>();
  for (const row of rows) {
    const list = byCharacter.get(row.character_id) ?? [];
    list.push({
      campaignId: row.campaign_id,
      title: row.title,
      kind: normalizeCampaignKind(row.kind),
      status: row.status,
    });
    byCharacter.set(row.character_id, list);
  }
  return byCharacter;
}

export function listAssignmentsForCharacter(
  userId: string,
  characterId: string,
): CharacterAssignment[] {
  return listAssignmentsForUser(userId).get(characterId) ?? [];
}

// ---- copying ----

// A duplicate of a library character, under a numbered name. Copied verbatim
// rather than rebuilt: the stored sheet already has its features populated,
// and re-deriving them would quietly change a sheet somebody had hand-edited.
//
// The portrait travels as a path, like a prepared map's backdrop: it points
// at a file in public/uploads that both copies can read, and duplicating the
// image would cost megabytes to show the same face.
export function duplicateCharacter(userId: string, id: string): LibraryCharacter | null {
  const source = getCharacterForUser(userId, id);
  if (!source) {
    return null;
  }
  const taken = new Set(
    listCharactersForUser(userId).map((character) => character.name.trim().toLowerCase()),
  );
  // Trimmed before the numbering so a long name cannot lose the "(2)".
  const name = dedupeName(`${source.name} (copy)`.slice(0, 72), taken);
  const copyId = crypto.randomUUID();
  const now = nowIso();
  getDatabase()
    .prepare(
      `INSERT INTO library_characters (
         id, user_id, name, role, race, class, subclass, background, level, xp,
         sheet_json, created_at, updated_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      copyId,
      userId,
      name,
      source.role,
      source.race,
      source.class,
      source.subclass,
      source.background,
      source.level,
      source.xp,
      JSON.stringify({ ...source.sheet, name }),
      now,
      now,
    );
  return getCharacter(copyId);
}
