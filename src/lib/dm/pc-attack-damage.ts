// What a player's attack deals: the dice its riders fold into the damage
// expression (Rage, effect conditions, feature riders, lasting effects,
// Sneak Attack), the once-per-turn riders the turn budget takes back, the
// critical and reroll rules the damage roll carries, and a landed blow
// resolved per damage type (src/lib/dm/damage-parts.ts). Split from
// pc-attack.ts, which decides and rolls the attack these dice belong to.
// Nothing here refuses the attack.

import type { Advantage, RollResult } from "@/lib/dice";
import { claimOncePerTurn, type TurnBudget } from "@/lib/dm/action-budget";
import { ragingMeleeBonus, type AttackProfile } from "@/lib/dm/attack-logic";
import { damageParts, type TypedRider } from "@/lib/dm/damage-parts";
import { damageAdjust, resistsAllDamage, weaponMaterial } from "@/lib/dm/damage-logic";
import { resistLineFor } from "@/lib/dm/underwater";
import { effectOutcome } from "@/lib/dm/effect-tools";
import type { EncounterEnemy } from "@/lib/db/encounters";
import { DAMAGE_TYPES } from "@/lib/dm/condition-logic";
import { subclassFeatureDescription } from "@/lib/srd/features";
import { authoredSneakEdge } from "@/lib/dm/authored-hooks";
import { authoredSneakBonus } from "@/lib/srd/authored-effects-more";
import { getEnemy } from "@/lib/db/encounters";
import { getSheetById } from "@/lib/db/sheets";
import { applyEnemyDamage } from "@/lib/dm/enemy-damage";
import { allyAdjacentToEnemy } from "@/lib/dm/map-tools";
import type { AttackPlan } from "@/lib/dm/pc-attack-plan";
import type { AttackKind } from "@/lib/dm/pc-attack-profile";
import type { OnHitSpends } from "@/lib/dm/pc-attack-riders";
import { conditionOnHitDice } from "@/lib/srd/condition-effects";
import { conditionStrikesMagical } from "@/lib/srd/condition-effect-queries";
import { effectsFor, type CombatRiders } from "@/lib/srd/feature-effects";
import type { CharacterSheet } from "@/lib/schemas/sheet";

export type FeatureRider = CombatRiders["damageRiders"][number];

