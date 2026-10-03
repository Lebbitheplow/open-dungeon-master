import { fieldedSheets } from "@/lib/dm/roster";
import { z } from "zod";
import {
  allocateSeq,
  getCampaignById,
  latestSeq,
  listMembers,
  setFloor,
  getFloor,
  combatOwnsFloor,
  type Campaign,
  type Floor,
  type InitiativeFloor,
} from "@/lib/db/campaigns";
import {
  createEncounter,
  getActiveEncounter,
  insertEnemy,
  listEnemies,
  saveEncounter,
  type Encounter,
  type EncounterEnemy,
  orderEntryId,
  type OrderEntry,
} from "@/lib/db/encounters";
import { getSheetById, listSheets } from "@/lib/db/sheets";
import { getRoll, insertRoll } from "@/lib/db/rolls";
import { insertCampaignMessage } from "@/lib/db/messages";
import { listOpenPendingRolls, saveDmTurn, type DmTurn } from "@/lib/db/dm-turns";
import { d20Expression, rollExpression } from "@/lib/dice";
import { publishPersisted, publishWithSeq } from "@/lib/events";
import { computeSheetDerived } from "@/lib/srd";
import { encounterCeiling, evaluateEncounter } from "@/lib/srd/encounter-math";
import { suggestEnemies } from "@/lib/bestiary";
import { enemyRequestSchema, resolveEnemyRequests } from "@/lib/dm/encounter-spawn";
import { decideAmbush, rollOpeningInitiative } from "@/lib/dm/encounter-open";
import { heldRollUserIds } from "@/lib/dice/held-rolls";
import { healthState } from "@/lib/bestiary/health";
import {
  advanceOrder,
  buildOrder,
  coerceEncounterOutcome,
  numberDuplicates,
  pickEnemyTarget,
  spliceIntoOrder,
  withoutReflexTurns,
  withReflexTurns,
} from "@/lib/dm/encounter-logic";
import { holdsThiefsReflexes } from "@/lib/dm/bonus-routes";
import {
  actingCombatantId,
  canEnemyAct,
  markEnemyActed,
  oweEnemiesAnAction,
} from "@/lib/dm/can-act";
import { acWithEffects, enemyAcWithEffects } from "@/lib/dm/ac-effects";
import { rollEffectExtras } from "@/lib/dm/effect-tools";
import { followCombatAmbience } from "@/lib/dm/ambience-tools";
import {
  createBattleMapForEncounter,
  handleMoveToken,
  handleSetMovement,
  handleTeleportToken,
  moveTokenTool,
  publishBattleMapUpdate,
  setMovementTool,
  teleportTokenTool,
} from "@/lib/dm/map-tools";
import {
  applyEnemyDamage,
  finishEncounter,
  publishEncounter,
  resolveEnemyRef,
} from "@/lib/dm/enemy-damage";
import { enemyFalls } from "@/lib/dm/enemy-fall";
import { enemyCallOutOfTurn } from "@/lib/dm/enemy-turn-order";
import {
  applyExtraEncounterCall,
  EXTRA_ENCOUNTER_TOOL_NAMES,
  extraEncounterTools,
} from "@/lib/dm/encounter-tools-extra";
import { handlePcAttack, pcAttackTool } from "@/lib/dm/pc-attack";
import { handleEnemyAttack } from "@/lib/dm/enemy-attack";
import { isCompanionUserId } from "@/lib/db/users";
import { wakeDm } from "@/lib/dm/wake";
import { resolveSheetRef } from "@/lib/dm/rolls";
import {
  castAtEnemyTool,
  castAtPlayerTool,
  handleCastAtEnemy,
  handleCastAtPlayer,
} from "@/lib/dm/cast-tools";
import {
  ACTION_TOOL_NAMES,
  actionTools,
  handleTakeAction,
  handleUseReaction,
} from "@/lib/dm/action-tools";
import { isIncapacitated, mergeAdvantage } from "@/lib/dm/condition-logic";
import { startTurnConditions, tickEncounterConditions } from "@/lib/dm/condition-tick";
import { endTurns } from "@/lib/dm/turn-end";
import { turnStartEffects } from "@/lib/dm/turn-start-effects";
import { damageEnemyTool, endEncounterTool, endTurnTool, enemyAttackTool, startEncounterTool, type ToolDef } from "@/lib/dm/encounter-tool-defs";
import { rollDeathSave } from "@/lib/dm/death";
import { getBattleMapForEncounter, getTokenByRef, resetRoundBudgets, resetTurnBudgets } from "@/lib/db/battle-maps";
import { initLegendaryPools } from "@/lib/dm/legendary-tools";
import { publishTitleCard } from "@/lib/dm/scene-state";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { VIGILANT_PREFIX } from "@/lib/srd/authored-effects-more";
import { handleReaperCast } from "@/lib/dm/authored-reaper";
import { sweepSummons } from "@/lib/dm/summon-store";
import { afflictionsAtCombatStart } from "@/lib/dm/afflictions";
import { holdForEnemies } from "@/lib/dm/enemies-due";
import { approachForCompanion } from "@/lib/dm/companion-approach";
import { dmRoll } from "@/lib/dm/roll-card";

// Server-authoritative combat: enemies spawn from real stat blocks, their
// HP changes only through these tools, and the initiative pointer is moved
// by the server (finalize/lead skip), never by the model.

export const ENCOUNTER_TOOL_NAMES = [
  "start_encounter",
  "pc_attack",
  "cast_at_enemy",
  "cast_at_player",
  "damage_enemy",
  "enemy_attack",
  "move_token",
  "teleport_token",
  "set_movement",
  "end_turn",
  "end_encounter",
  ...EXTRA_ENCOUNTER_TOOL_NAMES,
  ...ACTION_TOOL_NAMES,
];

export const ENCOUNTER_CAP_PER_TURN = 12;

export function encounterTools(hasActiveEncounter: boolean): ToolDef[] {
  return hasActiveEncounter
    ? [
        pcAttackTool,
        castAtEnemyTool,
        castAtPlayerTool,
        damageEnemyTool,
        enemyAttackTool,
        moveTokenTool,
        teleportTokenTool,
        setMovementTool,
        endTurnTool,
        endEncounterTool,
        ...extraEncounterTools,
        ...actionTools,
      ]
    : [startEncounterTool];
}

function crLabel(cr: number): string {
  if (cr === 0.125) return "1/8";
  if (cr === 0.25) return "1/4";
  if (cr === 0.5) return "1/2";
  return String(cr);
}

// ---- start_encounter ----

const hasAlert = (sheet: CharacterSheet) =>
  (sheet.feats ?? []).some((feat) => /^alert\b/i.test(feat.trim()));

const startArgsSchema = z.object({
  enemies: z.array(enemyRequestSchema).min(1).max(8),
  summary: z.string().optional(),
  surprised: z.enum(["none", "enemies", "party"]).optional(),
  ambush: z.enum(["enemies", "party"]).optional(),
  battlefield: z.string().max(300).optional(),
  lair: z.boolean().optional(),
});

// Accepts the documented {enemies:[...]} shape, or flat monster/name/count
// keys (the textual-salvage path cannot produce arrays).
function parseStartArgs(rawArguments: string): z.infer<typeof startArgsSchema> | null {
  let raw: unknown;
  try {
    raw = JSON.parse(rawArguments || "{}");
  } catch {
    return null;
  }
  const nested = startArgsSchema.safeParse(raw);
  if (nested.success) {
    return nested.data;
  }
  const flat = enemyRequestSchema
    .extend({ summary: z.string().optional(), battlefield: z.string().max(300).optional() })
    .safeParse(raw);
  if (flat.success) {
    return {
      enemies: [{ monster: flat.data.monster, name: flat.data.name, count: flat.data.count, cr: flat.data.cr }],
      summary: flat.data.summary,
      battlefield: flat.data.battlefield,
    };
  }
  return null;
}

