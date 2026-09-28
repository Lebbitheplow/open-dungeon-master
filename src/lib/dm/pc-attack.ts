import { z } from "zod";
import type { Campaign } from "@/lib/db/campaigns";
import { getActiveEncounter, saveEncounter } from "@/lib/db/encounters";
import type { DmTurn } from "@/lib/db/dm-turns";
import { getSheetById, patchSheet } from "@/lib/db/sheets";
import { publishPersisted } from "@/lib/events";
import { normalizeAdvantage } from "@/lib/dm/arg-coerce";
import { removeConditions, type ConditionMetaMap } from "@/lib/dm/condition-logic";
import { applyDmMutation } from "@/lib/dm/mutations";
import { strikeDamage } from "@/lib/dm/pc-attack-damage";
import { parkPcAttack } from "@/lib/dm/pc-attack-parked";
import { planPcAttack, type AttackPlan } from "@/lib/dm/pc-attack-plan";
import { rollPcAttack, strikeToHit } from "@/lib/dm/pc-attack-resolve";
import { castAttackSpell } from "@/lib/dm/pc-attack-spell";
import { resolveSheetRef } from "@/lib/dm/rolls";
import { storeBudget } from "@/lib/dm/turn-budget";
import { withAmmoCount } from "@/lib/srd/ammunition";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// Re-exported for the callers that learned them here.
export { superiorityDie } from "@/lib/dm/pc-attack-riders";
export { resolvePendingPcAttack } from "@/lib/dm/pc-attack-parked";

// The pc_attack engine: full server resolution of player attacks. The
// to-hit bonus and damage dice come from the sheet and the SRD weapon
// table, the roll is adjudicated against the enemy's real AC, and damage
// lands through applyEnemyDamage, so the model can no longer decide hits,
// invent modifiers, or forget to apply damage. Physical-dice players still
// roll their own d20 and damage via chained pending rolls. This module and
// the ones split from it must not import encounter-tools (the import points
// the other way); they do import mutations for the slot and die spends,
// exactly as cast-tools does, and mutations must never import back.
//
// One attack runs in three steps, each in its own module: every refusal,
// asked before anything is spent (pc-attack-plan.ts, with the profile in
// pc-attack-profile.ts, the damage dice in pc-attack-damage.ts, the roll's
// situation in pc-attack-situation.ts and the spell branch in
// pc-attack-spell.ts); the spends, here; and the roll, by the server
// (pc-attack-resolve.ts) or by the player's own dice (pc-attack-parked.ts).

type ToolDef = {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

export const pcAttackTool: ToolDef = {
  type: "function",
  function: {
    name: "pc_attack",
    description:
      "A player character attacks an enemy. The server derives their attack bonus and damage from their sheet, rolls to-hit against the enemy's real AC, applies damage on a hit, and reports the outcome for you to narrate. Use this for EVERY weapon attack and attack-roll spell a player makes; never adjudicate a player's attack yourself.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        characterId: { type: "string", description: "Exact characterId from GAME STATE." },
        targetEnemyId: { type: "string", description: "Exact enemyId from GAME STATE." },
        weapon: {
          type: "string",
          description:
            "Weapon they attack with, from their equipment. Omit to use their best carried weapon.",
        },
        spell: {
          type: "string",
          description:
            "Attack-roll spell (e.g. Fire Bolt) instead of a weapon; requires damage.",
        },
        damage: {
          type: "string",
          description: "Spell attacks only: the spell's damage dice, e.g. '1d10' or '4d6'.",
        },
        damageType: { type: "string", description: "Spell attacks only: the damage type." },
        advantage: {
          type: "string",
          enum: ["none", "advantage", "disadvantage"],
          description: "Situational advantage or disadvantage from the fiction.",
        },
        twoHanded: {
          type: "boolean",
          description:
            "They swing a versatile weapon in both hands (bigger damage die). Ignore for other weapons.",
        },
        offHand: {
          type: "boolean",
          description:
            "This is the bonus-action second attack of two-weapon fighting with a light weapon.",
        },
        smite: {
          type: "integer",
          minimum: 1,
          maximum: 9,
          description:
            "Paladin Divine Smite: the spell slot level to burn on a hit. The server spends the slot and adds the radiant dice.",
        },
        level: {
          type: "integer",
          minimum: 1,
          maximum: 9,
          description:
            "Attack-roll spells of 1st level or higher (Guiding Bolt, Scorching Ray): the slot level cast from. Omit for the spell's own level; the server spends the slot. Eldritch Blast's beams and Scorching Ray's rays are one pc_attack call each, all from one casting.",
        },
        maneuver: {
          type: "string",
          description:
            "Battle Master maneuver riding this weapon attack (e.g. 'Trip Attack', 'Precision Attack', 'Menacing Attack'). The server spends a Superiority Die, adds it to the damage (Precision: to the attack roll), and rolls the target's save against the maneuver's rider.",
        },
      },
      required: ["characterId", "targetEnemyId"],
    },
  },
};

const pcAttackArgsSchema = z.object({
  characterId: z.string(),
  targetEnemyId: z.string(),
  weapon: z.string().max(80).optional(),
  spell: z.string().max(80).optional(),
  damage: z.string().max(30).optional(),
  damageType: z.string().max(30).optional(),
  advantage: z.preprocess(
    normalizeAdvantage,
    z.enum(["none", "advantage", "disadvantage"]).optional(),
  ),
  twoHanded: z.coerce.boolean().optional(),
  offHand: z.coerce.boolean().optional(),
  smite: z.coerce.number().int().min(1).max(9).optional(),
  maneuver: z.string().max(60).optional(),
  // Attack-roll spells: the slot level cast from.
  level: z.coerce.number().int().min(1).max(9).optional(),
});

