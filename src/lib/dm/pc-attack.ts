import { z } from "zod";
import { allocateSeq, getCampaignById, type Campaign } from "@/lib/db/campaigns";
import { getActiveEncounter } from "@/lib/db/encounters";
import { getSheetById, listSheets, patchSheet } from "@/lib/db/sheets";
import { insertRoll, markRollApplied, type StoredRoll } from "@/lib/db/rolls";
import {
  createPendingRoll,
  getDmTurn,
  publicPendingRoll,
  type DmTurn,
  type PendingRoll,
} from "@/lib/db/dm-turns";
import { d20Expression, isValidExpression, rollExpression, type Advantage } from "@/lib/dice";
import { publishPersisted, publishWithSeq } from "@/lib/events";
import { computeSheetDerived } from "@/lib/srd";
import {
  adjudicateHit,
  ammoKindFor,
  resolveAttackWeapon,
  spellAttackProfile,
  weaponAttackProfile,
  type AttackProfile,
} from "@/lib/dm/attack-logic";
import { ammoItemFor } from "@/lib/dm/item-logic";
import { removeItemMath } from "@/lib/dm/mutation-math";
import {
  attackContext,
  exhaustionRollState,
  incapacitatedBy,
  mergeAdvantage,
} from "@/lib/dm/condition-logic";
import { critDamageExpression } from "@/lib/dm/encounter-logic";
import { applyEnemyDamage, resolveEnemyRef } from "@/lib/dm/enemy-damage";
import { checkPcAttackRange } from "@/lib/dm/map-tools";
import { resolveSheetRef } from "@/lib/dm/rolls";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// The pc_attack engine: full server resolution of player attacks. The
// to-hit bonus and damage dice come from the sheet and the SRD weapon
// table, the roll is adjudicated against the enemy's real AC, and damage
// lands through applyEnemyDamage, so the model can no longer decide hits,
// invent modifiers, or forget to apply damage. Physical-dice players still
// roll their own d20 and damage via chained pending rolls. This module must
// not import encounter-tools or mutations (the imports point the other way).

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
  advantage: z.enum(["none", "advantage", "disadvantage"]).optional(),
});