function suggestionLines(campaign: Campaign, sheets: CharacterSheet[]): string {
  return suggestEnemies(campaign.gameSettings, sheets.map((sheet) => sheet.level), 5)
    .map((entry) => `${entry.slug} as "${entry.name}" (CR ${crLabel(entry.cr)})`)
    .join(", ");
}

function handleStartEncounter(
  campaign: Campaign,
  rawArguments: string,
  sheets: CharacterSheet[],
  // The AI's fight opens with its initiative rolled (the server rolls every
  // character it rolls for); a person's fight is asked for its rolls by the
  // console's façade (src/lib/dm/initiative-ask.ts), on the person's turn.
  actor: DmTurn["actor"] = "human_dm",
): Record<string, unknown> {
  const args = parseStartArgs(rawArguments);
  if (!args) {
    return {
      error:
        'Invalid start_encounter arguments. Send {"enemies":[{"monster":"goblin","count":3}],"summary":"..."}.',
    };
  }
  if (getActiveEncounter(campaign.id)) {
    return {
      error:
        "An encounter is already active. Use damage_enemy and enemy_attack, or end_encounter first.",
    };
  }
  if (!sheets.length) {
    return { error: "No party characters to fight." };
  }

  // Resolve every requested enemy before creating anything.
  const outcome = resolveEnemyRequests(campaign.gameSettings, args.enemies, campaign.ownerUserId);
  if ("unknownMonster" in outcome) {
    return {
      error: `Unknown monster "${outcome.unknownMonster}". Use a real monster slug or name, or pass cr for an invented enemy. Good picks for this world: ${suggestionLines(campaign, sheets)}.`,
    };
  }
  const resolved = outcome.resolved;
  if (resolved.length > 8) {
    return { error: "Too many enemies; keep encounters to 8 combatants or fewer." };
  }

  // 5e budget check: refuse fights the party cannot plausibly survive.
  const partyLevels = sheets.map((sheet) => sheet.level);
  const evaluation = evaluateEncounter(partyLevels, resolved.map((entry) => entry.stats.cr));
  const ceiling = encounterCeiling(campaign.difficulty, evaluation.thresholds.deadly);
  if (evaluation.adjustedXp > ceiling) {
    return {
      error: `Too deadly for this party: adjusted XP ${evaluation.adjustedXp} vs an allowed ceiling of ${ceiling} (difficulty ${campaign.difficulty}). Use fewer or weaker enemies. Good picks for this world: ${suggestionLines(campaign, sheets)}.`,
    };
  }

  const encounter = createEncounter(campaign.id, args.summary ?? "");
  if (!encounter) {
    return { error: "An encounter is already active." };
  }

  const names = numberDuplicates(resolved.map((entry) => entry.name));
  const enemies = resolved.map((entry, index) =>
    insertEnemy({
      encounterId: encounter.id,
      campaignId: campaign.id,
      slug: entry.slug,
      displayName: names[index],
      // Enemy initiative rolls silently at spawn; players roll on request.
      // A record for the DM alone, as an enemy's save is.
      initiative: dmRoll(campaign.id, null, "initiative", `${names[index]}: initiative`, d20Expression(entry.stats.dexMod)).total,
      stats: entry.stats,
    }),
  );
  // Surprise: the ambushed side loses its first turn. Stored as ids the
  // initiative pointer skips through round 1 and then forgets. An ambush is
  // decided per creature, Stealth against passive Perception; a side named
  // outright overrides it.
  let ambushLines: string[] = [];
  if (args.surprised === "enemies") {
    encounter.surprisedIds = enemies.map((enemy) => enemy.id);
  } else if (args.surprised === "party") {
    // Alert: a character with the feat cannot be surprised while conscious.
    encounter.surprisedIds = sheets
      .filter((sheet) => !(hasAlert(sheet) && sheet.currentHp > 0))
      .map((sheet) => sheet.id);
  } else if (args.ambush) {
    const ambush = decideAmbush(campaign, args.ambush, enemies, sheets);
    encounter.surprisedIds = ambush.surprisedIds;
    ambushLines = ambush.lines;
  }
  const partySurprised = sheets.some((sheet) => encounter.surprisedIds.includes(sheet.id));
  // Legendary pools and the lair flag (docs/vtt-parity-implementation-
  // plan.md 4.1), written with the fight so the tracker shows them at once.
  initLegendaryPools(encounter, enemies, args.lair === true);
  saveEncounter(encounter);
  createBattleMapForEncounter(campaign, encounter, enemies, sheets, args.battlefield);
  publishEncounter(campaign.id);
  // The fight's card: the opening line in ember, "Ambush" when the party
  // was caught, with the combat sting (SceneTitle.tsx).
  const enemiesSurprised = enemies.some((enemy) => encounter.surprisedIds.includes(enemy.id));
  publishTitleCard(campaign.id, {
    title: partySurprised ? "Ambush" : (args.summary ?? "").trim().slice(0, 48) || "Battle",
    subtitle: partySurprised
      ? (args.summary ?? "").trim().slice(0, 80) || undefined
      : enemiesSurprised
        ? "The party strikes first"
        : "Roll initiative",
    tone: "ember",
    sting: "sword_clash",
  });

  // Initiative is starting: the room's music changes, and the harder the
  // fight reads the bigger the music. The bed is left alone, because the
  // cave they are fighting in is still a cave.
  followCombatAmbience(
    campaign,
    true,
    evaluation.verdict === "deadly" || evaluation.verdict === "beyond_deadly",
  );

  // The AI's fight rolls its initiative now, for every character whose dice
  // the server rolls, so the fight opens in this same call; a player who
  // holds their own dice is asked, as at the console.
  const opening =
    actor === "ai"
      ? rollOpeningInitiative(
          campaign,
          sheets,
          heldRollUserIds(campaign.gameSettings.dicePolicy, listMembers(campaign.id)),
          (characterId, total) => recordInitiativeRoll(campaign.id, characterId, total),
        )
      : null;
  const asked = opening ? opening.waiting : sheets;
  const rollList = asked
    .map((sheet) => `${sheet.name} (characterId=${sheet.id})`)
    .join(", ");
  const surprisedNames = [
    ...sheets.filter((sheet) => encounter.surprisedIds.includes(sheet.id)).map((sheet) => sheet.name),
    ...enemies.filter((enemy) => encounter.surprisedIds.includes(enemy.id)).map((enemy) => enemy.displayName),
  ];
  return {
    ok: true,
    encounterId: encounter.id,
    enemies: enemies.map((enemy) => ({
      enemyId: enemy.id,
      name: enemy.displayName,
      ac: enemy.ac,
      hp: `${enemy.currentHp}/${enemy.maxHp}`,
    })),
    difficulty: `${evaluation.verdict} for this party`,
    ...(evaluation.verdict === "deadly" || evaluation.verdict === "beyond_deadly"
      ? { warning: "This fight can kill characters. Telegraph the danger." }
      : {}),
    map: "A tactical battle map was generated; positions appear in GAME STATE on your next call.",
    ...(ambushLines.length ? { ambush: ambushLines.join(" ") } : {}),
    ...(surprisedNames.length
      ? {
          surprise: `Surprised: ${surprisedNames.join(", ")}. The server skips their turns for the first round. Narrate the ambush landing.`,
        }
      : {}),
    ...(opening?.rolled.length ? { initiative: opening.rolled.join(", ") } : {}),
    ...(opening && !asked.length
      ? { next: opening.note ?? "Every initiative is in; combat has begun." }
      : {
          next: `Now call request_roll with kind=initiative for EACH character: ${rollList}. Combat begins once every initiative is in.`,
        }),
  };
}

