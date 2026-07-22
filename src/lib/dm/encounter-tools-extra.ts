import { z } from "zod";
import { allocateSeq, type Campaign } from "@/lib/db/campaigns";
import {
  getActiveEncounter,
  listEnemies,
  patchEnemyConditions,
  patchEnemyHp,
  type EncounterEnemy,
} from "@/lib/db/encounters";
import { getBattleMapForEncounter, removeTokenByRef } from "@/lib/db/battle-maps";
import { insertRoll } from "@/lib/db/rolls";
import type { DmTurn } from "@/lib/db/dm-turns";
import { d20Expression, isValidExpression, rollExpression } from "@/lib/dice";
import { publishWithSeq } from "@/lib/events";
import { saveModFor, type SaveAbility } from "@/lib/bestiary/statblock";
import { allySaveAura } from "@/lib/dm/aura";
import { trackEnemyConcentration } from "@/lib/dm/cast-tools";
import { defenseRiders } from "@/lib/srd/feature-effects";
import { computeSheetDerived, spellSaveDcFor } from "@/lib/srd";
import { spellDamageFor, spellMechanicsFor } from "@/lib/content";
import {
  applyEnemyDamage,
  finishEncounter,
  publishEncounter,
  resolveEnemyRef,
} from "@/lib/dm/enemy-damage";
import { addEnemiesTool, handleAddEnemies } from "@/lib/dm/encounter-spawn";
import { applyDmMutation, canonicalCondition } from "@/lib/dm/mutations";
import { mergeAdvantage, pruneMeta, rollDerivation } from "@/lib/dm/condition-logic";
import { conditionRollRiders } from "@/lib/srd/condition-effects";
import { normalizeAbility } from "@/lib/dm/arg-coerce";
import { publishBattleMapUpdate } from "@/lib/dm/map-tools";
import { resolveSheetRef } from "@/lib/dm/rolls";
import type { CharacterSheet } from "@/lib/schemas/sheet";

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

const aoeDamageTool: ToolDef = {
  type: "function",
  function: {
    name: "aoe_damage",
    description:
      "Resolve a multi-target save-or-damage effect (breath weapon, fireball, collapsing ceiling) in ONE call. The server rolls the damage once, rolls every target's saving throw from their real stats, and applies full or half damage to each. Never chain per-target request_roll or apply_damage calls for an area effect.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        damage: {
          type: "string",
          description: "Damage dice expression (e.g. 8d6) or a flat integer.",
        },
        type: { type: "string", description: "Damage type, e.g. fire." },
        saveAbility: { type: "string", enum: ["str", "dex", "con", "int", "wis", "cha"] },
        dc: { type: "integer", minimum: 1, maximum: 30 },
        halfOnSave: {
          type: "boolean",
          description: "True (default) = half damage on a successful save; false = no damage.",
        },
        enemyIds: {
          type: "array",
          items: { type: "string" },
          description: "Exact enemyIds from GAME STATE caught in the effect.",
        },
        characterIds: {
          type: "array",
          items: { type: "string" },
          description: "Exact characterIds from GAME STATE caught in the effect.",
        },
        targets: {
          type: "string",
          description: "Fallback: comma-separated combatant names, mixed enemies and characters.",
        },
        casterId: {
          type: "string",
          description:
            "If a player character cast this effect on their combat turn, their exact characterId; marks their turn as taken.",
        },
        casterEnemyId: {
          type: "string",
          description:
            "If a specific ENEMY cast this: its enemyId from GAME STATE. With spell set, the server tracks the enemy's concentration and breaks it when the enemy takes damage or dies.",
        },
        spell: {
          type: "string",
          description:
            "The spell being cast, when this is a player's spell (e.g. Fireball). With casterId set, the server spends the slot and derives the real dice, save, and DC itself, overriding the numbers above.",
        },
        level: {
          type: "integer",
          minimum: 1,
          maximum: 9,
          description: "Slot level to spend for a player's spell (upcasting scales the dice).",
        },
        reason: { type: "string", description: "Short in-fiction cause." },
      },
      required: ["damage", "saveAbility", "dc"],
    },
  },
};

