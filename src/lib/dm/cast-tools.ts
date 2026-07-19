import { z } from "zod";
import { allocateSeq, type Campaign } from "@/lib/db/campaigns";
import { getActiveEncounter, patchEnemyConditions } from "@/lib/db/encounters";
import { getSheetById } from "@/lib/db/sheets";
import { insertRoll } from "@/lib/db/rolls";
import type { DmTurn } from "@/lib/db/dm-turns";
import { d20Expression, isValidExpression, rollExpression } from "@/lib/dice";
import { publishWithSeq } from "@/lib/events";
import { computeSheetDerived } from "@/lib/srd";
import { saveModFor, type SaveAbility } from "@/lib/bestiary/statblock";
import { applyDmMutation, canonicalCondition } from "@/lib/dm/mutations";
import { applyEnemyDamage, publishEncounter, resolveEnemyRef } from "@/lib/dm/enemy-damage";
import { resolveSheetRef } from "@/lib/dm/rolls";
import type { ConditionMeta } from "@/lib/dm/condition-logic";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// cast_at_enemy: single-target save-or-suffer spells a player casts on an
// enemy (Hold Person, Tasha's Hideous Laughter, single-target Poison
// Spray...). The server spends the slot, derives the save DC from the
// caster's sheet, rolls the enemy's save from its real stat block, and
// applies the damage and/or condition (with duration) on a failure, so the
// model never adjudicates these. Multi-target effects stay on aoe_damage;
// attack-roll spells stay on pc_attack. This module imports mutations (for
// the slot spend) and must never be imported by it.

type ToolDef = {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

export const castAtEnemyTool: ToolDef = {
  type: "function",
  function: {
    name: "cast_at_enemy",
    description:
      "A player casts a saving-throw spell at ONE enemy (Hold Person, Bane on a single target, a single-target poison...). The server spends the slot, derives the save DC from the caster's sheet, rolls the enemy's save from its real stats, and applies the damage and/or condition on a failure. Use aoe_damage for multi-target effects and pc_attack for attack-roll spells.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        characterId: { type: "string", description: "Exact characterId from GAME STATE." },
        targetEnemyId: { type: "string", description: "Exact enemyId from GAME STATE." },
        spell: { type: "string", description: "Exact spell name from the caster's list." },
        saveAbility: {
          type: "string",
          enum: ["str", "dex", "con", "int", "wis", "cha"],
          description: "The save the spell forces.",
        },
        level: {
          type: "integer",
          minimum: 1,
          maximum: 9,
          description: "Slot level to spend. Omit for cantrips.",
        },
        damage: {
          type: "string",
          description: "Damage dice on a failed save, e.g. '3d8'. Omit for pure-condition spells.",
        },
        damageType: { type: "string", description: "Damage type, e.g. psychic." },
        halfOnSave: {
          type: "boolean",
          description: "True = half damage on a successful save (default false: no effect).",
        },
        condition: {
          type: "string",
          description: "Condition applied on a failed save, e.g. paralyzed.",
        },
        rounds: {
          type: "integer",
          minimum: 1,
          maximum: 100,
          description:
            "How many rounds the condition lasts. Omit for save-ends: the enemy re-saves at the end of each round.",
        },
        reason: { type: "string", description: "Short in-fiction cause." },
      },
      required: ["characterId", "targetEnemyId", "spell", "saveAbility"],
    },
  },
};

const castArgsSchema = z.object({
  characterId: z.string(),
  targetEnemyId: z.string(),
  spell: z.string().max(80),
  saveAbility: z.enum(["str", "dex", "con", "int", "wis", "cha"]),
  level: z.coerce.number().int().min(1).max(9).optional(),
  damage: z.string().max(30).optional(),
  damageType: z.string().max(30).optional(),
  halfOnSave: z.coerce.boolean().optional(),
  condition: z.string().max(40).optional(),
  rounds: z.coerce.number().int().min(1).max(100).optional(),
  reason: z.string().optional(),
});