function publishRoll(campaignId: string, roll: StoredRoll) {
  publishWithSeq(campaignId, allocateSeq(campaignId), "roll_result", {
    roll,
    source: "digital",
  });
}

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
  let args: z.infer<typeof pcAttackArgsSchema>;
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
  if (sheet.currentHp <= 0) {
    return { error: `${sheet.name} is at 0 HP and cannot attack.` };
  }
  const stoppedBy = incapacitatedBy(sheet.conditions);
  if (stoppedBy) {
    return { error: `${sheet.name} is ${stoppedBy} and cannot attack.` };
  }
  const enemy = resolveEnemyRef(encounter.id, args.targetEnemyId);
  if (!enemy) {
    return { error: "Unknown targetEnemyId; use one from GAME STATE." };
  }
  if (enemy.status !== "alive") {
    return { error: `${enemy.displayName} is already ${enemy.status}.` };
  }

  const derived = computeSheetDerived(sheet);
  let profile: AttackProfile;
  let ammoNote: string | null = null;
  let pendingAmmoKind: string | null = null;
  if (args.spell?.trim()) {
    const spellName = args.spell.trim();
    if (!sheet.spellcasting) {
      return { error: `${sheet.name} cannot cast spells.` };
    }
    const spellList = [...sheet.spellcasting.known, ...sheet.spellcasting.prepared];
    const onList = spellList.some(
      (entry) => entry.toLowerCase().includes(spellName.toLowerCase()) ||
        spellName.toLowerCase().includes(entry.toLowerCase()),
    );
    if (!onList) {
      return {
        error: `${spellName} is not on ${sheet.name}'s spell list; they cannot cast it.`,
      };
    }
    const damageArg = (args.damage ?? "").trim();
    if (!damageArg || !isValidExpression(damageArg)) {
      return {
        error: `Spell attacks need the spell's damage dice, e.g. damage="1d10". Send pc_attack again with a damage expression.`,
      };
    }
    const spellProfile = spellAttackProfile(
      derived,
      spellName,
      damageArg,
      (args.damageType ?? "").trim().toLowerCase(),
    );
    if (!spellProfile) {
      return { error: `${sheet.name} has no spell attack bonus.` };
    }
    profile = spellProfile;
  } else {
    const resolved = resolveAttackWeapon(sheet.equipment, sheet.proficiencies.weapons, args.weapon);
    profile = weaponAttackProfile(derived, sheet.proficiencies.weapons, resolved);
    // Ammunition weapons need a carried ammo item; an empty quiver refuses
    // the attack. The shot is spent below, after the range gate passes.
    const ammoKind = ammoKindFor(resolved.srd);
    if (ammoKind && !ammoItemFor(sheet.equipment, ammoKind)) {
      return {
        error: `${sheet.name} carries no ${ammoKind} for the ${profile.weapon}. They cannot fire it; pick another attack or have them find ammunition.`,
      };
    }
    pendingAmmoKind = ammoKind;
  }

  // Battle-map positions are authoritative; players move their own tokens,
  // so an out-of-reach attack is refused rather than auto-approached.
  const rangeError = checkPcAttackRange(encounter.id, sheet.id, enemy.id, {
    ranged: profile.ranged,
    rangeTiles: profile.rangeTiles,
    reachTiles: profile.reachTiles,
    thrown: profile.thrown,
  });
  if (rangeError) {
    return { error: rangeError };
  }

  // The attack is definitely happening: spend the shot (hit or miss).
  if (pendingAmmoKind) {
    const ammoItem = ammoItemFor(sheet.equipment, pendingAmmoKind);
    const removal = ammoItem ? removeItemMath(sheet.equipment, ammoItem.name, 1) : null;
    if (ammoItem && removal) {
      patchSheet(sheet.id, { equipment: removal.equipment });
      const remaining = removal.equipment.find((entry) => entry.name === ammoItem.name)?.qty ?? 0;
      publishPersisted(campaign.id, "sheet_updated", { sheet: getSheetById(sheet.id) });
      ammoNote =
        remaining <= 0
          ? `That was ${sheet.name}'s LAST ${pendingAmmoKind.replace(/s$/, "")}; they are out of ammunition.`
          : remaining <= 3
            ? `${sheet.name} has only ${remaining} ${pendingAmmoKind} left.`
            : null;
    }
  }

  // Conditions on both sides drive advantage and auto-crits; the model's
  // situational claim merges in as one more source.
  const conditionContext = attackContext({
    attackerConditions: sheet.conditions,
    targetConditions: enemy.conditions,
    melee: !profile.ranged,
    adjacent: !profile.ranged,
    requested: args.advantage ?? "none",
  });
  const exhaustion = exhaustionRollState(sheet.exhaustion ?? 0, "attack");
  if (exhaustion.note) {
    conditionContext.notes.push(exhaustion.note);
  }
  const advantage: Advantage = mergeAdvantage([
    conditionContext.advantage,
    exhaustion.advantage,
  ]);
  const toHitExpression = d20Expression(profile.toHit, advantage);
  const detail = `${sheet.name}: ${profile.weapon} vs ${enemy.displayName}`;

  // Physical dice: park the to-hit roll for the player; the submit route
  // adjudicates it and, on a hit, parks the damage roll too.
  if (realDiceUserIds.has(sheet.userId)) {
    const pending = createPendingRoll({
      campaignId: campaign.id,
      turnId: turn.id,
      toolCallId,
      userId: sheet.userId,
      characterId: sheet.id,
      kind: "attack",
      detail,
      expression: toHitExpression,
      advantage,
      dc: null,
      reason: `${profile.weapon} attack against ${enemy.displayName}`,
      attack: {
        attacker: sheet.name,
        weapon: profile.weapon,
        targetEnemyId: enemy.id,
        targetAc: enemy.ac,
        damageExpression: profile.damageExpression,
        critDamageExpression: critDamageExpression(profile.damageExpression),
        damageType: profile.damageType,
        ...(conditionContext.autoCrit ? { autoCrit: true } : {}),
      },
    });
    publishPersisted(campaign.id, "roll_pending", { pendingRoll: publicPendingRoll(pending) });
    return { [PC_ATTACK_PARKED]: true };
  }

  // Digital path: roll, adjudicate, and apply in one pass.
  const hitOutcome = rollExpression(toHitExpression);
  const hitRoll = insertRoll({
    campaignId: campaign.id,
    characterId: sheet.id,
    requestedBy: "dm",
    kind: "attack",
    detail,
    advantage,
    result: hitOutcome,
  });
  publishRoll(campaign.id, hitRoll);
  turn.rollIds.push(hitRoll.id);

  const adjudicated = adjudicateHit(hitOutcome.total, hitOutcome.crit, enemy.ac);
  const hit = adjudicated.hit;
  const crit = adjudicated.crit || (hit && conditionContext.autoCrit);
  const base = {
    attacker: sheet.name,
    weapon: profile.weapon,
    rolled: hitOutcome.total,
    vsAc: enemy.ac,
    target: enemy.displayName,
    ...(profile.improvised ? { improvised: true } : {}),
    ...(conditionContext.notes.length ? { conditionEffects: conditionContext.notes } : {}),
    ...(ammoNote ? { ammo: ammoNote } : {}),
  };
  if (!hit) {
    return {
      ...base,
      hit: false,
      ...(hitOutcome.crit === "nat1" ? { fumble: true } : {}),
      note: "The attack misses; narrate the miss.",
    };
  }

  const damageExpression = crit
    ? critDamageExpression(profile.damageExpression)
    : profile.damageExpression;
  const damageOutcome = rollExpression(damageExpression);
  const damageRoll = insertRoll({
    campaignId: campaign.id,
    characterId: sheet.id,
    requestedBy: "dm",
    kind: "damage",
    detail: `${sheet.name}: ${profile.weapon} damage`,
    result: damageOutcome,
  });
  publishRoll(campaign.id, damageRoll);
  turn.rollIds.push(damageRoll.id);

  const applied = applyEnemyDamage(
    campaign,
    turn,
    encounter,
    enemy,
    Math.max(1, damageOutcome.total),
    sheets,
    sheetsById,
    profile.damageType,
  );
  if (!("error" in applied)) {
    markRollApplied(damageRoll.id, enemy.id);
  }
  return {
    ...base,
    hit: true,
    ...(crit ? { crit: true } : {}),
    damage: damageOutcome.total,
    ...(profile.damageType ? { damageType: profile.damageType } : {}),
    ...applied,
    note: applied.dead
      ? `${enemy.displayName} is slain; the server already applied this damage. Narrate the killing blow.`
      : `The server already applied this damage to ${enemy.displayName}. Do NOT call damage_enemy for this hit; narrate from this state.`,
  };
}

