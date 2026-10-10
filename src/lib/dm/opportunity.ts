import { evadesOpportunityAttacksAfterMelee, MOBILE_ATTACKED, polearmReachOpportunity } from "@/lib/srd/feat-combat";
import { budgetFor } from "@/lib/dm/turn-budget";
import { allocateSeq, type Campaign } from "@/lib/db/campaigns";
import { insertCampaignMessage } from "@/lib/db/messages";
import { getActiveEncounter, listEnemies, saveEncounter } from "@/lib/db/encounters";
import { getBattleMapForEncounter, getTokenByRef } from "@/lib/db/battle-maps";
import { getSheetById, listSheets, patchSheet } from "@/lib/db/sheets";
import { insertRoll } from "@/lib/db/rolls";
import { rollAgainst } from "@/lib/roll-labels";
import { chebyshev } from "@/lib/battlemap/types";
import { d20Expression, rollExpression } from "@/lib/dice";
import { publishWithSeq } from "@/lib/events";
import {
  adjudicateHit,
  resolveAttackWeapon,
  weaponAttackProfile,
  weaponOf,
} from "@/lib/dm/attack-logic";
import { RAGING } from "@/lib/srd/class-resources";
import { computeSheetDerived } from "@/lib/srd";
import { matchWeapon } from "@/lib/srd/weapons";
import { magicWeaponOfRow } from "@/lib/dm/gear-attack";
import { combatRiders } from "@/lib/srd/feature-effects";
import { conditionBlocksReactions } from "@/lib/srd/condition-effects";
import { critDamageExpression } from "@/lib/dm/encounter-logic";

import { openLastHit } from "@/lib/dm/last-hit";
import {
  DODGING,
  attackContext,
  effectiveSpeed,
  mergeAdvantage,
  type ConditionMetaMap,
} from "@/lib/dm/condition-logic";
import { acWithEffects } from "@/lib/dm/ac-effects";
import { canAct, canEnemyAct } from "@/lib/dm/can-act";
import { opportunityReactionKey } from "@/lib/srd/authored-effects-more";
import { conditionsOf } from "@/lib/dm/vitals-logic";
import { lightOnAttack } from "@/lib/dm/attack-light";
import { opportunityWeapon } from "@/lib/dm/enemy-profile";
import { opportunitySight, pcOpportunitySwing, withOpportunityTurn } from "@/lib/dm/opportunity-strike";
import { martialArtsApplies } from "@/lib/dm/pc-attack-options";
import { applyPcDamage } from "@/lib/dm/pc-damage";
import { blowByType, resolveOnHit } from "@/lib/dm/enemy-hit";
import { hasTrait } from "@/lib/dm/monster-abilities";
import { enfeebledBlow, spellRetort } from "@/lib/dm/spell-retort";

// Opportunity attacks: walking out of an enemy's reach is not free. Before
// this, a player could stroll away from a troll with no consequence at all,
// which is the single most-noticed missing rule in 5e combat.
//
// Resolved here rather than through handleEnemyAttack because the trigger
// fires from the player's own token-move route, which has no DM turn to
// hang tool calls on. The outcome posts as a table note, exactly like the
// death saves the server rolls between turns.
//
// The move is walked square by square: what provokes is LEAVING a reach,
// wherever the move began and ended, so a runner who passes a guard in a
// corridor is struck as they go by.

type XY = { x: number; y: number };

function tableNote(campaign: Campaign, content: string) {
  const seq = allocateSeq(campaign.id);
  const message = insertCampaignMessage({
    campaignId: campaign.id,
    seq,
    authorType: "system",
    content,
  });
  publishWithSeq(campaign.id, seq, "message_added", { message });
}

export type OpportunityOutcome = {
  notes: string[];
  downed: boolean;
  // Where the mover fell, when an attack on the way brought them to 0: the
  // last square they stood on inside the reach they were leaving.
  downedAt?: XY;
};

