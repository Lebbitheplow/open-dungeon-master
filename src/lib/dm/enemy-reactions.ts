// A monster's reaction the engine takes for it when the moment comes, the
// way a DM running the creature always would (SRD 5.1, Monsters: Reactions).
// Parry: "The captain adds 2 to its AC against one melee attack that would
// hit it. To do so, the captain must see the attacker and be wielding a
// melee weapon." A natural 20 hits whatever the AC. The reaction is the
// creature's one a round (the same list opportunity attacks spend).
// The reaction spells its block lists are taken the same way: Shield when
// +5 AC turns a hit into a miss, Counterspell against a spell of 1st level
// or higher cast at its side within 60 feet (the SRD Mage, Archmage, Lich).

import { getEnemy, listEnemies, patchEnemyConditions, saveEncounter, type Encounter, type EncounterEnemy } from "@/lib/db/encounters";
import type { DmTurn } from "@/lib/db/dm-turns";
import { canEnemyAct } from "@/lib/dm/can-act";
import { conditionBlocksReactions } from "@/lib/srd/condition-effects";
import { enemyAttackProfile } from "@/lib/dm/enemy-profile";
import { findMonsterSpell, slotFor, spellUsesLeft, spendSlot, spendSpellUse, type AbilityLedger } from "@/lib/dm/monster-abilities";
import { tilesBetween } from "@/lib/dm/attack-spatial";
import { dmRoll } from "@/lib/dm/roll-card";
import type { ConditionMetaMap } from "@/lib/dm/condition-logic";

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

type DefenseInput = {
  encounter: Encounter;
  enemy: EncounterEnemy;
  total: number;
  natural20: boolean;
  ac: number;
  melee: boolean;
  attackerUnseen: boolean;
};

// The creature's defensive reaction against a hit, when one turns it into a
// miss: Parry, else the Shield spell. Spends the reaction (and Shield's
// slot) and returns the note, or null.
export function tryParry(input: DefenseInput): { bonus: number; note: string } | null {
  return parry(input) ?? shieldSpell(input);
}

// Whether the creature can take a reaction at all now.
function reactionFree(encounter: Encounter, enemy: EncounterEnemy): boolean {
  return (
    !encounter.reactionsUsed.includes(enemy.id) &&
    !conditionBlocksReactions(enemy.conditions) &&
    canEnemyAct({ enemy, encounter, kind: "reaction" }).ok
  );
}

// The slot or use a listed spell takes, or null when none is left.
function spellCost(enemy: EncounterEnemy, encounter: Encounter, spell: string, level: number): { slot: number; ledger: AbilityLedger } | null {
  const casting = enemy.stats.spellcasting;
  const listed = findMonsterSpell(casting, spell);
  if (!casting || !listed) {
    return null;
  }
  const ledger = encounter.legendary.abilities?.[enemy.id];
  if (listed.perDay) {
    return spellUsesLeft(ledger, listed) > 0 ? { slot: listed.level ?? level, ledger: spendSpellUse(ledger, listed.name) } : null;
  }
  if (!Object.keys(casting.slots).length) {
    // At will.
    return { slot: listed.level ?? level, ledger: ledger ?? {} };
  }
  const slot = slotFor(casting, ledger, level);
  return slot === null ? null : { slot, ledger: spendSlot(ledger, slot) };
}