// Physical-dice adjudication, called from the pending-rolls submit route
// when a parked pc_attack to-hit roll lands. Returns the combat note the
// resumed turn surfaces to the model; on a hit it parks the damage roll so
// the turn stays paused until the player rolls their damage dice (which the
// existing applyPendingDamageRoll path then applies).
export function resolvePendingPcAttack(pending: PendingRoll, roll: StoredRoll): string | null {
  const context = pending.attack;
  if (!context) {
    return null;
  }
  const campaign = getCampaignById(pending.campaignId);
  const turn = getDmTurn(pending.turnId);
  if (!campaign || !turn) {
    return null;
  }
  const adjudicated = adjudicateHit(roll.total, roll.breakdown.crit, context.targetAc);
  const hit = adjudicated.hit;
  const crit = adjudicated.crit || (hit && context.autoCrit === true);
  if (!hit) {
    return `${context.attacker}'s ${context.weapon} attack rolled ${roll.total} vs AC ${context.targetAc}: MISS${
      roll.breakdown.crit === "nat1" ? " (natural 1)" : ""
    }. No damage roll happens; narrate the miss.`;
  }
  // Verify the target still stands before asking for damage dice (the lead
  // may have force-ended the encounter while the roll sat parked).
  const encounter = getActiveEncounter(pending.campaignId);
  const enemy = encounter ? resolveEnemyRef(encounter.id, context.targetEnemyId) : null;
  if (!enemy || enemy.status !== "alive") {
    return `${context.attacker}'s ${context.weapon} attack rolled ${roll.total} vs AC ${context.targetAc}: HIT, but the target is already gone; narrate around it.`;
  }
  const expression = crit ? context.critDamageExpression : context.damageExpression;
  const sheets = listSheets(pending.campaignId);
  const sheet = sheets.find((entry) => entry.id === pending.characterId);
  const damagePending = createPendingRoll({
    campaignId: pending.campaignId,
    turnId: pending.turnId,
    // No paired tool call: the resumed turn pushes this result without an
    // id, which the conversation loop tolerates; the combat notes on both
    // stages carry the full story.
    toolCallId: null,
    userId: pending.userId,
    characterId: pending.characterId,
    kind: "damage",
    detail: `${sheet?.name ?? context.attacker}: ${context.weapon} damage`,
    expression,
    advantage: "none",
    dc: null,
    reason: `${context.weapon} damage against ${enemy.displayName}`,
    targetEnemyId: enemy.id,
    // Carried so the damage stage keeps the type for resistance math.
    attack: context,
  });
  publishPersisted(pending.campaignId, "roll_pending", {
    pendingRoll: publicPendingRoll(damagePending),
  });
  return `${context.attacker}'s ${context.weapon} attack rolled ${roll.total} vs AC ${context.targetAc}: HIT${
    crit ? " (CRITICAL: damage dice are doubled)" : ""
  }. ${context.attacker} now rolls damage (${expression}); the server will apply it to ${enemy.displayName} automatically.`;
}
