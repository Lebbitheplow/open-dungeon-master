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
import { spellDamageFor } from "@/lib/content";
import {
  adjudicateHit,
  ragingMeleeBonus,
  resolveAttackWeapon,
  spellAttackProfile,
  weaponAttackProfile,
  type AttackProfile,
} from "@/lib/dm/attack-logic";
import { combatRiders } from "@/lib/srd/feature-effects";
import { normalizeAdvantage } from "@/lib/dm/arg-coerce";
import {
  attackContext,
  exhaustionRollState,
  incapacitatedBy,
  mergeAdvantage,
  removeConditions,
} from "@/lib/dm/condition-logic";
import { critDamageExpression } from "@/lib/dm/encounter-logic";
import { applyDmMutation } from "@/lib/dm/mutations";
import { applyEnemyDamage, resolveEnemyRef } from "@/lib/dm/enemy-damage";
import { allyAdjacentToEnemy, checkPcAttackRange, pcAttackSpatials } from "@/lib/dm/map-tools";
import {
  attacksAllowedFor,
  budgetFor,
  storeBudget,
} from "@/lib/dm/action-tools";
import { attacksLeft, claimOncePerTurn, spendAction, spendAttack } from "@/lib/dm/action-budget";
import { resolveSheetRef } from "@/lib/dm/rolls";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// The pc_attack engine: full server resolution of player attacks. The
// to-hit bonus and damage dice come from the sheet and the SRD weapon
// table, the roll is adjudicated against the enemy's real AC, and damage
// lands through applyEnemyDamage, so the model can no longer decide hits,
// invent modifiers, or forget to apply damage. Physical-dice players still
// roll their own d20 and damage via chained pending rolls. This module must
// not import encounter-tools (the import points the other way); it does
// import mutations for the Divine Smite slot spend, exactly as cast-tools
// does, and mutations must never import back.

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
  // Everything the character's features add to an attack: fighting styles,
  // Martial Arts, Sneak Attack, crit range, Brutal Critical, Divine Smite.
  const riders = combatRiders(sheet);
  let profile: AttackProfile;
  // Set when the server derived the spell's dice itself, for the notes.
  let scalingNote: string | null = null;
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
    // The content pack knows what this spell rolls at this level, including
    // cantrip scaling the model routinely forgets. Its answer wins; the
    // model's dice are the fallback for spells that do not parse.
    const scaled = spellDamageFor({
      spell: spellName,
      userId: sheet.userId,
      casterLevel: sheet.level,
    });
    const damageArg = scaled?.dice ?? (args.damage ?? "").trim();
    if (!damageArg || !isValidExpression(damageArg)) {
      return {
        error: `Spell attacks need the spell's damage dice, e.g. damage="1d10". Send pc_attack again with a damage expression.`,
      };
    }
    if (scaled) {
      scalingNote = scaled.note;
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
    profile = weaponAttackProfile(derived, sheet.proficiencies.weapons, resolved, {
      riders,
      twoHanded: args.twoHanded,
      offHand: args.offHand,
    });
  }

  // Rage adds its bonus to melee Strength weapon attacks for as long as the
  // condition lasts; the server folds it into the damage dice so both the
  // digital and physical-dice paths carry it.
  const rageBonus = ragingMeleeBonus(sheet, profile);
  if (rageBonus) {
    profile = {
      ...profile,
      damageExpression: `${profile.damageExpression}+${rageBonus}`,
    };
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
  // Terrain cover raises the AC to beat; a shot past normal range is taken
  // at disadvantage.
  const spatials = pcAttackSpatials(encounter.id, sheet.id, enemy.id, {
    ranged: profile.ranged,
    rangeTiles: profile.rangeTiles,
    thrown: profile.thrown,
  });
  const effectiveAc = enemy.ac + spatials.cover;

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
  if (rageBonus) {
    conditionContext.notes.push(`raging: +${rageBonus} melee damage`);
  }
  for (const note of profile.riderNotes) {
    conditionContext.notes.push(note);
  }
  if (scalingNote) {
    conditionContext.notes.push(scalingNote);
  }
  if (spatials.cover) {
    conditionContext.notes.push(
      `${enemy.displayName} has ${spatials.cover === 2 ? "half" : "three-quarters"} cover: +${spatials.cover} AC`,
    );
  }
  if (spatials.longRange) {
    conditionContext.notes.push("beyond normal range: disadvantage");
  }
  const advantage: Advantage = mergeAdvantage([
    conditionContext.advantage,
    exhaustion.advantage,
    ...(spatials.longRange ? ["disadvantage" as const] : []),
  ]);

  // Sneak Attack, decided here because it turns on the final advantage
  // state: a finesse or ranged attack made with advantage, or with an ally
  // adjacent to the target and no disadvantage. Once per turn is enforced by
  // the model calling it on one swing; the dice ride the damage roll.
  const sneak =
    riders.sneakAttackDice > 0 &&
    profile.sneakEligible &&
    advantage !== "disadvantage" &&
    (advantage === "advantage" || allyAdjacentToEnemy(encounter.id, sheet.id, enemy.id));
  if (sneak) {
    profile = {
      ...profile,
      damageExpression: `${profile.damageExpression}+${riders.sneakAttackDice}d6`,
    };
    conditionContext.notes.push(`Sneak Attack: +${riders.sneakAttackDice}d6`);
  }

  // Divine Smite: the slot is spent up front so a refused spend refuses the
  // smite rather than handing out free radiant damage. 2d8 at 1st level,
  // +1d8 per slot level above, +1d8 against undead and fiends.
  let smiteNote: string | null = null;
  if (args.smite) {
    if (!riders.canSmite) {
      return { error: `${sheet.name} has no Divine Smite.` };
    }
    if (profile.ranged) {
      return { error: "Divine Smite rides on a melee weapon attack, not a ranged one." };
    }
    const spend = applyDmMutation(
      campaign,
      turn.id,
      "use_spell_slot",
      JSON.stringify({ characterId: sheet.id, level: args.smite, reason: "Divine Smite" }),
      sheets,
      sheetsById,
    ).result;
    if ("error" in spend) {
      return spend;
    }
    // The stat block carries no creature type, so the name and content slug
    // are what there is to go on; a miss just costs the extra die.
    const undeadOrFiend = /undead|fiend|demon|devil|zombie|skeleton|ghoul|wraith|lich|vampire|specter|shadow|imp/i.test(
      `${enemy.displayName} ${enemy.slug}`,
    );
    const dice = Math.min(6, 1 + args.smite) + (undeadOrFiend ? 1 : 0);
    profile = {
      ...profile,
      damageExpression: `${profile.damageExpression}+${dice}d8`,
    };
    smiteNote = `Divine Smite (level ${args.smite} slot): +${dice}d8 radiant${
      undeadOrFiend ? " against an undead or fiend" : ""
    }`;
    conditionContext.notes.push(smiteNote);
  }

  // The action economy: the first swing spends the Attack action, the rest
  // come out of Extra Attack, and the off-hand swing is a bonus action. Only
  // binds the character whose turn it actually is.
  let budget = budgetFor(encounter, sheet.id, attacksAllowedFor(sheet));
  if (budget) {
    const spend = args.offHand
      ? spendAction(budget, "bonus", "an off-hand attack", sheet.name)
      : spendAttack(budget, sheet.name);
    if (!spend.ok) {
      return { error: spend.error };
    }
    budget = spend.budget;
    if (sneak) {
      // Sneak Attack is once per turn however many swings land.
      const claimed = claimOncePerTurn(budget, "sneak_attack");
      if (!claimed) {
        profile = {
          ...profile,
          damageExpression: profile.damageExpression.replace(
            `+${riders.sneakAttackDice}d6`,
            "",
          ),
        };
        conditionContext.notes = conditionContext.notes.filter(
          (note) => !note.startsWith("Sneak Attack"),
        );
        conditionContext.notes.push("Sneak Attack already used this turn: no extra dice");
      } else {
        budget = claimed;
      }
    }
    storeBudget(encounter, budget);
  }

  // Striking from hiding spends the hiding: the attack gives them away
  // whether it lands or not.
  if (sheet.conditions.some((entry) => entry.toLowerCase() === "hidden")) {
    const cleared = removeConditions(sheet.conditions, sheet.conditionMeta, ["hidden"]);
    const revealed = patchSheet(sheet.id, {
      conditions: cleared.conditions,
      conditionMeta: cleared.meta,
    });
    if (revealed) {
      publishPersisted(campaign.id, "sheet_updated", { sheet: revealed });
    }
  }

  const toHitExpression = d20Expression(profile.toHit, advantage);
  const detail = `${sheet.name}: ${profile.weapon} vs ${enemy.displayName}`;

  // Great Weapon Fighting rerolls 1s and 2s, but only on the two-handed
  // melee swing it is written for.
  const rerollBelow =
    riders.greatWeaponRerollBelow && profile.twoHanded && !profile.ranged
      ? riders.greatWeaponRerollBelow
      : 0;
  if (rerollBelow) {
    conditionContext.notes.push(`Great Weapon Fighting: rerolling damage dice of ${rerollBelow} or less`);
  }
  const critExpression = critDamageExpression(profile.damageExpression, riders.critExtraDice);

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
        targetAc: effectiveAc,
        damageExpression: profile.damageExpression,
        critDamageExpression: critExpression,
        damageType: profile.damageType,
        ...(conditionContext.autoCrit ? { autoCrit: true } : {}),
        ...(riders.critRange < 20 ? { critRange: riders.critRange } : {}),
        ...(rerollBelow ? { rerollBelow } : {}),
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

  const adjudicated = adjudicateHit(hitOutcome.total, hitOutcome.crit, effectiveAc, {
    natural: hitOutcome.natural,
    critRange: riders.critRange,
  });
  const hit = adjudicated.hit;
  const crit = adjudicated.crit || (hit && conditionContext.autoCrit);
  const base = {
    attacker: sheet.name,
    weapon: profile.weapon,
    rolled: hitOutcome.total,
    vsAc: effectiveAc,
    target: enemy.displayName,
    ...(profile.improvised ? { improvised: true } : {}),
    ...(conditionContext.notes.length ? { conditionEffects: conditionContext.notes } : {}),
    // Extra Attack: the model has no way to know a level-5 fighter swings
    // twice unless the engine says so on every swing.
    ...(budget && attacksLeft(budget) > 0
      ? {
          attacksRemaining: attacksLeft(budget),
          extraAttack: `${sheet.name} has ${attacksLeft(budget)} more attack${
            attacksLeft(budget) === 1 ? "" : "s"
          } this turn; call pc_attack again for each before ending their turn.`,
        }
      : riders.extraAttacks && !budget
        ? {
            extraAttack: `${sheet.name} attacks ${riders.extraAttacks + 1} times per Attack action.`,
          }
        : {}),
  };
  if (!hit) {
    return {
      ...base,
      hit: false,
      ...(hitOutcome.crit === "nat1" ? { fumble: true } : {}),
      note: "The attack misses; narrate the miss.",
    };
  }

  const damageExpression = crit ? critExpression : profile.damageExpression;
  const damageOutcome = rollExpression(damageExpression, undefined, { rerollBelow });
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
  const adjudicated = adjudicateHit(roll.total, roll.breakdown.crit, context.targetAc, {
    natural: roll.breakdown.natural,
    critRange: context.critRange,
  });
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
  }. ${context.attacker} now rolls damage (${expression})${
    context.rerollBelow
      ? `, rerolling any die of ${context.rerollBelow} or less once for Great Weapon Fighting`
      : ""
  }; the server will apply it to ${enemy.displayName} automatically.`;
}
