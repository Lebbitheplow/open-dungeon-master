import { getDatabase, nowIso, parseJson } from "@/lib/db/core";
import { touchCampaign } from "@/lib/db/campaigns";
import type {
  CharacterSheet,
  CreateSheetInput,
  PatchSheetInput,
} from "@/lib/schemas/sheet";

type SheetRow = {
  id: string;
  campaign_id: string;
  user_id: string;
  library_character_id: string | null;
  name: string;
  race: string;
  class: string;
  subclass: string;
  background: string;
  alignment: string;
  level: number;
  xp: number;
  abilities_json: string;
  max_hp: number;
  current_hp: number;
  temp_hp: number;
  ac: number;
  speed: number;
  hit_dice_json: string;
  proficiencies_json: string;
  equipment_json: string;
  gold: number;
  feats_json: string;
  spellcasting_json: string;
  conditions_json: string;
  notes: string;
  created_at: string;
  updated_at: string;
};

const EMPTY_PROFICIENCIES = {
  saves: [],
  skills: [],
  languages: [],
  tools: [],
  armor: [],
  weapons: [],
};

function mapSheet(row: SheetRow): CharacterSheet {
  // Sheets created before the `known` spell list existed lack the field.
  const spellcasting = parseJson<CharacterSheet["spellcasting"]>(row.spellcasting_json, null);
  if (spellcasting && !Array.isArray(spellcasting.known)) {
    spellcasting.known = [];
  }
  return {
    id: row.id,
    campaignId: row.campaign_id,
    userId: row.user_id,
    libraryCharacterId: row.library_character_id,
    name: row.name,
    race: row.race,
    class: row.class,
    subclass: row.subclass ?? "",
    background: row.background,
    alignment: row.alignment,
    level: row.level,
    xp: row.xp,
    abilities: parseJson(row.abilities_json, { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }),
    maxHp: row.max_hp,
    currentHp: row.current_hp,
    tempHp: row.temp_hp,
    ac: row.ac,
    speed: row.speed,
    hitDice: parseJson(row.hit_dice_json, { die: "d8" as const, total: 1, spent: 0 }),
    proficiencies: parseJson(row.proficiencies_json, EMPTY_PROFICIENCIES),
    equipment: parseJson(row.equipment_json, []),
    gold: row.gold,
    feats: parseJson(row.feats_json, []),
    spellcasting,
    conditions: parseJson(row.conditions_json, []),
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const SHEET_COLUMNS = `
  id, campaign_id, user_id, library_character_id, name, race, class, subclass,
  background, alignment, level, xp,
  abilities_json, max_hp, current_hp, temp_hp, ac, speed, hit_dice_json,
  proficiencies_json, equipment_json, gold, feats_json, spellcasting_json,
  conditions_json, notes, created_at, updated_at
`;

export function createSheet(
  campaignId: string,
  userId: string,
  level: number,
  input: CreateSheetInput,
  libraryCharacterId?: string | null,
): CharacterSheet {
  const db = getDatabase();
  const id = crypto.randomUUID();
  const now = nowIso();

  db.prepare(
    `
      INSERT INTO character_sheets (
        id, campaign_id, user_id, library_character_id, name, race, class,
        subclass, background, alignment,
        level, xp, abilities_json, max_hp, current_hp, temp_hp, ac, speed,
        hit_dice_json, proficiencies_json, equipment_json, gold, feats_json,
        spellcasting_json, conditions_json, notes, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, ?, ?)
    `,
  ).run(
    id,
    campaignId,
    userId,
    libraryCharacterId ?? null,
    input.name,
    input.race,
    input.class,
    input.subclass,
    input.background,
    input.alignment,
    level,
    JSON.stringify(input.abilities),
    input.maxHp,
    input.maxHp,
    input.ac,
    input.speed,
    JSON.stringify(input.hitDice),
    JSON.stringify(input.proficiencies),
    JSON.stringify(input.equipment),
    input.gold,
    JSON.stringify(input.feats),
    JSON.stringify(input.spellcasting),
    input.notes,
    now,
    now,
  );
  touchCampaign(campaignId);

  const sheet = getSheetById(id);
  if (!sheet) {
    throw new Error("Failed to create character sheet.");
  }
  return sheet;
}

export function getSheetById(sheetId: string): CharacterSheet | null {
  const row = getDatabase()
    .prepare(`SELECT ${SHEET_COLUMNS} FROM character_sheets WHERE id = ?`)
    .get(sheetId) as SheetRow | undefined;
  return row ? mapSheet(row) : null;
}

export function getSheetForUser(campaignId: string, userId: string): CharacterSheet | null {
  const row = getDatabase()
    .prepare(`SELECT ${SHEET_COLUMNS} FROM character_sheets WHERE campaign_id = ? AND user_id = ?`)
    .get(campaignId, userId) as SheetRow | undefined;
  return row ? mapSheet(row) : null;
}

export function listSheets(campaignId: string): CharacterSheet[] {
  const rows = getDatabase()
    .prepare(
      `SELECT ${SHEET_COLUMNS} FROM character_sheets WHERE campaign_id = ? ORDER BY created_at ASC`,
    )
    .all(campaignId) as SheetRow[];
  return rows.map(mapSheet);
}

export function patchSheet(sheetId: string, patch: PatchSheetInput): CharacterSheet | null {
  const existing = getSheetById(sheetId);
  if (!existing) {
    return null;
  }

  const next = {
    currentHp: patch.currentHp ?? existing.currentHp,
    tempHp: patch.tempHp ?? existing.tempHp,
    maxHp: patch.maxHp ?? existing.maxHp,
    ac: patch.ac ?? existing.ac,
    xp: patch.xp ?? existing.xp,
    level: patch.level ?? existing.level,
    gold: patch.gold ?? existing.gold,
    conditions: patch.conditions ?? existing.conditions,
    equipment: patch.equipment ?? existing.equipment,
    hitDice: patch.hitDice ?? existing.hitDice,
    spellcasting: patch.spellcasting !== undefined ? patch.spellcasting : existing.spellcasting,
    feats: patch.feats ?? existing.feats,
    subclass: patch.subclass ?? existing.subclass,
    notes: patch.notes ?? existing.notes,
  };

  getDatabase()
    .prepare(
      `
        UPDATE character_sheets SET
          current_hp = ?, temp_hp = ?, max_hp = ?, ac = ?, xp = ?, level = ?,
          gold = ?, conditions_json = ?, equipment_json = ?, hit_dice_json = ?,
          spellcasting_json = ?, feats_json = ?, subclass = ?, notes = ?, updated_at = ?
        WHERE id = ?
      `,
    )
    .run(
      Math.min(next.currentHp, next.maxHp),
      next.tempHp,
      next.maxHp,
      next.ac,
      next.xp,
      next.level,
      next.gold,
      JSON.stringify(next.conditions),
      JSON.stringify(next.equipment),
      JSON.stringify(next.hitDice),
      JSON.stringify(next.spellcasting),
      JSON.stringify(next.feats),
      next.subclass,
      next.notes,
      nowIso(),
      sheetId,
    );
  touchCampaign(existing.campaignId);

  return getSheetById(sheetId);
}