// ---- initiative collection ----

// Whether this combatant can take a turn: alive AND (for PCs) not
// incapacitated. A stunned or paralyzed PC's turn is skipped exactly like a
// downed one; the condition ticks away at round wrap. Enemies stay in the
// passed list either way (enemy_attack refuses the incapacitated ones).
function entryAlive(entry: OrderEntry, enemiesById: Map<string, EncounterEnemy>): boolean {
  if (entry.kind === "pc") {
    const sheet = getSheetById(entry.characterId);
    return (sheet?.currentHp ?? 0) > 0 && !isIncapacitated(sheet?.conditions ?? []);
  }
  if (entry.kind === "enemy") {
    return enemiesById.get(entry.enemyId)?.status === "alive";
  }
  // A DM's own NPC slot has no stat block to be dead in. It stays in the
  // order until the DM takes it out (src/lib/dm/initiative-edit.ts).
  return true;
}

const entryId = orderEntryId;

// A combatant the pointer should stop on: alive, and not surprised. Surprise
// costs exactly the first turn, and surprisedIds is emptied when round 1
// wraps, so this narrows to entryAlive from round 2 on.
function entryActs(
  entry: OrderEntry,
  enemiesById: Map<string, EncounterEnemy>,
  surprisedIds: string[],
): boolean {
  return entryAlive(entry, enemiesById) && !surprisedIds.includes(entryId(entry));
}

// Armor Class with every active effect folded in lives in
// src/lib/dm/ac-effects.ts; re-exported for the callers that learned it here.
export { acWithEffects, enemyAcWithEffects };

// Exported for src/lib/dm/initiative.ts: a DM editing the order moves the
// pointer without going through advancePointer, and the floor has to follow
// it or the banner and the permission check disagree about whose turn it is.
export function setInitiativeFloor(campaign: Campaign | null, encounter: Encounter) {
  if (!campaign) {
    return;
  }
  const current = encounter.order[encounter.turnIndex];
  if (!current || current.kind !== "pc") {
    return;
  }
  const floor: InitiativeFloor = {
    mode: "initiative",
    encounterId: encounter.id,
    userIds: [current.userId],
    currentName: current.name,
    round: encounter.round,
  };
  // A hold (held responses) stays a hold: the pointer moved underneath it,
  // and the lead's release opens into the new turn rather than the old one.
  const next: Floor = getFloor(campaign.id).mode === "hold" ? { mode: "hold", next: floor } : floor;
  setFloor(campaign.id, next);
  publishPersisted(campaign.id, "floor_changed", { floor: next });
}

// The floor a running fight would have right now, read from the initiative
// pointer. Null when no ready fight has a player character at the pointer.
export function initiativeFloorFor(campaignId: string): InitiativeFloor | null {
  const encounter = getActiveEncounter(campaignId);
  if (!encounter || !encounter.orderReady) {
    return null;
  }
  const current = encounter.order[encounter.turnIndex];
  if (!current || current.kind !== "pc") {
    return null;
  }
  return {
    mode: "initiative",
    encounterId: encounter.id,
    userIds: [current.userId],
    currentName: current.name,
    round: encounter.round,
  };
}

// What a release, or a spotlight everyone has answered, opens into: the
// fight's floor while a fight runs, the open table otherwise. Opening the
// table mid-fight (issue 17) let everyone post, stopped the order advancing
// and had the End Turn button refused for whoever pressed it.
export function floorAfterRelease(campaignId: string): Floor {
  return initiativeFloorFor(campaignId) ?? { mode: "open" };
}

// Whether the initiative order owns the floor: the floor says so (directly
// or under a hold), or a ready fight has a PC at the pointer whatever the
// floor row says. Spotlights and lead overrides are refused while this holds.
export function fightOwnsFloor(campaignId: string): boolean {
  return combatOwnsFloor(getFloor(campaignId)) || initiativeFloorFor(campaignId) !== null;
}

function describeOrder(encounter: Encounter): string {
  return encounter.order
    .map((entry, index) => (index === encounter.turnIndex ? `${entry.name} (CURRENT)` : entry.name))
    .join(" > ");
}

// Records one PC's initiative result. When the last one lands, builds the
// order, points the turn at the first living PC, and locks the floor.
// Returns a note for the model when combat begins.
export function recordInitiativeRoll(
  campaignId: string,
  characterId: string | null,
  total: number,
): string | null {
  if (!characterId) {
    return null;
  }
  const encounter = getActiveEncounter(campaignId);
  if (!encounter) {
    return null;
  }
  const sheet = getSheetById(characterId);
  if (!sheet || encounter.order.some((entry) => entry.kind === "pc" && entry.characterId === characterId)) {
    return null;
  }
  if (encounter.orderReady) {
    // A character joining a fight in progress takes a place in the order by
    // their roll. The pointer stays on whoever is acting; the newcomer's
    // turn comes when their count does.
    const campaignNow = getCampaignById(campaignId);
    const fielded = campaignNow ? fieldedSheets(campaignNow) : listSheets(campaignId);
    if (!fielded.some((entry) => entry.id === sheet.id)) {
      return null;
    }
    const joined = spliceIntoOrder(encounter.order, encounter.turnIndex, [
      { kind: "pc", characterId: sheet.id, userId: sheet.userId, name: sheet.name, initiative: total },
    ]);
    encounter.order = joined.order;
    encounter.turnIndex = joined.turnIndex;
    saveEncounter(encounter);
    publishEncounter(campaignId);
    return `${sheet.name} joins the fight on initiative ${total}. Initiative order: ${describeOrder(encounter)}.`;
  }
  encounter.order.push({
    kind: "pc",
    characterId: sheet.id,
    userId: sheet.userId,
    name: sheet.name,
    initiative: total,
  });

  const campaignForRoster = getCampaignById(campaignId);
  // The dead roll nothing (request_roll refuses them), so the order is not
  // held open waiting on them.
  const sheets = (campaignForRoster ? fieldedSheets(campaignForRoster) : listSheets(campaignId)).filter(
    (entry) => !entry.deathSaves?.dead,
  );
  const staged = encounter.order.filter(
    (entry): entry is Extract<OrderEntry, { kind: "pc" }> => entry.kind === "pc",
  );
  if (staged.length < sheets.length) {
    saveEncounter(encounter);
    return null;
  }

  // Everyone is in: build the final order and open combat.
  const enemies = listEnemies(encounter.id);
  // Thief's Reflexes: a thief's second turn in round 1.
  const reflexes = (characterId: string) => {
    const sheet = sheets.find((entry) => entry.id === characterId);
    return Boolean(sheet && holdsThiefsReflexes(sheet));
  };
  encounter.order = buildOrder(
    withReflexTurns(staged, reflexes, encounter.surprisedIds),
    enemies.map((enemy) => ({
      enemyId: enemy.id,
      name: enemy.displayName,
      initiative: enemy.initiative ?? 0,
    })),
  );
  const enemiesById = new Map(enemies.map((enemy) => [enemy.id, enemy]));
  const first = advanceOrder(encounter.order, -1, (entry) =>
    entryActs(entry, enemiesById, encounter.surprisedIds),
  );
  if (!first) {
    return openAfterAmbush(campaignId, encounter, enemies, enemiesById);
  }
  encounter.orderReady = true;
  encounter.turnIndex = first.turnIndex;
  encounter.waitingSeq = latestSeq(campaignId);
  saveEncounter(encounter);
  const campaign = getCampaignById(campaignId);
  setInitiativeFloor(campaign, encounter);
  // Enemies ahead of the first character: a person plays them before the
  // floor opens (src/lib/dm/enemies-due.ts).
  holdForEnemies(campaign, encounter, first.enemiesPassed);
  publishEncounter(campaignId);
  if (campaign) {
    for (const passedCharacterId of first.pcsPassed) {
      rollDeathSave(campaign, passedCharacterId);
    }
  }

  const actFirst = first.enemiesPassed
    .map((enemyId) => enemiesById.get(enemyId)?.displayName)
    .filter(Boolean);
  const current = encounter.order[encounter.turnIndex];
  return `Combat begins. Initiative order: ${describeOrder(encounter)}.${
    actFirst.length
      ? ` ${actFirst.join(" and ")} act${actFirst.length === 1 ? "s" : ""} first: call enemy_attack for each now, then narrate and stop.`
      : ` It is ${current?.name}'s turn; narrate the scene and stop for their action.`
  }`;
}

// The whole party was surprised: round 1 belongs to the enemies. The order
// still locks, or the fight would have no turns, no floor and no action
// economy for as long as it lasts. Round 2 opens on the first character
// standing, and every living enemy is owed the action of the round the
// party lost, on top of its own.
function openAfterAmbush(
  campaignId: string,
  encounter: Encounter,
  enemies: EncounterEnemy[],
  enemiesById: Map<string, EncounterEnemy>,
): string | null {
  const first = advanceOrder(encounter.order, -1, (entry) => entryAlive(entry, enemiesById));
  if (!first) {
    // Nobody in the party can stand at all: nothing to open.
    saveEncounter(encounter);
    return null;
  }
  encounter.orderReady = true;
  encounter.round = 2;
  encounter.surprisedIds = [];
  encounter.turnIndex = first.turnIndex;
  encounter.turnBudget = null;
  encounter.waitingSeq = latestSeq(campaignId);
  const ambushers = enemies.filter((enemy) => enemy.status === "alive");
  oweEnemiesAnAction(
    encounter,
    ambushers.map((enemy) => enemy.id),
  );
  saveEncounter(encounter);
  const campaign = getCampaignById(campaignId);
  setInitiativeFloor(campaign, encounter);
  holdForEnemies(campaign, encounter, [...ambushers.map((enemy) => enemy.id), ...first.enemiesPassed]);
  publishEncounter(campaignId);
  if (campaign) {
    for (const passedCharacterId of first.pcsPassed) {
      rollDeathSave(campaign, passedCharacterId);
    }
  }
  const current = encounter.order[encounter.turnIndex];
  const names = ambushers.map((enemy) => enemy.displayName);
  const ahead = first.enemiesPassed
    .map((enemyId) => enemiesById.get(enemyId)?.displayName)
    .filter(Boolean);
  return `Combat begins. Initiative order: ${describeOrder(encounter)}. The party was surprised and lost round 1: ${
    names.join(" and ")
  } ${names.length === 1 ? "acts" : "each act"} now, call enemy_attack for each.${
    ahead.length
      ? ` ${ahead.join(" and ")} ${ahead.length === 1 ? "comes" : "come"} before ${current?.name} in the order and ${ahead.length === 1 ? "acts" : "act"} a second time, for round 2.`
      : ""
  } Then it is ${current?.name}'s turn (round 2); narrate and stop for their action.`;
}

