// A character sheet read as a stat block (issue 503): the numbers an enemy
// row carries, built from the sheet's own derivations, so everything that
// reads a foe's block (an attack's advantage, Divine Smite's undead check, a
// rider's size limit, the encounter's rating) reads a character who fights
// against the party the same way. Phase 2 of the issue rates a wavering
// companion as a foe through deriveCr with this; Phase 6 gives the foe view
// (src/lib/dm/sheet-foe.ts) its block.
//
// The block carries no resistances, immunities or vulnerabilities: damage to
// a sheet always lands through the sheet's own damage path
// (src/lib/dm/pc-damage.ts), which applies them, and a block that carried
// them too would halve a blow twice. A summon is its stat block already
// (summon-rules.ts enemyStatsFromSummon).
//
// No database access.

import type { EnemyAttack, EnemyStats } from "@/lib/bestiary/statblock";
import { deriveCr } from "@/lib/bestiary/derive-cr";
import { resolveAttackWeapon, weaponAttackProfile } from "@/lib/dm/attack-logic";
import { enemyStatsFromSummon } from "@/lib/dm/summon-rules";
import { attacksAllowedFor } from "@/lib/dm/turn-budget";
import { acBreakdownFor, computeSheetDerived, sizeForRace } from "@/lib/srd";
import { combatRiders } from "@/lib/srd/feature-effects";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// ODM keeps no size on a sheet: the race says it (srd sizeForRace).
export function sheetSize(sheet: Pick<CharacterSheet, "race">): string {
  return sizeForRace(sheet.race);
}

// The best weapon the sheet carries as the block's attack, or an unarmed
// strike for one carrying none.
function weaponAttack(sheet: CharacterSheet, derived: ReturnType<typeof computeSheetDerived>): EnemyAttack {
  try {
    const resolved = resolveAttackWeapon(sheet.equipment, sheet.proficiencies.weapons, undefined, {
      shieldOnArm: acBreakdownFor(sheet).shieldName !== null,
    });
    const profile = weaponAttackProfile(derived, sheet.proficiencies.weapons, resolved, { riders: combatRiders(sheet) });
    return {
      name: profile.weapon,
      toHit: profile.toHit,
      damage: profile.damageExpression,
      type: profile.damageType,
      mode: profile.ranged ? "ranged" : profile.thrown ? "both" : "melee",
    };
  } catch {
    const str = derived.abilityMods.str;
    return { name: "Unarmed strike", toHit: str + derived.proficiencyBonus, damage: `${Math.max(1, 1 + str)}`, type: "bludgeoning", mode: "melee" };
  }
}

export function sheetEnemyStats(sheet: CharacterSheet): EnemyStats {
  if (sheet.summon) {
    return enemyStatsFromSummon(sheet);
  }
  const derived = computeSheetDerived(sheet);
  const attack = weaponAttack(sheet, derived);
  const base: EnemyStats = {
    ac: sheet.ac,
    maxHp: sheet.maxHp,
    dexMod: derived.abilityMods.dex,
    saveMods: { ...derived.saves },
    speed: `${sheet.speed} ft.`,
    attacks: [attack],
    traits: [],
    resist: "",
    immune: "",
    vulnerable: "",
    conditionImmune: "",
    cr: 0,
    xp: 0,
    attacksPerTurn: Math.max(1, attacksAllowedFor(sheet)),
    size: sheetSize(sheet),
    type: "humanoid",
    abilities: { ...sheet.abilities },
    skills: { ...derived.skills },
    senses: { passivePerception: derived.passivePerception },
    ...(sheet.alignment ? { alignment: sheet.alignment } : {}),
  };
  // Rated as the DMG rates a monster: its hit points and AC against its
  // attack routine. A caster's best spell is Phase 2's to add
  // (extraDamagePerRound); the weapon routine alone is a floor.
  const rated = deriveCr(base);
  return { ...base, cr: rated.cr, xp: rated.xp };
}