// The square a walker stood on when they left this reach, or null when the
// walk never leaves it. `steps` is every square of the walk in order, the
// starting one first.
// The square a walk enters a reactor's reach at, or null when it never
// does: Polearm Master's opportunity attack on a creature coming in.
export function entersReachAt(steps: XY[], reactor: XY, reach: number): XY | null {
  for (let index = 0; index + 1 < steps.length; index += 1) {
    const here = steps[index];
    const next = steps[index + 1];
    if (
      chebyshev(reactor.x, reactor.y, here.x, here.y) > reach &&
      chebyshev(reactor.x, reactor.y, next.x, next.y) <= reach
    ) {
      return next;
    }
  }
  return null;
}

export function leavesReachAt(steps: XY[], reactor: XY, reach: number): XY | null {
  for (let index = 0; index + 1 < steps.length; index += 1) {
    const here = steps[index];
    const next = steps[index + 1];
    if (
      chebyshev(reactor.x, reactor.y, here.x, here.y) <= reach &&
      chebyshev(reactor.x, reactor.y, next.x, next.y) > reach
    ) {
      return here;
    }
  }
  return null;
}

const lowered = (conditions: string[]) => conditions.map((entry) => entry.toLowerCase());
const cannotSee = (conditions: string[]) => lowered(conditions).includes("blinded");
const cannotBeSeen = (conditions: string[]) =>
  lowered(conditions).some((entry) => entry === "invisible" || entry === "hidden");

// Dodge is lost with the dodger's speed (SRD 5.1, Dodge): a grappled or
// restrained dodger puts nobody at disadvantage.
export function withLiveDodge(conditions: string[]): string[] {
  if (effectiveSpeed(conditions, 30) > 0) {
    return conditions;
  }
  return conditions.filter((entry) => entry.toLowerCase() !== DODGING);
}

