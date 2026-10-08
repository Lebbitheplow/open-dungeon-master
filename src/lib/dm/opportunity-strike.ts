// The attack itself of an opportunity attack, for both sides, once
// opportunity.ts has found that one is provoked and spent the reaction. An
// opportunity attack is an attack like any other (SRD 5.1): the enemy's
// blow runs the whole damage path a character takes damage by
// (src/lib/dm/pc-damage.ts), and a character's swing carries what their
// attack carries on their own turn (Rage, a magic weapon, Sneak Attack,
// Hunter's Mark, Bless) and lands through applyEnemyDamage, so a creature it
// kills leaves the board and its concentration is tested. The fight itself
// stays open when the last foe falls to one: its end and XP wait for the
// DM's next turn (ODM's rule).
//
// The move route that provokes these has no DM turn, and the damage paths
// keep their rolls and audit rows on one, so a short human-DM turn is
// opened for the swing and closed with it.

import { hasSentinel } from "@/lib/srd/feat-combat";
import { tryParry } from "@/lib/dm/enemy-reactions";
import { allocateSeq, type Campaign } from "@/lib/db/campaigns";
import { createDmTurn, saveDmTurn, type DmTurn } from "@/lib/db/dm-turns";
import { getEnemy, patchEnemyConditions, type Encounter, type EncounterEnemy } from "@/lib/db/encounters";
import { insertRoll, markRollApplied } from "@/lib/db/rolls";
import { rollAgainst } from "@/lib/roll-labels";
import { getSheetById, listSheets, patchSheet } from "@/lib/db/sheets";
import { d20Expression, rollExpression, type Advantage } from "@/lib/dice";
import { publishPersisted, publishWithSeq } from "@/lib/events";
import { healthState } from "@/lib/bestiary/health";
import { enemyAcWithEffects } from "@/lib/dm/ac-effects";
import { attackSight, characterSenses, enemySenses, lightOnAttack } from "@/lib/dm/attack-light";
import { adjudicateHit, weaponAttackProfile, type ResolvedWeapon } from "@/lib/dm/attack-logic";
import { invisibilityEndedByAction, planMarks, writeMarks } from "@/lib/dm/attack-marks";
import {
  attackContext,
  exhaustionRollState,
  mergeAdvantage,
  removeConditions,
} from "@/lib/dm/condition-logic";
import { critDamageExpression } from "@/lib/dm/encounter-logic";
import { publishEncounter } from "@/lib/dm/enemy-damage";
import { martialArtsApplies } from "@/lib/dm/pc-attack-options";
import { shillelaghSwing } from "@/lib/dm/attack-features";
import { gearCritRiders, itemRidersAgainst } from "@/lib/dm/gear-attack";
import { foldDamageRiders, landBlow, strikesAsMagic, withSneakAttack } from "@/lib/dm/pc-attack-damage";
import { clearHitSpent } from "@/lib/dm/pc-attack-riders";
import { computeSheetDerived } from "@/lib/srd";
import { conditionRollRiders } from "@/lib/srd/condition-effects";
import { conditionsSpentAgainst } from "@/lib/srd/condition-effect-queries";
import { combatRiders } from "@/lib/srd/feature-effects";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { markOpportunityHit } from "@/lib/dm/authored-reactions-more";

// A turn for the swing's rolls and audit rows, closed as soon as it is used
// so nothing waits on it.
export function withOpportunityTurn<T>(campaignId: string, run: (turn: DmTurn) => T): T {
  const turn = createDmTurn(campaignId, [], "human_dm");
  try {
    return run(turn);
  } finally {
    turn.status = "done";
    saveDmTurn(turn);
  }
}

function publishRoll(campaignId: string, roll: ReturnType<typeof insertRoll>) {
  publishWithSeq(campaignId, allocateSeq(campaignId), "roll_result", { roll, source: "digital" });
}

// The light between a reactor and the creature leaving: null off the board.
export function opportunitySight(input: {
  campaignId: string;
  encounterId: string;
  enemy: EncounterEnemy;
  sheet: CharacterSheet;
  enemyReacts: boolean;
}) {
  const enemySide = { refId: input.enemy.id, senses: enemySenses(input.enemy) };
  const sheetSide = { refId: input.sheet.id, senses: characterSenses(input.sheet) };
  return attackSight({
    campaignId: input.campaignId,
    encounterId: input.encounterId,
    attacker: input.enemyReacts ? enemySide : sheetSide,
    target: input.enemyReacts ? sheetSide : enemySide,
  });
}