export function handleCastAtEnemy(
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
  let args: z.infer<typeof castArgsSchema>;
  try {
    args = castArgsSchema.parse(JSON.parse(rawArguments || "{}"));
  } catch {
    return {
      error: "Invalid arguments: cast_at_enemy needs characterId, targetEnemyId, spell, and saveAbility.",
    };
  }
  const staleSheet = resolveSheetRef(args.characterId, sheets, sheetsById);
  const sheet = staleSheet ? (getSheetById(staleSheet.id) ?? staleSheet) : null;
  if (!sheet) {
    return { error: "Unknown characterId; use one from GAME STATE." };
  }
  if (sheet.currentHp <= 0) {
    return { error: `${sheet.name} is at 0 HP and cannot cast.` };
  }
  if (!sheet.spellcasting) {
    return { error: `${sheet.name} cannot cast spells.` };
  }
  const dc = computeSheetDerived(sheet).spellSaveDc;
  if (dc === null) {
    return { error: `${sheet.name} has no spell save DC.` };
  }
  const enemy = resolveEnemyRef(encounter.id, args.targetEnemyId);
  if (!enemy) {
    return { error: "Unknown targetEnemyId; use one from GAME STATE." };
  }
  if (enemy.status !== "alive") {
    return { error: `${enemy.displayName} is already ${enemy.status}.` };
  }
  if (!args.damage && !args.condition) {
    return { error: "cast_at_enemy needs damage and/or condition; otherwise nothing happens." };
  }
  if (args.damage && !isValidExpression(args.damage)) {
    return { error: `Invalid damage expression "${args.damage}".` };
  }
  const condition = args.condition ? canonicalCondition(args.condition) : null;
  if (condition && enemy.stats.conditionImmune.toLowerCase().includes(condition)) {
    return {
      error: `${enemy.displayName} is immune to ${condition} (immunities: ${enemy.stats.conditionImmune}); the spell cannot take hold. The slot was not spent.`,
    };
  }

  // Spend the slot first (spell-list validation and concentration come with
  // it); a refused spend refuses the cast.
  if (args.level) {
    const spend = applyDmMutation(
      campaign,
      turn.id,
      "use_spell_slot",
      JSON.stringify({
        characterId: sheet.id,
        level: args.level,
        spell: args.spell,
        reason: (args.reason ?? "").slice(0, 200),
      }),
      sheets,
      sheetsById,
    ).result;
    if ("error" in spend) {
      return spend;
    }
  } else {
    // Cantrip path: no slot, but the spell must still be on their list.
    const spellList = [...sheet.spellcasting.known, ...sheet.spellcasting.prepared];
    const onList = spellList.some(
      (entry) =>
        entry.toLowerCase().includes(args.spell.toLowerCase()) ||
        args.spell.toLowerCase().includes(entry.toLowerCase()),
    );
    if (!onList) {
      return { error: `${args.spell} is not on ${sheet.name}'s spell list; they cannot cast it.` };
    }
  }

  // The enemy's save, rolled from its real stat block as a visible card.
  const ability = args.saveAbility as SaveAbility;
  const saveOutcome = rollExpression(d20Expression(saveModFor(enemy.stats, ability)));
  const saveRoll = insertRoll({
    campaignId: campaign.id,
    characterId: null,
    requestedBy: "dm",
    kind: "saving_throw",
    detail: `${enemy.displayName}: ${ability.toUpperCase()} save vs ${args.spell}`,
    dc,
    result: saveOutcome,
  });
  turn.rollIds.push(saveRoll.id);
  publishWithSeq(campaign.id, allocateSeq(campaign.id), "roll_result", {
    roll: saveRoll,
    source: "digital",
  });
  const saved = saveOutcome.total >= dc;

  const base: Record<string, unknown> = {
    spell: args.spell,
    caster: sheet.name,
    target: enemy.displayName,
    save: saveOutcome.total,
    dc,
    saved,
  };

  let damageDealt = 0;
  if (args.damage) {
    const outcome = rollExpression(args.damage);
    damageDealt = saved ? (args.halfOnSave ? Math.floor(outcome.total / 2) : 0) : outcome.total;
    if (damageDealt > 0) {
      const applied = applyEnemyDamage(
        campaign,
        turn,
        encounter,
        enemy,
        damageDealt,
        sheets,
        sheetsById,
        args.damageType,
      );
      Object.assign(base, { damage: damageDealt, ...applied });
    } else {
      base.damage = 0;
    }
  }

  if (condition && !saved && !base.dead && !base.encounterOver) {
    const fresh = resolveEnemyRef(encounter.id, enemy.id);
    if (fresh && fresh.status === "alive" && !fresh.conditions.includes(condition)) {
      const meta: ConditionMeta = args.rounds
        ? { rounds: args.rounds }
        : { saveEnds: { ability, dc } };
      patchEnemyConditions(fresh.id, [...fresh.conditions, condition], {
        ...fresh.conditionMeta,
        [condition]: meta,
      });
      publishEncounter(campaign.id);
      base.conditionApplied = condition;
      base.duration = args.rounds
        ? `${args.rounds} round${args.rounds === 1 ? "" : "s"}`
        : `until it succeeds on a ${ability.toUpperCase()} save (DC ${dc}) at the end of a round`;
    }
  }
  if (saved && condition) {
    base.note = `${enemy.displayName} resists: no ${condition}.`;
  }
  return { ok: true, ...base };
}