// The riders that fold into the damage expression before anything is
// rolled, and the lasting effects on the attack and damage rolls.
export function foldDamageRiders(input: {
  campaignId: string;
  sheet: CharacterSheet;
  profile: AttackProfile;
  riders: CombatRiders;
  kind: AttackKind;
  // The target, for the riders that read it (Colossus Slayer).
  enemy?: Pick<EncounterEnemy, "currentHp" | "maxHp">;
  // The marking conditions (Hunter's Mark, Hex) whose die rides a hit on
  // this target (src/lib/dm/attack-marks.ts). Absent: every one does.
  marked?: Set<string>;
}) {
  const { campaignId, sheet, riders, kind } = input;
  let profile = input.profile;

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

  // Effect conditions riding the attacker's hits (Divine Favor's +1d4
  // radiant, Hunter's Mark, Hex, enlarged/reduced) fold into the damage
  // expression so both dice paths carry them.
  const marked = input.marked;
  const onHit = conditionOnHitDice(sheet.conditions, {
    weapon: kind === "weapon" || kind === "natural",
    ...(marked ? { marked: (condition: string) => marked.has(condition) } : {}),
  });
  if (onHit.suffix) {
    profile = {
      ...profile,
      damageExpression: `${profile.damageExpression}${onHit.suffix}`,
    };
  }

  // Feature damage riders (Divine Strike, Improved Divine Smite, Divine
  // Fury) ride weapon attacks only; once-per-turn ones are reconciled with
  // the turn budget below, mirroring Sneak Attack.
  const featureRiders: FeatureRider[] =
    kind === "spell" || kind === "granted"
      ? []
      : [...riders.damageRiders, ...hunterRiders(sheet, input.enemy)].filter((rider) => {
          if (rider.when === "melee" && profile.ranged) {
            return false;
          }
          if (rider.when === "ranged" && !profile.ranged) {
            return false;
          }
          if (
            rider.requiresCondition &&
            !sheet.conditions.some(
              (entry) => entry.toLowerCase() === rider.requiresCondition,
            )
          ) {
            return false;
          }
          return true;
        })
        .map((rider) => ({ ...rider, type: riderType(sheet, rider) }));
  for (const rider of featureRiders) {
    profile = {
      ...profile,
      damageExpression: `${profile.damageExpression}+${rider.dice}`,
    };
  }
  // The dice that ride this attack under a damage type of their own, so the
  // hit can be resolved per type (src/lib/dm/damage-parts.ts).
  const typedRiders: TypedRider[] = [
    ...onHit.typed,
    ...featureRiders.filter((rider) => rider.type).map(({ dice, type }) => ({ dice, type })),
  ];

  // Lasting effects on the attacker's attack and damage rolls (set_effect).
  const attackEffect = effectOutcome(campaignId, { kind: "character", id: sheet.id }, "attack");
  const damageEffect = effectOutcome(campaignId, { kind: "character", id: sheet.id }, "damage");
  if (attackEffect.bonus) {
    profile = { ...profile, toHit: profile.toHit + attackEffect.bonus };
  }
  if (damageEffect.bonus) {
    profile = {
      ...profile,
      damageExpression: `${profile.damageExpression}${damageEffect.bonus > 0 ? "+" : "-"}${Math.abs(damageEffect.bonus)}`,
    };
  }
  return {
    profile,
    rageBonus,
    onHitNotes: onHit.notes,
    // Conditions the first hit uses up (the smites).
    hitSpent: onHit.hitSpent,
    featureRiders,
    typedRiders,
    attackEffect,
    damageEffect,
  };
}

// Hunter's Prey, Colossus Slayer (SRD 5.1, Hunter 3): once per turn, 1d8
// more on a weapon hit against a creature below its hit point maximum. The
// pick is a "Hunter's Prey: Colossus Slayer" choice feature (options.ts).
function hunterRiders(
  sheet: CharacterSheet,
  enemy: Pick<EncounterEnemy, "currentHp" | "maxHp"> | undefined,
): FeatureRider[] {
  const slayer = sheet.features.some((feature) => /colossus slayer/i.test(feature.name));
  if (!slayer || !enemy || enemy.currentHp >= enemy.maxHp) {
    return [];
  }
  return [{ feature: "Colossus Slayer", dice: "1d8", type: "", when: "weapon", oncePerTurn: true }];
}

// A Divine Strike rider's damage type. The domains share the name and the
// dice but not the type, so the parsed rider carries none; the sheet's own
// domain says which: the SRD Life Domain's is radiant, an authored domain's
// is in its text, and "of the weapon's type" (War) or a choice of three
// (Nature) rides as the weapon's own.
function riderType(sheet: CharacterSheet, rider: FeatureRider): string {
  if (rider.type || !/^divine strike/i.test(rider.feature.trim())) {
    return rider.type;
  }
  const domains = [
    { id: sheet.class, subclass: sheet.subclass },
    ...(sheet.classes ?? []).map((entry) => ({ id: entry.id, subclass: entry.subclass })),
  ].filter((entry) => entry.id.toLowerCase() === "cleric" && entry.subclass);
  for (const { subclass } of domains) {
    if (/^life\b|life domain/i.test(subclass.trim())) {
      return "radiant";
    }
    const text = subclassFeatureDescription("cleric", subclass, "Divine Strike") ?? "";
    const typed = /extra \d+d\d+ ([a-z]+) damage/i.exec(text);
    if (typed && (DAMAGE_TYPES as readonly string[]).includes(typed[1].toLowerCase())) {
      return typed[1].toLowerCase();
    }
  }
  return "";
}

