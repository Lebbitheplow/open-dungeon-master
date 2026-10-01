// The readers of the authored hooks the final round added
// (src/lib/srd/authored-effects-types.ts, "the final round's hooks"): the
// features the authored workstream left narrated because the engine had no
// place to hold them. Pure and database-free, like authored-effects.ts, whose
// resolver (the sheet's features, their gates and class levels) they share.
//
//   natural_weapon  pc-attack-profile.ts buildAttackProfile (Form of the
//                   Beast, the Soulknife's Psychic Blades, Radiant Sun Bolt)
//   reach           pc-attack-profile.ts (Demiurgic Colossus)
//   sneak_bonus     pc-attack-damage.ts withSneakAttack (Eye for Weakness)
//   save_die_vs     forced-save.ts rollCharacterSave (Supernatural Defense)
//   spell_rider     spell-damage-riders.ts, heal-spell.ts (Enhanced Bond,
//                   Arcane Firearm)
//   concentration_guard  concentration.ts, cast-guard.ts (Grasping Tentacles)
//   twin_spell      cast-at-enemy.ts (Improved Reaper)
//   rapid_strike    pc-attack-plan.ts (Rapid Strike)
//   oa_each_turn    opportunity.ts (Vigilant Defender)
//   stand_cost      the battle map move route and view.ts (Tipsy Sway)
//   mote            rolls.ts, forced-save.ts (Mote of Potential)
//   swarm_prone     authored-spend-more.ts (Mighty Swarm)

import { activeAuthored, resolveFormula, type AuthoredSheet } from "@/lib/srd/authored-effects";
import type { NaturalWeapon } from "@/lib/srd/authored-effects-types";
import type { SrdWeapon } from "@/lib/srd/weapons";

const lower = (value: string | undefined | null) => (value ?? "").trim().toLowerCase();

// ---- weapons the feature is ----

export type HeldNaturalWeapon = {
  feature: string;
  weapon: NaturalWeapon;
  // The weapon as the attack engine reads one: a simple weapon (so the
  // holder is proficient), its dice at the class level that granted it.
  srd: SrdWeapon;
  // The die of the bonus-action second attack, when the feature grants one.
  second: string | null;
};

function toSrd(weapon: NaturalWeapon, level: number, mods: Record<string, number>): SrdWeapon {
  const properties = [
    ...(weapon.finesse ? ["finesse"] : []),
    ...(weapon.reach ? ["reach"] : []),
    ...(weapon.thrown ? ["thrown"] : []),
    ...(weapon.light ? ["light"] : []),
  ];
  return {
    name: weapon.name,
    category: "simple",
    kind: weapon.ranged ? "ranged" : "melee",
    damage: `${resolveFormula(weapon.dice, level, mods)} ${weapon.type}`,
    ...(properties.length ? { properties } : {}),
    ...(weapon.rangeFt ? { rangeFt: weapon.rangeFt } : {}),
    ...(weapon.longRangeFt ? { longRangeFt: weapon.longRangeFt } : {}),
  };
}

// The weapon a feature makes that pc_attack's `weapon` names ("claws", "the
// psychic blade", "radiant sun bolt"), when its gate holds (a rage for Form
// of the Beast). Null when the name is none of them.
export function authoredNaturalWeapon(
  sheet: AuthoredSheet,
  term: string | undefined,
  mods: Record<string, number> = {},
): HeldNaturalWeapon | null {
  const wanted = lower(term).replace(/^(the|a|an|her|his|their)\s+/, "");
  if (!wanted) {
    return null;
  }
  for (const { effect, held } of activeAuthored(sheet, "natural_weapon")) {
    const names = [effect.weapon.name, ...(effect.weapon.aliases ?? [])].map(lower);
    if (names.some((name) => name === wanted || wanted.startsWith(name) || name.startsWith(wanted))) {
      return {
        feature: held.feature,
        weapon: effect.weapon,
        srd: toSrd(effect.weapon, held.level, mods),
        second: effect.weapon.second ?? null,
      };
    }
  }
  return null;
}

// A natural weapon the sheet would have if its gate held: for the refusal
// that says why it cannot swing it now ("claws, while raging").
export function naturalWeaponGated(sheet: AuthoredSheet, term: string | undefined): string | null {
  const wanted = lower(term);
  if (!wanted) {
    return null;
  }
  const open = { ...sheet, conditions: [...(sheet.conditions ?? []), "raging"], equipment: [] };
  const found = authoredNaturalWeapon(open, term);
  return found && !authoredNaturalWeapon(sheet, term) ? found.feature : null;
}

// ---- reach, Sneak Attack, saves ----

export function authoredReachBonus(sheet: AuthoredSheet): { tiles: number; feature: string } | null {
  const found = activeAuthored(sheet, "reach")[0];
  return found ? { tiles: found.effect.tiles, feature: found.held.feature } : null;
}

// Extra Sneak Attack dice against a creature: the marks it carries whose
// source is the attacker. `marks` maps a condition to its source.
export function authoredSneakBonus(
  sheet: AuthoredSheet,
  sheetId: string,
  marks: Array<{ condition: string; source?: string }>,
): { dice: number; feature: string } | null {
  for (const { effect, held } of activeAuthored(sheet, "sneak_bonus")) {
    if (marks.some((mark) => lower(mark.condition) === lower(effect.mark) && mark.source === sheetId)) {
      return { dice: effect.dice, feature: held.feature };
    }
  }
  return null;
}

