import { z } from "zod";
import type { Campaign } from "@/lib/db/campaigns";
import { getActiveEncounter, getEnemy, patchEnemyConditions, saveEncounter } from "@/lib/db/encounters";
import { invisibilityEndedByAction, writeMarks } from "@/lib/dm/attack-marks";
import { sanctuaryEndedByAttack } from "@/lib/dm/spell-defenses";
import { publishEncounter } from "@/lib/dm/enemy-damage";
import type { DmTurn } from "@/lib/db/dm-turns";
import { getSheetById, patchSheet } from "@/lib/db/sheets";
import { publishPersisted } from "@/lib/events";
import { normalizeAdvantage } from "@/lib/dm/arg-coerce";
import { removeConditions, type ConditionMetaMap } from "@/lib/dm/condition-logic";
import { applyDmMutation } from "@/lib/dm/mutations";
import { strikeDamage } from "@/lib/dm/pc-attack-damage";
import { FRENZIED } from "@/lib/dm/frenzy";
import { BONUS_ATTACKS, RECKLESS } from "@/lib/dm/pc-attack-options";
import { parkPcAttack } from "@/lib/dm/pc-attack-parked";
import { planPcAttack, type AttackPlan } from "@/lib/dm/pc-attack-plan";
import { rollPcAttack, strikeToHit } from "@/lib/dm/pc-attack-resolve";
import { castAttackSpell } from "@/lib/dm/pc-attack-spell";
import { resolveSheetRef } from "@/lib/dm/rolls";
import { storeBudget } from "@/lib/dm/turn-budget";
import { spendReadied } from "@/lib/dm/object-actions";
import { spendGiantKiller } from "@/lib/dm/reaction-attacks";
import { withAmmoCount } from "@/lib/srd/ammunition";
import { OPEN_HAND_CHOICES } from "@/lib/dm/attack-onhit";
import { spendInspirationCounter } from "@/lib/dm/roll-riders";
import { moteBurst, moteOf } from "@/lib/dm/authored-mote";
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
      "A player character attacks an enemy. The server derives their attack bonus and damage from their sheet, rolls to-hit against the enemy's real AC, applies damage on a hit, and reports the outcome for you to narrate. Use this for EVERY weapon attack and attack-roll spell a player makes; never adjudicate a player's attack yourself. Off their own turn a character attacks only with a readied attack or spell, or Giant Killer's reaction against a Large or larger creature within 5 feet that just attacked them; the server checks which and spends the reaction.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        characterId: { type: "string", description: "Exact characterId from GAME STATE." },
        targetEnemyId: { type: "string", description: "Exact enemyId from GAME STATE." },
        weapon: {
          type: "string",
          description:
            "Weapon they attack with, from their equipment. Omit to use their best carried weapon. A weapon a subclass feature makes is named here too: a raging Path of the Beast barbarian's 'bite', 'claws' or 'tail', a Soulknife's 'psychic blade' (offHand for the second blade), a Sun Soul monk's 'radiant sun bolt'.",
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
          description:
            "Situational advantage or disadvantage from the fiction that the server cannot see. It counts only with advantageReason. The server already applies conditions (prone, invisible, hidden, restrained...), cover, light and darkness, range, Help, flanking, Reckless Attack and every feature: never claim those.",
        },
        advantageReason: {
          type: "string",
          description: "The circumstance behind advantage, in a few words (\"the ogre is tangled in the curtain\").",
        },
        bonusAttack: {
          type: "string",
          enum: ["martial arts", "frenzy", "feature"],
          description:
            "A bonus-action attack a feature grants: 'martial arts' (a monk's unarmed strike after taking the Attack action with an unarmed strike or monk weapon; send weapon 'unarmed strike'), 'frenzy' (a raging Berserker's melee weapon attack), or 'feature' (a subclass's bonus weapon attack: Battle Magic or War Magic after casting with the action, Sudden Strike or Curving Shot after attacking, Telekinetic Master while concentrating on telekinesis; the server checks the feature and the turn). The server spends the bonus action.",
        },
        stunningStrike: {
          type: "boolean",
          description:
            "Monk 5+: Stunning Strike on this melee weapon hit. The server spends 1 ki on a hit and rolls the target's CON save against the ki DC; a failed save stuns it.",
        },
        powerAttack: {
          type: "boolean",
          description:
            "Great Weapon Master (a heavy melee weapon) or Sharpshooter (a ranged weapon): take -5 on this attack roll for +10 damage. The player's choice before the roll; the server checks the feat and the weapon. After a melee critical hit or a kill, a Great Weapon Master's bonus-action attack is bonusAttack 'feature'.",
        },
        reckless: {
          type: "boolean",
          description:
            "Barbarian 2+: Reckless Attack, declared on the first attack of their turn. Advantage on melee Strength weapon attacks this turn; attacks against them have advantage until their next turn. The server tracks both.",
        },
        nonlethal: {
          type: "boolean",
          description:
            "A melee attack meant to knock out: a creature it drops to 0 hit points falls unconscious instead of dying and is out of the fight.",
        },
        hordeBreaker: {
          type: "boolean",
          description:
            "Hunter ranger with Horde Breaker: once a turn, an extra weapon attack on a different creature within 5 feet of one they already attacked this turn. It uses no attack of their action.",
        },
        useInspiration: {
          type: "boolean",
          description: "Spend the character's Inspiration for advantage on this attack roll. Refused when they hold none.",
        },
        strokeOfLuck: {
          type: "boolean",
          description:
            "Rogue 20: Stroke of Luck. If this attack misses, the server turns it into a hit and spends the use (once a short rest); a hit spends nothing.",
        },
        openHand: {
          type: "string",
          enum: ["prone", "push", "no reactions"],
          description:
            "Way of the Open Hand monk: Open Hand Technique on this Flurry of Blows strike. On a hit the server rolls the target's DEX save (prone) or STR save (pushed 15 feet) against the ki DC, or takes its reactions until the end of the monk's next turn.",
        },
        hurlThroughHell: {
          type: "boolean",
          description:
            "Fiend warlock 14: Hurl Through Hell on this hit. The server spends the use (once a long rest); the creature is gone until the end of the warlock's next turn and then takes 10d10 psychic unless it is a fiend.",
        },
        rapidStrike: {
          type: "boolean",
          description:
            "Samurai 15: Rapid Strike. This attack has advantage and the fighter forgoes it for one more attack of the Attack action, once a turn; the server refuses it when the attack has no advantage.",
        },
        whirlwind: {
          type: "boolean",
          description:
            "Hunter ranger with Whirlwind Attack: the action makes one melee weapon attack against each creature within 5 feet; call pc_attack once per creature with whirlwind true. The first spends the whole action.",
        },
        volley: {
          type: "boolean",
          description:
            "Hunter ranger with Volley: the action makes one ranged weapon attack against each creature within 10 feet of the first target; call pc_attack once per creature with volley true. The first spends the whole action.",
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
  advantageReason: z.string().max(200).optional(),
  bonusAttack: z.preprocess(
    (value) => (typeof value === "string" ? value.trim().toLowerCase() : value),
    z.enum(BONUS_ATTACKS).optional(),
  ),
  stunningStrike: z.coerce.boolean().optional(),
  powerAttack: z.coerce.boolean().optional(),
  reckless: z.coerce.boolean().optional(),
  nonlethal: z.coerce.boolean().optional(),
  hordeBreaker: z.coerce.boolean().optional(),
  useInspiration: z.coerce.boolean().optional(),
  strokeOfLuck: z.coerce.boolean().optional(),
  openHand: z.preprocess(
    (value) => (typeof value === "string" ? value.trim().toLowerCase() : value),
    z.enum(OPEN_HAND_CHOICES).optional(),
  ),
  hurlThroughHell: z.coerce.boolean().optional(),
  rapidStrike: z.coerce.boolean().optional(),
  whirlwind: z.coerce.boolean().optional(),
  volley: z.coerce.boolean().optional(),
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

  // A Creation bard's mote rides the inspiration die the roll spends
  // (src/lib/dm/authored-mote.ts); it bursts once the attack is rolled.
  const mote = moteOf(sheet, plan.attackRiders.spent);
  spendPcAttack(plan);
  const strike = { ...strikeToHit(plan), ...strikeDamage(plan) };

  // Physical dice: park the to-hit roll for the player; the submit route
  // adjudicates it and, on a hit, parks the damage roll too.
  if (realDiceUserIds.has(sheet.userId)) {
    parkPcAttack(plan, strike, toolCallId);
    return { [PC_ATTACK_PARKED]: true };
  }
  const rolled = rollPcAttack(plan, strike);
  const burst = moteBurst(campaign, turn, mote, plan.enemy);
  return burst ? { ...rolled, mote: burst } : rolled;
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
    // The readied action (or the Giant Killer answer) this attack is spends
    // with it.
    if (plan.extras.giantKiller) {
      spendGiantKiller(campaign.id, sheet.id);
    } else {
      spendReadied(campaign, sheet.id);
    }
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
  // whether it lands or not), an attack ends Invisibility (not Greater
  // Invisibility, attack-marks.ts), and one-shot riders like True Strike and
  // a held Help are spent by this roll: clear them all together.
  const spentConditions = [
    ...(sheet.conditions.some((entry) => entry.toLowerCase() === "hidden") ? ["hidden"] : []),
    ...invisibilityEndedByAction(sheet),
    // An attack ends the attacker's own Sanctuary (spell-defenses.ts).
    ...sanctuaryEndedByAttack(sheet),
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
  // Inspiration spent for this roll's advantage.
  if (plan.extras.inspired) {
    const fresh = getSheetById(sheet.id) ?? sheet;
    const spent = patchSheet(sheet.id, { resources: spendInspirationCounter(fresh.resources) });
    if (spent) {
      publishPersisted(campaign.id, "sheet_updated", { sheet: spent });
    }
  }
  markAttackOptions(plan);
  writeMarks(campaign.id, sheet.id, plan.marks.assign);
  // The target's one-shot conditions this roll uses up (Guiding Bolt).
  if (plan.targetSpent.length) {
    const target = getEnemy(plan.enemy.id);
    if (target) {
      const cleared = removeConditions(target.conditions, target.conditionMeta, plan.targetSpent);
      patchEnemyConditions(target.id, cleared.conditions, cleared.meta);
      publishEncounter(campaign.id);
    }
  }
}

// What a feature option leaves on the attacker once the attack is paid for:
// Reckless Attack's opening (attacks against them have advantage until
// their next turn starts), and the frenzy a Berserker's rage now carries,
// which costs a level of exhaustion when the rage ends (src/lib/dm/frenzy.ts).
function markAttackOptions(plan: AttackPlan) {
  const { campaign, sheet, options } = plan;
  if (!options.declaresReckless && options.bonusAttack !== "frenzy") {
    return;
  }
  const fresh = getSheetById(sheet.id) ?? sheet;
  const meta = { ...(fresh.conditionMeta as ConditionMetaMap) };
  const conditions = [...fresh.conditions];
  if (options.declaresReckless && !conditions.some((entry) => entry.toLowerCase() === RECKLESS)) {
    conditions.push(RECKLESS);
    meta[RECKLESS] = { untilTurnOf: sheet.id };
  }
  if (options.bonusAttack === "frenzy" && !conditions.some((entry) => entry.toLowerCase() === FRENZIED)) {
    conditions.push(FRENZIED);
  }
  const marked = patchSheet(sheet.id, { conditions, conditionMeta: meta });
  if (marked) {
    publishPersisted(campaign.id, "sheet_updated", { sheet: marked });
  }
}