// Sneak Attack, decided once the final advantage state is known: a finesse
// or ranged attack made with advantage, or with an ally adjacent to the
// target and no disadvantage. Once per turn is enforced by the turn budget
// (claimOncePerTurnRiders); the dice ride the damage roll.
export function withSneakAttack(input: {
  encounterId: string;
  sheetId: string;
  enemyId: string;
  profile: AttackProfile;
  riders: CombatRiders;
  advantage: Advantage;
  notes: string[];
}): { sneak: boolean; profile: AttackProfile; dice: number } {
  const { riders, advantage } = input;
  let profile = input.profile;
  const sneak =
    riders.sneakAttackDice > 0 &&
    profile.sneakEligible &&
    advantage !== "disadvantage" &&
    (advantage === "advantage" ||
      allyAdjacentToEnemy(input.encounterId, input.sheetId, input.enemyId) ||
      // Insightful Fighting, Rakish Audacity (authored-hooks.ts).
      authoredSneakEdge(input.encounterId, input.sheetId, input.enemyId) !== null);
  // Eye for Weakness: 3d6 more against the creature the rogue read. The
  // extra dice are one term with Sneak Attack's, so the once-a-turn claim
  // (claimOncePerTurnRiders) takes them back together.
  const bonus = sneak ? sneakBonusAgainst(input.sheetId, input.enemyId) : null;
  const dice = riders.sneakAttackDice + (bonus?.dice ?? 0);
  if (sneak) {
    profile = {
      ...profile,
      damageExpression: `${profile.damageExpression}+${dice}d6`,
    };
    input.notes.push(`Sneak Attack: +${dice}d6${bonus ? ` (${bonus.feature}: +${bonus.dice}d6)` : ""}`);
  }
  return { sneak, profile, dice };
}

function sneakBonusAgainst(sheetId: string, enemyId: string): { dice: number; feature: string } | null {
  const sheet = getSheetById(sheetId);
  const enemy = getEnemy(enemyId);
  if (!sheet || !enemy) {
    return null;
  }
  const meta = enemy.conditionMeta as Record<string, { source?: string } | undefined>;
  return authoredSneakBonus(sheet, sheet.id, enemy.conditions.map((condition) => ({ condition, source: meta[condition]?.source })));
}

// The once-per-turn damage riders claim their turn slot as the attack is
// charged. A rider already used this turn leaves the expression, its note
// says so, and its dice are listed so the typed riders drop them too.
export function claimOncePerTurnRiders(input: {
  budget: TurnBudget;
  profile: AttackProfile;
  notes: string[];
  sneak: boolean;
  sneakAttackDice: number;
  featureRiders: FeatureRider[];
}): { budget: TurnBudget; profile: AttackProfile; notes: string[]; droppedRiders: string[] } {
  let { budget, profile, notes } = input;
  const droppedRiders: string[] = [];
  if (input.sneak) {
    // Sneak Attack is once per turn however many swings land.
    const claimed = claimOncePerTurn(budget, "sneak_attack");
    if (!claimed) {
      profile = {
        ...profile,
        damageExpression: profile.damageExpression.replace(
          `+${input.sneakAttackDice}d6`,
          "",
        ),
      };
      notes = notes.filter(
        (note) => !note.startsWith("Sneak Attack"),
      );
      notes.push("Sneak Attack already used this turn: no extra dice");
    } else {
      budget = claimed;
    }
  }
  // Once-per-turn feature riders (Divine Strike) spend their turn slot the
  // same way.
  for (const rider of input.featureRiders) {
    if (!rider.oncePerTurn) {
      continue;
    }
    const claimed = claimOncePerTurn(budget, `rider:${rider.feature.toLowerCase()}`);
    if (!claimed) {
      profile = {
        ...profile,
        damageExpression: profile.damageExpression.replace(`+${rider.dice}`, ""),
      };
      droppedRiders.push(rider.dice);
      notes = notes.filter(
        (note) => !note.startsWith(`${rider.feature}:`),
      );
      notes.push(`${rider.feature} already used this turn: no extra dice`);
    } else {
      budget = claimed;
    }
  }
  return { budget, profile, notes, droppedRiders };
}

