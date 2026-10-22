// What a summoned creature's record (src/lib/schemas/summon.ts) means to the
// engines that read a character sheet: the attack pc_attack makes, the number
// of attacks its Attack action holds, the damage it shrugs off, the stat
// block it keeps if it turns hostile, and the line GAME STATE prints. Pure.

import type { AttackProfile } from "@/lib/dm/attack-logic";
import type { EnemyStats } from "@/lib/bestiary/statblock";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import type { SheetSummon } from "@/lib/schemas/summon";
import type { SummonForm } from "@/lib/srd/summon-forms";
import { noneNamed, type ToolError } from "@/lib/dm/tool-errors";
import { naturalAttackProfile, pickNaturalAttack } from "@/lib/dm/natural-attack";
import { attackSummary, enemyAttackOf } from "@/lib/srd/creature-attacks";

export const SUMMONED = "summoned";

// The attack a summoned creature makes with pc_attack: the stat block's own
// to-hit and dice, its reach or range, any rider dice of another type kept
// apart so each meets its own resistance, and what its hit carries
// (src/lib/dm/natural-attack.ts).
export function summonAttackProfile(
  sheet: Pick<CharacterSheet, "name" | "summon">,
  weapon: string | undefined,
): AttackProfile | ToolError | null {
  const summon = sheet.summon;
  if (!summon) {
    return null;
  }
  if (!summon.attacks.length) {
    return { error: `${sheet.name} (${summon.form}) has no attack; it cannot fight.`, refused: "rules" };
  }
  const attack = pickNaturalAttack(summon.attacks, weapon);
  if (!attack) {
    const names = summon.attacks.map((entry) => entry.name);
    return weapon?.trim()
      ? noneNamed(`${sheet.name} (${summon.form}) has no attack called`, weapon.trim(), names)
      : { error: `${sheet.name} (${summon.form}) has several attacks; name one in weapon: ${names.join(", ")}.`, retry: true };
  }
  return naturalAttackProfile(attack, {
    weapon: `${summon.form} ${attack.name}`,
    note: `${summon.form}'s own attack (summoned by ${summon.spell})`,
    magical: /\bMagic Weapons\b/i.test(summon.traits),
  });
}

// The attacks one Attack action holds for a summoned creature: its
// Multiattack count. Null for every other sheet.
export function summonAttacksPerTurn(sheet: Pick<CharacterSheet, "summon">): number | null {
  return sheet.summon ? Math.max(1, sheet.summon.attacksPerTurn) : null;
}

// Its stat block's resistances and immunities, in the words damageAdjust
// reads ("fire, poison; bludgeoning, piercing, and slashing from
// nonmagical attacks").
export function summonResistances(sheet: Pick<CharacterSheet, "summon">): string {
  return sheet.summon?.resist ?? "";
}

export function summonImmunities(sheet: Pick<CharacterSheet, "summon">): string {
  const immune = sheet.summon?.immune ?? "";
  return immune ? `${immune}, ` : "";
}

export function summonVulnerabilities(sheet: Pick<CharacterSheet, "summon">): string {
  return sheet.summon?.vulnerable ?? "";
}

// What kind of creature a sheet is, for the rules that ask (Protection from
// Evil and Good, Antilife Shell, a spell that touches only some): the form
// it wears (a druid's bear is a beast), a summoned creature's record (Find
// Steed's celestial, fey or fiend), or a humanoid.
export function sheetCreatureType(sheet: Pick<CharacterSheet, "summon" | "wildShape">): string {
  if (sheet.wildShape) {
    return sheet.wildShape.type || "beast";
  }
  return sheet.summon?.creatureType || "humanoid";
}

// The record a stat block becomes when a spell makes it.
export function summonRecord(
  form: SummonForm,
  made: { spell: string; casterId: string; casterName: string; concentration: boolean; hostileOnBreak?: boolean; controlExpires?: boolean; castId: string },
): SheetSummon {
  return {
    spell: made.spell,
    casterId: made.casterId,
    casterName: made.casterName,
    form: form.name,
    creatureType: form.type,
    size: form.size,
    cr: form.cr,
    attacks: form.attacks.slice(0, 4).map((attack) => ({ ...attack })),
    attacksPerTurn: Math.max(1, Math.min(4, form.attacksPerTurn ?? 1)),
    resist: form.resist ?? "",
    immune: form.immune ?? "",
    vulnerable: form.vulnerable ?? "",
    conditionImmune: form.conditionImmune ?? "",
    traits: (form.traits ?? "").slice(0, 400),
    concentration: made.concentration,
    ...(made.hostileOnBreak ? { hostileOnBreak: true } : {}),
    ...(made.controlExpires ? { controlExpires: true } : {}),
    castId: made.castId,
  };
}

const mod = (score: number) => Math.floor((score - 10) / 2);
const XP_BY_CR: Record<string, number> = { "0": 10, "0.125": 25, "0.25": 50, "0.5": 100, "1": 200, "2": 450, "3": 700, "4": 1100, "5": 1800, "6": 2300, "7": 2900, "8": 3900, "9": 5000, "10": 5900 };

// The stat block an enemy row keeps when a creature turns on the party
// (Conjure Elemental's broken concentration): the sheet's own numbers as
// they stand, and the record's attacks.
export function enemyStatsFromSummon(
  sheet: Pick<CharacterSheet, "abilities" | "maxHp" | "ac" | "speed" | "summon">,
): EnemyStats {
  const summon = sheet.summon!;
  const abilities = sheet.abilities;
  const saveMods = {
    str: mod(abilities.str),
    dex: mod(abilities.dex),
    con: mod(abilities.con),
    int: mod(abilities.int),
    wis: mod(abilities.wis),
    cha: mod(abilities.cha),
  };
  return {
    ac: sheet.ac,
    maxHp: sheet.maxHp,
    dexMod: saveMods.dex,
    saveMods,
    speed: `${sheet.speed} ft.`,
    // Its attacks with their riders, which the enemy's own engine lands.
    attacks: summon.attacks.map(enemyAttackOf),
    traits: summon.traits ? [summon.traits] : [],
    resist: summon.resist,
    immune: summon.immune,
    vulnerable: summon.vulnerable,
    conditionImmune: summon.conditionImmune,
    cr: summon.cr,
    xp: XP_BY_CR[String(summon.cr)] ?? 0,
    attacksPerTurn: summon.attacksPerTurn,
    size: summon.size,
    type: summon.creatureType,
    abilities: { ...abilities },
  };
}

// One line for GAME STATE: who made it, with what, how it ends, and its
// attacks, so the narrator runs it by its numbers.
export function summonStateLine(sheet: Pick<CharacterSheet, "name" | "summon">): string | null {
  const summon = sheet.summon;
  if (!summon) {
    return null;
  }
  const attacks = summon.attacks.length ? summon.attacks.map(attackSummary).join(", ") : "no attacks";
  const ends = summon.concentration
    ? `ends with ${summon.casterName || "its caster"}'s concentration`
    : "ends with its duration";
  return `  Summoned ${summon.form} (${summon.creatureType}, by ${summon.casterName || "its caster"} with ${summon.spell}; ${ends} or at 0 HP${summon.hostileOnBreak ? "; turns hostile if concentration breaks" : ""}). Attacks: ${attacks}${summon.attacksPerTurn > 1 ? ` (${summon.attacksPerTurn} per Attack action)` : ""}. It attacks through pc_attack with its own characterId on its own turn; the server rolls these numbers.${summon.traits ? ` Traits: ${summon.traits}` : ""}`;
}