// Deadlock guard: if combat is stuck collecting initiative with nothing
// pending, roll the stragglers digitally so a fight can never wedge.
export function ensureInitiativeProgress(campaign: Campaign): string | null {
  const encounter = getActiveEncounter(campaign.id);
  if (!encounter || encounter.orderReady) {
    return null;
  }
  if (listOpenPendingRolls(campaign.id).length) {
    return null;
  }
  const staged = new Set(
    encounter.order
      .filter((entry): entry is Extract<OrderEntry, { kind: "pc" }> => entry.kind === "pc")
      .map((entry) => entry.characterId),
  );
  const missing = fieldedSheets(campaign).filter((sheet) => !staged.has(sheet.id) && !sheet.deathSaves?.dead);
  if (!missing.length) {
    return null;
  }
  let note: string | null = null;
  for (const sheet of missing) {
    // The same roll request_roll would make: effects on initiative count.
    const effects = rollEffectExtras(campaign.id, sheet.id, "initiative");
    const outcome = rollExpression(
      d20Expression(
        computeSheetDerived(sheet).initiative + (effects.effectBonus ?? 0),
        mergeAdvantage([
          ...(effects.effectAdvantage ? ["advantage" as const] : []),
          ...(effects.effectDisadvantage ? ["disadvantage" as const] : []),
        ]),
      ),
    );
    const roll = insertRoll({
      campaignId: campaign.id,
      characterId: sheet.id,
      requestedBy: "dm",
      kind: "initiative",
      detail: "initiative",
      result: outcome,
    });
    publishWithSeq(campaign.id, allocateSeq(campaign.id), "roll_result", {
      roll,
      source: "digital",
    });
    note = recordInitiativeRoll(campaign.id, sheet.id, outcome.total) ?? note;
  }
  return note;
}

// ---- damage_enemy ----

const damageArgsSchema = z.object({
  enemyId: z.string(),
  amount: z.coerce.number().int().min(1).max(200).optional(),
  fallFeet: z.coerce.number().int().min(1).max(1000).optional(),
  type: z.string().optional(),
  magical: z.coerce.boolean().optional(),
  source: z.enum(["hazard", "environment", "ally"]).optional(),
  reason: z.string().optional(),
});

function handleDamageEnemy(
  campaign: Campaign,
  turn: DmTurn,
  rawArguments: string,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
): Record<string, unknown> {
  const encounter = getActiveEncounter(campaign.id);
  if (!encounter) {
    return { error: "No active encounter. Call start_encounter first." };
  }
  let args: z.infer<typeof damageArgsSchema>;
  try {
    args = damageArgsSchema.parse(JSON.parse(rawArguments || "{}"));
  } catch {
    return { error: "Invalid arguments: damage_enemy needs enemyId and amount." };
  }
  if (args.amount === undefined && args.fallFeet === undefined) {
    return { error: "damage_enemy needs the amount, or fallFeet for a fall." };
  }
  const enemy = resolveEnemyRef(encounter.id, args.enemyId);
  if (!enemy) {
    return { error: "Unknown enemyId; use one from GAME STATE." };
  }
  if (enemy.status !== "alive") {
    return { error: `${enemy.displayName} is already ${enemy.status}.` };
  }
  // The AI's damage_enemy is for harm no creature's attack deals: a hazard,
  // the environment. A blow is an attack and goes through pc_attack (or an
  // ally recruited with add_companion, attacking with pc_attack), where the
  // hit is rolled and the action spent. The DM's own hand stays free.
  // A fall is the environment's by its nature.
  if (args.fallFeet !== undefined) {
    return enemyFalls(campaign, turn, encounter, enemy, args.fallFeet, sheets, sheetsById);
  }
  const amount = args.amount ?? 0;
  if (turn.actor === "ai" && args.source !== "hazard" && args.source !== "environment") {
    return {
      error:
        args.source === "ally"
          ? "An ally's blow is an attack: recruit the ally with add_companion (kind guest) and resolve it with pc_attack. damage_enemy takes only harm from a hazard or the environment."
          : "damage_enemy takes only harm no creature's attack deals: send source 'hazard' or 'environment' with the reason. A character's attack is pc_attack; a spell is cast_at_enemy or aoe_damage.",
    };
  }
  // Double-apply guard: a damage roll carrying targetEnemyId already landed
  // this hit the moment the dice resolved; a damage_enemy call repeating the
  // same number out of habit must not stack the damage.
  const alreadyApplied = turn.rollIds
    .map((rollId) => getRoll(rollId))
    .some(
      (roll) => roll?.applied && roll.targetEnemyId === enemy.id && roll.total === amount,
    );
  if (alreadyApplied) {
    return {
      ok: true,
      name: enemy.displayName,
      hp: `${enemy.currentHp}/${enemy.maxHp}`,
      health: healthState(enemy.currentHp, enemy.maxHp),
      note: "That damage was already applied when the roll resolved; nothing more to apply. Narrate from this state.",
    };
  }
  return applyEnemyDamage(
    campaign,
    turn,
    encounter,
    enemy,
    amount,
    sheets,
    sheetsById,
    args.type,
    { magical: args.magical === true },
  );
}

