// The class-feature options a player's attack can carry beyond the weapon
// itself, each checked before anything is spent: a bonus-action attack a
// feature grants (Martial Arts, Frenzy), Stunning Strike, Reckless Attack, a
// blow that knocks out instead of killing, and the situational advantage the
// AI claims for a roll. Split from pc-attack-plan.ts, which asks these in its
// refusal pass and carries the answers to the roll. Nothing here writes.

import { GREAT_WEAPON_MASTER_READY } from "@/lib/srd/feat-combat";
import { holdsFeat } from "@/lib/srd/feat-effects";
import type { Advantage } from "@/lib/dice";
import type { TurnBudget } from "@/lib/dm/action-budget";
import type { AttackProfile } from "@/lib/dm/attack-logic";
import { resourceLeft } from "@/lib/dm/attack-rules";
import type { AttackKind } from "@/lib/dm/pc-attack-profile";
import { acBreakdownFor, type SheetDerived } from "@/lib/srd";
import { RAGING } from "@/lib/srd/class-resources";
import { authoredBonusAttackProblem } from "@/lib/srd/authored-economy";
import type { CharacterSheet } from "@/lib/schemas/sheet";

export const BONUS_ATTACKS = ["martial arts", "frenzy", "feature"] as const;
export type AnyBonusAttack = (typeof BONUS_ATTACKS)[number];
// The class options the Hand offers; "feature" is a subclass's bonus attack
// (src/lib/srd/authored-effects.ts), sent by the DM or the model.
export type BonusAttack = Exclude<AnyBonusAttack, "feature">;

// The condition Reckless Attack leaves on the barbarian until their next
// turn starts (src/lib/srd/condition-effects.ts reckless row).
export const RECKLESS = "reckless";

// The Attack action was taken this turn with an unarmed strike or a monk
// weapon, which is what opens Martial Arts' bonus strike. Kept in the turn
// budget's once-per-turn list, so it dies with the turn.
export const MARTIAL_ARTS_READY = "martial-arts:attack-action";

// The creatures a character attacked this turn, one budget key each
// ("attacked:<enemyId>"), for Horde Breaker's "a different creature within
// 5 feet of the original target".
export const ATTACKED = "attacked:";
const HORDE_BREAKER = "horde-breaker";

const hasFeature = (sheet: Pick<CharacterSheet, "features">, name: string) =>
  sheet.features.some((feature) => {
    const lowered = feature.name.trim().toLowerCase();
    return lowered === name || lowered.startsWith(`${name} (`);
  });

const hasCondition = (sheet: Pick<CharacterSheet, "conditions">, name: string) =>
  sheet.conditions.some((entry) => entry.trim().toLowerCase() === name);

// Martial Arts works only while the monk wears no armor and carries no
// shield (SRD 5.1, Martial Arts).
export function martialArtsApplies(sheet: CharacterSheet): boolean {
  const worn = acBreakdownFor(sheet);
  return !worn.armorName && !worn.shieldName;
}

export type AttackOptions = {
  bonusAttack: AnyBonusAttack | null;
  // Stunning Strike declared: the ki DC the target's CON save meets.
  stunningStrike: { dc: number } | null;
  // Reckless Attack declared on this swing (the condition is written when
  // the attack is paid for).
  declaresReckless: boolean;
  // This swing rides the reckless turn: advantage.
  recklessAdvantage: boolean;
  nonlethal: boolean;
  // Horde Breaker's extra attack: it spends no attack of the action, only
  // the once-per-turn key it claims.
  hordeBreaker: boolean;
};