// Resolves the opportunity attacks a character's move provokes, applying
// damage and posting table notes. `disengaged` suppresses all of them.
// `path` is the walk, square by square after the starting one; without it
// the move is read as one step from `from` to `to`.
export function resolveOpportunityAttacks(
  campaign: Campaign,
  characterId: string,
  from: XY,
  to: XY,
  disengaged: boolean,
  path?: XY[],
): OpportunityOutcome {
  const empty: OpportunityOutcome = { notes: [], downed: false };
  if (disengaged) {
    return empty;
  }
  const encounter = getActiveEncounter(campaign.id);
  if (!encounter) {
    return empty;
  }
  const map = getBattleMapForEncounter(encounter.id);
  if (!map) {
    return empty;
  }
  const steps = [from, ...(path?.length ? path : [to])];
  const notes: string[] = [];
  let downed = false;
  let downedAt: XY | undefined;

  for (const enemy of listEnemies(encounter.id)) {
    // The reacting side must be able to react (Shocking Grasp and Slow take
    // the reaction away), and to see who is leaving.
    if (
      !canEnemyAct({ enemy, encounter, kind: "reaction" }).ok ||
      conditionBlocksReactions(enemy.conditions) ||
      cannotSee(enemy.conditions)
    ) {
      continue;
    }
    if (encounter.reactionsUsed.includes(enemy.id)) {
      continue;
    }
    const token = getTokenByRef(map.id, enemy.id);
    if (!token) {
      continue;
    }
    // An opportunity attack is a melee attack: the block's first melee
    // attack, at its reach. A creature with only a bow makes none.
    const weapon = opportunityWeapon(enemy.stats);
    if (!weapon) {
      continue;
    }
    const { attack, reachTiles: reach } = weapon;
    const leftFrom = leavesReachAt(steps, token, reach);
    if (!leftFrom) {
      continue;
    }

    const sheet = getSheetById(characterId);
    if (!sheet || sheet.currentHp <= 0) {
      break;
    }
    if (cannotBeSeen(sheet.conditions)) {
      continue;
    }
    // Mobile (and Skirmisher): a creature they attacked in melee this turn
    // makes no opportunity attack against them (pc-attack-spend.ts marks it).
    const moverBudget = budgetFor(encounter, characterId, 1);
    if (moverBudget?.oncePerTurn.includes(`${MOBILE_ATTACKED}${enemy.id}`)) {
      notes.push(`${enemy.displayName} gets no opportunity attack on ${sheet.name}: ${evadesOpportunityAttacksAfterMelee(sheet) ?? "Mobile"} (attacked in melee this turn).`);
      continue;
    }
    // Only a creature it can see provokes it: in the dark, with no
    // darkvision and no light, the leaver slips away (attack-light.ts).
    const sight = opportunitySight({ campaignId: campaign.id, encounterId: encounter.id, enemy, sheet, enemyReacts: true });
    if (sight && !sight.attackerSees) {
      continue;
    }
    // The reaction is spent whether or not the swing lands.
    encounter.reactionsUsed = [...encounter.reactionsUsed, enemy.id];
    saveEncounter(encounter);

    // An attack roll like any other: both sides' conditions decide it.
    const context = attackContext({
      attackerConditions: enemy.conditions,
      targetConditions: withLiveDodge(conditionsOf(sheet)),
      melee: true,
      adjacent: reach <= 1,
      requested: "none",
    });
    const light = lightOnAttack(sight, { attacker: enemy.displayName, target: sheet.name });
    // Escape the Horde (a Hunter ranger's Defensive Tactics): opportunity
    // attacks against them are made at disadvantage.
    const escapes = sheet.features.some((feature) => /escape the horde/i.test(feature.name));
    const advantage = mergeAdvantage([
      context.advantage,
      ...light.sources,
      ...(escapes ? ["disadvantage" as const] : []),
    ]);
    const targetAc = acWithEffects(campaign.id, sheet);
    const hitOutcome = rollExpression(d20Expression(attack.toHit, advantage));
    const hitRoll = insertRoll({
      campaignId: campaign.id,
      characterId: null,
      requestedBy: "dm",
      kind: "attack",
      detail: rollAgainst(`${attack.name} (opportunity attack)`, sheet.name),
      advantage,
      result: hitOutcome,
      attacker: { kind: "enemy", id: enemy.id, name: enemy.displayName },
    });
    publishWithSeq(campaign.id, allocateSeq(campaign.id), "roll_result", {
      roll: hitRoll,
      source: "digital",
    });
    const adjudicated = adjudicateHit(hitOutcome.total, hitOutcome.crit, targetAc);
    if (!adjudicated.hit) {
      notes.push(
        `${enemy.displayName} takes an opportunity attack as ${sheet.name} pulls away and misses (${hitOutcome.total} vs AC ${targetAc}).`,
      );
      continue;
    }
    const crit = adjudicated.crit || context.autoCrit;

    const damageOutcome = rollExpression(
      crit
        ? critDamageExpression(attack.damage, 0, {
            powerfulCritical: campaign.gameSettings.variantRules.powerfulCritical,
            multiplyNumeric: campaign.gameSettings.variantRules.criticalDamageMods,
          })
        : attack.damage,
    );
    const damageRoll = insertRoll({
      campaignId: campaign.id,
      characterId: null,
      requestedBy: "dm",
      kind: "damage",
      detail: rollAgainst(`${attack.name} (opportunity attack)`, sheet.name),
      result: damageOutcome,
      attacker: { kind: "enemy", id: enemy.id, name: enemy.displayName },
    });
    publishWithSeq(campaign.id, allocateSeq(campaign.id), "roll_result", {
      roll: damageRoll,
      source: "digital",
    });

    // Kept so a reaction can answer the hit (src/lib/dm/last-hit.ts).
    const hitLog = openLastHit(campaign.id, sheet.id);
    // The same hit as enemy_attack lands (enemy-attack.ts): each damage type
    // meets the target's resistances on its own, Magic Weapons make the blow
    // magical, Ray of Enfeeblement halves it, and the rider the attack
    // prints (a save or be knocked prone, poison, a grapple) is resolved.
    // Damage like any other (src/lib/dm/pc-damage.ts): resistances, temporary
    // hit points, a beast form's pool first, Relentless Endurance, the rage
    // ending at 0, the death engine, and the concentration save.
    const magical = hasTrait(enemy.stats, "magicWeapons");
    const blow = blowByType(attack, damageOutcome, sheet, crit, magical);
    const rolled = enfeebledBlow(enemy, attack, false, Math.max(0, blow.amount));
    const { landed, onHit } = withOpportunityTurn(campaign.id, (turn) => {
      const hitSheets = listSheets(campaign.id);
      const hitSheetsById = new Map(hitSheets.map((entry) => [entry.id, entry]));
      const applied: Record<string, unknown> =
        rolled > 0
          ? applyPcDamage(campaign, turn.id, sheet, {
              amount: rolled,
              ...(blow.type ? { type: blow.type } : {}),
              ...(magical ? { magical: true } : {}),
              crit,
              reason: `opportunity attack from ${enemy.displayName}`,
            })
          : {};
      const rider = resolveOnHit(campaign, turn, enemy, attack, sheet.id, { sheets: hitSheets, sheetsById: hitSheetsById });
      spellRetort(campaign, turn, enemy, sheet.id, true, reach <= 1, hitSheets, hitSheetsById);
      return { landed: applied, onHit: rider };
    });
    const updated = getSheetById(sheet.id);
    hitLog.swing(hitOutcome, targetAc, { hit: true, crit, raw: rolled, advantage, ...(blow.type ? { type: blow.type } : {}) });
    hitLog.close({ attacker: { kind: "enemy", id: enemy.id, name: enemy.displayName }, attack: `${attack.name} (opportunity attack)`, type: attack.type, ranged: false });
    if (updated && updated.currentHp <= 0 && !updated.wildShape) {
      downed = true;
      downedAt = leftFrom;
    }
    const byType = blow.byType ? ` (${blow.byType.join(", ")})` : typeof landed.resistance === "string" ? ` (${landed.resistance})` : "";
    const riderNote = Array.isArray(onHit?.riderCondition) ? ` ${sheet.name} is ${(onHit.riderCondition as string[]).join(" and ")}.` : "";
    notes.push(
      `${enemy.displayName} takes an opportunity attack as ${sheet.name} pulls away: ${
        crit ? "a critical hit for " : "hit for "
      }${rolled} damage${byType}.${riderNote}`,
    );
    if (downed) {
      break;
    }
  }

  for (const note of notes) {
    tableNote(campaign, note);
  }
  return { notes, downed, ...(downedAt ? { downedAt } : {}) };
}

