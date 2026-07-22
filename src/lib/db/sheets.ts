import { getDatabase, nowIso, parseJson } from "@/lib/db/core";
import { touchCampaign } from "@/lib/db/campaigns";
import { populateFeaturesForClasses } from "@/lib/srd/features";
import { populateResources } from "@/lib/srd/class-resources";
import { deriveAc } from "@/lib/srd";
import { ATTUNEMENT_SLOTS } from "@/lib/srd/armor";
import { backgroundFeatureFor } from "@/lib/backgrounds";
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
  ac_override: number | null;
  speed: number;
  hit_dice_json: string;
  classes_json: string | null;
  hit_dice_pools_json: string | null;
  proficiencies_json: string;
  equipment_json: string;
  gold: number;
  feats_json: string;
  features_json: string | null;
  spellcasting_json: string;
  conditions_json: string;
  condition_meta_json: string | null;
  resources_json: string | null;
  wild_shape_json: string | null;
  pets_json: string | null;
  exhaustion: number | null;
  death_saves_json: string | null;
  concentrating_on: string | null;
  portrait_json: string | null;
  notes: string;
  backstory: string | null;
  is_companion: number | null;
  companion_kind: string | null;
  personality: string | null;
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
    acOverride: row.ac_override === 1,
    speed: row.speed,
    hitDice: parseJson(row.hit_dice_json, { die: "d8" as const, total: 1, spent: 0 }),
    classes: parseJson<CharacterSheet["classes"]>(row.classes_json, []),
    hitDicePools: parseJson<CharacterSheet["hitDicePools"]>(row.hit_dice_pools_json, null),
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
    wildShape: parseJson<CharacterSheet["wildShape"]>(row.wild_shape_json, null),
    pets: parseJson<CharacterSheet["pets"]>(row.pets_json, []),
    exhaustion: row.exhaustion ?? 0,
    deathSaves: parseJson<CharacterSheet["deathSaves"]>(row.death_saves_json, null),
    concentratingOn: row.concentrating_on ?? null,
    portrait: parseJson<CharacterSheet["portrait"]>(row.portrait_json, null),
    notes: row.notes,
    backstory: row.backstory ?? "",
    isCompanion: row.is_companion === 1,
    companionKind:
      row.companion_kind === "party" || row.companion_kind === "guest"
        ? row.companion_kind
        : null,
    personality: row.personality ?? "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const SHEET_COLUMNS = `
  id, campaign_id, user_id, library_character_id, name, race, class, subclass,
  background, alignment, level, xp,
  abilities_json, max_hp, current_hp, temp_hp, ac, ac_override, speed, hit_dice_json,
  classes_json, hit_dice_pools_json,
  proficiencies_json, equipment_json, gold, feats_json, features_json,
  spellcasting_json, conditions_json, condition_meta_json, resources_json, wild_shape_json, pets_json, exhaustion, death_saves_json, concentrating_on,
  portrait_json, notes, backstory, is_companion, companion_kind, personality, created_at, updated_at
