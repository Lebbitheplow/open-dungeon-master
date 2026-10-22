import { z } from "zod";
import type { Campaign } from "@/lib/db/campaigns";
import { getActiveEncounter, listEnemies, patchEnemyConditions, patchEnemyHp } from "@/lib/db/encounters";
import { getBattleMapForEncounter, removeTokenByRef } from "@/lib/db/battle-maps";
import type { DmTurn } from "@/lib/db/dm-turns";
import { finishEncounter, publishEncounter, resolveEnemyRef, unknownEnemyRef } from "@/lib/dm/enemy-damage";
import { addEnemiesTool, handleAddEnemies } from "@/lib/dm/encounter-spawn";
import { handleLairAction, handleLegendaryAction, handleLegendaryResist, legendaryTools } from "@/lib/dm/legendary-tools";
import { declareIntentTool, handleDeclareIntent } from "@/lib/dm/intent-tools";
import { canonicalCondition } from "@/lib/dm/mutations";
import { conditionNameRefusal } from "@/lib/dm/set-condition";
import { addConditionInstance, instancesOf, isIncapacitated, pruneMeta, type ConditionMetaMap } from "@/lib/dm/condition-logic";
import { AI_BIND_REFUSAL, AI_CLEAR_REFUSAL, bindsCreature, engineKept } from "@/lib/dm/ai-boundary";
import { rollEnemySave } from "@/lib/dm/forced-save";
import { onEnemyIncapacitated } from "@/lib/dm/enemy-conditions";
import { setEnemyExhaustion } from "@/lib/dm/enemy-exhaustion";
import { enemyCallOutOfTurn, enemyTurnRefusal } from "@/lib/dm/enemy-turn-order";
import { characterCallUnasked } from "@/lib/dm/player-word";
import { standUpIfProne } from "@/lib/dm/enemy-approach";
import { enemySpeedTiles } from "@/lib/dm/enemy-speed";
import { namesExhaustion, PRONE } from "@/lib/dm/vitals-logic";
import { normalizeAbility } from "@/lib/dm/arg-coerce";
import { publishBattleMapUpdate } from "@/lib/dm/map-tools";
import { planConditionFx } from "@/lib/battlemap/fx-plan";
import { publishFx, tokenPosition } from "@/lib/dm/fx";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { aoeDamageTool, handleAoeDamage } from "@/lib/dm/aoe-damage";
import type { ToolResult } from "@/lib/dm/tool-errors";
import { isConditionNamed } from "@/lib/srd/feature-names";
import { enemyExhaustion } from "@/lib/dm/monster-abilities";

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
      "Record an enemy escaping the fight: it runs, teleports away, dives underwater, or otherwise leaves. Call it BEFORE narrating the escape; its token leaves the map. When no enemies remain the encounter ends automatically with reduced XP.",
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