// ---- enemy_attack ----

// The handler lives in src/lib/dm/enemy-attack.ts.

// ---- end_encounter ----

// Outcome is deliberately a free string: a rejected end_encounter used to
// leave the fight stuck open while the narration declared it over.
// coerceEncounterOutcome maps synonyms and infers from the roster.
const endArgsSchema = z.object({
  outcome: z.string().max(80).optional(),
  reason: z.string().optional(),
});

function handleEndEncounter(
  campaign: Campaign,
  turn: DmTurn,
  rawArguments: string,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
): Record<string, unknown> {
  const encounter = getActiveEncounter(campaign.id);
  if (!encounter) {
    return { error: "No active encounter." };
  }
  let args: z.infer<typeof endArgsSchema>;
  try {
    args = endArgsSchema.parse(JSON.parse(rawArguments || "{}"));
  } catch {
    args = { outcome: undefined };
  }
  const statuses = listEnemies(encounter.id).map((enemy) => enemy.status);
  const { outcome, inferred } = coerceEncounterOutcome(args.outcome, statuses);
  return {
    ok: true,
    ...(inferred
      ? { note: `Outcome "${args.outcome ?? ""}" was not recognized; recorded as ${outcome}.` }
      : {}),
    ...finishEncounter(campaign, turn, encounter, outcome, sheets, sheetsById),
  };
}

// ---- turn resolution marking ----

// Records that a PC's combat turn was adjudicated by a resolving tool this
// DM turn; finalize() only advances the initiative past a PC on this list
// (or with a landed non-initiative roll). Persisted with the turn so a
// parked physical-dice attack still counts when the turn resumes.
function markTurnResolved(turn: DmTurn, sheetId: string) {
  if (!turn.resolvedCharacterIds.includes(sheetId)) {
    turn.resolvedCharacterIds.push(sheetId);
    saveDmTurn(turn);
  }
}

// An attack no longer ends a HUMAN character's initiative turn: they may
// still have movement and a bonus action, so only end_turn (the model's or
// the player's own button) advances past them. Companions are the
// exception: the model plays their whole turn in one go, and marking them
// resolved here keeps the auto-act backstop from swinging a second time.
function markResolvedFromArgs(
  turn: DmTurn,
  rawArguments: string,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
  result: Record<string, unknown>,
) {
  if ("error" in result) {
    return;
  }
  let characterId: string | null = null;
  try {
    const parsed = JSON.parse(rawArguments || "{}") as { characterId?: unknown };
    characterId = typeof parsed.characterId === "string" ? parsed.characterId : null;
  } catch {
    return;
  }
  const sheet = characterId ? resolveSheetRef(characterId, sheets, sheetsById) : null;
  if (sheet?.isCompanion) {
    markTurnResolved(turn, sheet.id);
  }
}

const endTurnArgsSchema = z.object({ characterId: z.string() });

function handleEndTurn(
  campaign: Campaign,
  turn: DmTurn,
  rawArguments: string,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
): Record<string, unknown> {
  const encounter = getActiveEncounter(campaign.id);
  if (!encounter || !encounter.orderReady) {
    return { error: "No active encounter with a locked initiative order." };
  }
  let args: z.infer<typeof endTurnArgsSchema>;
  try {
    args = endTurnArgsSchema.parse(JSON.parse(rawArguments || "{}"));
  } catch {
    return { error: "Invalid arguments: end_turn needs characterId." };
  }
  const sheet = resolveSheetRef(args.characterId, sheets, sheetsById);
  if (!sheet) {
    return { error: "Unknown characterId; use one from GAME STATE." };
  }
  // Ending a turn is the one thing its owner can always do: a character
  // stunned in the middle of their turn still has to be able to hand it on.
  // So only whose turn it is is asked here, not whether they can act.
  const current = encounter.order[encounter.turnIndex];
  if (actingCombatantId(encounter) !== sheet.id || !current || current.kind !== "pc") {
    return { error: `It is ${current?.name ?? "someone else"}'s turn, not ${sheet.name}'s.` };
  }
  markTurnResolved(turn, sheet.id);
  // The pointer moves now, for the AI as for a person at the console, so the
  // enemies whose turns come next are the model's to play in this same reply
  // (their round has begun for them: an enemy acts once a round, counted
  // from where the pointer stands). The ones the model leaves are acted by
  // the backstop when its turn finishes (advanceAfterTurn), which reads the
  // handoff recorded here so it neither moves the pointer twice nor acts an
  // enemy the model already played.
  const advanced = advancePointer(campaign, encounter);
  if (!advanced) {
    return { error: "Nobody is left standing to take the next turn." };
  }
  const next = encounter.order[encounter.turnIndex];
  const passed = advanced.enemiesPassed
    .map((enemyId) => resolveEnemyRef(encounter.id, enemyId))
    .filter((enemy): enemy is EncounterEnemy => Boolean(enemy && enemy.status === "alive"));
  if (turn.actor === "ai") {
    const live = getActiveEncounter(campaign.id) ?? encounter;
    const earlier = live.legendary.handoff?.turnId === turn.id ? live.legendary.handoff.enemyIds : [];
    live.legendary.handoff = { turnId: turn.id, enemyIds: [...earlier, ...passed.map((enemy) => enemy.id)] };
    saveEncounter(live);
  }
  const names = passed.map((enemy) => enemy.displayName);
  return {
    ok: true,
    nextTurn: next?.name ?? null,
    round: encounter.round,
    ...(passed.length
      ? { enemiesToAct: passed.map((enemy) => ({ enemyId: enemy.id, name: enemy.displayName })) }
      : {}),
    note: `${sheet.name}'s turn is over.${
      names.length
        ? ` ${names.join(" and ")} act${names.length === 1 ? "s" : ""} before ${next?.name}${
            turn.actor === "ai"
              ? ": take their turns now, one enemy_attack (or ability or spell) each, then narrate and stop. Any you leave act on their own after your narration."
              : "."
          }`
        : ""
    } It is now ${next?.name}'s turn (round ${encounter.round}).`,
  };
}

// ---- dispatch ----