`;

// Flags a freshly created sheet as an AI companion. Kept out of the main
// INSERT so every existing creation path stays untouched.
export function markSheetAsCompanion(
  sheetId: string,
  kind: "party" | "guest",
  personality: string,
): CharacterSheet | null {
  getDatabase()
    .prepare(
      `UPDATE character_sheets SET is_companion = 1, companion_kind = ?, personality = ? WHERE id = ?`,
    )
    .run(kind, personality, sheetId);
  return getSheetById(sheetId);
}

// Backgrounds grant a named feature ("Shelter of the Faithful"). It is added
// once at creation with source "background", which populateFeatures keeps
// across level-ups and boot resyncs.
function withBackgroundFeature(
  features: CreateSheetInput["features"],
  background: string,
): NonNullable<CreateSheetInput["features"]> {
  const list = features ?? [];
  const granted = backgroundFeatureFor(background);
  if (!granted) {
    return list;
  }
  const label = `${granted.name} (${granted.background})`;
  if (list.some((feature) => feature.name.toLowerCase() === label.toLowerCase())) {
    return list;
  }
  return [...list, { name: label, source: "background" as const }];
}

// The attunement cap is enforced here rather than in the UI so no path
// (player toggle, DM update_sheet, undo) can slip a fourth item through;
// extras past the third are simply un-attuned, keeping the earlier picks.
function capAttunement(equipment: CharacterSheet["equipment"]): CharacterSheet["equipment"] {
  let attuned = 0;
  return equipment.map((item) => {
    if (!item.attuned) {
      return item;
    }
    attuned += 1;
    return attuned <= ATTUNEMENT_SLOTS ? item : { ...item, attuned: false };
  });
}

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
  // A multiclassed library character re-entering play grants per class.
  const classList =
    (input.classes ?? []).length > 1
      ? input.classes
      : [{ id: input.class, subclass: input.subclass, level }];
  const features = populateFeaturesForClasses(
    withBackgroundFeature(input.features ?? [], input.background),
    classList,
    input.race,
  );
  // Limited-use counters (Rage, Ki, Second Wind...) sized for the features
  // just granted; the resource engine spends and refills them.
  const abilityMods = Object.fromEntries(
    Object.entries(input.abilities).map(([ability, score]) => [
      ability,
      Math.floor((score - 10) / 2),
    ]),
  );
  const resources = populateResources(
    features,
    level,
    abilityMods,
    undefined,
    classList.length > 1 ? classList : undefined,
  );
  // Unless the AC is pinned, it comes from the gear they are actually
  // carrying rather than the builder's suggestion. An absent flag means a
  // library character stored before the engine: its equipment list has no
  // armor in it, so its saved AC is the only truthful number available.
  const acOverride = input.acOverride ?? true;
  const ac = acOverride
    ? input.ac
    : deriveAc({
        class: input.class,
        level,
        classes: classList.length > 1 ? classList : undefined,
        abilities: input.abilities,
        proficiencies: input.proficiencies,
        equipment: input.equipment,
        features,
      });

  db.prepare(
    `
      INSERT INTO character_sheets (
        id, campaign_id, user_id, library_character_id, name, race, class,
        subclass, background, alignment,
        level, xp, abilities_json, max_hp, current_hp, temp_hp, ac, ac_override, speed,
        hit_dice_json, classes_json, hit_dice_pools_json, proficiencies_json, equipment_json, gold, feats_json,
        features_json, resources_json, spellcasting_json, conditions_json, portrait_json,
        notes, backstory, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, ?, ?, ?, ?)
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
    ac,
    acOverride ? 1 : 0,
    input.speed,
    JSON.stringify(input.hitDice),
    classList.length > 1 ? JSON.stringify(classList) : null,
    classList.length > 1 && input.hitDicePools?.length
      ? JSON.stringify(input.hitDicePools)
      : null,
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