// What the damage roll carries once the attack is paid for: the reroll and
// critical rules, and the spends that wait for the hit.
export function strikeDamage(plan: AttackPlan) {
  const { campaign, sheet, profile, riders, context } = plan;
  // Great Weapon Fighting rerolls 1s and 2s, but only on the two-handed
  // melee swing it is written for.
  const rerollBelow =
    riders.greatWeaponRerollBelow && profile.twoHanded && !profile.ranged
      ? riders.greatWeaponRerollBelow
      : 0;
  if (rerollBelow) {
    context.notes.push(`Great Weapon Fighting: rerolling damage dice of ${rerollBelow} or less`);
  }
  // Savage Attacks and Brutal Critical are written for a melee weapon
  // attack: a bow and a spell roll the plain critical.
  const critExtraDice = plan.weaponAttack && !plan.atRange ? riders.critExtraDice : 0;
  const critOptions = {
    powerfulCritical: campaign.gameSettings.variantRules.powerfulCritical,
    multiplyNumeric: campaign.gameSettings.variantRules.criticalDamageMods,
  };
  const onHitSpends: OnHitSpends = {
    characterId: sheet.id,
    ...(plan.smite ? { smite: plan.smite } : {}),
    ...(plan.maneuver && !plan.maneuver.precision
      ? { maneuver: { name: plan.maneuver.name, die: plan.maneuver.die } }
      : {}),
    ...(plan.options.stunningStrike ? { stun: plan.options.stunningStrike } : {}),
    baseDamage: profile.damageExpression,
    critExtraDice,
  };
  const hasOnHit = Boolean(onHitSpends.smite || onHitSpends.maneuver || onHitSpends.stun);
  return { rerollBelow, critExtraDice, critOptions, onHitSpends, hasOnHit };
}

// A spell, a magic weapon and strikes that count as magical pass
// resistance to nonmagical attacks.
export function strikesAsMagic(plan: Pick<AttackPlan, "kind" | "profile" | "riders" | "sheet">): boolean {
  return (
    plan.kind === "spell" ||
    plan.kind === "granted" ||
    plan.profile.magicBonus > 0 ||
    plan.profile.magicWeapon === true ||
    // Magic Weapon and Shillelagh make the weapon itself magical.
    (plan.kind === "weapon" && conditionStrikesMagical(plan.sheet.conditions)) ||
    magicalStrikeApplies(plan)
  );
}

// Strikes that count as magical, each within its own scope: Ki-Empowered
// Strikes covers a monk's unarmed strikes and Primal Strike a beast form's
// natural attacks (SRD 5.1); an authored "your attacks count as magical"
// covers every weapon attack.
function magicalStrikeApplies(plan: Pick<AttackPlan, "kind" | "profile" | "riders" | "sheet">): boolean {
  if (!plan.riders.magicalAttacks) {
    return false;
  }
  return effectsFor(plan.sheet)
    .filter(({ effect }) => effect.kind === "magical_attacks")
    .some(({ feature }) => {
      const name = feature.toLowerCase();
      if (name.startsWith("ki-empowered strikes")) {
        return plan.profile.unarmed === true;
      }
      if (name.startsWith("primal strike")) {
        return plan.kind === "natural";
      }
      return true;
    });
}

// The typed riders still on the expression: each once-per-turn rider the
// turn budget dropped takes one matching entry out.
export function liveTypedRiders(typedRiders: TypedRider[], droppedRiders: string[]): TypedRider[] {
  const unspent = [...droppedRiders];
  return typedRiders.filter((rider) => {
    const at = unspent.indexOf(rider.dice);
    if (at < 0) {
      return true;
    }
    unspent.splice(at, 1);
    return false;
  });
}

