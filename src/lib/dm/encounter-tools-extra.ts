import { z } from "zod";
import type { Campaign } from "@/lib/db/campaigns";
import { getActiveEncounter, listEnemies, patchEnemyConditions, patchEnemyHp } from "@/lib/db/encounters";
import { getBattleMapForEncounter, removeTokenByRef } from "@/lib/db/battle-maps";
import type { DmTurn } from "@/lib/db/dm-turns";
import { finishEncounter, publishEncounter, resolveEnemyRef } from "@/lib/dm/enemy-damage";
import { addEnemiesTool, handleAddEnemies } from "@/lib/dm/encounter-spawn";
import { handleLairAction, handleLegendaryAction, handleLegendaryResist, legendaryTools } from "@/lib/dm/legendary-tools";
import { declareIntentTool, handleDeclareIntent } from "@/lib/dm/intent-tools";
import { canonicalCondition } from "@/lib/dm/mutations";
import { isIncapacitated, pruneMeta } from "@/lib/dm/condition-logic";
import { onEnemyIncapacitated } from "@/lib/dm/enemy-conditions";
import { setEnemyExhaustion } from "@/lib/dm/enemy-exhaustion";
import { enemyCallOutOfTurn, enemyTurnRefusal } from "@/lib/dm/enemy-turn-order";
import { characterCallUnasked } from "@/lib/dm/player-word";
import { standUpIfProne } from "@/lib/dm/enemy-approach";
import { enemySpeedTiles } from "@/lib/dm/enemy-speed";
import { PRONE } from "@/lib/dm/vitals-logic";
import { normalizeAbility } from "@/lib/dm/arg-coerce";
import { publishBattleMapUpdate } from "@/lib/dm/map-tools";
import { planConditionFx } from "@/lib/battlemap/fx-plan";
import { publishFx, tokenPosition } from "@/lib/dm/fx";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { aoeDamageTool, handleAoeDamage } from "@/lib/dm/aoe-damage";

// Encounter tools beyond the core start/damage/attack/end set:
// reinforcements, enemy flight, enemy conditions, and multi-target AoE.
// Imports point downward only (enemy-damage, encounter-spawn, map-tools,
// db); this module must never import encounter-tools.

export const EXTRA_ENCOUNTER_TOOL_NAMES = [
  "add_enemies",
  "enemy_flees",
  "set_enemy_condition",
  "clear_enemy_condition",
  "aoe_damage",
  "legendary_action",
  "legendary_resist",
  "lair_action",
  "declare_intent",
] as const;

type ToolDef = {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

const enemyFleesTool: ToolDef = {
  type: "function",
  function: {
    name: "enemy_flees",
    description:
      "An enemy escapes the fight: it runs, teleports away, dives underwater, or otherwise leaves. Call this BEFORE narrating the escape; its token leaves the map. When no enemies remain the encounter ends automatically with reduced XP.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        enemyId: { type: "string", description: "Exact enemyId from GAME STATE." },
        reason: { type: "string", description: "Short in-fiction cause." },
      },
      required: ["enemyId"],
    },
  },
};

const setEnemyConditionTool: ToolDef = {
  type: "function",
  function: {
    name: "set_enemy_condition",
    description:
      "Apply a condition to an enemy (prone, poisoned, stunned, restrained, frightened, grappled, ...). Call it BEFORE narrating the effect taking hold, exactly as with characters. The server refuses conditions the enemy is immune to.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        enemyId: { type: "string", description: "Exact enemyId from GAME STATE." },
        condition: { type: "string" },
        rounds: {
          type: "integer",
          minimum: 1,
          maximum: 100,
          description: "Rounds until the condition ends on its own.",
        },
        saveAbility: {
          type: "string",
          enum: ["str", "dex", "con", "int", "wis", "cha"],
          description: "Save-ends: ability the enemy re-saves at the end of each round.",
        },
        saveDc: { type: "integer", minimum: 1, maximum: 30, description: "Save-ends DC." },
        sourceCharacterId: {
          type: "string",
          description:
            "The character that caused it, when the condition is tied to one: the grappler, the charmer, the source of the fear.",
        },
        sourceEnemyId: {
          type: "string",
          description: "The enemy that caused it, when it was another enemy.",
        },
        level: {
          type: "integer",
          minimum: 1,
          maximum: 6,
          description:
            "Exhaustion only: the level it now has. The server applies it: 2 halves speed, 3 disadvantage on attacks and saves, 4 halves hit points, 5 speed 0, 6 dead.",
        },
        reason: { type: "string", description: "Short in-fiction cause." },
      },
      required: ["enemyId", "condition"],
    },
  },
};

