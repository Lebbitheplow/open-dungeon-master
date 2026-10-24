import { z } from "zod";
import { rollCard } from "@/lib/dm/roll-card";
import { allocateSeq, campaignSeats, countPartySlots, type Campaign } from "@/lib/db/campaigns";
import { createSheet, listSheets, markSheetAsCompanion, setCompanionCommander } from "@/lib/db/sheets";
import { defaultCommander } from "@/lib/dm/companion-command";
import { createCompanionUser, deleteCompanionUser } from "@/lib/db/users";
import {
  partRelationshipsWithSubject,
  rejoinRelationshipsWithSubject,
} from "@/lib/db/relationships";
import { insertCharacterEvent } from "@/lib/db/character-events";
import { getActiveEncounter, saveEncounter, type OrderEntry } from "@/lib/db/encounters";
import { activePublicEncounter } from "@/lib/db/encounter-view";
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
import { defaultRng } from "@/lib/dice";
import { characterInitiativeExpression } from "@/lib/dm/contest-roll";
import {
  DRACONIC_ANCESTRY_IDS,
  findDraconicAncestry,
  rollDraconicAncestry,
  takesDraconicAncestry,
} from "@/lib/srd/racial-grants";
import { abilityMod, findClass, findRace, suggestedStartingHp, type SrdClass } from "@/lib/srd";
import { abilityPriority } from "@/lib/srd/companion-build";
import { startingKitFor } from "@/lib/srd/starting-kit";
import { legalCompanionSheet } from "@/lib/dm/companion-level";
import { queueCompanionPortrait } from "@/lib/portrait";
import { settingClassIds } from "@/lib/classes";
import { TOLD_GENDER_HELP, TOLD_GENDERS, toldGender } from "@/lib/gender";
import { attractionFromTold, TOLD_ATTRACTION } from "@/lib/attraction";
import { companionNpcFor, lastingCompanion, rememberDepartingSheet } from "@/lib/db/companion-npcs";
import { returningCompanion, settleReturn } from "@/lib/dm/companion-return";
import { presetFor, packFor } from "@/lib/worlds/preset";
import { packIds } from "@/lib/worlds/reskin-logic";
import {
  lastingCompanionBlock,
  resolveCompanionMode,
  type CompanionMode,
  type LastingCompanionBlock,
} from "@/lib/schemas/game-settings";
import { hasHumanDm } from "@/lib/dm/viewer";
import {
  createSheetSchema,
  type Ability,
  type CharacterSheet,
  type CreateSheetInput,
} from "@/lib/schemas/sheet";
import { toolError, type ToolResult } from "@/lib/dm/tool-errors";
import { textKey } from "@/lib/language/text-logic";
import { unknownSheetRef } from "@/lib/dm/rolls";
import { ALIGNMENT_CODES, VALUES_PARAMETER, valuesArgSchema } from "@/lib/dm/companion-values-logic";
import { setCompanionValues } from "@/lib/db/companion-conscience";
import { seedAgenda } from "@/lib/dm/companion-agenda";

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

// Party slots, not member rows: a DM seat is not a player, so a table of one
// player and a person running it is still a table that "auto" should give a
// full companion to. Counting the DM as a second player was what quietly
// dropped a human-run duo down to guests-only.
export function companionMode(campaign: Campaign): CompanionMode {
  return resolveCompanionMode(
    campaign.gameSettings,
    countPartySlots(campaign.id),
    hasHumanDm(campaignSeats(campaign)),
  );
}

export function listCompanions(sheets: CharacterSheet[]): CharacterSheet[] {
  return sheets.filter((sheet) => sheet.isCompanion);
}

// Why a lasting party companion cannot join this table now, with the way
// to allow one (game-settings.ts lastingCompanionBlock, issue 209); null
// when one can. The mode and the cap, read the way companionMode reads them.
export function lastingCompanionProblem(campaign: Campaign): LastingCompanionBlock | null {
  const partyCompanions = listCompanions(listSheets(campaign.id)).filter(
    (sheet) => sheet.companionKind !== "guest",
  ).length;
  return lastingCompanionBlock(
    campaign.gameSettings,
    countPartySlots(campaign.id),
    partyCompanions,
    hasHumanDm(campaignSeats(campaign)),
  );
}

