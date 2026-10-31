import type { EncounterEnemy } from "@/lib/db/encounters";
import { damageAdjust, resistsAllDamage } from "@/lib/dm/condition-logic";
import { petrifiedImmunities, type BlowSource, type WeaponMaterial } from "@/lib/dm/damage-logic";
import { authoredIgnoresResistance } from "@/lib/dm/authored-saves";
import { absorbs } from "@/lib/dm/monster-traits";
import { resistLineFor } from "@/lib/dm/underwater";
import { silencedImmunity } from "@/lib/dm/zone-rules";

// The defences one damage type meets on an enemy, wherever the damage comes
// from: the block's lines, the fire resistance of a creature under water
// (underwater.ts), thunder immunity inside Silence (zone-rules.ts), a golem's
// Absorption trait (monster-traits.ts), and a feature that ignores resistance
// to the type (Inescapable Destruction, authored-saves.ts; Elemental Adept and
// Poisoner, passed by the caller). applyEnemyDamage read these for a blow of
// one type, while a blow of several types (a smite's thunder riding a sword)
// and a running spell's damage met the bare block, so a sword's thunder hurt
// a creature inside Silence and an iron golem in a wall of fire took the fire.

export type EnemyPartFlags = {
  // From a spell, a magic weapon, or strikes that count as magical.
  magical?: boolean;
  // The feature that makes this type's resistance not count, or null.
  ignoreResistanceBy?: string | null;
  // One part of a blow whose total meets a resist-everything condition
  // (petrified) once, afterwards: the part skips it.
  partOfBlow?: boolean;
} & WeaponMaterial &
  BlowSource;

// The three lines one type meets, and the feature that set its resistance
// aside, if any.
export function enemyDefenseLines(
  campaignId: string,
  enemy: EncounterEnemy,
  damageType: string | undefined,
  ignoreResistanceBy?: string | null,
): { resist: string; immune: string; vulnerable: string; ignoredBy: string | null } {
  const type = (damageType ?? "").trim();
  const ignoredBy = (type && authoredIgnoresResistance(campaignId, type)) || (type && ignoreResistanceBy) || null;
  const resist = resistLineFor(campaignId, enemy);
  return {
    resist: ignoredBy ? resist.replace(new RegExp(`\\b${type}\\b`, "gi"), "") : resist,
    immune: [`${enemy.stats.immune ?? ""}${silencedImmunity(campaignId, enemy.id)}`, ...petrifiedImmunities(enemy.conditions)].join(", "),
    vulnerable: enemy.stats.vulnerable ?? "",
    ignoredBy,
  };
}

// One part of a blow as it lands: what gets through, the note for the
// table, and the hit points an Absorption trait turns it into instead.
export function meetEnemyPart(
  campaignId: string,
  enemy: EncounterEnemy,
  amount: number,
  damageType: string | undefined,
  flags: EnemyPartFlags = {},
): { amount: number; note: string | null; absorbed: number } {
  if (absorbs(enemy.stats, damageType)) {
    return { amount: 0, note: `absorbs the ${damageType}`, absorbed: Math.max(0, Math.floor(amount)) };
  }
  const lines = enemyDefenseLines(campaignId, enemy, damageType, flags.ignoreResistanceBy);
  const resistAll = resistsAllDamage(enemy.conditions);
  const met = damageAdjust(amount, damageType, flags.partOfBlow && resistAll ? "" : lines.resist, lines.immune, lines.vulnerable, {
    magical: flags.magical === true,
    resistAll: !flags.partOfBlow && resistAll,
    silvered: flags.silvered,
    adamantine: flags.adamantine,
    spell: flags.spell,
    goodWielder: flags.goodWielder,
  });
  return { ...met, absorbed: 0 };
}