export const extraEncounterTools: ToolDef[] = [
  addEnemiesTool,
  enemyFleesTool,
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
): ToolResult {
  const encounter = getActiveEncounter(campaign.id);
  if (!encounter) {
    return { error: "No active encounter: enemy_flees works only in a fight.", retry: true };
  }
  let args: z.infer<typeof enemyRefArgsSchema>;
  try {
    args = enemyRefArgsSchema.parse(JSON.parse(rawArguments || "{}"));
  } catch {
    return { error: "Invalid arguments: enemy_flees needs enemyId.", retry: true };
  }
  const enemy = resolveEnemyRef(encounter.id, args.enemyId);
  if (!enemy) {
    return unknownEnemyRef(encounter.id, "enemyId", args.enemyId);
  }
  if (enemy.status !== "alive") {
    return { error: `${enemy.displayName} is already ${enemy.status}.`, retry: true };
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
): ToolResult {
  const encounter = getActiveEncounter(campaign.id);
  if (!encounter) {
    return { error: "No active encounter: an enemy's condition is set only in a fight.", retry: true };
  }
  let args: z.infer<typeof enemyRefArgsSchema>;
  try {
    args = enemyRefArgsSchema.parse(JSON.parse(rawArguments || "{}"));
  } catch {
    return { error: "Invalid arguments: needs enemyId and condition.", retry: true };
  }
  const enemy = resolveEnemyRef(encounter.id, args.enemyId);
  if (!enemy) {
    return unknownEnemyRef(encounter.id, "enemyId", args.enemyId);
  }
  if (enemy.status !== "alive") {
    return { error: `${enemy.displayName} is ${enemy.status}.`, retry: true };
  }
  const wanted = canonicalCondition(args.condition ?? "");
  if (!wanted) {
    return { error: "A condition name is required.", retry: true };
  }

  if (action === "set") {
    // "exhaustion 2", the form the engine itself writes, names exhaustion
    // and its level.
    const exhaustion = namesExhaustion(args.condition ?? "");
    const misnamed = exhaustion ? null : conditionNameRefusal(args.condition ?? "");
    if (misnamed) {
      return misnamed;
    }
    const named = exhaustion ? "exhaustion" : wanted;
    if (enemy.stats.conditionImmune.toLowerCase().includes(named)) {
      return {
        error: `${enemy.displayName} is immune to ${named} (immunities: ${enemy.stats.conditionImmune}).`,
        refused: "rules",
      };
    }
    // Exhaustion is a level, not a flag: the table applies (enemy-exhaustion.ts).
    if (exhaustion) {
      // A bare "exhaustion" is one more level; "exhaustion 2" is that level.
      const written = isConditionNamed(args.condition ?? "", "exhaustion") ? undefined : enemyExhaustion([args.condition ?? ""]);
      return setEnemyExhaustion(campaign, ctx.turn, encounter, enemy, args.level ?? written, ctx.sheets, ctx.sheetsById);
    }
    // The model does not bind a creature by saying so: the creature's save
    // is rolled first, and the condition lands only on a failure
    // (src/lib/dm/ai-boundary.ts). The console keeps its free hand.
    let initialSave: string | null = null;
    if (ctx.turn.actor === "ai" && bindsCreature(wanted)) {
      if (!args.saveAbility || !args.saveDc) {
        return AI_BIND_REFUSAL(enemy.displayName, wanted);
      }
      const save = rollEnemySave(campaign.id, enemy, args.saveAbility, args.saveDc, {
        resist: true,
        against: wanted,
        record: { turn: ctx.turn, detail: `${enemy.displayName}: ${args.saveAbility.toUpperCase()} save against being ${wanted}` },
      });
      initialSave = `${args.saveAbility.toUpperCase()} save ${save.total ?? "failed outright"} vs DC ${args.saveDc}`;
      if (save.success) {
        return { ok: true, name: enemy.displayName, saved: true, note: `${enemy.displayName} makes the ${initialSave}${save.legendaryResistance ? " (Legendary Resistance)" : ""}: no ${wanted}.` };
      }
    }
    const source = (args.sourceCharacterId ?? args.sourceEnemyId ?? "").trim();
    const incoming =
      args.rounds || (args.saveAbility && args.saveDc) || source
        ? {
            ...(source ? { source } : {}),
            ...(args.rounds ? { rounds: args.rounds } : {}),
            ...(args.saveAbility && args.saveDc
              ? { saveEnds: { ability: args.saveAbility, dc: args.saveDc } }
              : {}),
          }
        : undefined;
    // A second source of a condition it holds holds it too, each with its
    // own lifetime (src/lib/dm/condition-logic.ts).
    const laid = addConditionInstance(enemy.conditions, enemy.conditionMeta as ConditionMetaMap, wanted, incoming);
    if (JSON.stringify(laid.meta) === JSON.stringify(enemy.conditionMeta) && laid.conditions.length === enemy.conditions.length) {
      return { ok: true, note: `${enemy.displayName} is already ${wanted}.` };
    }
    patchEnemyConditions(enemy.id, laid.conditions, laid.meta);
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
      ...(initialSave ? { save: `fails the ${initialSave}` } : {}),
      ...(released.length ? { released: released.join(" ") } : {}),
      ...(args.rounds ? { duration: `${args.rounds} rounds, expires automatically` } : {}),
      ...(args.saveAbility && args.saveDc
        ? {
            duration: `until it succeeds on a ${args.saveAbility.toUpperCase()} save (DC ${args.saveDc}), re-rolled automatically at the end of each of its turns`,
          }
        : {}),
    };
  }

  // The condition by its whole name, as the character-side clear_condition
  // finds it; a miss lists what the enemy holds.
  const matches = (entry: string) => entry === wanted || canonicalCondition(entry) === wanted || isConditionNamed(entry, wanted);
  const removed = enemy.conditions.filter(matches);
  if (!removed.length) {
    return {
      error: `${enemy.displayName} is not ${wanted}.`,
      retry: true,
      currentConditions: enemy.conditions,
    };
  }
  // The AI clearing prone is the enemy standing up, which costs half its
  // speed on its own turn, as its own walk charges it (enemy-approach.ts) and
  // a character's clear_condition does (stand-up.ts). The console stays free.
  if (wanted === PRONE && ctx.turn.actor === "ai" && encounter.orderReady) {
    const early = enemyTurnRefusal(encounter, enemy, ctx.turn);
    if (early) {
      return early;
    }
    const stood = standUpIfProne(encounter.id, enemy);
    if (!stood.stood) {
      const speed = enemySpeedTiles(enemy) * 5;
      return {
        error: speed
          ? `${enemy.displayName} has too little movement left this turn to stand: it costs half its speed (${Math.floor(speed / 10) * 5} ft). It stays prone and takes its turn from there.`
          : `${enemy.displayName} cannot stand up at speed 0. It stays prone and takes its turn from there.`,
        retry: true,
      };
    }
    publishEncounter(campaign.id);
    publishBattleMapUpdate(campaign.id);
    return { ok: true, name: enemy.displayName, cleared: removed.join(", "), stood: "stood up for half its speed" };
  }
  // The model does not lift what the engine keeps: a save, a duration or a
  // spell decides when it ends (src/lib/dm/ai-boundary.ts).
  if (ctx.turn.actor === "ai") {
    const kept = removed.find((name) => bindsCreature(canonicalCondition(name)) && instancesOf((enemy.conditionMeta as ConditionMetaMap)[name]).some(engineKept));
    if (kept) {
      return AI_CLEAR_REFUSAL(enemy.displayName, kept);
    }
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
): { result: ToolResult } | null {
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
      return { result: early ? early : handleAoeDamage(campaign, turn, rawArguments, sheets, sheetsById) };
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