const clearEnemyConditionTool: ToolDef = {
  type: "function",
  function: {
    name: "clear_enemy_condition",
    description:
      "Remove a condition from an enemy the moment the fiction ends it (it stands up, shakes off the fear, breaks the grapple). Use the condition name shown in GAME STATE.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        enemyId: { type: "string", description: "Exact enemyId from GAME STATE." },
        condition: { type: "string" },
        reason: { type: "string", description: "Short in-fiction cause." },
      },
      required: ["enemyId", "condition"],
    },
  },
};

export const extraEncounterTools: ToolDef[] = [
  addEnemiesTool,
  enemyFleesTool,
  setEnemyConditionTool,
  clearEnemyConditionTool,
  aoeDamageTool,
  ...legendaryTools,
  declareIntentTool,
];

const enemyRefArgsSchema = z.object({
  enemyId: z.string(),
  condition: z.string().optional(),
  rounds: z.coerce.number().int().min(1).max(100).optional(),
  saveAbility: z.preprocess(
    normalizeAbility,
    z.enum(["str", "dex", "con", "int", "wis", "cha"]).optional(),
  ),
  saveDc: z.coerce.number().int().min(1).max(30).optional(),
  // Who put the condition there: the grappler, the charmer, the source of
  // the fear. Kept as the condition's source.
  sourceCharacterId: z.string().max(80).optional(),
  sourceEnemyId: z.string().max(80).optional(),
  // Exhaustion only: the level it now has (1 to 6).
  level: z.coerce.number().int().min(1).max(6).optional(),
  reason: z.string().optional(),
});

function handleEnemyFlees(
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
  let args: z.infer<typeof enemyRefArgsSchema>;
  try {
    args = enemyRefArgsSchema.parse(JSON.parse(rawArguments || "{}"));
  } catch {
    return { error: "Invalid arguments: enemy_flees needs enemyId." };
  }
  const enemy = resolveEnemyRef(encounter.id, args.enemyId);
  if (!enemy) {
    return { error: "Unknown enemyId; use one from GAME STATE." };
  }
  if (enemy.status !== "alive") {
    return { error: `${enemy.displayName} is already ${enemy.status}.` };
  }
  patchEnemyHp(enemy.id, enemy.currentHp, "fled");
  const map = getBattleMapForEncounter(encounter.id);
  if (map) {
    removeTokenByRef(map.id, enemy.id);
    publishBattleMapUpdate(campaign.id);
  }
  publishEncounter(campaign.id);
  const base: Record<string, unknown> = {
    ok: true,
    fled: enemy.displayName,
    note: `${enemy.displayName} has escaped and is out of the fight.`,
  };
  const remaining = listEnemies(encounter.id).filter((entry) => entry.status === "alive");
  if (!remaining.length) {
    Object.assign(
      base,
      finishEncounter(campaign, turn, encounter, "enemies_fled", sheets, sheetsById),
    );
  }
  return base;
}