export function applyEncounterCall(
  campaign: Campaign,
  turn: DmTurn,
  toolName: string,
  rawArguments: string,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
  // pc_attack only: physical-dice roster and the call id its parked to-hit
  // roll answers on resume.
  callContext?: { realDiceUserIds: Set<string>; toolCallId: string | null },
): { result: Record<string, unknown> } {
  switch (toolName) {
    case "start_encounter": {
      const started = handleStartEncounter(campaign, rawArguments, sheets, turn.actor);
      // Entering combat is great stress for cackle fever (afflictions.ts).
      const stress = "error" in started ? [] : afflictionsAtCombatStart(campaign, turn.id);
      return { result: stress.length ? { ...started, afflictions: stress } : started };
    }
    case "pc_attack": {
      const result = handlePcAttack(
        campaign,
        turn,
        rawArguments,
        sheets,
        sheetsById,
        callContext?.realDiceUserIds ?? new Set(),
        callContext?.toolCallId ?? null,
      );
      markResolvedFromArgs(turn, rawArguments, sheets, sheetsById, result);
      return { result };
    }
    case "cast_at_enemy": {
      // Improved Reaper's second target (src/lib/dm/authored-reaper.ts).
      const result = handleReaperCast(campaign, turn, rawArguments, sheets, sheetsById) ?? handleCastAtEnemy(campaign, turn, rawArguments, sheets, sheetsById);
      markResolvedFromArgs(turn, rawArguments, sheets, sheetsById, result);
      return { result };
    }
    case "cast_at_player": {
      // An enemy's spell or ability is its action, on its own turn.
      const early = enemyCallOutOfTurn(campaign.id, turn, rawArguments, "casterEnemyId");
      return { result: early ? { error: early } : handleCastAtPlayer(campaign, turn, rawArguments, sheets, sheetsById) };
    }
    case "take_action": {
      const result = handleTakeAction(campaign, turn, rawArguments, sheets, sheetsById);
      markResolvedFromArgs(turn, rawArguments, sheets, sheetsById, result);
      return { result };
    }
    case "use_reaction":
      return { result: handleUseReaction(campaign, turn, rawArguments, sheets, sheetsById) };
    case "end_turn":
      return { result: handleEndTurn(campaign, turn, rawArguments, sheets, sheetsById) };
    case "damage_enemy":
      return { result: handleDamageEnemy(campaign, turn, rawArguments, sheets, sheetsById) };
    case "enemy_attack": {
      // The backstop calls handleEnemyAttack directly; the model's call waits
      // for the enemy's turn (src/lib/dm/enemy-turn-order.ts).
      const early = enemyCallOutOfTurn(campaign.id, turn, rawArguments, "enemyId");
      return { result: early ? { error: early } : handleEnemyAttack(campaign, turn, rawArguments, sheets, sheetsById) };
    }
    case "move_token":
      return { result: handleMoveToken(campaign, rawArguments, sheets, sheetsById, turn) };
    case "teleport_token":
      return { result: handleTeleportToken(campaign, rawArguments, sheets, sheetsById, turn) };
    case "set_movement":
      return { result: handleSetMovement(campaign, rawArguments, sheets, sheetsById, turn) };
    case "end_encounter":
      return { result: handleEndEncounter(campaign, turn, rawArguments, sheets, sheetsById) };
    default:
      return (
        applyExtraEncounterCall(campaign, turn, toolName, rawArguments, sheets, sheetsById) ?? {
          result: { error: `Unknown encounter tool ${toolName}.` },
        }
      );
  }
}

// ---- server-driven turn advancement ----

function advancePointer(
  campaign: Campaign,
  encounter: Encounter,
  options?: { announce?: boolean },
): { enemiesPassed: string[] } | null {
  const enemiesById = new Map(listEnemies(encounter.id).map((enemy) => [enemy.id, enemy]));
  const leaving = encounter.order[encounter.turnIndex];
  let next = advanceOrder(encounter.order, encounter.turnIndex, (entry) =>
    entryActs(entry, enemiesById, encounter.surprisedIds),
  );
  // Round 1 is ending: Thief's Reflexes' second turns go with it
  // (src/lib/dm/encounter-logic.ts), and the step is taken again on the
  // order the next round keeps.
  const reflexless = next?.wrapped ? withoutReflexTurns(encounter.order, encounter.turnIndex) : null;
  if (reflexless) {
    encounter.order = reflexless.order;
    encounter.turnIndex = reflexless.turnIndex;
    next = advanceOrder(encounter.order, encounter.turnIndex, (entry) =>
      entryActs(entry, enemiesById, encounter.surprisedIds),
    );
  }
  if (!next) {
    return null;
  }
  // Every combatant from the one after the last turn to the one the pointer
  // lands on is starting a turn: enemies and the downed are walked past, and
  // an enemy's turn is taken inside the DM turn that follows.
  const starting: string[] = [];
  // The ones walked past before the order wrapped: their turn belongs to
  // the round that is ending.
  const beforeWrap: string[] = [];
  for (let index = encounter.turnIndex; ; ) {
    const wrappedHere = index + 1 >= encounter.order.length;
    index = (index + 1) % encounter.order.length;
    const id = orderEntryId(encounter.order[index]);
    starting.push(id);
    if (!wrappedHere && index > encounter.turnIndex) {
      beforeWrap.push(id);
    }
    if (index === next.turnIndex || starting.length >= encounter.order.length) {
      break;
    }
  }
  const lostToSurprise = beforeWrap.filter(
    (id) => encounter.surprisedIds.includes(id) && enemiesById.has(id),
  );
  // The turn the pointer leaves is over, and so are the enemies' turns it
  // handed out before (they were played in the DM turn after that move):
  // whatever lasted "until the end of" one of those turns ends now
  // (src/lib/dm/turn-end.ts). Only an effect whose awaited turn has begun
  // goes, so one laid during this very turn waits for the next.
  const turnEnd = endTurns(campaign, encounter.id, [
    ...(leaving ? [orderEntryId(leaving)] : []),
    ...enemiesById.keys(),
  ]);
  encounter.turnIndex = next.turnIndex;
  // The action economy belongs to whoever was acting; the next combatant
  // starts clean (src/lib/dm/action-budget.ts). What the turn that is ending
  // spent is handed to the turn-end rules (a rage that was not fed) before
  // it is thrown away, so they never depend on when this row is saved.
  const endedTurn = { budget: encounter.turnBudget };
  encounter.turnBudget = null;
  // A reaction comes back at the start of its owner's turn, and what lasted
  // until that turn (Dodge, Shield) ends with it.
  // Vigilant Defender's per-turn reactions ("vigilant:<id>:<mover>") come
  // back with the defender's own turn too.
  encounter.reactionsUsed = encounter.reactionsUsed.filter(
    (id) => !starting.includes(id) && !starting.some((owner) => id.startsWith(`${VIGILANT_PREFIX}${owner}:`)),
  );
  startTurnConditions(campaign, encounter, starting, endedTurn);
  // What the turns now starting bring, posted as one table note
  // (src/lib/dm/turn-start-effects.ts).
  turnStartEffects(campaign, encounter, starting, enemiesById, turnEnd.lines);
  if (next.wrapped) {
    encounter.round += 1;
    // A surprised enemy at the tail of the order was walked past in round
    // 1: that was the turn it lost, and the new round must not hand it back.
    for (const id of lostToSurprise) {
      markEnemyActed(encounter, id);
    }
    // Surprise costs exactly one turn, so it is spent by the time round 1
    // has gone all the way around.
    encounter.surprisedIds = [];
    // New round: timed conditions tick down, save-ends conditions re-save,
    // and movement budgets refill for every token.
    tickEncounterConditions(campaign, encounter);
    const map = getBattleMapForEncounter(encounter.id);
    if (map) {
      resetRoundBudgets(map.id, encounter.round);
      publishBattleMapUpdate(campaign.id);
    }
  } else {
    // Mid-round, only the turns now starting walk again: a Thief's Reflexes
    // turn after the thief's first one, not a turn that has been taken.
    const map = getBattleMapForEncounter(encounter.id);
    if (map) {
      resetTurnBudgets(map.id, starting);
      publishBattleMapUpdate(campaign.id);
    }
  }
  encounter.waitingSeq = latestSeq(campaign.id);
  saveEncounter(encounter);
  // A creature a spell made that went during the move leaves the order now,
  // after the save that would have put it back (src/lib/dm/summon-store.ts).
  if (sweepSummons(campaign).length || encounter.order.some((entry) => entry.kind === "pc" && !getSheetById(entry.characterId))) {
    Object.assign(encounter, getActiveEncounter(campaign.id) ?? encounter);
  }
  setInitiativeFloor(campaign, encounter);
  holdForEnemies(campaign, encounter, next.enemiesPassed);
  publishEncounter(campaign.id);
  // The pointer move is announced as a table note so the transcript can
  // never silently disagree with the banner about whose turn it is.
  if (options?.announce !== false) {
    const nextEntry = encounter.order[encounter.turnIndex];
    if (nextEntry) {
      const seq = allocateSeq(campaign.id);
      const lairNote =
        next.wrapped && encounter.legendary.lair
          ? " Initiative 20: the lair stirs (lair_action)."
          : "";
      const message = insertCampaignMessage({
        campaignId: campaign.id,
        seq,
        authorType: "system",
        content: `It is now ${nextEntry.name}'s turn (round ${encounter.round}).${lairNote}`,
      });
      publishWithSeq(campaign.id, seq, "message_added", { message });
    }
  }
  // Downed PCs the pointer skipped make their death saves now, once per
  // pass, announced to the table as system messages and dice cards.
  for (const characterId of next.pcsPassed) {
    rollDeathSave(campaign, characterId);
  }
  return { enemiesPassed: next.enemiesPassed };
}