export type PcAttackArgs = z.infer<typeof pcAttackArgsSchema>;

// Sentinel the turn loop checks: a parked pc_attack pushes no tool result
// now; the resumed turn answers it with the adjudicated roll.
export const PC_ATTACK_PARKED = "_parked";

export function handlePcAttack(
  campaign: Campaign,
  turn: DmTurn,
  rawArguments: string,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
  realDiceUserIds: Set<string>,
  toolCallId: string | null,
): Record<string, unknown> {
  const encounter = getActiveEncounter(campaign.id);
  if (!encounter) {
    return { error: "No active encounter. Call start_encounter first." };
  }
  let args: PcAttackArgs;
  try {
    args = pcAttackArgsSchema.parse(JSON.parse(rawArguments || "{}"));
  } catch {
    return { error: "Invalid arguments: pc_attack needs characterId and targetEnemyId." };
  }
  const staleSheet = resolveSheetRef(args.characterId, sheets, sheetsById);
  const sheet = staleSheet ? (getSheetById(staleSheet.id) ?? staleSheet) : null;
  if (!sheet) {
    return { error: "Unknown characterId; use one from GAME STATE." };
  }

  // ---- refusals: everything that can stop this attack, before any spend ----
  // Asked in one place, in order, by planPcAttack (src/lib/dm/pc-attack-plan.ts).

  const plan = planPcAttack({ campaign, turn, encounter, sheet, args, sheets, sheetsById });
  if ("refused" in plan) {
    return plan.refused;
  }

  // ---- spends: nothing below refuses the attack ----

  spendPcAttack(plan);
  const strike = { ...strikeToHit(plan), ...strikeDamage(plan) };

  // Physical dice: park the to-hit roll for the player; the submit route
  // adjudicates it and, on a hit, parks the damage roll too.
  if (realDiceUserIds.has(sheet.userId)) {
    parkPcAttack(plan, strike, toolCallId);
    return { [PC_ATTACK_PARKED]: true };
  }
  return rollPcAttack(plan, strike);
}

// What the attack costs, paid now that nothing can refuse it: the turn
// budget, the cast or the reaction, the round from the quiver, Precision
// Attack's die, and the conditions this roll uses up.
function spendPcAttack(plan: AttackPlan) {
  const { campaign, turn, encounter, sheet, sheets, sheetsById, budget, ammo, context } = plan;
  if (budget) {
    storeBudget(encounter, budget);
  }
  if (plan.castsSpell) {
    castAttackSpell(plan);
  } else if (!budget) {
    encounter.reactionsUsed = [...encounter.reactionsUsed, sheet.id];
    saveEncounter(encounter);
    // An attack made off their own turn shows on no turn budget, so a rage
    // it feeds is marked the way damage taken marks it.
    const ragingAs = sheet.conditions.find((entry) => entry.trim().toLowerCase() === "raging");
    if (ragingAs) {
      const meta = sheet.conditionMeta as ConditionMetaMap;
      patchSheet(sheet.id, {
        conditionMeta: { ...meta, [ragingAs]: { ...meta[ragingAs], stoked: true } },
      });
    }
    context.notes.push(
      `made off their own turn: ${sheet.name}'s reaction is spent until their next turn starts`,
    );
  }
  if (ammo && ammo.ok) {
    const equipment = withAmmoCount(sheet.equipment, ammo.index, ammo.remaining);
    patchSheet(sheet.id, { equipment });
    // Tallied under the line's name as it reads NOW: a quiver written
    // "Arrows (20)" is renamed by every shot, and the tally follows it so the
    // end of the fight finds the line it has to refill.
    const before = `${sheet.id}|${ammo.name}`;
    const after = `${sheet.id}|${equipment[ammo.index]?.name ?? ammo.name}`;
    const tally = { ...encounter.ammoSpent };
    const spentSoFar = tally[before] ?? 0;
    delete tally[before];
    tally[after] = (tally[after] ?? 0) + spentSoFar + 1;
    encounter.ammoSpent = tally;
    saveEncounter(encounter);
  }
  if (plan.maneuver?.precision) {
    // Validated above, so this spend lands; were it to fail the roll simply
    // goes without the die.
    const spent = applyDmMutation(
      campaign,
      turn.id,
      "use_resource",
      JSON.stringify({
        characterId: sheet.id,
        resource: "Superiority Dice",
        reason: plan.maneuver.name,
      }),
      sheets,
      sheetsById,
    ).result;
    if ("error" in spent) {
      plan.maneuver = null;
    }
  }

  // Striking from hiding spends the hiding (the attack gives them away
  // whether it lands or not), and one-shot riders like True Strike and a
  // held Help are spent by this roll: clear them all together.
  const spentConditions = [
    ...(sheet.conditions.some((entry) => entry.toLowerCase() === "hidden") ? ["hidden"] : []),
    ...(plan.helped ? [plan.helped] : []),
    ...plan.attackRiders.spent,
  ];
  if (spentConditions.length) {
    const cleared = removeConditions(sheet.conditions, sheet.conditionMeta, spentConditions);
    const revealed = patchSheet(sheet.id, {
      conditions: cleared.conditions,
      conditionMeta: cleared.meta,
    });
    if (revealed) {
      publishPersisted(campaign.id, "sheet_updated", { sheet: revealed });
    }
  }
}