function stokeRage(sheet: NonNullable<ReturnType<typeof getSheetById>>) {
  const ragingAs = sheet.conditions.find((entry) => entry.trim().toLowerCase() === RAGING);
  if (!ragingAs) {
    return;
  }
  const meta = sheet.conditionMeta as ConditionMetaMap;
  patchSheet(sheet.id, {
    conditionMeta: { ...meta, [ragingAs]: { ...meta[ragingAs], stoked: true } },
  });
}

// The melee weapon a character strikes with when something walks away from
// them: the best one they carry. A character carrying only a bow has no
// opportunity attack to make. A magic weapon is its base weapon (a Flame
// Tongue is a longsword, src/lib/dm/gear-attack.ts).
function meleeWeaponFor(sheet: NonNullable<ReturnType<typeof getSheetById>>) {
  const weaponFor = (item: (typeof sheet.equipment)[number]) =>
    magicWeaponOfRow(item).srd ?? weaponOf(item) ?? matchWeapon(item.name);
  const melee = sheet.equipment.filter((item) => {
    const weapon = weaponFor(item);
    return weapon !== null && weapon.kind === "melee";
  });
  const carriesWeapon = sheet.equipment.some((item) => weaponFor(item) !== null);
  if (!melee.length && carriesWeapon) {
    return null;
  }
  return resolveAttackWeapon(melee, sheet.proficiencies.weapons, undefined);
}

