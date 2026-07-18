import { getDatabase, nowIso, parseJson } from "@/lib/db/core";
import { createSheet, getSheetById, getSheetForUser } from "@/lib/db/sheets";
import { spellSlotsFor, suggestedStartingHp } from "@/lib/srd";
import { earnedAsiCount, removeAsiChoices } from "@/lib/srd/asi";
import { populateFeatures } from "@/lib/srd/features";
import type { CharacterSheet, CreateSheetInput } from "@/lib/schemas/sheet";

// The per-user character library (table library_characters). Campaign play
// COPIES a library character into character_sheets (copy-on-instantiate);
// only the copy mutates during play, so a dead or mangled campaign never
// corrupts the library version. Durable progression flows back via
// syncProgressToLibrary (manual button + automatic on campaign end).

export type LibraryCharacter = {
  id: string;
  userId: string;
  name: string;
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
        id, user_id, name, race, class, subclass, background, level, xp,
        sheet_json, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
    `,
  ).run(
    id,
    userId,
    input.name,
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

export function listCharactersForUser(userId: string): LibraryCharacter[] {
  const rows = getDatabase()
    .prepare(`SELECT * FROM library_characters WHERE user_id = ? ORDER BY updated_at DESC`)
    .all(userId) as LibraryRow[];
  return rows.map(mapCharacter);
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
  const sheet = structuredClone(character.sheet);
  const level = Math.max(1, Math.min(20, targetLevel));

  // Strip ASI choices earned above the campaign's starting level: reverse
  // their ability bonuses (slightly lossy for scores that hit the 20 cap)
  // and drop their feats. Up-scaling grants no automatic extra ASIs; the
  // player edits the sheet in-game instead. Level-up ASIs taken mid-campaign
  // sync back as raw abilities without a recorded choice, so those cannot
  // be reversed here either.
  const storedChoices = sheet.asiChoices ?? [];
  const keptChoiceCount = earnedAsiCount(level);
  if (storedChoices.length > keptChoiceCount) {
    const dropped = storedChoices.slice(keptChoiceCount);
    sheet.abilities = removeAsiChoices(sheet.abilities, dropped);
    const droppedFeats = new Set(
      dropped.flatMap((choice) => (choice.mode === "feat" ? [choice.feat] : [])),
    );
    sheet.feats = (sheet.feats ?? []).filter((feat) => !droppedFeats.has(feat));
    sheet.asiChoices = storedChoices.slice(0, keptChoiceCount);
  }

  sheet.hitDice = { ...sheet.hitDice, total: level, spent: 0 };
  if (level !== character.level) {
    const suggested = suggestedStartingHp(sheet.class, sheet.race, sheet.abilities.con, level);
    // Only classes the SRD tables know produce a real suggestion; otherwise
    // scale the stored HP roughly by level.
    sheet.maxHp =
      suggested !== 8 || sheet.class === "wizard"
        ? suggested
        : Math.max(1, Math.round((sheet.maxHp / Math.max(1, character.level)) * level));
  }
  if (sheet.spellcasting) {
    const slots = spellSlotsFor(sheet.class, level);
    if (Object.keys(slots).length) {
      sheet.spellcasting.slots = Object.fromEntries(
        Object.entries(slots).map(([slotLevel, max]) => [slotLevel, { max, used: 0 }]),
      );
    }
  }

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