type ToolDef = {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

export const COMPANION_TOOL_NAMES = new Set(["add_companion", "dismiss_companion"]);

// A pack's class ids, filtered to the ones findClass can actually resolve.
// This list becomes the add_companion allowlist and the text of the retry
// error, so an id the catalog does not have would tell the model to call again
// with a class that can never validate: an unwinnable retry loop. Packs in the
// repo are checked by scripts/test-world-packs.mjs, but one loaded through
// WORLD_PACKS_DIR is unvetted.
export function packClassIds(settings: Campaign["gameSettings"]): string[] {
  return packIds(packFor(settings), "classes").filter((id) => findClass(id));
}

export function companionTools(campaign: Campaign, inEncounter = false): ToolDef[] {
  const tools = companionToolDefs(campaign);
  // What a party member holds to is settled out of a fight: an ally who
  // joins mid-fight takes their class's, and the fight's tool set stays lean.
  if (inEncounter) {
    for (const tool of tools) {
      const properties = tool.function.parameters.properties as Record<string, unknown> | undefined;
      if (tool.function.name === "add_companion" && properties) {
        delete properties.alignment;
        delete properties.values;
      }
    }
  }
  return tools;
}

function companionToolDefs(campaign: Campaign): ToolDef[] {
  const mode = companionMode(campaign);
  if (mode === "off") {
    return [];
  }
  const preset = presetFor(campaign.gameSettings);
  const classIds = settingClassIds(
    campaign.gameSettings.genre,
    packClassIds(campaign.gameSettings),
  );
  const classDescription = classIds.length
    ? `Class id from this world's catalog. Only these belong in this setting: ${classIds.join(", ")}. Anything else is refused.`
    : "Class id from this world's catalog ('fighter', 'cleric').";
  const raceDescription = preset.companionRaces.length
    ? `SRD race id. ${preset.raceHint} Allowed here: ${preset.companionRaces.join(", ")} (anything else becomes human).`
    : `SRD race id ('human', 'hill_dwarf', 'high_elf'). ${preset.raceHint}`;
  const kindDescription =
    mode === "full"
      ? "'party' for a lasting party member who travels with the party until dismissed; 'guest' for a scene-scoped ally (a soldier helping defend the town) who leaves when the scene ends."
      : "Only 'guest' is allowed at this table: a scene-scoped ally (a soldier helping defend the town) who leaves when the scene or battle ends. Lasting party companions are disabled.";
  return [
    {
      type: "function",
      function: {
        name: "add_companion",
        description: `Write a new AI-controlled ally into the story with a REAL character sheet: they get stats, HP, equipment, an initiative slot, and a map token, and you control them fully (dialogue and combat). Call it BEFORE narrating them joining. An ally that never went through add_companion does not exist and cannot act or fight. They must belong in this world (${preset.name.toLowerCase()}): name, race, and class all fit the setting.`,
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            name: { type: "string", description: "The companion's in-world name." },
            race: { type: "string", description: raceDescription },
            ancestry: {
              type: "string",
              enum: DRACONIC_ANCESTRY_IDS,
              description: "A dragonborn's draconic ancestry, when the story names one. Omit it and the server rolls one.",
            },
            class: { type: "string", description: classDescription },
            gender: { type: "string", enum: [...TOLD_GENDERS], description: TOLD_GENDER_HELP },
            drawnTo: {
              type: "array",
              items: { type: "string", enum: TOLD_ATTRACTION },
              description: "Who they could fall for, if the story has shown it.",
            },
            level: {
              type: "integer",
              minimum: 1,
              maximum: 20,
              description: "Default: the party's average level.",
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
              description: "Casters only: the spells they know (level-appropriate).",
            },
            // What a party member holds to (issue 503).
            alignment: {
              type: "string",
              enum: [...ALIGNMENT_CODES],
              description: "When the story has shown it: with their class, sets what a party member holds to.",
            },
            values: VALUES_PARAMETER,
            agenda: {
              type: "object",
              properties: { employer: { type: "string" }, aim: { type: "string" } },
              description: "Party only, a secret from every player: who secretly employs them and what they want of the party. The server brings the order in time.",
            },
          },
          required: ["name", "class", "gender", "personality", "kind"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "dismiss_companion",
        description:
          "Write a companion out of the story: they part ways, their scene ends, or they died and the story moves on. Call it BEFORE narrating the departure; their sheet, initiative slot, and token are removed.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            characterId: { type: "string", description: "The companion: exact characterId from GAME STATE." },
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
  ancestry: z.string().trim().max(40).optional(),
  class: z.string().trim().min(1).max(60),
  gender: z.enum(TOLD_GENDERS),
  drawnTo: z.array(z.string().max(40)).max(6).optional(),
  level: z.number().int().min(1).max(20).optional(),
  personality: z.string().trim().min(1).max(500),
  kind: z.enum(["party", "guest"]).default("guest"),
  spells: z.array(z.string().trim().min(1).max(60)).max(12).optional(),
  alignment: z.enum(ALIGNMENT_CODES).optional(),
  values: valuesArgSchema.optional(),
  agenda: z.object({ employer: z.string().trim().max(80).optional(), aim: z.string().trim().max(200).optional() }).optional(),
});

const dismissArgsSchema = z.object({
  characterId: z.string().trim().min(1),
  reason: z.string().trim().max(300).optional(),
});

const STANDARD_ARRAY = [15, 14, 13, 12, 10, 8];

// The average level of the real players' characters, or 1 with none.
function partyAverageLevel(sheets: CharacterSheet[]): number {
  const levels = sheets.filter((sheet) => !sheet.isCompanion).map((sheet) => sheet.level);
  return levels.length ? Math.max(1, Math.min(20, Math.round(levels.reduce((sum, level) => sum + level, 0) / levels.length))) : 1;
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
): ToolResult {
  const mode = companionMode(campaign);
  if (mode === "off") {
    return { error: "Companions are disabled for this campaign.", retry: true };
  }
  let args: z.infer<typeof addArgsSchema>;
  try {
    args = addArgsSchema.parse(JSON.parse(rawArguments || "{}"));
  } catch {
    return {
      error:
        "Invalid arguments: add_companion needs name, class, gender (Female, Male, Nonbinary or Unknown), personality, and kind ('party' or 'guest').",
      retry: true,
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
      error: `The party already has ${existing.length} ${label}${existing.length === 1 ? "" : "s"} (limit ${cap}): ${existing.map((sheet) => sheet.name).join(", ")}. One is dismissed before another joins. Ask the players which.`,
      retry: true,
    };
  }

  // A party companion who left is the same person coming back: the sheet
  // they left with, at the table's level now (#503 Phase 0.4).
  if (kind === "party") {
    const back = returningCompanion(campaign, args.name, args.level ?? partyAverageLevel(sheets));
    if (back) {
      const { sheet, hadEncounter } = finalizeNewCompanion(campaign, back.level, back.input, kind, args.personality);
      settleReturn(campaign, back);
      return {
        ok: true,
        characterId: sheet.id,
        name: sheet.name,
        returned: true,
        summary: `${sheet.name} returns: the same ${sheet.class} they were when they left, now level ${sheet.level}. HP ${sheet.maxHp}, AC ${sheet.ac}.`,
        note: `They are back with the sheet they left with${back.leftAtLevel !== back.level ? `, brought from level ${back.leftAtLevel} to ${back.level}` : ""}, and every bond with them picks up where it stopped. ${hadEncounter ? "They have an initiative slot and a map token. " : ""}Narrate their return in their own voice.`,
      };
    }
  }

  const preset = presetFor(campaign.gameSettings);
  const klass = resolveClass(args.class);
  if (!klass) {
    return {
      error: `Unknown class "${args.class}". Use a class id from this world's catalog (e.g. fighter, cleric, rogue, wizard).`,
      retry: true,
    };
  }
  // Off-genre classes are refused outright: a high-fantasy paladin walking
  // into a cyberpunk campaign breaks the world harder than a retry costs.
  const allowedClasses = settingClassIds(
    campaign.gameSettings.genre,
    packClassIds(campaign.gameSettings),
  );
  if (allowedClasses.length && !allowedClasses.includes(klass.id)) {
    return {
      error: `${klass.name} does not belong in this world (${preset.name}). Call add_companion again with one of: ${allowedClasses.join(", ")}.`,
      retry: true,
    };
  }

  // Races coerce instead of refusing: the allowed set is the genre's list plus
  // whatever the players themselves are playing, so a table running an elf in a
  // neon city keeps that door open.
  const race = findRace(slugify(args.race ?? "")) ?? findRace("human");
  if (!race) {
    return { error: "No usable race found.", retry: true };
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
  const level = Math.max(1, Math.min(20, args.level ?? partyAverageLevel(sheets)));

  // Standard array by class priority, then racial ASI.
  const priority = abilityPriority(klass);
  const abilities = { str: 8, dex: 8, con: 8, int: 8, wis: 8, cha: 8 } as Record<Ability, number>;
  priority.forEach((ability, index) => {
    abilities[ability] = STANDARD_ARRAY[index] ?? 8;
  });
  for (const [ability, bonus] of Object.entries(chosenRace.asi)) {
    abilities[ability as Ability] += bonus ?? 0;
  }

  // The class's starting equipment with the book's first option of every
  // choice (src/lib/srd/starting-kit.ts): what a player's character of the
  // class is handed. The armor engine derives the armor class from it when
  // the sheet is written; the figure here is only a starting point.
  const equipment = startingKitFor(klass, null).items;
  const ac = 10 + abilityMod(abilities.dex);

  const skills = klass.skillChoices.from.slice(0, klass.skillChoices.count);

  // A dragonborn's ancestry: the one the recruiter names, else a roll on the
  // SRD's table, so an engine-made dragonborn is not always red.
  const ancestry = takesDraconicAncestry(chosenRace.id)
    ? (findDraconicAncestry(args.ancestry) ?? rollDraconicAncestry(defaultRng))
    : null;
  if (ancestry && args.ancestry && !findDraconicAncestry(args.ancestry)) {
    notes.push(`"${args.ancestry}" is not a draconic ancestry, so one was rolled: ${ancestry.dragon}.`);
  }

  const draft = createSheetSchema.parse({
    name: args.name,
    race: chosenRace.id,
    class: klass.id,
    background: "",
    // What they hold to starts from it (src/lib/dm/companion-values-logic.ts).
    alignment: args.alignment ?? "",
    gender: toldGender(args.gender) ?? "",
    attraction: attractionFromTold(args.drawnTo) ?? { genders: [], note: "" },
    abilities,
    // A figure to start from; the legality check derives the real one by
    // the table's hit point method, and the armor engine the armor class.
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
    spellcasting: null,
    backstory: args.personality,
    ...(ancestry ? { racialChoices: { ancestry: ancestry.id } } : {}),
  });
  // The same door a player's character comes through: the improvements the
  // class has earned by this level, a spell list its tables allow, and every
  // derived number written by the server.
  const legal = legalCompanionSheet({
    campaign,
    level,
    sheet: draft,
    wantedSpells: args.spells ?? [],
  });
  if (!legal.ok) {
    return toolError(legal);
  }
  notes.push(...legal.notes);
  const input = legal.sheet;

  const { sheet, hadEncounter } = finalizeNewCompanion(campaign, level, input, kind, args.personality);
  // What the DM says they hold to replaces what class and alignment gave.
  const row = kind === "party" && args.values ? companionNpcFor(sheet) : null;
  if (row && args.values) {
    setCompanionValues(row.id, args.values);
  }
  // A hidden employer, the DM's or the arc's (issue 503 Phase 8).
  if (kind === "party") {
    seedAgenda(campaign, sheet, args.agenda);
  }

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
  const marked = markSheetAsCompanion(created.id, kind, personality) ?? created;
  // At a one-player table the AI runs, a party companion follows that player
  // in fights (src/lib/dm/companion-command.ts).
  const sheet = setCompanionCommander(marked.id, defaultCommander(campaign, kind)) ?? marked;
  publishPersisted(campaign.id, "sheet_updated", { sheet });
  // A companion the party once travelled with can be written back in; every
  // standing with them picks up exactly where it stopped.
  rejoinRelationshipsWithSubject(campaign.id, sheet.name, sheet.id);
  // A lasting companion has a person behind the sheet: personality axes a
  // deed weighs against, and who they are drawn to (#503 Phase 0.1).
  if (kind === "party") {
    companionNpcFor(sheet);
  }
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
    queueCompanionPortrait(campaign, {
      id: sheet.id,
      name: sheet.name,
      race: sheet.race,
      class: sheet.class,
      background: sheet.background,
      personality,
    });
  }

  // Mid-combat arrival: a real initiative slot and a token beside the party,
  // exactly like add_enemies does for the other side.
  const encounter = getActiveEncounter(campaign.id);
  if (encounter) {
    const initiative = rollCard(campaign, null, sheet.id, "initiative", "initiative", characterInitiativeExpression(campaign, sheet, abilityMod(sheet.abilities.dex)), null).total;
    const entry: OrderEntry = {
      kind: "pc",
      characterId: sheet.id,
      userId: botUser.id,
      name: sheet.name,
      initiative,
    };
    if (encounter.orderReady) {
      const spliced = spliceIntoOrder(encounter.order, encounter.turnIndex, [entry]);
      encounter.order = spliced.order;
      encounter.turnIndex = spliced.turnIndex;
      saveEncounter(encounter);
      publishEncounterState(campaign.id);
    } else {
      // The order is still being collected and counts every fielded
      // character, companions included: the roll is staged with the rest, or
      // the order waits on a card nobody was ever dealt. The last player's
      // roll builds and sorts it (recordInitiativeRoll).
      encounter.order.push(entry);
      saveEncounter(encounter);
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
): ToolResult {
  let args: z.infer<typeof dismissArgsSchema>;
  try {
    args = dismissArgsSchema.parse(JSON.parse(rawArguments || "{}"));
  } catch {
    return { error: "Invalid arguments: dismiss_companion needs characterId.", retry: true };
  }
  const needle = textKey(args.characterId);
  const sheet =
    sheets.find((candidate) => candidate.id === args.characterId) ??
    sheets.find((candidate) => textKey(candidate.name) === needle) ??
    null;
  if (!sheet) {
    return unknownSheetRef("characterId", args.characterId, sheets);
  }
  if (!sheet.isCompanion) {
    return { error: `${sheet.name} is a player's character and cannot be dismissed.`, retry: true };
  }
  removeCompanion(campaign, sheet, args.reason);

  return {
    ok: true,
    dismissed: sheet.name,
    note: `${sheet.name} is out of the party; their sheet is gone. Narrate the departure.`,
  };
}

// A lasting companion leaving by its own conscience (issue 503,
// src/lib/dm/departure.ts): the same removal as a dismissal, its sheet kept
// on the row behind it, and `how` (what the table saw, never the plan it
// held) told with the sheet's going, so the Party panel dims its card and
// moves it to the Gone list.
export function departCompanion(campaign: Campaign, sheet: CharacterSheet, reason: string, how: string) {
  removeCompanion(campaign, sheet, reason, how);
}

// The whole removal: initiative slot, map token, story event, sheet, and the
// bot user behind it. Shared by dismiss_companion and the end-of-fight sweep.
// A lasting companion's going is told with `departed` (how they went: their
// conscience's words, or a plain parting), so the Party panel shows it.
function removeCompanion(campaign: Campaign, sheet: CharacterSheet, reason?: string, how?: string) {
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
  // Their sheet goes, but what the party felt for them does not: a bond with
  // a departing companion is parted, not ended, so it comes back whole if
  // the story brings them back (src/lib/db/relationships.ts). Nor does who
  // they were: a lasting companion's sheet is kept on the row behind them
  // (#503 Phase 0.4), so a return is the same person.
  rememberDepartingSheet(sheet);
  partRelationshipsWithSubject(campaign.id, sheet.name);
  const lasting = lastingCompanion(sheet);
  publishPersisted(campaign.id, "sheet_deleted", {
    sheetId: sheet.id,
    userId: sheet.userId,
    ...(lasting ? { departed: { name: sheet.name, how: how ?? (sheet.deathSaves?.dead ? "Fell" : "Left the party") } } : {}),
  });
  // The bot user owns nothing but this sheet; the FK cascade removes it.
  deleteCompanionUser(sheet.userId);
}

// Called when a fight ends: scene-scoped guests are exactly that, so the
// server writes them out instead of letting temporary allies quietly become
// permanent party members. Returns their names for the DM to narrate.
export function dismissGuestCompanions(campaign: Campaign, reason: string): string[] {
  // A creature a spell made stays while the spell lasts, fight or no fight
  // (src/lib/dm/summon-store.ts sends it away).
  const guests = listCompanions(listSheets(campaign.id)).filter(
    (sheet) => sheet.companionKind === "guest" && !sheet.summon,
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
    glyph: "system-party",
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
): ToolResult {
  if (toolName === "add_companion") {
    return handleAddCompanion(campaign, rawArguments, sheets);
  }
  if (toolName === "dismiss_companion") {
    return handleDismissCompanion(campaign, rawArguments, sheets);
  }
  return { error: `Unknown companion tool ${toolName}.`, retry: true };
}

// A companion's level-up lives beside the legality check it goes through
// (src/lib/dm/companion-level.ts); exported from here because this is where
// every caller has always found it.
export { autoLevelCompanion } from "@/lib/dm/companion-level";
