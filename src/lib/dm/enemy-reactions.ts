// A monster's reaction the engine takes for it when the moment comes, the
// way a DM running the creature always would (SRD 5.1, Monsters: Reactions).
// Parry: "The captain adds 2 to its AC against one melee attack that would
// hit it. To do so, the captain must see the attacker and be wielding a
// melee weapon." A natural 20 hits whatever the AC. The reaction is the
// creature's one a round (the same list opportunity attacks spend).

import { saveEncounter, type Encounter, type EncounterEnemy } from "@/lib/db/encounters";
import { canEnemyAct } from "@/lib/dm/can-act";
import { conditionBlocksReactions } from "@/lib/srd/condition-effects";
import { enemyAttackProfile } from "@/lib/dm/enemy-profile";

// The AC a block's Parry adds, or null when it has none.
export function parryBonus(stats: { traits?: string[] }): number | null {
  for (const line of stats.traits ?? []) {
    const found = /^reaction:\s*parry\b[^.]*\.\s*[^.]*?\badds (\d{1,2}) to its ac\b/i.exec(line.trim());
    if (found) {
      return Number(found[1]);
    }
  }
  return null;
}

// Parries a melee hit when the bonus turns it into a miss: spends the
// reaction and returns the note, or null when it does not (or cannot).
export function tryParry(input: {
  encounter: Encounter;
  enemy: EncounterEnemy;
  total: number;
  natural20: boolean;
  ac: number;
  melee: boolean;
  attackerUnseen: boolean;
}): { bonus: number; note: string } | null {
  const { encounter, enemy } = input;
  const bonus = parryBonus(enemy.stats);
  if (!bonus || !input.melee || input.natural20 || input.total < input.ac || input.total >= input.ac + bonus) {
    return null;
  }
  const blinded = enemy.conditions.some((entry) => entry.trim().toLowerCase() === "blinded");
  const wieldsMelee = enemy.stats.attacks.some((attack) => enemyAttackProfile(attack, enemy.stats.traits ?? []).melee);
  if (
    input.attackerUnseen ||
    blinded ||
    !wieldsMelee ||
    encounter.reactionsUsed.includes(enemy.id) ||
    conditionBlocksReactions(enemy.conditions) ||
    !canEnemyAct({ enemy, encounter, kind: "reaction" }).ok
  ) {
    return null;
  }
  encounter.reactionsUsed = [...encounter.reactionsUsed, enemy.id];
  saveEncounter(encounter);
  return {
    bonus,
    note: `${enemy.displayName} parries (its reaction): +${bonus} AC turns ${input.total} against AC ${input.ac} into a miss`,
  };
}