// The die a save gains against the creature forcing it, when the holder
// marked it (Supernatural Defense against their Slayer's Prey).
export function authoredSaveDieVs(
  sheet: AuthoredSheet,
  sheetId: string,
  forcer: { conditions: string[]; meta: Record<string, { source?: string } | undefined> } | null,
): { die: string; feature: string } | null {
  if (!forcer) {
    return null;
  }
  for (const { effect, held } of activeAuthored(sheet, "save_die_vs")) {
    const mark = forcer.conditions.find((entry) => lower(entry) === lower(effect.mark));
    if (mark && forcer.meta[mark]?.source === sheetId) {
      return { die: effect.die, feature: held.feature };
    }
  }
  return null;
}

// ---- spells ----

// The dice a caster's features add to one roll of a spell: damage of a type,
// healing, a spell of a class's list, cast through an item the caster carries.
export function authoredSpellDice(
  sheet: AuthoredSheet & { level?: number },
  spell: { damageType?: string | null; healing?: boolean },
  mods: Record<string, number> = {},
): { dice: string[]; notes: string[] } {
  const dice: string[] = [];
  const notes: string[] = [];
  for (const { effect, held } of activeAuthored(sheet, "spell_rider")) {
    const byType = effect.damageTypes?.includes(lower(spell.damageType));
    const byHealing = effect.healing && spell.healing;
    const typed = effect.damageTypes || effect.healing ? Boolean(byType || byHealing) : true;
    // An artificer spell is one the caster casts as an artificer: the class
    // is the caster's (a spell list is shared by several classes).
    const casterClasses = [lower(sheet.class), ...(sheet.classes ?? []).map((entry) => lower(entry.id))];
    const listed = !effect.classes || casterClasses.some((entry) => effect.classes!.includes(entry));
    const pattern = effect.item ? new RegExp(effect.item, "i") : null;
    const item = pattern ? (sheet.equipment ?? []).find((entry) => pattern.test(entry.name)) : null;
    if (!typed || !listed || (pattern && !item)) {
      continue;
    }
    const rolled = resolveFormula(effect.dice, held.level, mods);
    dice.push(rolled);
    notes.push(`${held.feature}: +${rolled}${item ? ` (through the ${item.name})` : ""}`);
  }
  return { dice, notes };
}

// Grasping Tentacles: the spell whose concentration damage cannot break, and
// the temporary hit points its casting gives.
export function authoredConcentrationGuard(
  sheet: AuthoredSheet,
  spell: string | null | undefined,
  mods: Record<string, number> = {},
): { feature: string; tempHp: number } | null {
  const wanted = lower(spell);
  if (!wanted) {
    return null;
  }
  for (const { effect, held } of activeAuthored(sheet, "concentration_guard")) {
    if (wanted.includes(lower(effect.spell)) || lower(effect.spell).includes(wanted)) {
      return { feature: held.feature, tempHp: Math.max(0, Number(resolveFormula(effect.tempHp, held.level, mods)) || 0) };
    }
  }
  return null;
}

// Improved Reaper: whether this spell may strike a second creature.
export function authoredTwinSpell(
  sheet: AuthoredSheet,
  spell: { school?: string | null; level: number },
): { feature: string; cost: string } | null {
  for (const { effect, held } of activeAuthored(sheet, "twin_spell")) {
    if (lower(spell.school) === lower(effect.school) && spell.level >= 1 && spell.level <= effect.maxLevel) {
      const [count, die] = effect.costPerLevel.split("d");
      return { feature: held.feature, cost: `${Number(count) * spell.level}d${die}` };
    }
  }
  return null;
}

// ---- the action economy, the board ----

export function hasRapidStrike(sheet: AuthoredSheet): string | null {
  return activeAuthored(sheet, "rapid_strike")[0]?.held.feature ?? null;
}

// The reaction key an opportunity attack spends: the character's one
// reaction, or with Vigilant Defender one for each other creature's turn
// (the mover's, since a creature provokes on its own turn). The pointer
// clears a holder's "vigilant:<id>:" keys as their own turn starts.
export function opportunityReactionKey(sheet: AuthoredSheet, sheetId: string, moverId: string): string {
  return activeAuthored(sheet, "oa_each_turn").length ? `${VIGILANT_PREFIX}${sheetId}:${moverId}` : sheetId;
}
export const VIGILANT_PREFIX = "vigilant:";

// The squares standing up from prone costs: half the speed, or the feature's
// own price (Tipsy Sway: 5 feet).
export function standUpTiles(sheet: AuthoredSheet, speedTiles: number): number {
  const found = activeAuthored(sheet, "stand_cost")[0];
  return found ? Math.max(0, Math.round(found.effect.feet / 5)) : Math.floor(speedTiles / 2);
}

export function holdsMote(sheet: AuthoredSheet): string | null {
  return activeAuthored(sheet, "mote")[0]?.held.feature ?? null;
}

export function swarmKnocksProne(sheet: AuthoredSheet): string | null {
  return activeAuthored(sheet, "swarm_prone")[0]?.held.feature ?? null;
}