// The other side of the same rule: an enemy that walks out of a character's
// reach eats a melee attack from them. Fires wherever an enemy walks (the
// DM's move_token and the approach enemy_attack makes), and spends the
// character's reaction out of the same list the enemy side uses.
export function resolvePcOpportunityAttacks(
  campaign: Campaign,
  enemyId: string,
  from: XY,
  to: XY,
  path?: XY[],
): string[] {
  const encounter = getActiveEncounter(campaign.id);
  if (!encounter) {
    return [];
  }
  const map = getBattleMapForEncounter(encounter.id);
  if (!map) {
    return [];
  }
  const steps = [from, ...(path?.length ? path : [to])];
  const notes: string[] = [];

  for (const stale of listSheets(campaign.id)) {
    const sheet = getSheetById(stale.id) ?? stale;
    if (
      !canAct({ sheet, encounter, kind: "reaction" }).ok ||
      conditionBlocksReactions(sheet.conditions) ||
      cannotSee(sheet.conditions)
    ) {
      continue;
    }
    // Vigilant Defender: a reaction for each other creature's turn
    // (src/lib/srd/authored-effects-more.ts).
    const reactionKey = opportunityReactionKey(sheet, sheet.id, enemyId);
    if (encounter.reactionsUsed.includes(reactionKey)) {
      continue;
    }
    const token = getTokenByRef(map.id, sheet.id);
    if (!token) {
      continue;
    }
    const resolved = meleeWeaponFor(sheet);
    if (!resolved) {
      continue;
    }
    const derived = computeSheetDerived(sheet);
    const riders = combatRiders(sheet);
    const profile = weaponAttackProfile(derived, sheet.proficiencies.weapons, resolved, {
      riders,
      martialArts: martialArtsApplies(sheet),
    });
    if (profile.ranged) {
      continue;
    }
    // Polearm Master: a creature entering the polearm's reach provokes too.
    const entering = polearmReachOpportunity(sheet, resolved.displayName) ? entersReachAt(steps, token, profile.reachTiles) : null;
    if (!leavesReachAt(steps, token, profile.reachTiles) && !entering) {
      continue;
    }

    const enemy = listEnemies(encounter.id).find((entry) => entry.id === enemyId);
    if (!enemy || enemy.status !== "alive") {
      break;
    }
    if (cannotBeSeen(enemy.conditions)) {
      continue;
    }
    // Only a creature they can see provokes it (attack-light.ts).
    const sight = opportunitySight({ campaignId: campaign.id, encounterId: encounter.id, enemy, sheet, enemyReacts: false });
    if (sight && !sight.attackerSees) {
      continue;
    }
    encounter.reactionsUsed = [...encounter.reactionsUsed, reactionKey];
    saveEncounter(encounter);
    // SRD 5.1, Rage: an attack on a hostile creature since the barbarian's
    // last turn keeps the rage going, and this swing is one, hit or miss.
    // The turn budget only knows the barbarian's own turn, so the rage is
    // marked the way an off-turn pc_attack marks it (condition-tick.ts
    // endTurnRage reads the mark).
    stokeRage(sheet);

    // The swing itself, with everything their attack carries
    // (src/lib/dm/opportunity-strike.ts).
    const { note, dropped } = pcOpportunitySwing({
      campaign,
      encounter,
      sheet,
      enemy,
      resolved,
      adjacent: profile.reachTiles <= 1,
      targetConditions: withLiveDodge(enemy.conditions),
    });
    notes.push(note);
    if (dropped) {
      break;
    }
  }

  for (const note of notes) {
    tableNote(campaign, note);
  }
  return notes;
}
