// The creatures fighting beside an attacker, by its side and not by its kind
// (issue 503, Phase 6). Martial Advantage and Pack Tactics ask for an ally of
// the attacker next to its target (SRD 5.1); a goblin's allies are the foes'
// side (its kin, and a companion who turned on the party), not a goblin the
// party dominates, and a dominated ogre's are the party.
//
// Database reads only: enemy-attack.ts, enemy-strike.ts and
// enemy-swing-odds.ts ask it for every swing of a stat block's routine.

import { getEncounter } from "@/lib/db/encounters";
import { tilesBetween } from "@/lib/dm/attack-spatial";
import type { CombatantKind } from "@/lib/dm/combat-sides-logic";
import { combatantDefeated, combatantsOf, sideOf } from "@/lib/dm/combatant";
import { incapacitatedBy } from "@/lib/dm/condition-logic";
import { martialAdvantageDice, surpriseAttackDice } from "@/lib/dm/monster-traits";

// Whether an ally of the attacker, up and able, stands within 5 feet of the
// target: any combatant of its side but itself and the target.
export function allyBeside(encounterId: string, attacker: { kind: CombatantKind; id: string }, targetRef: string): boolean {
  const encounter = getEncounter(encounterId);
  if (!encounter) {
    return false;
  }
  const mine = sideOf(encounter, attacker.kind, attacker.id);
  return combatantsOf(encounter.campaignId, encounter).some((ally) => {
    if (ally.id === attacker.id || ally.id === targetRef || ally.side !== mine || combatantDefeated(ally)) {
      return false;
    }
    const conditions = ally.kind === "enemy" ? ally.enemy.conditions : ally.sheet.conditions;
    return !incapacitatedBy(conditions) && (tilesBetween(encounterId, ally.id, targetRef) ?? Infinity) <= 1;
  });
}

// The dice a stat block's trait adds to a hit: Martial Advantage (a weapon
// hit on a creature within 5 feet of one of its allies that isn't
// incapacitated, once a turn) and Surprise Attack (a hit on a creature it
// surprised, in the first round). Whatever the target is.
export function hitTraitDice(
  encounter: { id: string; round: number; surprisedIds: string[] },
  enemy: { id: string; stats: { traits?: string[] } },
  targetId: string,
  attack: { spellAttack?: boolean },
  martialSpent: boolean,
): { dice: string[]; martial: boolean } {
  const dice: string[] = [];
  let martial = false;
  const martialDice = martialAdvantageDice(enemy.stats);
  if (martialDice && !martialSpent && !attack.spellAttack && allyBeside(encounter.id, { kind: "enemy", id: enemy.id }, targetId)) {
    dice.push(martialDice);
    martial = true;
  }
  const surprise = surpriseAttackDice(enemy.stats);
  if (surprise && encounter.round === 1 && encounter.surprisedIds.includes(targetId)) {
    dice.push(surprise);
  }
  return { dice, martial };
}
