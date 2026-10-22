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
//   twin_spell      authored-reaper.ts (Reaper, Improved Reaper, Moon Fire)
//   rapid_strike    pc-attack-plan.ts (Rapid Strike)
//   oa_each_turn    opportunity.ts (Vigilant Defender)
//   stand_cost      the battle map move route and view.ts (Tipsy Sway)
//   mote            rolls.ts, forced-save.ts (Mote of Potential)
//   swarm_prone     authored-spend-more.ts (Mighty Swarm)

import { standsCheaply } from "@/lib/srd/feat-combat";
import { activeAuthored, resolveFormula, type AuthoredSheet } from "@/lib/srd/authored-effects";
import type { NaturalWeapon } from "@/lib/srd/authored-effects-types";
import type { SrdWeapon } from "@/lib/srd/weapons";
import { containsPhrase, textKey } from "@/lib/language/text-logic";
import { hasItemTag } from "@/lib/srd/item-tags";
import { pluralForms } from "@/lib/srd/name-forms";
import { bundledSpellSchool, spellNamesOf } from "@/lib/srd/spell-facts";

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

// The weapon a feature makes that pc_attack's `weapon` names, whole
// ("claws", "psychic blade", "radiant sun bolt"), when its gate holds (a
// rage for Form of the Beast). Null when the name is none of them.
export function authoredNaturalWeapon(
  sheet: AuthoredSheet,
  name: string,
  mods: Record<string, number> = {},
): HeldNaturalWeapon | null {
  const wanted = textKey(name);
  if (!wanted) {
    return null;
  }
  for (const { effect, held } of activeAuthored(sheet, "natural_weapon")) {
    const names = [effect.weapon.name, ...(effect.weapon.aliases ?? [])].flatMap((name) => pluralForms(textKey(name)));
    if (names.includes(wanted)) {
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
export function naturalWeaponGated(sheet: AuthoredSheet, name: string): string | null {
  const open = { ...sheet, conditions: [...(sheet.conditions ?? []), "raging"], equipment: [] };
  const found = authoredNaturalWeapon(open, name);
  return found && !authoredNaturalWeapon(sheet, name) ? found.feature : null;
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
    if (marks.some((mark) => textKey(mark.condition) === textKey(effect.mark) && mark.source === sheetId)) {
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
    const mark = forcer.conditions.find((entry) => textKey(entry) === textKey(effect.mark));
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
  spell: { damageType?: string | null; healing?: boolean; level?: number },
  mods: Record<string, number> = {},
): { dice: string[]; notes: string[] } {
  const dice: string[] = [];
  const notes: string[] = [];
  for (const { effect, held } of activeAuthored(sheet, "spell_rider")) {
    // Potent Spellcasting: cantrips only.
    if (effect.cantrips && spell.level !== 0) {
      continue;
    }
    const byType = effect.damageTypes?.includes(textKey(spell.damageType ?? ""));
    const byHealing = effect.healing && spell.healing;
    const typed = effect.damageTypes || effect.healing ? Boolean(byType || byHealing) : true;
    // An artificer spell is one the caster casts as an artificer: the class
    // is the caster's (a spell list is shared by several classes).
    const casterClasses = [textKey(sheet.class ?? ""), ...(sheet.classes ?? []).map((entry) => textKey(entry.id))];
    const listed = !effect.classes || casterClasses.some((entry) => effect.classes!.includes(entry));
    const wanted = effect.items;
    const item = wanted ? (sheet.equipment ?? []).find((entry) => wanted.some((tag) => hasItemTag(entry, tag))) : null;
    if (!typed || !listed || (wanted && !item)) {
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
  if (!spell?.trim()) {
    return null;
  }
  // The guarded spell under any name the checklist prints it under: the
  // bundled row is "Evard's Black Tentacles", the SRD's "Black Tentacles".
  const names = spellNamesOf(spell).map(textKey);
  for (const { effect, held } of activeAuthored(sheet, "concentration_guard")) {
    // Focused Conjuration: any spell of the school.
    const bySchool = effect.school ? textKey(bundledSpellSchool(spell) ?? "") === textKey(effect.school) : false;
    const byName = effect.spell ? names.includes(textKey(effect.spell)) : false;
    if (bySchool || byName) {
      return { feature: held.feature, tempHp: Math.max(0, Number(resolveFormula(effect.tempHp, held.level, mods)) || 0) };
    }
  }
  return null;
}

// Whether this spell may strike a second creature within 5 feet of the first:
// Improved Reaper (a 1st to 5th level necromancy spell), Reaper (a
// necromancy cantrip), Moon Fire (sacred flame).
export function authoredTwinSpell(
  sheet: AuthoredSheet,
  spell: { name?: string | null; school?: string | null; level: number },
): { feature: string } | null {
  for (const { effect, held } of activeAuthored(sheet, "twin_spell")) {
    const named = !effect.spells || effect.spells.some((entry) => textKey(entry) === textKey(spell.name ?? ""));
    if (named && textKey(spell.school ?? "") === textKey(effect.school) && spell.level >= (effect.minLevel ?? 1) && spell.level <= effect.maxLevel) {
      return { feature: held.feature };
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
  // Athlete: standing from prone costs 5 feet (src/lib/srd/feat-combat.ts).
  if (!found && standsCheaply(sheet as { feats?: string[]; features?: Array<{ name: string }> })) {
    return 1;
  }
  return found ? Math.max(0, Math.round(found.effect.feet / 5)) : Math.floor(speedTiles / 2);
}

export function holdsMote(sheet: AuthoredSheet): string | null {
  return activeAuthored(sheet, "mote")[0]?.held.feature ?? null;
}

export function swarmKnocksProne(sheet: AuthoredSheet): string | null {
  return activeAuthored(sheet, "swarm_prone")[0]?.held.feature ?? null;
}

// ---- issue 474's readers ----

// Darkvision the holder's features give, in feet, over what they already
// have (`base`): Umbral Sight's 60, or 30 more; Eyes of the Dark's 120.
export function authoredDarkvisionFeet(sheet: AuthoredSheet, base: number): number {
  let feet = base;
  for (const { effect } of activeAuthored(sheet, "darkvision")) {
    feet = Math.max(feet, effect.orAdd && base > 0 ? base + effect.orAdd : effect.feet);
  }
  return feet;
}

// An ability modifier (at least +1) added to a weapon attack's damage
// (Aura of Hate, Song of Victory), with the feature for the note.
export function authoredDamageAbility(
  sheet: AuthoredSheet,
  attack: { melee: boolean },
  mods: Record<string, number>,
): Array<{ feature: string; amount: number }> {
  const out: Array<{ feature: string; amount: number }> = [];
  for (const { effect, held } of activeAuthored(sheet, "damage_ability")) {
    if (effect.when === "melee" && !attack.melee) {
      continue;
    }
    if (effect.requiresCondition && !(sheet.conditions ?? []).some((entry) => textKey(entry) === textKey(effect.requiresCondition ?? ""))) {
      continue;
    }
    out.push({ feature: held.feature, amount: Math.max(1, mods[effect.ability] ?? 0) });
  }
  return out;
}

// The lowest a d20 may count on a check with this skill (Silver Tongue's 10,
// Ear for Deceit's 8), or 0.
export function authoredCheckFloor(sheet: AuthoredSheet, skill: string): number {
  let floor = 0;
  for (const { effect } of activeAuthored(sheet, "check_floor")) {
    if (effect.skills.some((entry) => textKey(entry) === textKey(skill))) {
      floor = Math.max(floor, effect.floor);
    }
  }
  return floor;
}

// Expert Divination: the slot level a casting gives back, or null. `slots`
// are the caster's slots with this casting already paid.
export function authoredSlotRefund(
  sheet: AuthoredSheet,
  cast: { school?: string | null; slotLevel: number | null },
  slots: Record<string, { max: number; used: number }> | undefined,
): { feature: string; level: number } | null {
  if (!cast.slotLevel || !slots) {
    return null;
  }
  for (const { effect, held } of activeAuthored(sheet, "slot_refund")) {
    if (textKey(cast.school ?? "") !== textKey(effect.school) || cast.slotLevel < effect.minLevel) {
      continue;
    }
    for (let level = Math.min(cast.slotLevel - 1, effect.maxLevel); level >= 1; level -= 1) {
      if ((slots[String(level)]?.used ?? 0) > 0) {
        return { feature: held.feature, level };
      }
    }
  }
  return null;
}

// A creature's Hit Die by its size: an SRD block's hit points are the
// average of its dice plus its Constitution modifier for each.
const HIT_DIE_AVERAGE: Record<string, number> = { Tiny: 2.5, Small: 3.5, Medium: 4.5, Large: 5.5, Huge: 6.5, Gargantuan: 10.5 };

// Mighty Summoner: the hit points a creature the holder summons gains, by
// its Hit Dice, when it is of a type the feature names; null otherwise.
export function authoredSummonHitPoints(
  sheet: AuthoredSheet,
  form: { type: string; size: string; hp: number; abilities: { con: number } },
): { feature: string; hp: number } | null {
  for (const { effect, held } of activeAuthored(sheet, "summon_hp_per_hd")) {
    if (!effect.types.some((type) => containsPhrase(form.type, type))) {
      continue;
    }
    const perDie = (HIT_DIE_AVERAGE[form.size] ?? 4.5) + Math.floor((form.abilities.con - 10) / 2);
    const dice = Math.max(1, Math.round(form.hp / Math.max(1, perDie)));
    return { feature: held.feature, hp: effect.amount * dice };
  }
  return null;
}