function handleEnemyCondition(
  campaign: Campaign,
  action: "set" | "clear",
  rawArguments: string,
  ctx: { turn: DmTurn; sheets: CharacterSheet[]; sheetsById: Map<string, CharacterSheet> },
): Record<string, unknown> {
  const encounter = getActiveEncounter(campaign.id);
  if (!encounter) {
    return { error: "No active encounter." };
  }
  let args: z.infer<typeof enemyRefArgsSchema>;
  try {
    args = enemyRefArgsSchema.parse(JSON.parse(rawArguments || "{}"));
  } catch {
    return { error: "Invalid arguments: needs enemyId and condition." };
  }
  const enemy = resolveEnemyRef(encounter.id, args.enemyId);
  if (!enemy) {
    return { error: "Unknown enemyId; use one from GAME STATE." };
  }
  if (enemy.status !== "alive") {
    return { error: `${enemy.displayName} is ${enemy.status}.` };
  }
  const wanted = canonicalCondition(args.condition ?? "");
  if (!wanted) {
    return { error: "A condition name is required." };
  }

  if (action === "set") {
    if (enemy.stats.conditionImmune.toLowerCase().includes(wanted)) {
      return {
        error: `${enemy.displayName} is immune to ${wanted} (immunities: ${enemy.stats.conditionImmune}).`,
      };
    }
    // Exhaustion is a level, not a flag: the table applies (enemy-exhaustion.ts).
    if (/^exhaust/.test(wanted)) {
      return setEnemyExhaustion(campaign, ctx.turn, encounter, enemy, args.level, ctx.sheets, ctx.sheetsById);
    }
    if (enemy.conditions.includes(wanted)) {
      return { ok: true, note: `${enemy.displayName} is already ${wanted}.` };
    }
    const source = (args.sourceCharacterId ?? args.sourceEnemyId ?? "").trim();
    const meta =
      args.rounds || (args.saveAbility && args.saveDc) || source
        ? {
            ...enemy.conditionMeta,
            [wanted]: {
              ...(source ? { source } : {}),
              ...(args.rounds ? { rounds: args.rounds } : {}),
              ...(args.saveAbility && args.saveDc
                ? { saveEnds: { ability: args.saveAbility, dc: args.saveDc } }
                : {}),
            },
          }
        : enemy.conditionMeta;
    patchEnemyConditions(enemy.id, [...enemy.conditions, wanted], meta);
    // An incapacitated creature loses its concentration (and the spell's
    // hold on its targets) and lets go of whoever it grapples.
    const released = isIncapacitated([wanted]) ? onEnemyIncapacitated(campaign, enemy) : [];
    publishEncounter(campaign.id);
    {
      const pos = tokenPosition(campaign.id, enemy.id);
      if (pos && !pos.hidden) {
        publishFx(
          campaign.id,
          planConditionFx({ to: pos.at, toTokenId: pos.tokenId, condition: wanted, applied: true }),
        );
      }
    }
    return {
      ok: true,
      name: enemy.displayName,
      condition: wanted,
      ...(released.length ? { released: released.join(" ") } : {}),
      ...(args.rounds ? { duration: `${args.rounds} rounds, expires automatically` } : {}),
      ...(args.saveAbility && args.saveDc
        ? {
            duration: `until it succeeds on a ${args.saveAbility.toUpperCase()} save (DC ${args.saveDc}), re-rolled automatically each round`,
          }
        : {}),
    };
  }

  // Forgiving clear, matching the character-side clear_condition behavior.
  const matches = (entry: string) =>
    entry === wanted ||
    canonicalCondition(entry) === wanted ||
    (wanted.length > 3 && (entry.includes(wanted) || wanted.includes(entry)));
  const removed = enemy.conditions.filter(matches);
  if (!removed.length) {
    return {
      error: `${enemy.displayName} is not ${wanted}.`,
      currentConditions: enemy.conditions,
    };
  }
  // The AI clearing prone is the enemy standing up, which costs half its
  // speed on its own turn, as its own walk charges it (enemy-approach.ts) and
  // a character's clear_condition does (stand-up.ts). The console stays free.
  if (wanted === PRONE && ctx.turn.actor === "ai" && encounter.orderReady) {
    const early = enemyTurnRefusal(encounter, enemy, ctx.turn);
    if (early) {
      return { error: early };
    }
    const stood = standUpIfProne(encounter.id, enemy);
    if (!stood.stood) {
      const speed = enemySpeedTiles(enemy) * 5;
      return {
        error: speed
          ? `${enemy.displayName} has too little movement left this turn to stand: it costs half its speed (${Math.floor(speed / 10) * 5} ft).`
          : `${enemy.displayName} cannot stand up at speed 0.`,
      };
    }
    publishEncounter(campaign.id);
    publishBattleMapUpdate(campaign.id);
    return { ok: true, name: enemy.displayName, cleared: removed.join(", "), stood: "stood up for half its speed" };
  }
  const remaining = enemy.conditions.filter((entry) => !matches(entry));
  patchEnemyConditions(enemy.id, remaining, pruneMeta(remaining, enemy.conditionMeta));
  publishEncounter(campaign.id);
  return { ok: true, name: enemy.displayName, cleared: removed.join(", ") };
}

export function applyExtraEncounterCall(
  campaign: Campaign,
  turn: DmTurn,
  toolName: string,
  rawArguments: string,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
): { result: Record<string, unknown> } | null {
  switch (toolName) {
    case "add_enemies":
      return { result: handleAddEnemies(campaign, rawArguments, sheets) };
    case "enemy_flees":
      return { result: handleEnemyFlees(campaign, turn, rawArguments, sheets, sheetsById) };
    case "set_enemy_condition":
      return { result: handleEnemyCondition(campaign, "set", rawArguments, { turn, sheets, sheetsById }) };
    case "clear_enemy_condition":
      return { result: handleEnemyCondition(campaign, "clear", rawArguments, { turn, sheets, sheetsById }) };
    case "aoe_damage": {
      // An enemy's breath or spell is its action, on its own turn; a
      // character's spell waits for their player's word.
      const early =
        enemyCallOutOfTurn(campaign.id, turn, rawArguments, "casterEnemyId") ??
        characterCallUnasked(campaign.id, turn, rawArguments, "casterId");
      return { result: early ? { error: early } : handleAoeDamage(campaign, turn, rawArguments, sheets, sheetsById) };
    }
    case "legendary_action":
      return { result: handleLegendaryAction(campaign, rawArguments) };
    case "legendary_resist":
      return { result: handleLegendaryResist(campaign, rawArguments) };
    case "lair_action":
      return { result: handleLairAction(campaign, turn, rawArguments) };
    case "declare_intent":
      return { result: handleDeclareIntent(campaign, rawArguments, sheets, sheetsById) };
    default:
      return null;
  }
}