export const extraEncounterTools: ToolDef[] = [
  addEnemiesTool,
  enemyFleesTool,
  setEnemyConditionTool,
  clearEnemyConditionTool,
  aoeDamageTool,
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
    if (enemy.conditions.includes(wanted)) {
      return { ok: true, note: `${enemy.displayName} is already ${wanted}.` };
    }
    const meta =
      args.rounds || (args.saveAbility && args.saveDc)
        ? {
            ...enemy.conditionMeta,
            [wanted]: {
              ...(args.rounds ? { rounds: args.rounds } : {}),
              ...(args.saveAbility && args.saveDc
                ? { saveEnds: { ability: args.saveAbility, dc: args.saveDc } }
                : {}),
            },
          }
        : enemy.conditionMeta;
    patchEnemyConditions(enemy.id, [...enemy.conditions, wanted], meta);
    publishEncounter(campaign.id);
    return {
      ok: true,
      name: enemy.displayName,
      condition: wanted,
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
  const remaining = enemy.conditions.filter((entry) => !matches(entry));
  patchEnemyConditions(enemy.id, remaining, pruneMeta(remaining, enemy.conditionMeta));
  publishEncounter(campaign.id);
  return { ok: true, name: enemy.displayName, cleared: removed.join(", ") };
}

const aoeArgsSchema = z.object({
  damage: z.union([z.string().max(30), z.number().int().min(1).max(300)]),
  type: z.string().optional(),
  saveAbility: z.preprocess(normalizeAbility, z.enum(["str", "dex", "con", "int", "wis", "cha"])),
  dc: z.coerce.number().int().min(1).max(30),
  halfOnSave: z.boolean().optional(),
  enemyIds: z.array(z.string()).optional(),
  characterIds: z.array(z.string()).optional(),
  targets: z.string().max(400).optional(),
  casterId: z.string().optional(),
  casterEnemyId: z.string().optional(),
  spell: z.string().max(80).optional(),
  level: z.coerce.number().int().min(1).max(9).optional(),
  reason: z.string().optional(),
});

function handleAoeDamage(
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
  let args: z.infer<typeof aoeArgsSchema>;
  try {
    args = aoeArgsSchema.parse(JSON.parse(rawArguments || "{}"));
  } catch {
    return {
      error: "Invalid arguments: aoe_damage needs damage, saveAbility, dc, and targets.",
    };
  }

  // Resolve targets: each ref may be an enemy or a character, from the id
  // arrays or the comma-separated fallback.
  const enemyTargets: EncounterEnemy[] = [];
  const pcTargets: CharacterSheet[] = [];
  const unmatched: string[] = [];
  const addRef = (ref: string) => {
    const enemy = resolveEnemyRef(encounter.id, ref);
    if (enemy && enemy.status === "alive") {
      if (!enemyTargets.some((entry) => entry.id === enemy.id)) {
        enemyTargets.push(enemy);
      }
      return;
    }
    const sheet = resolveSheetRef(ref, sheets, sheetsById);
    if (sheet) {
      if (!pcTargets.some((entry) => entry.id === sheet.id)) {
        pcTargets.push(sheet);
      }
      return;
    }
    unmatched.push(ref);
  };
  for (const ref of args.enemyIds ?? []) {
    addRef(ref);
  }
  for (const ref of args.characterIds ?? []) {
    addRef(ref);
  }
  for (const ref of (args.targets ?? "").split(",").map((part) => part.trim()).filter(Boolean)) {
    addRef(ref);
  }
  if (!enemyTargets.length && !pcTargets.length) {
    return {
      error:
        "aoe_damage needs at least one valid target: enemyIds and/or characterIds from GAME STATE.",
    };
  }

  // A named player spell hands the server the real mechanics: the slot
  // spends, the dice scale with it, and the save comes from the pack's own
  // text and the caster's sheet. The model's numbers are the fallback.
  const corrections: string[] = [];
  const casterSheet = args.casterId ? resolveSheetRef(args.casterId, sheets, sheetsById) : null;
  if (args.spell && casterSheet) {
    const resolved = spellMechanicsFor({ spell: args.spell, userId: casterSheet.userId });
    if (resolved?.mech.resolution === "save") {
      if (resolved.spellLevel >= 1) {
        const spend = applyDmMutation(
          campaign,
          turn.id,
          "use_spell_slot",
          JSON.stringify({
            characterId: casterSheet.id,
            level: args.level ?? resolved.spellLevel,
            spell: args.spell,
            reason: (args.reason ?? "").slice(0, 200),
          }),
          sheets,
          sheetsById,
        ).result;
        if ("error" in spend) {
          return spend;
        }
      }
      const scaled = spellDamageFor({
        spell: args.spell,
        userId: casterSheet.userId,
        casterLevel: casterSheet.level,
        slotLevel: args.level,
      });
      if (scaled) {
        args.damage = scaled.dice;
        corrections.push(scaled.note);
      }
      if (resolved.mech.save && resolved.mech.save !== args.saveAbility) {
        corrections.push(
          `${resolved.name} forces a ${resolved.mech.save.toUpperCase()} save; the server rolled the real one.`,
        );
        args.saveAbility = resolved.mech.save;
      }
      args.halfOnSave = Boolean(resolved.mech.halfOnSave);
      if (resolved.mech.damageType) {
        args.type = resolved.mech.damageType;
      }
      // Multiclass: the DC follows the class whose list carries the spell.
      const realDc = spellSaveDcFor(casterSheet, args.spell ?? "");
      if (realDc && realDc !== args.dc) {
        corrections.push(`Save DC ${realDc} from ${casterSheet.name}'s sheet.`);
        args.dc = realDc;
      }
    }
  }

  // The damage rolls once for the whole effect.
  let total: number;
  if (typeof args.damage === "number") {
    total = args.damage;
  } else {
    if (!isValidExpression(args.damage)) {
      return { error: `Invalid damage expression "${args.damage}".` };
    }
    const outcome = rollExpression(args.damage);
    total = outcome.total;
    const roll = insertRoll({
      campaignId: campaign.id,
      characterId: null,
      requestedBy: "dm",
      kind: "damage",
      detail: `area effect${args.type ? ` (${args.type})` : ""}`,
      result: outcome,
    });
    turn.rollIds.push(roll.id);
    publishWithSeq(campaign.id, allocateSeq(campaign.id), "roll_result", {
      roll,
      source: "digital",
    });
  }
  total = Math.max(1, total);
  const half = Math.floor(total / 2);
  const halfOnSave = args.halfOnSave ?? true;
  const ability = args.saveAbility as SaveAbility;

  const results: Array<Record<string, unknown>> = [];
  let encounterOver: Record<string, unknown> = {};

  // Enemy saves roll silently from stat blocks; results ride the table.
  for (const enemy of enemyTargets) {
    const saveOutcome = rollExpression(d20Expression(saveModFor(enemy.stats, ability)));
    const success = saveOutcome.total >= args.dc;
    const damageTaken = success ? (halfOnSave ? half : 0) : total;
    const row: Record<string, unknown> = {
      target: enemy.displayName,
      save: saveOutcome.total,
      success,
      damage: damageTaken,
    };
    if (damageTaken > 0) {
      const applied = applyEnemyDamage(
        campaign,
        turn,
        encounter,
        enemy,
        damageTaken,
        sheets,
        sheetsById,
        args.type,
      );
      if (applied.damageNote) {
        row.note = applied.damageNote;
      }
      row.health = applied.health;
      if (applied.dead) {
        row.dead = true;
      }
      if (applied.encounterOver) {
        encounterOver = {
          encounterOver: true,
          outcome: applied.outcome,
          ...(applied.xpAwarded ? { xpAwarded: applied.xpAwarded } : {}),
        };
      }
    }
    results.push(row);
  }

  // Character saves use real sheet modifiers and publish dice cards; the
  // damage rides apply_damage so audit, undo, and the death engine apply.
  for (const sheet of pcTargets) {
    // Conditions apply: restrained = DEX-save disadvantage; paralyzed and
    // the like auto-fail STR/DEX saves.
    const derivation = rollDerivation(sheet.conditions, "saving_throw", ability);
    if (derivation.autoFail) {
      const row: Record<string, unknown> = {
        target: sheet.name,
        success: false,
        autoFailed: derivation.notes.join("; "),
        damage: total,
      };
      const applied = applyDmMutation(
        campaign,
        turn.id,
        "apply_damage",
        JSON.stringify({
          characterId: sheet.id,
          amount: total,
          type: args.type,
          reason: (args.reason ?? "area effect").slice(0, 200),
        }),
        sheets,
        sheetsById,
      ).result;
      if (typeof applied.hp === "string") {
        row.hp = applied.hp;
      }
      if (applied.dead) {
        row.dead = true;
      }
      results.push(row);
      continue;
    }
    // A nearby paladin's aura covers allies caught in the blast too.
    const aura = allySaveAura(campaign.id, sheet);
    const saveMod = computeSheetDerived(sheet).saves[ability] + (aura?.bonus ?? 0);
    // Effect conditions (Bless's +1d4, Haste's DEX-save advantage) ride the
    // save exactly as they do on a requested roll.
    const effects = conditionRollRiders(sheet.conditions, "save", ability);
    const advantage = mergeAdvantage([derivation.advantage, ...effects.advantageSources]);
    const saveOutcome = rollExpression(
      `${d20Expression(saveMod, advantage)}${effects.diceSuffix}`,
    );
    const roll = insertRoll({
      campaignId: campaign.id,
      characterId: sheet.id,
      requestedBy: "dm",
      kind: "saving_throw",
      detail: `${ability.toUpperCase()} save vs area effect`,
      dc: args.dc,
      result: saveOutcome,
    });
    turn.rollIds.push(roll.id);
    publishWithSeq(campaign.id, allocateSeq(campaign.id), "roll_result", {
      roll,
      source: "digital",
    });
    const success = saveOutcome.total >= args.dc;
    // Evasion: on a Dexterity save for half, a made save takes nothing and a
    // failed one takes half. Only for DEX saves against effects that would
    // deal half on a success at all.
    const evasion =
      ability === "dex" &&
      halfOnSave &&
      defenseRiders({ class: sheet.class, level: sheet.level, features: sheet.features }).evasion;
    const damageTaken = evasion
      ? success
        ? 0
        : half
      : success
        ? halfOnSave
          ? half
          : 0
        : total;
    const row: Record<string, unknown> = {
      target: sheet.name,
      save: saveOutcome.total,
      success,
      damage: damageTaken,
      ...(evasion ? { evasion: success ? "no damage" : "half damage" } : {}),
    };
    if (damageTaken > 0) {
      const applied = applyDmMutation(
        campaign,
        turn.id,
        "apply_damage",
        JSON.stringify({
          characterId: sheet.id,
          amount: damageTaken,
          type: args.type,
          reason: (args.reason ?? "area effect").slice(0, 200),
        }),
        sheets,
        sheetsById,
      ).result;
      if (typeof applied.hp === "string") {
        row.hp = applied.hp;
      }
      if (applied.dying) {
        row.dying = applied.dying;
      }
      if (applied.dead) {
        row.dead = true;
      }
      if (applied.note) {
        row.note = applied.note;
      }
    }
    results.push(row);
  }

  // Casting an area spell is the character's action, not their whole turn:
  // a human caster may still move or use a bonus action, so only end_turn
  // advances past them. Companion casters resolve here so the auto-act
  // backstop cannot act them a second time.
  if (args.casterId) {
    const caster = resolveSheetRef(args.casterId, sheets, sheetsById);
    if (caster?.isCompanion && !turn.resolvedCharacterIds.includes(caster.id)) {
      turn.resolvedCharacterIds.push(caster.id);
    }
  }

  // An enemy caster's concentration spell (Web, Cloud of Daggers) is
  // tracked so damage to the caster can end the effect.
  const enemyConcentration = trackEnemyConcentration(campaign, args.casterEnemyId, args.spell);

  return {
    ok: true,
    damageRolled: total,
    dc: args.dc,
    saveAbility: ability,
    halfOnSave,
    results,
    ...(corrections.length ? { corrected: corrections } : {}),
    ...(unmatched.length ? { unmatchedTargets: unmatched } : {}),
    ...(enemyConcentration ? { enemyConcentration } : {}),
    ...encounterOver,
  };
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
      return { result: handleEnemyCondition(campaign, "set", rawArguments) };
    case "clear_enemy_condition":
      return { result: handleEnemyCondition(campaign, "clear", rawArguments) };
    case "aoe_damage":
      return { result: handleAoeDamage(campaign, turn, rawArguments, sheets, sheetsById) };
    default:
      return null;
  }
}