// A landed blow meets the target's resistances and lands. One damage type
// goes straight through applyEnemyDamage; two or more are resolved per type.
export function applyHitDamage(input: {
  plan: AttackPlan;
  typedRiders: TypedRider[];
  damageOutcome: RollResult;
  dealt: number;
  crit: boolean;
  critExtraDice: number;
}): Record<string, unknown> {
  const { plan } = input;
  return landBlow({
    ...input,
    campaign: plan.campaign,
    turn: plan.turn,
    encounter: plan.encounter,
    enemy: plan.enemy,
    sheets: plan.sheets,
    sheetsById: plan.sheetsById,
    profile: plan.profile,
    typedRiders: liveTypedRiders(input.typedRiders, plan.droppedRiders),
    magical: strikesAsMagic(plan),
    nonlethal: plan.options.nonlethal,
    ignoreResistance: plan.elementalAdept,
    concentrationDisadvantage: plan.mageSlayer,
  });
}

// One blow landing on an enemy, per damage type: the shared end of
// pc_attack's digital path and a character's opportunity attack.
export function landBlow(input: {
  campaign: AttackPlan["campaign"];
  turn: AttackPlan["turn"];
  encounter: AttackPlan["encounter"];
  enemy: AttackPlan["enemy"];
  sheets: CharacterSheet[];
  sheetsById: Map<string, CharacterSheet>;
  profile: AttackProfile;
  typedRiders: TypedRider[];
  damageOutcome: RollResult;
  dealt: number;
  crit: boolean;
  critExtraDice: number;
  magical: boolean;
  // Elemental Adept covers this attack spell's type (feat-combat.ts).
  ignoreResistance?: boolean;
  // Mage Slayer's melee hit from within 5 feet (feat-combat.ts).
  concentrationDisadvantage?: boolean;
  nonlethal?: boolean;
  // An opportunity attack leaves the fight open (enemy-damage.ts).
  holdVictory?: boolean;
}): Record<string, unknown> {
  const { campaign, turn, encounter, enemy, sheets, sheetsById, profile, damageOutcome, dealt, crit, critExtraDice, magical } = input;
  // A silvered or adamantine weapon passes the resistances that name it.
  const material = weaponMaterial(profile.weapon);
  const nonlethal = input.nonlethal === true;
  const holdVictory = input.holdVictory === true;
  const unharmed = {
    ok: true,
    name: enemy.displayName,
    hp: `${enemy.currentHp}/${enemy.maxHp}`,
    damageApplied: 0,
  };
  const parts = damageParts(damageOutcome, profile.damageType, input.typedRiders, {
    crit,
    trailingTerms: crit ? critExtraDice : 0,
  });
  let applied: Record<string, unknown>;
  if (dealt <= 0) {
    applied = unharmed;
  } else if (parts.length < 2) {
    applied = applyEnemyDamage(
      campaign,
      turn,
      encounter,
      enemy,
      dealt,
      sheets,
      sheetsById,
      profile.damageType,
      { magical, nonlethal, holdVictory, ...material, ...(input.ignoreResistance ? { ignoreResistance: true } : {}), ...(input.concentrationDisadvantage ? { concentrationDisadvantage: true } : {}) },
    );
  } else {
    // Two damage types in one blow: each meets the creature's resistances
    // on its own, and what is left lands as one wound. A creature that
    // resists everything (petrified) is halved once, by applyEnemyDamage.
    const resistAll = resistsAllDamage(enemy.conditions);
    const byType = parts.map((part, index) => ({
      ...part,
      ...damageAdjust(
        part.amount,
        part.type,
        resistAll ? "" : resistLineFor(campaign.id, enemy),
        enemy.stats.immune,
        enemy.stats.vulnerable,
        { magical: index === 0 ? magical : true, ...(index === 0 ? material : {}) },
      ),
    }));
    const landed = byType.reduce((sum, part) => sum + part.amount, 0);
    applied =
      landed > 0
        ? applyEnemyDamage(campaign, turn, encounter, enemy, landed, sheets, sheetsById, undefined, {
            magical: true,
            nonlethal,
            holdVictory,
            ...(input.concentrationDisadvantage ? { concentrationDisadvantage: true } : {}),
          })
        : unharmed;
    applied = {
      ...applied,
      damageApplied: resistAll ? Math.floor(landed / 2) : landed,
      damageByType: byType.map(
        (part) => `${part.amount} ${part.type || "untyped"}${part.note ? ` (${part.note})` : ""}`,
      ),
    };
  }
  return applied;
}