// A character's opportunity attack on an enemy breaking away. Returns the
// table line.
export function pcOpportunitySwing(input: {
  campaign: Campaign;
  encounter: Encounter;
  sheet: CharacterSheet;
  enemy: EncounterEnemy;
  resolved: ResolvedWeapon;
  adjacent: boolean;
  // The target's conditions as the swing meets them (a Dodge lost with its
  // speed already left out, opportunity.ts withLiveDodge).
  targetConditions: string[];
}): { note: string; dropped: boolean } {
  const { campaign, encounter, sheet, enemy, resolved } = input;
  const derived = computeSheetDerived(sheet);
  const riders = combatRiders(sheet);
  const shillelagh = shillelaghSwing(sheet, resolved, derived);
  let profile = weaponAttackProfile(shillelagh?.derived ?? derived, sheet.proficiencies.weapons, shillelagh?.resolved ?? resolved, {
    riders,
    martialArts: martialArtsApplies(sheet),
  });
  if (shillelagh) {
    profile = { ...profile, magicWeapon: true };
  }
  // What rides the swing, as on the character's own turn: Rage, the on-hit
  // dice of their effects (a mark only on its creature), their features.
  const marks = planMarks({ sheet, enemy, encounterEnemies: [enemy], budget: null });
  const folded = foldDamageRiders({
    campaignId: campaign.id,
    sheet,
    profile,
    riders,
    kind: "weapon",
    enemy,
    marked: marks.applies,
  });
  // A magic weapon's dice against this creature, each kept at its own type
  // (a Flame Tongue's fire), as on the character's own turn
  // (src/lib/dm/gear-attack.ts).
  const gear = itemRidersAgainst(folded.profile, enemy.stats.type, false);
  profile = gear.profile;
  const typedRiders = [...folded.typedRiders, ...gear.typed];

  const context = attackContext({
    attackerConditions: sheet.conditions,
    targetConditions: input.targetConditions,
    melee: true,
    adjacent: input.adjacent,
    requested: "none",
  });
  const light = lightOnAttack(
    opportunitySight({ campaignId: campaign.id, encounterId: encounter.id, enemy, sheet, enemyReacts: false }),
    { attacker: sheet.name, target: enemy.displayName },
  );
  const attackRiders = conditionRollRiders(sheet.conditions, "attack");
  const advantage: Advantage = mergeAdvantage([
    context.advantage,
    exhaustionRollState(sheet.exhaustion ?? 0, "attack").advantage,
    ...light.sources,
    ...attackRiders.advantageSources,
    ...(folded.attackEffect.advantage ? ["advantage" as const] : []),
    ...(folded.attackEffect.disadvantage ? ["disadvantage" as const] : []),
  ]);
  const notes: string[] = [];
  profile = withSneakAttack({
    encounterId: encounter.id,
    sheetId: sheet.id,
    enemyId: enemy.id,
    profile,
    riders,
    advantage,
    notes,
  }).profile;

  const targetAc = enemyAcWithEffects(campaign.id, enemy);
  const hitOutcome = rollExpression(`${d20Expression(profile.toHit, advantage)}${attackRiders.diceSuffix}`);
  const hitRoll = insertRoll({
    campaignId: campaign.id,
    characterId: sheet.id,
    requestedBy: "dm",
    kind: "attack",
    detail: rollAgainst(`${profile.weapon} (opportunity attack)`, enemy.displayName),
    advantage,
    result: hitOutcome,
    attacker: { kind: "sheet", id: sheet.id, name: sheet.name },
  });
  publishRoll(campaign.id, hitRoll);
  const judged = adjudicateHit(hitOutcome.total, hitOutcome.crit, targetAc, {
    natural: hitOutcome.natural,
    critRange: riders.critRange,
  });
  // Parry: the creature's reaction lifts its AC against a melee hit (enemy-reactions.ts).
  const parry = judged.hit && !judged.crit ? tryParry({ encounter, enemy, total: hitOutcome.total, natural20: false, ac: targetAc, melee: true, attackerUnseen: false }) : null;
  const adjudicated = parry ? { ...judged, hit: false, crit: false } : judged;
  spendAttackCarriers(campaign, sheet, enemy, attackRiders.spent);
  // Relentless Avenger answers the hit (src/lib/dm/authored-reactions-more.ts).
  if (adjudicated.hit) {
    markOpportunityHit(campaign, sheet);
    // Sentinel: the creature's speed is 0 for the rest of its turn.
    if (hasSentinel(sheet)) {
      const fresh = getEnemy(enemy.id);
      if (fresh && !fresh.conditions.includes("stopped")) {
        patchEnemyConditions(fresh.id, [...fresh.conditions, "stopped"], { ...fresh.conditionMeta, stopped: { source: sheet.id, untilTurnEndOf: enemy.id } });
        notes.push("Sentinel: its speed is 0 for the rest of the turn");
      }
    }
  }
  if (!adjudicated.hit) {
    return {
      note: `${sheet.name} swings at ${enemy.displayName} as it breaks away and misses (${hitOutcome.total} vs AC ${targetAc}${parry ? `; ${parry.note}` : ""}).`,
      dropped: false,
    };
  }
  const crit = adjudicated.crit || context.autoCrit;
  // A natural 20's magic weapon dice (a Vicious Weapon's 2d6).
  const critGear = hitOutcome.crit === "nat20" ? gearCritRiders(profile, enemy.stats.type) : null;
  if (critGear?.suffix) {
    profile = { ...profile, damageExpression: `${profile.damageExpression}${critGear.suffix}` };
    typedRiders.push(...critGear.typed);
  }
  clearHitSpent(campaign, sheet.id, folded.hitSpent);
  writeMarks(campaign.id, sheet.id, marks.assign);
  const damageOutcome = rollExpression(
    crit
      ? critDamageExpression(profile.damageExpression, riders.critExtraDice, {
          powerfulCritical: campaign.gameSettings.variantRules.powerfulCritical,
          multiplyNumeric: campaign.gameSettings.variantRules.criticalDamageMods,
        })
      : profile.damageExpression,
  );
  const dealt = Math.max(0, damageOutcome.total);
  return withOpportunityTurn(campaign.id, (turn) => {
    const damageRoll = insertRoll({
      campaignId: campaign.id,
      characterId: sheet.id,
      requestedBy: "dm",
      kind: "damage",
      detail: rollAgainst(`${profile.weapon} (opportunity attack)`, enemy.displayName),
      result: damageOutcome,
      attacker: { kind: "sheet", id: sheet.id, name: sheet.name },
    });
    publishRoll(campaign.id, damageRoll);
    const sheets = listSheets(campaign.id);
    const applied = landBlow({
      campaign,
      turn,
      encounter,
      enemy,
      sheets,
      sheetsById: new Map(sheets.map((entry) => [entry.id, entry])),
      profile,
      typedRiders,
      damageOutcome,
      dealt,
      crit,
      critExtraDice: riders.critExtraDice,
      magical: strikesAsMagic({ kind: "weapon", profile, riders, sheet }),
      holdVictory: true,
    });
    if (!("error" in applied)) {
      markRollApplied(damageRoll.id, enemy.id);
    }
    const after = getEnemy(enemy.id);
    const dropped = Boolean(applied.dead) || after?.status === "dead";
    const landed = typeof applied.damageApplied === "number" ? applied.damageApplied : dealt;
    return {
      note: `${sheet.name} catches ${enemy.displayName} with an opportunity attack as it breaks away: ${
        crit ? "a critical hit, " : ""
      }${landed} damage${notes.length ? ` (${notes.join("; ")})` : ""}. ${
        dropped
          ? `${enemy.displayName} drops.`
          : `It is now ${healthState(after?.currentHp ?? enemy.currentHp, enemy.maxHp)}.`
      }`,
      dropped,
    };
  });
}

// What the swing uses up: the attacker's hiding and Invisibility (an attack
// gives both away), their one-shot roll riders (True Strike), and the
// target's one-shot conditions (Guiding Bolt's advantage).
function spendAttackCarriers(campaign: Campaign, sheet: CharacterSheet, enemy: EncounterEnemy, riders: string[]) {
  const fresh = getSheetById(sheet.id) ?? sheet;
  const mine = [
    ...fresh.conditions.filter((entry) => entry.trim().toLowerCase() === "hidden"),
    ...invisibilityEndedByAction(fresh),
    ...riders,
  ];
  if (mine.length) {
    const cleared = removeConditions(fresh.conditions, fresh.conditionMeta, mine);
    const updated = patchSheet(sheet.id, { conditions: cleared.conditions, conditionMeta: cleared.meta });
    if (updated) {
      publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
    }
  }
  const theirs = conditionsSpentAgainst(enemy.conditions);
  if (theirs.length) {
    const target = getEnemy(enemy.id);
    if (target) {
      const cleared = removeConditions(target.conditions, target.conditionMeta, theirs);
      patchEnemyConditions(target.id, cleared.conditions, cleared.meta);
      publishEncounter(campaign.id);
    }
  }
}
