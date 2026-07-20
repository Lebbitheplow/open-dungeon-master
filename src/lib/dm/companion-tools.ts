import { z } from "zod";
import { allocateSeq, listMembers, type Campaign } from "@/lib/db/campaigns";
import {
  createSheet,
  getSheetById,
  listSheets,
  markSheetAsCompanion,
  patchSheet,
} from "@/lib/db/sheets";
import { createCompanionUser, deleteCompanionUser } from "@/lib/db/users";
import { insertCharacterEvent } from "@/lib/db/character-events";
import {
  activePublicEncounter,
  getActiveEncounter,
  saveEncounter,
  type OrderEntry,
} from "@/lib/db/encounters";
import {
  getBattleMapForEncounter,
  insertToken,
  listTokens,
  removeTokenByRef,
} from "@/lib/db/battle-maps";
import { findSpawnTiles } from "@/lib/battlemap/tactics";
import { occupiedTiles } from "@/lib/battlemap/view";
import { spliceIntoOrder } from "@/lib/dm/encounter-logic";
import { publishBattleMapUpdate } from "@/lib/dm/map-tools";
import { insertCampaignMessage } from "@/lib/db/messages";
import { publishPersisted, publishWithSeq } from "@/lib/events";
import { d20Expression, rollExpression } from "@/lib/dice";
import {
  abilityMod,
  findClass,
  findRace,
  levelForXp,
  spellSlotsFor,
  suggestedStartingHp,
  type SrdClass,
} from "@/lib/srd";
import { populateFeatures } from "@/lib/srd/features";
import { queueCompanionPortrait } from "@/lib/portrait";
import { genreClassIds } from "@/lib/classes";
import { genrePreset } from "@/lib/genres";
import { resolveCompanionMode, type CompanionMode } from "@/lib/schemas/game-settings";
import {
  createSheetSchema,
  type Ability,
  type CharacterSheet,
  type CreateSheetInput,
} from "@/lib/schemas/sheet";

// AI companion party members: sheets the DM recruits, plays, and dismisses.
// A companion is a full character sheet owned by an unloginable bot user,
// so every combat/rules engine treats it exactly like a player character;
// this module only handles recruiting, dismissal, and level-ups. Must not
// import turn.ts, loop.ts, encounter-tools.ts, enemy-damage.ts, or
// mutations.ts (they all import this).

export type { CompanionMode };

// Local copy of enemy-damage's publishEncounter: importing it would close
// an import cycle (mutations -> companion-tools -> enemy-damage -> mutations).
function publishEncounterState(campaignId: string) {
  publishPersisted(campaignId, "encounter_updated", {
    encounter: activePublicEncounter(campaignId),
  });
}

export function companionMode(campaign: Campaign): CompanionMode {
  return resolveCompanionMode(campaign.gameSettings, listMembers(campaign.id).length);
}

export function listCompanions(sheets: CharacterSheet[]): CharacterSheet[] {
  return sheets.filter((sheet) => sheet.isCompanion);
}