export function checkAttackOptions(input: {
  sheet: CharacterSheet;
  args: {
    bonusAttack?: AnyBonusAttack;
    stunningStrike?: boolean;
    reckless?: boolean;
    nonlethal?: boolean;
    offHand?: boolean;
    hordeBreaker?: boolean;
  };
  profile: AttackProfile;
  kind: AttackKind;
  atRange: boolean;
  derived: SheetDerived;
  // Null off the character's own turn.
  budget: TurnBudget | null;
  // Whether a creature this character attacked this turn stands within 5
  // feet of this target (Horde Breaker). Absent off the board.
  besideEarlierTarget?: (earlierId: string) => boolean;
  targetId?: string;
}): { refused: string } | { options: AttackOptions } {
  const { sheet, args, profile, kind, atRange, derived, budget } = input;
  const weaponAttack = kind === "weapon" || kind === "natural";
  const meleeWeapon = weaponAttack && !atRange;
  const options: AttackOptions = {
    bonusAttack: null,
    stunningStrike: null,
    declaresReckless: false,
    recklessAdvantage: false,
    nonlethal: false,
    hordeBreaker: false,
  };

  if (args.bonusAttack) {
    if (!budget) {
      return { refused: `A bonus-action attack is made on ${sheet.name}'s own turn; it is not their turn.` };
    }
    if (args.offHand) {
      return { refused: "An attack is either the off-hand swing of two-weapon fighting or a feature's bonus attack, not both." };
    }
    if (args.bonusAttack === "martial arts") {
      if (!hasFeature(sheet, "martial arts")) {
        return { refused: `${sheet.name} has no Martial Arts; the bonus-action unarmed strike is a monk's.` };
      }
      if (!martialArtsApplies(sheet)) {
        return { refused: `Martial Arts works only with no armor and no shield, and ${sheet.name} wears one.` };
      }
      if (!profile.unarmed) {
        return { refused: "Martial Arts' bonus-action attack is an unarmed strike; send weapon \"unarmed strike\"." };
      }
      if (!budget.oncePerTurn.includes(MARTIAL_ARTS_READY)) {
        return {
          refused: `Martial Arts' bonus strike follows the Attack action taken with an unarmed strike or a monk weapon, and ${sheet.name} has not attacked that way this turn. They attack first, then strike as a bonus action.`,
        };
      }
    } else if (args.bonusAttack === "feature") {
      // Great Weapon Master: a melee weapon attack as a bonus action on the
      // turn a melee crit or a kill was scored (src/lib/srd/feat-combat.ts).
      const greatWeapon =
        meleeWeapon && holdsFeat(sheet, "Great Weapon Master") && budget.oncePerTurn.includes(GREAT_WEAPON_MASTER_READY);
      // Battle Magic, War Magic, Sudden Strike, Telekinetic Master...
      // (src/lib/srd/authored-effects.ts).
      const granted = greatWeapon ? { ok: true } : authoredBonusAttackProblem(sheet, budget);
      if ("refused" in granted || !weaponAttack) {
        const gwmHint = holdsFeat(sheet, "Great Weapon Master") ? " Great Weapon Master's bonus attack follows a melee critical hit or a kill on this turn." : "";
        return { refused: "refused" in granted ? `${sheet.name}: ${granted.refused}${gwmHint}` : "A feature's bonus-action attack is a weapon attack." };
      }
    } else {
      if (!hasFeature(sheet, "frenzy")) {
        return { refused: `${sheet.name} has no Frenzy; the bonus-action attack of a frenzy is a Berserker's.` };
      }
      if (!hasCondition(sheet, RAGING)) {
        return { refused: `${sheet.name} is not raging; a frenzy lasts only as long as a rage. They rage first (use_resource Rage).` };
      }
      if (!meleeWeapon) {
        return { refused: "A frenzy's bonus-action attack is a melee weapon attack." };
      }
    }
    options.bonusAttack = args.bonusAttack;
  }

  if (args.stunningStrike) {
    if (!hasFeature(sheet, "stunning strike")) {
      return { refused: `${sheet.name} has no Stunning Strike (a monk's feature from 5th level).` };
    }
    if (!meleeWeapon) {
      return { refused: "Stunning Strike rides a melee weapon attack (an unarmed strike counts), not a ranged one or a spell." };
    }
    const ki = resourceLeft(sheet, "Ki");
    if (!ki || ki.left < 1) {
      return {
        refused: `${sheet.name} has no ki point left for Stunning Strike. They can make the attack without it.`,
      };
    }
    options.stunningStrike = { dc: 8 + derived.proficiencyBonus + derived.abilityMods.wis };
  }

  const strengthMelee = meleeWeapon && profile.ability === "str";
  const alreadyReckless = hasCondition(sheet, RECKLESS);
  if (args.reckless) {
    if (!hasFeature(sheet, "reckless attack")) {
      return { refused: `${sheet.name} has no Reckless Attack (a barbarian's feature from 2nd level).` };
    }
    if (!budget) {
      return { refused: "Reckless Attack is declared on the barbarian's own turn." };
    }
    if (!strengthMelee) {
      return { refused: "Reckless Attack covers melee weapon attacks made with Strength; this one is not." };
    }
    if (!alreadyReckless && budget.attacksMade > 0) {
      return {
        refused: `Reckless Attack is decided on the first attack of the turn, and ${sheet.name} has already attacked. They can attack without it, or decide it at the start of their next turn.`,
      };
    }
    options.declaresReckless = !alreadyReckless;
  }
  options.recklessAdvantage = Boolean(budget) && strengthMelee && (alreadyReckless || options.declaresReckless);

  if (args.hordeBreaker) {
    const problem = hordeBreakerProblem({ ...input, weaponAttack });
    if (problem) {
      return { refused: problem };
    }
    options.hordeBreaker = true;
  }

  if (args.nonlethal) {
    if (atRange) {
      return { refused: "Only a melee attack can knock a creature out instead of killing it; this one is ranged." };
    }
    options.nonlethal = true;
  }
  return { options };
}