// The auto-act fallback: enemies the model skipped this turn take their
// default attack anyway, so an enemy turn can never silently vanish. Runs
// through handleEnemyAttack, so multiattack, auto-approach, conditions, and
// real dice cards all apply; the outcome posts as a system table note the
// model narrates around next turn.
export function autoActSkippedEnemies(
  campaign: Campaign,
  turn: DmTurn,
  encounter: Encounter,
  enemyIds: string[],
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
  // A person who played the enemies themselves hands the turn on with
  // play=false: only the end of those turns is applied.
  options: { play?: boolean } = {},
) {
  const play = options.play !== false;
  const notes: string[] = [];
  for (const enemyId of play ? enemyIds : []) {
    if (turn.actedEnemyIds.includes(enemyId)) {
      continue;
    }
    const enemy = resolveEnemyRef(encounter.id, enemyId);
    // Read fresh: each attack before this one wrote to the encounter.
    const live = getActiveEncounter(campaign.id);
    if (!enemy || !live || !canEnemyAct({ enemy, encounter: live, kind: "action" }).ok) {
      continue;
    }
    const living = sheets.filter((sheet) => {
      const fresh = getSheetById(sheet.id);
      return (fresh?.currentHp ?? 0) > 0;
    });
    if (!living.length) {
      break;
    }
    const map = getBattleMapForEncounter(encounter.id);
    const attackerToken = map ? getTokenByRef(map.id, enemy.id) : null;
    const targetId = pickEnemyTarget(
      attackerToken ? { x: attackerToken.x, y: attackerToken.y } : null,
      living.map((sheet) => {
        const token = map ? getTokenByRef(map.id, sheet.id) : null;
        const conditions = (getSheetById(sheet.id) ?? sheet).conditions.map((entry) => entry.toLowerCase());
        return {
          characterId: sheet.id,
          ac: acWithEffects(campaign.id, sheet),
          position: token ? { x: token.x, y: token.y } : null,
          unseen: conditions.includes("hidden") || conditions.includes("invisible"),
        };
      }),
    );
    if (!targetId) {
      break;
    }
    const result = handleEnemyAttack(
      campaign,
      turn,
      JSON.stringify({ enemyId: enemy.id, targetCharacterId: targetId }),
      sheets,
      sheetsById,
    );
    const targetName = sheetsById.get(targetId)?.name ?? "a hero";
    if ("error" in result) {
      // Out of reach or otherwise unable: the skipped turn passes quietly.
      continue;
    }
    const swings = Array.isArray(result.swings) ? (result.swings as Array<Record<string, unknown>>) : [];
    const summary = swings
      .map((swing) =>
        swing.hit
          ? `${swing.rolled} vs AC ${result.vsAc}: HIT for ${swing.damage}${swing.crit ? " (CRIT)" : ""}`
          : `${swing.rolled} vs AC ${result.vsAc}: miss`,
      )
      .join("; ");
    notes.push(
      `${enemy.displayName} attacks ${targetName} with ${String(result.attack)} (${summary}).${
        result.dropped ? ` ${targetName} falls!` : ""
      }`,
    );
  }
  // The enemies handed out have had their turns: what lasted until the end
  // of one of them ends now (src/lib/dm/turn-end.ts).
  const ended = endTurns(campaign, encounter.id, enemyIds);
  notes.push(...ended.lines);
  if (ended.enemiesChanged) {
    publishEncounter(campaign.id);
  }
  if (notes.length) {
    const seq = allocateSeq(campaign.id);
    const message = insertCampaignMessage({
      campaignId: campaign.id,
      seq,
      authorType: "system",
      content: play ? `Skipped enemy turns resolve automatically: ${notes.join(" ")}` : notes.join(" "),
    });
    publishWithSeq(campaign.id, seq, "message_added", { message });
    saveDmTurn(turn);
  }
}

// Called from finalize() on a successful DM turn: the pointer moves only
// when the current PC's turn was actually adjudicated this DM turn (a
// resolving tool like pc_attack or cast_at_enemy ran for them, a
// non-initiative roll of theirs landed, or the model called end_turn), so
// table talk and questions never steal anyone's turn. Enemies the pointer
// passes that the model never attacked with auto-act via the server
// fallback.
export function advanceAfterTurn(campaign: Campaign, turn?: DmTurn) {
  const floor = getFloor(campaign.id);
  // A hold wrapping the fight's floor is still the fight's floor.
  const combat =
    floor.mode === "initiative"
      ? floor
      : floor.mode === "hold" && floor.next.mode === "initiative"
        ? floor.next
        : null;
  if (!combat) {
    return;
  }
  const encounter = getActiveEncounter(campaign.id);
  if (!encounter || !encounter.orderReady || encounter.id !== combat.encounterId) {
    return;
  }
  // The model's end_turn already moved the pointer in this DM turn and
  // handed it the enemies to play: the pointer stays, and only the enemies
  // it left are acted by the backstop (after the narration, as before).
  const handoff = encounter.legendary?.handoff;
  if (turn && handoff && handoff.turnId === turn.id) {
    delete encounter.legendary.handoff;
    saveEncounter(encounter);
    const sheets = listSheets(campaign.id);
    const sheetsById = new Map(sheets.map((sheet) => [sheet.id, sheet]));
    autoActSkippedEnemies(campaign, turn, encounter, handoff.enemyIds, sheets, sheetsById);
    const next = encounter.order[encounter.turnIndex];
    if (next?.kind === "pc" && isCompanionUserId(next.userId)) {
      wakeDm(campaign.id);
    }
    return;
  }
  const current = encounter.order[encounter.turnIndex];
  if (!current || current.kind !== "pc") {
    return;
  }
  // Only an explicit end_turn (the model's call, the player's End Turn
  // button, or the companion auto-act) resolves a turn now: attacks and
  // landed rolls leave the floor with the character, because they may still
  // have movement or a bonus action to spend.
  const resolved = turn !== undefined && turn.resolvedCharacterIds.includes(current.characterId);
  if (!resolved) {
    // AI companion turn the model never adjudicated: the server takes the
    // basic action (like skipped enemies), so combat cannot wedge on a
    // combatant no human controls.
    if (turn && isCompanionUserId(current.userId)) {
      companionAutoAct(campaign, turn, encounter, current.characterId);
    } else {
      return;
    }
  }
  const advanced = advancePointer(campaign, encounter);
  if (advanced && turn) {
    const sheets = listSheets(campaign.id);
    const sheetsById = new Map(sheets.map((sheet) => [sheet.id, sheet]));
    autoActSkippedEnemies(
      campaign,
      turn,
      encounter,
      advanced.enemiesPassed,
      sheets,
      sheetsById,
    );
  }
  // The pointer now rests on an AI companion: wake the DM so the model can
  // play their turn with real tactics; if that turn ends without resolving
  // them, the auto-act above is the safety net.
  if (advanced) {
    const next = encounter.order[encounter.turnIndex];
    if (next?.kind === "pc" && isCompanionUserId(next.userId)) {
      wakeDm(campaign.id);
    }
  }
}