type ToolDef = {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

export const COMPANION_TOOL_NAMES = new Set(["add_companion", "dismiss_companion"]);

export function companionTools(campaign: Campaign): ToolDef[] {
  const mode = companionMode(campaign);
  if (mode === "off") {
    return [];
  }
  const preset = genrePreset(campaign.gameSettings.genre);
  const classIds = genreClassIds(campaign.gameSettings.genre);
  const classDescription = classIds.length
    ? `Class id from this world's catalog. Only these belong in this setting: ${classIds.join(", ")}. Anything else is refused.`
    : "Class id from this world's catalog, e.g. 'fighter', 'cleric'.";
  const raceDescription = preset.companionRaces.length
    ? `SRD race id. ${preset.raceHint} Allowed here: ${preset.companionRaces.join(", ")} (anything else becomes human).`
    : `SRD race id, e.g. 'human', 'hill_dwarf', 'high_elf'. ${preset.raceHint}`;
  const kindDescription =
    mode === "full"
      ? "'party' for a lasting party member who travels with the party until dismissed; 'guest' for a scene-scoped ally (a soldier helping defend the town) who leaves when the scene ends."
      : "Only 'guest' is allowed at this table: a scene-scoped ally (a soldier helping defend the town) who leaves when the scene or battle ends. Lasting party companions are disabled.";
  return [
    {
      type: "function",
      function: {
        name: "add_companion",
        description: `Write a new AI-controlled ally into the story with a REAL character sheet: they get stats, HP, equipment, an initiative slot, and a map token, and you control them fully (dialogue and combat). Call this BEFORE narrating them joining. An ally that never went through add_companion does not exist and cannot act or fight. They must belong in this world (${preset.name.toLowerCase()}): name, race, and class all fit the setting.`,
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            name: { type: "string", description: "The companion's in-world name." },
            race: { type: "string", description: raceDescription },
            class: { type: "string", description: classDescription },
            level: {
              type: "integer",
              minimum: 1,
              maximum: 20,
              description: "Optional; defaults to the party's average level.",
            },
            personality: {
              type: "string",
              description:
                "Short personality and voice brief you will roleplay from (2-3 traits, a quirk, how they talk).",
            },
            kind: { type: "string", enum: ["party", "guest"], description: kindDescription },
            spells: {
              type: "array",
              items: { type: "string" },
              description: "For casters: the spells they know (level-appropriate).",
            },
          },
          required: ["name", "class", "personality", "kind"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "dismiss_companion",
        description:
          "Write a companion out of the story: they part ways, their scene ends, or they died and the story moves on. Call this BEFORE narrating the departure; their sheet, initiative slot, and token are removed.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            characterId: { type: "string", description: "The companion's characterId from GAME STATE." },
            reason: { type: "string", description: "Short in-fiction reason for the departure." },
          },
          required: ["characterId"],
        },
      },
    },
  ];
}

const addArgsSchema = z.object({
  name: z.string().trim().min(1).max(60),
  race: z.string().trim().max(60).optional(),
  class: z.string().trim().min(1).max(60),
  level: z.number().int().min(1).max(20).optional(),
  personality: z.string().trim().min(1).max(500),
  kind: z.enum(["party", "guest"]).default("guest"),
  spells: z.array(z.string().trim().min(1).max(60)).max(12).optional(),
});

const dismissArgsSchema = z.object({
  characterId: z.string().trim().min(1),
  reason: z.string().trim().max(300).optional(),
});

const STANDARD_ARRAY = [15, 14, 13, 12, 10, 8];
const ABILITY_ORDER: Ability[] = ["str", "dex", "con", "int", "wis", "cha"];

// Standard-array assignment by a class-shaped priority: casters lead with
// their casting stat, STR-save classes fight in melee, everyone else is a
// DEX skirmisher. CON always lands second or third.
function abilityPriority(klass: SrdClass): Ability[] {
  if (klass.spellAbility) {
    const rest = ABILITY_ORDER.filter(
      (ability) => ability !== klass.spellAbility && ability !== "con" && ability !== "dex",
    );
    return [klass.spellAbility, "con", "dex", ...rest];
  }
  if (klass.saves.includes("str")) {
    return ["str", "con", "dex", "wis", "cha", "int"];
  }
  return ["dex", "con", "wis", "str", "int", "cha"];
}