// Lobby-only character removal (delete, switch, or recreate); returns the
// removed sheet so callers can publish sheet_deleted. Dependent rows
// (pending rolls, tokens) cascade via foreign keys where defined; the lobby
// has none of them yet.
export function deleteSheetForUser(campaignId: string, userId: string): CharacterSheet | null {
  const existing = getSheetForUser(campaignId, userId);
  if (!existing) {
    return null;
  }
  getDatabase().prepare(`DELETE FROM character_sheets WHERE id = ?`).run(existing.id);
  touchCampaign(campaignId);
  return existing;
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

// Mirror of per-class hit-die pools into the legacy single hitDice field:
// die = the primary class's pool, totals and spents summed. Every existing
// consumer (UI counters, prompt, rest planners) keeps reading hitDice.
function poolsMirror(
  pools: NonNullable<CharacterSheet["hitDicePools"]>,
  primaryClassId: string | undefined,
): CharacterSheet["hitDice"] {
  const primary =
    pools.find((pool) => pool.classId.toLowerCase() === (primaryClassId ?? "").toLowerCase()) ??
    pools[0];
  const total = Math.min(20, pools.reduce((sum, pool) => sum + pool.total, 0));
  const spent = Math.min(total, pools.reduce((sum, pool) => sum + pool.spent, 0));
  return { die: primary.die, total, spent };
}

// A bare hitDice patch (the usage +/- buttons, short-rest spends) arrives as
// a change to the summed mirror; fold the spent delta into the pools,
// biggest die first in both directions (spending big dice heals more, and
// recovering them first is strictly kinder).
function adjustPoolsSpent(
  pools: NonNullable<CharacterSheet["hitDicePools"]>,
  delta: number,
): NonNullable<CharacterSheet["hitDicePools"]> {
  const next = pools.map((pool) => ({ ...pool }));
  const byDie = [...next].sort(
    (a, b) => Number(b.die.slice(1)) - Number(a.die.slice(1)),
  );
  let remaining = delta;
  while (remaining > 0) {
    const pool = byDie.find((candidate) => candidate.spent < candidate.total);
    if (!pool) {
      break;
    }
    pool.spent += 1;
    remaining -= 1;
  }
  while (remaining < 0) {
    const pool = byDie.find((candidate) => candidate.spent > 0);
    if (!pool) {
      break;
    }
    pool.spent -= 1;
    remaining += 1;
  }
  return next;
}

export function patchSheet(sheetId: string, patch: FullPatchSheetInput): CharacterSheet | null {
  const existing = getSheetById(sheetId);
  if (!existing) {
    return null;
  }

  // Multiclass: the classes array is authoritative when present, and the
  // scalar class/subclass/level fields are mirrors of it. Scalar patches on
  // a multiclass sheet (lead edits, update_sheet) fold into the primary
  // entry so the two shapes can never disagree.
  let classes = patch.classes ?? existing.classes;
  if (!patch.classes && existing.classes.length > 0) {
    classes = existing.classes.map((entry, index) =>
      index === 0
        ? {
            ...entry,
            id: patch.class ?? entry.id,
            subclass: patch.subclass ?? entry.subclass,
            level:
              patch.level !== undefined
                ? Math.max(1, Math.min(20, entry.level + (patch.level - existing.level)))
                : entry.level,
          }
        : entry,
    );
  }
  const usingClasses = classes.length > 0;
  const summedLevel = Math.min(
    20,
    classes.reduce((sum, entry) => sum + entry.level, 0),
  );

  let hitDicePools =
    patch.hitDicePools !== undefined ? patch.hitDicePools : existing.hitDicePools;
  if (
    hitDicePools?.length &&
    patch.hitDicePools === undefined &&
    patch.hitDice !== undefined
  ) {
    hitDicePools = adjustPoolsSpent(
      hitDicePools,
      patch.hitDice.spent - existing.hitDice.spent,
    );
  }

  const next = {
    name: patch.name ?? existing.name,
    race: patch.race ?? existing.race,
    class: usingClasses ? classes[0].id : (patch.class ?? existing.class),
    classes,
    hitDicePools,
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
    // Setting an AC by hand pins it; clearing the flag hands it back to the
    // armor engine, which recomputes it below.
    acOverride: patch.acOverride ?? (patch.ac !== undefined ? true : existing.acOverride),
    ac: patch.ac ?? existing.ac,
    xp: patch.xp ?? existing.xp,
    level: usingClasses ? summedLevel : (patch.level ?? existing.level),
    gold: patch.gold ?? existing.gold,
    conditions: patch.conditions ?? existing.conditions,
    conditionMeta: patch.conditionMeta ?? existing.conditionMeta,
    // Resources track features and level: any patch touching them re-sizes
    // the counters (spent uses preserved, clamped). An explicit resources
    // patch (rests, use_resource) wins.
    resources:
      patch.resources ??
      (patch.level !== undefined ||
      patch.features !== undefined ||
      patch.abilities !== undefined ||
      patch.classes !== undefined
        ? populateResources(
            patch.features ?? existing.features,
            usingClasses ? summedLevel : (patch.level ?? existing.level),
            Object.fromEntries(
              Object.entries(patch.abilities ?? existing.abilities).map(([ability, score]) => [
                ability,
                Math.floor((score - 10) / 2),
              ]),
            ),
            existing.resources,
            classes.length ? classes : undefined,
          )
        : existing.resources),
    equipment: capAttunement(patch.equipment ?? existing.equipment),
    hitDice: hitDicePools?.length
      ? poolsMirror(hitDicePools, classes[0]?.id)
      : (patch.hitDice ?? existing.hitDice),
    wildShape: patch.wildShape !== undefined ? patch.wildShape : existing.wildShape,
    pets: patch.pets ?? existing.pets,
    exhaustion: patch.exhaustion ?? existing.exhaustion,
    spellcasting: patch.spellcasting !== undefined ? patch.spellcasting : existing.spellcasting,
    deathSaves: patch.deathSaves !== undefined ? patch.deathSaves : existing.deathSaves,
    concentratingOn:
      patch.concentratingOn !== undefined ? patch.concentratingOn : existing.concentratingOn,
    feats: patch.feats ?? existing.feats,
    features: patch.features ?? existing.features,
    subclass: usingClasses ? classes[0].subclass : (patch.subclass ?? existing.subclass),
    portrait: patch.portrait !== undefined ? patch.portrait : existing.portrait,
    notes: patch.notes ?? existing.notes,
    backstory: patch.backstory ?? existing.backstory,
  };

  // The armor engine owns the AC unless a human pinned it: buying a
  // breastplate, equipping a shield, or gaining Unarmored Defense changes
  // the number here rather than waiting for someone to retype it.
  if (!next.acOverride) {
    next.ac = deriveAc({
      class: next.class,
      level: next.level,
      classes: next.classes.length ? next.classes : undefined,
      abilities: next.abilities,
      proficiencies: next.proficiencies,
      equipment: next.equipment,
      features: next.features,
      // Effect conditions (Shield of Faith, Mage Armor, Barkskin) move the
      // stored AC while they hold; expiry recomputes it right back.
      conditions: next.conditions,
    });
  }

  getDatabase()
    .prepare(
      `
        UPDATE character_sheets SET
          name = ?, race = ?, class = ?, background = ?, alignment = ?,
          speed = ?, abilities_json = ?, proficiencies_json = ?,
          current_hp = ?, temp_hp = ?, max_hp = ?, ac = ?, ac_override = ?, xp = ?, level = ?,
          gold = ?, conditions_json = ?, condition_meta_json = ?, resources_json = ?, equipment_json = ?, hit_dice_json = ?,
          spellcasting_json = ?, wild_shape_json = ?, pets_json = ?, exhaustion = ?, death_saves_json = ?, concentrating_on = ?,
          feats_json = ?, features_json = ?, subclass = ?,
          classes_json = ?, hit_dice_pools_json = ?,
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
      next.acOverride ? 1 : 0,
      next.xp,
      next.level,
      next.gold,
      JSON.stringify(next.conditions),
      JSON.stringify(next.conditionMeta),
      JSON.stringify(next.resources),
      JSON.stringify(next.equipment),
      JSON.stringify(next.hitDice),
      JSON.stringify(next.spellcasting),
      next.wildShape ? JSON.stringify(next.wildShape) : null,
      next.pets.length ? JSON.stringify(next.pets) : null,
      next.exhaustion,
      next.deathSaves ? JSON.stringify(next.deathSaves) : null,
      next.concentratingOn,
      JSON.stringify(next.feats),
      JSON.stringify(next.features),
      next.subclass,
      next.classes.length ? JSON.stringify(next.classes) : null,
      next.hitDicePools?.length ? JSON.stringify(next.hitDicePools) : null,
      next.portrait ? JSON.stringify(next.portrait) : null,
      next.notes,
      next.backstory,
      nowIso(),
      sheetId,
    );
  touchCampaign(existing.campaignId);

  return getSheetById(sheetId);
}
