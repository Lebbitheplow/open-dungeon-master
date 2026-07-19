import { getDatabase, nowIso, parseJson } from "@/lib/db/core";
import { touchCampaign } from "@/lib/db/campaigns";
import { populateFeatures } from "@/lib/srd/features";
import { populateResources } from "@/lib/srd/class-resources";
import type {
  CharacterSheet,
  CreateSheetInput,
  FullPatchSheetInput,
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
  features_json: string | null;
  spellcasting_json: string;
  conditions_json: string;
  condition_meta_json: string | null;
  resources_json: string | null;
  exhaustion: number | null;
  death_saves_json: string | null;
  concentrating_on: string | null;
  portrait_json: string | null;
  notes: string;
  backstory: string | null;
  created_at: string;
  updated_at: string;
};

const EMPTY_PROFICIENCIES = {
  saves: [],
  skills: [],
  expertise: [],
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
    // Rows stored before the expertise field existed lack it; heal on read.
    proficiencies: (() => {
      const parsed = parseJson<CharacterSheet["proficiencies"]>(
        row.proficiencies_json,
        EMPTY_PROFICIENCIES,
      );
      return { ...parsed, expertise: parsed.expertise ?? [] };
    })(),
    equipment: parseJson(row.equipment_json, []),
    gold: row.gold,
    feats: parseJson(row.feats_json, []),
    features: parseJson(row.features_json, []),
    spellcasting,
    conditions: parseJson(row.conditions_json, []),
    conditionMeta: parseJson<CharacterSheet["conditionMeta"]>(row.condition_meta_json, {}),
    resources: parseJson<CharacterSheet["resources"]>(row.resources_json, {}),
    exhaustion: row.exhaustion ?? 0,
    deathSaves: parseJson<CharacterSheet["deathSaves"]>(row.death_saves_json, null),
    concentratingOn: row.concentrating_on ?? null,
    portrait: parseJson<CharacterSheet["portrait"]>(row.portrait_json, null),
    notes: row.notes,
    backstory: row.backstory ?? "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const SHEET_COLUMNS = `
  id, campaign_id, user_id, library_character_id, name, race, class, subclass,
  background, alignment, level, xp,
  abilities_json, max_hp, current_hp, temp_hp, ac, speed, hit_dice_json,
  proficiencies_json, equipment_json, gold, feats_json, features_json,
  spellcasting_json, conditions_json, condition_meta_json, resources_json, exhaustion, death_saves_json, concentrating_on,
  portrait_json, notes, backstory, created_at, updated_at
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
  // Every creation path lands here, so the SRD class features and racial
  // traits are always granted for the level the sheet actually starts at.
  const features = populateFeatures(
    input.features ?? [],
    input.class,
    input.subclass,
    input.race,
    level,
  );
  // Limited-use counters (Rage, Ki, Second Wind...) sized for the features
  // just granted; the resource engine spends and refills them.
  const abilityMods = Object.fromEntries(
    Object.entries(input.abilities).map(([ability, score]) => [
      ability,
      Math.floor((score - 10) / 2),
    ]),
  );
  const resources = populateResources(features, level, abilityMods, undefined);

  db.prepare(
    `
      INSERT INTO character_sheets (
        id, campaign_id, user_id, library_character_id, name, race, class,
        subclass, background, alignment,
        level, xp, abilities_json, max_hp, current_hp, temp_hp, ac, speed,
        hit_dice_json, proficiencies_json, equipment_json, gold, feats_json,
        features_json, resources_json, spellcasting_json, conditions_json, portrait_json,
        notes, backstory, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, ?, ?, ?, ?)
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
    JSON.stringify(features),
    JSON.stringify(resources),
    JSON.stringify(input.spellcasting),
    input.portrait ? JSON.stringify(input.portrait) : null,
    input.notes,
    // Older library sheet_json blobs predate the field.
    input.backstory ?? "",
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

// All campaign copies of a library character; used to land the auto-generated
// portrait on sheets cloned before the render finished.
export function listSheetsForLibraryCharacter(libraryCharacterId: string): CharacterSheet[] {
  const rows = getDatabase()
    .prepare(`SELECT ${SHEET_COLUMNS} FROM character_sheets WHERE library_character_id = ?`)
    .all(libraryCharacterId) as SheetRow[];
  return rows.map(mapSheet);
}

export function listSheets(campaignId: string): CharacterSheet[] {
  const rows = getDatabase()
    .prepare(
      `SELECT ${SHEET_COLUMNS} FROM character_sheets WHERE campaign_id = ? ORDER BY created_at ASC`,
    )
    .all(campaignId) as SheetRow[];
  return rows.map(mapSheet);
}

export function patchSheet(sheetId: string, patch: FullPatchSheetInput): CharacterSheet | null {
  const existing = getSheetById(sheetId);
  if (!existing) {
    return null;
  }

  const next = {
    name: patch.name ?? existing.name,
    race: patch.race ?? existing.race,
    class: patch.class ?? existing.class,
    background: patch.background ?? existing.background,
    alignment: patch.alignment ?? existing.alignment,
    speed: patch.speed ?? existing.speed,
    abilities: patch.abilities ?? existing.abilities,
    // A bare `expertise` patch (level-up picks) merges into proficiencies;
    // only skills the sheet is proficient in count.
    proficiencies:
      patch.proficiencies ??
      (patch.expertise !== undefined
        ? {
            ...existing.proficiencies,
            expertise: patch.expertise.filter((skill) =>
              existing.proficiencies.skills.includes(skill),
            ),
          }
        : existing.proficiencies),
    currentHp: patch.currentHp ?? existing.currentHp,
    tempHp: patch.tempHp ?? existing.tempHp,
    maxHp: patch.maxHp ?? existing.maxHp,
    ac: patch.ac ?? existing.ac,
    xp: patch.xp ?? existing.xp,
    level: patch.level ?? existing.level,
    gold: patch.gold ?? existing.gold,
    conditions: patch.conditions ?? existing.conditions,
    conditionMeta: patch.conditionMeta ?? existing.conditionMeta,
    // Resources track features and level: any patch touching them re-sizes
    // the counters (spent uses preserved, clamped). An explicit resources
    // patch (rests, use_resource) wins.
    resources:
      patch.resources ??
      (patch.level !== undefined || patch.features !== undefined || patch.abilities !== undefined
        ? populateResources(
            patch.features ?? existing.features,
            patch.level ?? existing.level,
            Object.fromEntries(
              Object.entries(patch.abilities ?? existing.abilities).map(([ability, score]) => [
                ability,
                Math.floor((score - 10) / 2),
              ]),
            ),
            existing.resources,
          )
        : existing.resources),
    equipment: patch.equipment ?? existing.equipment,
    hitDice: patch.hitDice ?? existing.hitDice,
    exhaustion: patch.exhaustion ?? existing.exhaustion,
    spellcasting: patch.spellcasting !== undefined ? patch.spellcasting : existing.spellcasting,
    deathSaves: patch.deathSaves !== undefined ? patch.deathSaves : existing.deathSaves,
    concentratingOn:
      patch.concentratingOn !== undefined ? patch.concentratingOn : existing.concentratingOn,
    feats: patch.feats ?? existing.feats,
    features: patch.features ?? existing.features,
    subclass: patch.subclass ?? existing.subclass,
    portrait: patch.portrait !== undefined ? patch.portrait : existing.portrait,
    notes: patch.notes ?? existing.notes,
    backstory: patch.backstory ?? existing.backstory,
  };

  getDatabase()
    .prepare(
      `
        UPDATE character_sheets SET
          name = ?, race = ?, class = ?, background = ?, alignment = ?,
          speed = ?, abilities_json = ?, proficiencies_json = ?,
          current_hp = ?, temp_hp = ?, max_hp = ?, ac = ?, xp = ?, level = ?,
          gold = ?, conditions_json = ?, condition_meta_json = ?, resources_json = ?, equipment_json = ?, hit_dice_json = ?,
          spellcasting_json = ?, exhaustion = ?, death_saves_json = ?, concentrating_on = ?,
          feats_json = ?, features_json = ?, subclass = ?,
          portrait_json = ?, notes = ?, backstory = ?, updated_at = ?
        WHERE id = ?
      `,
    )
    .run(
      next.name,
      next.race,
      next.class,
      next.background,
      next.alignment,
      next.speed,
      JSON.stringify(next.abilities),
      JSON.stringify(next.proficiencies),
      Math.min(next.currentHp, next.maxHp),
      next.tempHp,
      next.maxHp,
      next.ac,
      next.xp,
      next.level,
      next.gold,
      JSON.stringify(next.conditions),
      JSON.stringify(next.conditionMeta),
      JSON.stringify(next.resources),
      JSON.stringify(next.equipment),
      JSON.stringify(next.hitDice),
      JSON.stringify(next.spellcasting),
      next.exhaustion,
      next.deathSaves ? JSON.stringify(next.deathSaves) : null,
      next.concentratingOn,
      JSON.stringify(next.feats),
      JSON.stringify(next.features),
      next.subclass,
      next.portrait ? JSON.stringify(next.portrait) : null,
      next.notes,
      next.backstory,
      nowIso(),
      sheetId,
    );
  touchCampaign(existing.campaignId);

  return getSheetById(sheetId);
}