function slugify(value: string): string {
  return value.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function resolveClass(raw: string): SrdClass | null {
  const direct = findClass(slugify(raw));
  if (direct) {
    return direct;
  }
  return findClass(raw.trim().toLowerCase()) ?? null;
}

export function handleAddCompanion(
  campaign: Campaign,
  rawArguments: string,
  sheets: CharacterSheet[],
): Record<string, unknown> {
  const mode = companionMode(campaign);
  if (mode === "off") {
    return { error: "Companions are disabled for this campaign." };
  }
  let args: z.infer<typeof addArgsSchema>;
  try {
    args = addArgsSchema.parse(JSON.parse(rawArguments || "{}"));
  } catch {
    return {
      error:
        "Invalid arguments: add_companion needs name, class, personality, and kind ('party' or 'guest').",
    };
  }

  const notes: string[] = [];
  let kind = args.kind;
  if (mode === "guests" && kind === "party") {
    kind = "guest";
    notes.push(
      "Lasting party companions are disabled at this table, so they joined as a scene-scoped guest; dismiss them when their scene ends.",
    );
  }

  // Party members and scene guests have separate caps: a temporary ally
  // showing up for one fight never blocks a lasting companion, or the reverse.
  const existing = listCompanions(listSheets(campaign.id)).filter(
    (sheet) => (sheet.companionKind === "guest" ? "guest" : "party") === kind,
  );
  const cap =
    kind === "guest" ? campaign.gameSettings.maxGuests : campaign.gameSettings.maxCompanions;
  if (existing.length >= cap) {
    const label = kind === "guest" ? "guest ally" : "companion";
    return {
      error: `The party already has ${existing.length} ${label}${existing.length === 1 ? "" : "s"} (limit ${cap}). Dismiss one before adding another.`,
    };
  }

  const preset = genrePreset(campaign.gameSettings.genre);
  const klass = resolveClass(args.class);
  if (!klass) {
    return {
      error: `Unknown class "${args.class}". Use a class id from this world's catalog (e.g. fighter, cleric, rogue, wizard).`,
    };
  }
  // Off-genre classes are refused outright: a high-fantasy paladin walking
  // into a cyberpunk campaign breaks the world harder than a retry costs.
  const allowedClasses = genreClassIds(campaign.gameSettings.genre);
  if (allowedClasses.length && !allowedClasses.includes(klass.id)) {
    return {
      error: `${klass.name} does not belong in this world (${preset.name}). Call add_companion again with one of: ${allowedClasses.join(", ")}.`,
    };
  }

  // Races coerce instead of refusing: the allowed set is the genre's list plus
  // whatever the players themselves are playing, so a table running an elf in a
  // neon city keeps that door open.
  const race = findRace(slugify(args.race ?? "")) ?? findRace("human");
  if (!race) {
    return { error: "No usable race found." };
  }
  const playerRaces = sheets.filter((sheet) => !sheet.isCompanion).map((sheet) => sheet.race);
  const allowedRaces = preset.companionRaces.length
    ? new Set([...preset.companionRaces, ...playerRaces])
    : null;
  let chosenRace = race;
  if (args.race && race.id === "human" && slugify(args.race) !== "human") {
    notes.push(`Unknown race "${args.race}"; they are human instead.`);
  } else if (allowedRaces && !allowedRaces.has(race.id)) {
    chosenRace = findRace("human") ?? race;
    notes.push(
      `${race.name} does not belong in this world, so they are human instead. ${preset.raceHint}`,
    );
  }

  // Level matches the party (average of the real players' characters).
  const partyLevels = sheets.filter((sheet) => !sheet.isCompanion).map((sheet) => sheet.level);
  const averageLevel = partyLevels.length
    ? Math.round(partyLevels.reduce((sum, level) => sum + level, 0) / partyLevels.length)
    : 1;
  const level = Math.max(1, Math.min(20, args.level ?? averageLevel));

  // Standard array by class priority, then racial ASI.
  const priority = abilityPriority(klass);
  const abilities = { str: 8, dex: 8, con: 8, int: 8, wis: 8, cha: 8 } as Record<Ability, number>;
  priority.forEach((ability, index) => {
    abilities[ability] = STANDARD_ARRAY[index] ?? 8;
  });
  for (const [ability, bonus] of Object.entries(chosenRace.asi)) {
    abilities[ability as Ability] += bonus ?? 0;
  }

  const dexMod = abilityMod(abilities.dex);
  // Armor and weapons: a simple, valid kit the attack engine can resolve.
  let ac: number;
  const equipment: Array<{ name: string; qty: number }> = [];
  if (klass.armor.includes("heavy")) {
    ac = 16;
    equipment.push({ name: "Chain Mail", qty: 1 });
  } else if (klass.armor.includes("medium")) {
    ac = 14 + Math.min(2, dexMod);
    equipment.push({ name: "Scale Mail", qty: 1 });
  } else if (klass.armor.includes("light")) {
    ac = 11 + dexMod;
    equipment.push({ name: "Leather Armor", qty: 1 });
  } else {
    ac = 10 + dexMod;
  }
  const martial = klass.weapons.includes("martial");
  const primaryAbility = priority[0];
  if (klass.spellAbility) {
    equipment.push({ name: "Quarterstaff", qty: 1 }, { name: "Component Pouch", qty: 1 });
  } else if (primaryAbility === "dex") {
    equipment.push(
      { name: martial ? "Rapier" : "Dagger", qty: 1 },
      { name: "Shortbow", qty: 1 },
    );
  } else {
    equipment.push({ name: martial ? "Longsword" : "Mace", qty: 1 });
    if (klass.armor.includes("shields")) {
      ac += 2;
      equipment.push({ name: "Shield", qty: 1 });
    }
  }
  equipment.push({ name: "Adventurer's Pack", qty: 1 });

  const skills = klass.skillChoices.from.slice(0, klass.skillChoices.count);
  const slots = spellSlotsFor(klass.id, level);
  const spellcasting = klass.spellAbility
    ? {
        ability: klass.spellAbility,
        slots: Object.fromEntries(
          Object.entries(slots).map(([slotLevel, max]) => [slotLevel, { max, used: 0 }]),
        ),
        known: args.spells ?? [],
        prepared: [],
      }
    : null;
  if (klass.spellAbility && !args.spells?.length) {
    notes.push(
      "They know no spells yet: use learn_spell to give this caster a level-appropriate spell list now.",
    );
  }

  const input = createSheetSchema.parse({
    name: args.name,
    race: chosenRace.id,
    class: klass.id,
    background: "",
    alignment: "",
    abilities,
    maxHp: suggestedStartingHp(klass.id, chosenRace.id, abilities.con, level),
    ac,
    speed: chosenRace.speed,
    hitDice: { die: `d${klass.hitDie}`, total: level, spent: 0 },
    proficiencies: {
      saves: klass.saves,
      skills,
      expertise: [],
      languages: chosenRace.languages.length ? chosenRace.languages : ["Common"],
      tools: [],
      armor: klass.armor,
      weapons: klass.weapons,
    },
    equipment,
    gold: 10,
    spellcasting,
    backstory: args.personality,
  });

  const { sheet, hadEncounter } = finalizeNewCompanion(campaign, level, input, kind, args.personality);

  return {
    ok: true,
    characterId: sheet.id,
    name: sheet.name,
    summary: `${sheet.name}, ${chosenRace.name} ${klass.name} ${level} (${kind} companion). HP ${sheet.maxHp}, AC ${sheet.ac}.`,
    note: `They are real now: full sheet, ${hadEncounter ? "an initiative slot and a map token, " : ""}and you control them. Narrate their arrival with their own voice.${notes.length ? ` ${notes.join(" ")}` : ""}`,
  };
}

// Shared creation for every companion path (the DM's add_companion and the
// party lead's manual build): a bot user, the sheet, the companion mark, a
// portrait for lasting members, a story event, and, mid-fight, a real
// initiative slot and a map token beside the party. Returns the sheet and
// whether an encounter was live so callers can word their own responses.
export function finalizeNewCompanion(
  campaign: Campaign,
  level: number,
  input: CreateSheetInput,
  kind: "party" | "guest",
  personality: string,
): { sheet: CharacterSheet; hadEncounter: boolean } {
  const botUser = createCompanionUser(input.name);
  const created = createSheet(campaign.id, botUser.id, level, input);
  const sheet = markSheetAsCompanion(created.id, kind, personality) ?? created;
  publishPersisted(campaign.id, "sheet_updated", { sheet });
  insertCharacterEvent({
    libraryCharacterId: null,
    campaignCharacterId: sheet.id,
    campaignId: campaign.id,
    seq: allocateSeq(campaign.id),
    kind: "story",
    summary: `${sheet.name} joined the party as an AI companion (${kind}).`,
  });
  // Guests are transient and the render queue shares the one iGPU with the DM
  // model, so only lasting party members are worth a portrait; a sheet built
  // with its own portrait already (manual build) keeps it.
  if (kind === "party" && !sheet.portrait) {
    queueCompanionPortrait({
      id: sheet.id,
      campaignId: campaign.id,
      name: sheet.name,
      race: sheet.race,
      class: sheet.class,
      background: sheet.background,
      personality,
      genre: campaign.gameSettings.genre,
    });
  }

  // Mid-combat arrival: a real initiative slot and a token beside the party,
  // exactly like add_enemies does for the other side.
  const encounter = getActiveEncounter(campaign.id);
  if (encounter) {
    const initiative = rollExpression(d20Expression(abilityMod(sheet.abilities.dex))).total;
    if (encounter.orderReady) {
      const entry: OrderEntry = {
        kind: "pc",
        characterId: sheet.id,
        userId: botUser.id,
        name: sheet.name,
        initiative,
      };
      const spliced = spliceIntoOrder(encounter.order, encounter.turnIndex, [entry]);
      encounter.order = spliced.order;
      encounter.turnIndex = spliced.turnIndex;
      saveEncounter(encounter);
      publishEncounterState(campaign.id);
    }
    const map = getBattleMapForEncounter(encounter.id);
    if (map) {
      const tokens = listTokens(map.id);
      const spot = findSpawnTiles(
        map.terrain,
        map.width,
        map.height,
        occupiedTiles(map, tokens, null),
        1,
        tokens.filter((token) => token.kind === "pc").map((token) => ({ x: token.x, y: token.y })),
        tokens.filter((token) => token.kind === "enemy").map((token) => ({ x: token.x, y: token.y })),
      )[0];
      if (spot) {
        insertToken({
          mapId: map.id,
          campaignId: campaign.id,
          kind: "pc",
          refId: sheet.id,
          name: sheet.name,
          x: spot.x,
          y: spot.y,
        });
        publishBattleMapUpdate(campaign.id);
      }
    }
  }

  return { sheet, hadEncounter: Boolean(encounter) };
}

export function handleDismissCompanion(
  campaign: Campaign,
  rawArguments: string,
  sheets: CharacterSheet[],
): Record<string, unknown> {
  let args: z.infer<typeof dismissArgsSchema>;
  try {
    args = dismissArgsSchema.parse(JSON.parse(rawArguments || "{}"));
  } catch {
    return { error: "Invalid arguments: dismiss_companion needs characterId." };
  }
  const needle = args.characterId.trim().toLowerCase();
  const sheet =
    sheets.find((candidate) => candidate.id === args.characterId) ??
    sheets.find((candidate) => candidate.name.toLowerCase() === needle) ??
    null;
  if (!sheet) {
    return { error: "Unknown characterId; use one from GAME STATE." };
  }
  if (!sheet.isCompanion) {
    return { error: `${sheet.name} is a player's character and cannot be dismissed.` };
  }
  removeCompanion(campaign, sheet, args.reason);

  return {
    ok: true,
    dismissed: sheet.name,
    note: `${sheet.name} is out of the party; their sheet is gone. Narrate the departure.`,
  };
}

// The whole removal: initiative slot, map token, story event, sheet, and the
// bot user behind it. Shared by dismiss_companion and the end-of-fight sweep.
function removeCompanion(campaign: Campaign, sheet: CharacterSheet, reason?: string) {
  // Mid-combat: pull them out of the order and off the map cleanly.
  const encounter = getActiveEncounter(campaign.id);
  if (encounter) {
    const index = encounter.order.findIndex(
      (entry) => entry.kind === "pc" && entry.characterId === sheet.id,
    );
    if (index !== -1) {
      encounter.order.splice(index, 1);
      if (index < encounter.turnIndex) {
        encounter.turnIndex -= 1;
      } else if (index === encounter.turnIndex) {
        encounter.turnIndex = Math.max(0, encounter.turnIndex - 1);
      }
      saveEncounter(encounter);
      publishEncounterState(campaign.id);
    }
    const map = getBattleMapForEncounter(encounter.id);
    if (map) {
      removeTokenByRef(map.id, sheet.id);
      publishBattleMapUpdate(campaign.id);
    }
  }

  insertCharacterEvent({
    libraryCharacterId: null,
    campaignCharacterId: sheet.id,
    campaignId: campaign.id,
    seq: allocateSeq(campaign.id),
    kind: "story",
    summary: `${sheet.name} left the party${reason ? `: ${reason}` : "."}`,
  });
  publishPersisted(campaign.id, "sheet_deleted", { sheetId: sheet.id, userId: sheet.userId });
  // The bot user owns nothing but this sheet; the FK cascade removes it.
  deleteCompanionUser(sheet.userId);
}

// Called when a fight ends: scene-scoped guests are exactly that, so the
// server writes them out instead of letting temporary allies quietly become
// permanent party members. Returns their names for the DM to narrate.
export function dismissGuestCompanions(campaign: Campaign, reason: string): string[] {
  const guests = listCompanions(listSheets(campaign.id)).filter(
    (sheet) => sheet.companionKind === "guest",
  );
  if (!guests.length) {
    return [];
  }
  for (const guest of guests) {
    removeCompanion(campaign, guest, reason);
  }
  const names = guests.map((guest) => guest.name);
  const seq = allocateSeq(campaign.id);
  const message = insertCampaignMessage({
    campaignId: campaign.id,
    seq,
    authorType: "system",
    content: `${names.join(" and ")} ${names.length === 1 ? "was" : "were"} a temporary ally and leaves the party now that the fight is over. Narrate the goodbye.`,
  });
  publishWithSeq(campaign.id, seq, "message_added", { message });
  return names;
}

export function applyCompanionCall(
  campaign: Campaign,
  toolName: string,
  rawArguments: string,
  sheets: CharacterSheet[],
): Record<string, unknown> {
  if (toolName === "add_companion") {
    return handleAddCompanion(campaign, rawArguments, sheets);
  }
  if (toolName === "dismiss_companion") {
    return handleDismissCompanion(campaign, rawArguments, sheets);
  }
  return { error: `Unknown companion tool ${toolName}.` };
}

// Companions have no level-up dialog, so an XP award that crosses a level
// threshold applies a plain headless level-up (average HP, refreshed
// features and slots; subclass choices stay as they are).
export function autoLevelCompanion(campaign: Campaign, sheetId: string): string | null {
  const sheet = getSheetById(sheetId);
  if (!sheet?.isCompanion) {
    return null;
  }
  const target = levelForXp(sheet.xp);
  if (target <= sheet.level) {
    return null;
  }
  const features = populateFeatures(sheet.features, sheet.class, sheet.subclass, sheet.race, target);
  const maxHp = suggestedStartingHp(sheet.class, sheet.race, sheet.abilities.con, target);
  const hpGain = Math.max(0, maxHp - sheet.maxHp);
  const slots = spellSlotsFor(sheet.class, target);
  const spellcasting =
    sheet.spellcasting && Object.keys(slots).length
      ? {
          ...sheet.spellcasting,
          slots: Object.fromEntries(
            Object.entries(slots).map(([slotLevel, max]) => {
              const used = sheet.spellcasting?.slots[slotLevel]?.used ?? 0;
              return [slotLevel, { max, used: Math.min(used, max) }];
            }),
          ),
        }
      : sheet.spellcasting;
  const updated = patchSheet(sheet.id, {
    level: target,
    maxHp,
    currentHp: sheet.currentHp + hpGain,
    hitDice: { die: sheet.hitDice.die, total: target, spent: Math.min(sheet.hitDice.spent, target) },
    features,
    spellcasting,
  });
  if (!updated) {
    return null;
  }
  publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
  insertCharacterEvent({
    libraryCharacterId: null,
    campaignCharacterId: sheet.id,
    campaignId: campaign.id,
    seq: allocateSeq(campaign.id),
    kind: "level_up",
    summary: `${sheet.name} reached level ${target}.`,
  });
  return `${sheet.name} leveled up to ${target} automatically (companions level with the party).`;
}