// Horde Breaker (Hunter's Prey): once on each of their turns, after a weapon
// attack, another attack with the same weapon against a different creature
// within 5 feet of the first target. Null when this swing may be it.
function hordeBreakerProblem(input: {
  sheet: CharacterSheet;
  budget: TurnBudget | null;
  weaponAttack: boolean;
  args: { bonusAttack?: AnyBonusAttack; offHand?: boolean };
  besideEarlierTarget?: (earlierId: string) => boolean;
  targetId?: string;
}): string | null {
  const { sheet, budget } = input;
  if (!hasHordeBreaker(sheet)) {
    return `${sheet.name} has no Horde Breaker (a Hunter ranger's Hunter's Prey pick).`;
  }
  if (!budget) {
    return "Horde Breaker's attack is made on the ranger's own turn.";
  }
  if (!input.weaponAttack || input.args.bonusAttack || input.args.offHand) {
    return "Horde Breaker's extra attack is a weapon attack of its own, not an off-hand or bonus-action swing.";
  }
  if (budget.oncePerTurn.includes(HORDE_BREAKER)) {
    return `${sheet.name} has already made their Horde Breaker attack this turn; it comes once a turn.`;
  }
  const earlier = budget.oncePerTurn
    .filter((key) => key.startsWith(ATTACKED))
    .map((key) => key.slice(ATTACKED.length))
    .filter((id) => id !== input.targetId);
  if (!earlier.length) {
    return "Horde Breaker's extra attack follows a weapon attack on another creature this turn; attack that creature first.";
  }
  if (input.besideEarlierTarget && !earlier.some((id) => input.besideEarlierTarget?.(id))) {
    return "Horde Breaker's extra attack must target a creature within 5 feet of the creature attacked first.";
  }
  return null;
}

export function hasHordeBreaker(sheet: Pick<CharacterSheet, "features">): boolean {
  return sheet.features.some((feature) => /horde breaker/i.test(feature.name));
}

// What a charged Horde Breaker spends: its once-per-turn key.
export function claimHordeBreaker(budget: TurnBudget): TurnBudget {
  return { ...budget, oncePerTurn: [...budget.oncePerTurn, HORDE_BREAKER] };
}

// ---- the AI's situational advantage ----

// Circumstances the engine decides itself from the board, the conditions and
// the features: a claim naming one of them is the model standing in for the
// engine, and is dropped so the engine's own answer stands.
const ENGINE_DECIDED =
  /\b(prone|invisib|hidden|hiding|unseen|blind|restrain|paraly|stun|unconscious|poison|frighten|help|flank|dodg|reckless|cover|range|dark|dim|light|obscur|grappl|charm|pack tactics|bless|bane|faerie|true strike|inspir|exhaust|rage|raging|sneak)/i;

// What the AI's advantage claim on a roll is worth. A person running the
// table rules freely (the console keeps its correction power); the AI names
// the circumstance, and only one the engine does not already decide counts.
export function claimedAdvantage(input: {
  requested: Advantage | undefined;
  reason: string | undefined;
  byAi: boolean;
}): { requested: Advantage; note: string | null } {
  const requested = input.requested ?? "none";
  if (requested === "none") {
    return { requested, note: null };
  }
  if (!input.byAi) {
    return { requested, note: null };
  }
  const reason = (input.reason ?? "").trim();
  if (!reason) {
    return {
      requested: "none",
      note: `the ${requested} claimed was set aside: name the circumstance in advantageReason (the server already applies conditions, cover, light, range, Help and features)`,
    };
  }
  if (ENGINE_DECIDED.test(reason)) {
    return {
      requested: "none",
      note: `the ${requested} claimed for "${reason.slice(0, 80)}" was set aside: the server decides that circumstance itself`,
    };
  }
  return { requested, note: `DM ruling: ${requested} (${reason.slice(0, 80)})` };
}