// Shield (its block lists it): +5 AC until the start of its next turn,
// against the triggering attack too.
function shieldSpell(input: DefenseInput): { bonus: number; note: string } | null {
  const { encounter, enemy } = input;
  if (input.natural20 || input.total < input.ac || input.total >= input.ac + 5 || !reactionFree(encounter, enemy)) {
    return null;
  }
  const cost = spellCost(enemy, encounter, "Shield", 1);
  if (!cost) {
    return null;
  }
  encounter.reactionsUsed = [...encounter.reactionsUsed, enemy.id];
  encounter.legendary.abilities = { ...(encounter.legendary.abilities ?? {}), [enemy.id]: cost.ledger };
  saveEncounter(encounter);
  const fresh = getEnemy(enemy.id) ?? enemy;
  if (!fresh.conditions.includes("shielded")) {
    patchEnemyConditions(fresh.id, [...fresh.conditions, "shielded"], {
      ...(fresh.conditionMeta as ConditionMetaMap),
      shielded: { untilTurnOf: enemy.id, spell: "Shield", source: enemy.id },
    } as typeof fresh.conditionMeta);
  }
  return {
    bonus: 5,
    note: `${enemy.displayName} casts Shield (its reaction${cost.slot ? `, a level-${cost.slot} slot` : ""}): +5 AC until its next turn turns ${input.total} against AC ${input.ac} into a miss`,
  };
}

// Counterspell (its block lists it) against a spell of 1st level or higher
// a character casts at its side: the first creature that can see the
// caster within 60 feet, with its reaction and a slot, answers. A spell no
// higher than the slot fails; a higher one fails on the creature's
// spellcasting ability check, DC 10 + the spell's level. Returns what
// happened (the slot and reaction are spent either way), or null when no
// creature answers.
export function enemyCounterspell(
  campaignId: string,
  turn: DmTurn | null,
  encounter: Encounter,
  caster: { id: string; name: string; conditions: string[] },
  spell: string,
  level: number,
): { countered: boolean; note: string } | null {
  if (level < 1 || caster.conditions.some((entry) => /^(invisible|hidden)$/i.test(entry.trim()))) {
    return null;
  }
  for (const enemy of listEnemies(encounter.id)) {
    if (enemy.status !== "alive" || !findMonsterSpell(enemy.stats.spellcasting, "Counterspell")) {
      continue;
    }
    if (!reactionFree(encounter, enemy) || enemy.conditions.some((entry) => entry.trim().toLowerCase() === "blinded")) {
      continue;
    }
    const apart = tilesBetween(encounter.id, enemy.id, caster.id);
    if (apart !== null && apart > 12) {
      continue;
    }
    // The lowest slot that stops the spell outright, else the lowest at all.
    const cost = spellCost(enemy, encounter, "Counterspell", Math.max(3, level)) ?? spellCost(enemy, encounter, "Counterspell", 3);
    if (!cost) {
      continue;
    }
    encounter.reactionsUsed = [...encounter.reactionsUsed, enemy.id];
    encounter.legendary.abilities = { ...(encounter.legendary.abilities ?? {}), [enemy.id]: cost.ledger };
    saveEncounter(encounter);
    let countered = level <= cost.slot;
    let check = "";
    if (!countered) {
      const ability = enemy.stats.spellcasting?.ability ?? "int";
      const score = enemy.stats.abilities?.[ability] ?? 10;
      const mod = Math.floor((score - 10) / 2);
      const dc = 10 + level;
      const rolled = dmRoll(campaignId, turn, "ability_check", `${enemy.displayName}: Counterspell against ${spell} (${ability.toUpperCase()} check, DC ${dc})`, `1d20${mod >= 0 ? "+" : ""}${mod}`);
      countered = rolled.total >= dc;
      check = ` (${ability.toUpperCase()} check ${rolled.total} against DC ${dc})`;
    }
    return {
      countered,
      note: countered
        ? `${enemy.displayName} casts Counterspell (its reaction, a level-${cost.slot} slot)${check}: ${caster.name}'s ${spell} fails. The slot and the action ${caster.name} cast it with are spent; do not resolve the spell or cast it again.`
        : `${enemy.displayName} casts Counterspell (its reaction, a level-${cost.slot} slot)${check} and fails: ${caster.name}'s ${spell} goes ahead.`,
    };
  }
  return null;
}

// Parries a melee hit when the bonus turns it into a miss: spends the
// reaction and returns the note, or null when it does not (or cannot).
function parry(input: {
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