// The companion analog of autoActSkippedEnemies: nearest living enemy,
// basic attack through the full pc_attack engine (range checks, conditions,
// advantage, damage application), outcome posted as a table note. The turn
// counts as resolved even when the attack is out of reach, so initiative
// always moves on.
function companionAutoAct(
  campaign: Campaign,
  turn: DmTurn,
  encounter: Encounter,
  characterId: string,
) {
  markTurnResolved(turn, characterId);
  const sheet = getSheetById(characterId);
  if (!sheet || sheet.currentHp <= 0 || isIncapacitated(sheet.conditions)) {
    return;
  }
  const enemies = listEnemies(encounter.id).filter((enemy) => enemy.status === "alive");
  if (!enemies.length) {
    return;
  }
  // A companion whose action this turn already went on something (a spell,
  // a potion, a Dash) is not given a second one; its turn simply ends.
  const live = getActiveEncounter(campaign.id) ?? encounter;
  if (live.turnBudget?.ownerId === sheet.id && live.turnBudget.round === live.round && live.turnBudget.actionUsed) {
    return;
  }
  const map = getBattleMapForEncounter(encounter.id);
  const myToken = map ? getTokenByRef(map.id, sheet.id) : null;
  let target = enemies[0];
  if (map && myToken) {
    let best = Number.POSITIVE_INFINITY;
    for (const enemy of enemies) {
      const token = getTokenByRef(map.id, enemy.id);
      if (!token) {
        continue;
      }
      const distance = Math.max(Math.abs(token.x - myToken.x), Math.abs(token.y - myToken.y));
      if (distance < best) {
        best = distance;
        target = enemy;
      }
    }
  }
  // Out of reach: it walks to the target first, as the enemies the server
  // plays do (src/lib/dm/companion-approach.ts).
  const walked = approachForCompanion(campaign, live, sheet, target);
  const mover = walked ? getSheetById(sheet.id) ?? sheet : sheet;
  const result = handlePcAttack(
    campaign,
    turn,
    JSON.stringify({ characterId: mover.id, targetEnemyId: target.id }),
    [mover],
    new Map([[mover.id, mover]]),
    new Set<string>(),
    null,
  );
  const note =
    (walked ? `${walked} ` : "") +
    ("error" in result
      ? `${sheet.name} does not attack: ${String(result.error)}`
      : result.hit
        ? `${sheet.name} attacks ${target.displayName} with ${String(result.weapon ?? "their weapon")} and hits for ${String(result.damage)} damage${result.dead ? `, slaying ${target.displayName}!` : "."}`
        : `${sheet.name} attacks ${target.displayName} but misses.`);
  const seq = allocateSeq(campaign.id);
  const message = insertCampaignMessage({
    campaignId: campaign.id,
    seq,
    authorType: "system",
    content: `${sheet.name}'s turn resolves automatically: ${note}`,
  });
  publishWithSeq(campaign.id, seq, "message_added", { message });
  saveDmTurn(turn);
}

// Self-service turn end: the current player declares their combat turn done
// (attack landed, movement spent or declined). Same shape as the lead skip
// below; the caller wakes the DM so intervening enemies still act.
export function endOwnTurn(campaignId: string, userId: string): boolean {
  const campaign = getCampaignById(campaignId);
  const encounter = getActiveEncounter(campaignId);
  if (!campaign || !encounter || !encounter.orderReady) {
    return false;
  }
  const current = encounter.order[encounter.turnIndex];
  if (!current || current.kind !== "pc" || current.userId !== userId) {
    return false;
  }
  const name = current.name;
  if (!advancePointer(campaign, encounter, { announce: false })) {
    return false;
  }
  const next = encounter.order[encounter.turnIndex];
  const seq = allocateSeq(campaignId);
  const message = insertCampaignMessage({
    campaignId,
    seq,
    authorType: "system",
    content: `${name} ends their turn.${next ? ` It is now ${next.name}'s turn.` : ""}`,
  });
  publishWithSeq(campaignId, seq, "message_added", { message });
  return true;
}

// A person running the fight hands the turn on after the enemies the pointer
// walked past (src/lib/dm/enemies-due.ts): with play, the server plays the
// ones still owed their action, as the AI's backstop would; either way their
// turns end and the floor opens for the player up next.
export function handOnEnemyTurns(campaign: Campaign, turn: DmTurn, play: boolean): string | null {
  const encounter = getActiveEncounter(campaign.id);
  if (!encounter || !encounter.orderReady) {
    return "No fight is running.";
  }
  const due = encounter.legendary.due ?? [];
  delete encounter.legendary.due;
  saveEncounter(encounter);
  if (due.length) {
    const sheets = fieldedSheets(campaign);
    const sheetsById = new Map(sheets.map((sheet) => [sheet.id, sheet]));
    autoActSkippedEnemies(campaign, turn, encounter, due, sheets, sheetsById, { play });
  }
  const floor = getFloor(campaign.id);
  if (floor.mode === "hold" && floor.next.mode === "initiative") {
    const next = floorAfterRelease(campaign.id);
    setFloor(campaign.id, next);
    publishPersisted(campaign.id, "floor_changed", { floor: next });
  }
  publishEncounter(campaign.id);
  return null;
}

// The pointer rests on an AI companion at a person's table: the server
// plays its basic turn (as the AI's backstop does) and moves on.
export function playCompanionTurn(campaign: Campaign, turn: DmTurn): string | null {
  const encounter = getActiveEncounter(campaign.id);
  if (!encounter || !encounter.orderReady) {
    return "No fight is running.";
  }
  const current = encounter.order[encounter.turnIndex];
  if (!current || current.kind !== "pc" || !isCompanionUserId(current.userId)) {
    return "It is not a companion's turn.";
  }
  companionAutoAct(campaign, turn, encounter, current.characterId);
  const live = getActiveEncounter(campaign.id);
  if (live && !advancePointer(campaign, live)) {
    return "Nobody is left standing to take the next turn.";
  }
  return null;
}

// The DM's "on a turn": the same move End Turn makes, with everything a new
// turn brings (conditions, reactions, movement, death saves, a new round).
export function stepTurnForward(campaign: Campaign): string | null {
  const encounter = getActiveEncounter(campaign.id);
  if (!encounter || !encounter.orderReady) {
    return "No fight is running.";
  }
  return advancePointer(campaign, encounter) ? null : "Nobody is left standing to take the next turn.";
}

// Lead escape hatch: advance past an absent player's turn. Inserts a table
// note; the caller wakes the DM so intervening enemies still act (kept out
// of this module to avoid an import cycle with the turn loop).
export function skipCurrentTurn(campaignId: string): boolean {
  const campaign = getCampaignById(campaignId);
  const encounter = getActiveEncounter(campaignId);
  if (!campaign || !encounter || !encounter.orderReady) {
    return false;
  }
  const skipped = encounter.order[encounter.turnIndex];
  if (!advancePointer(campaign, encounter, { announce: false })) {
    return false;
  }
  const next = encounter.order[encounter.turnIndex];
  const seq = allocateSeq(campaignId);
  const message = insertCampaignMessage({
    campaignId,
    seq,
    authorType: "system",
    content: `The party lead skipped ${skipped?.name ?? "the current"}'s turn.${
      next ? ` It is now ${next.name}'s turn.` : ""
    }`,
  });
  publishWithSeq(campaignId, seq, "message_added", { message });
  return true;
}
