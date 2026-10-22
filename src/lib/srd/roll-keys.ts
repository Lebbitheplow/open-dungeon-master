// What a trait rule reads from a roll, as data: the roll it rides (a check or
// a save, by skill or ability) and the value of each fixed choice it keys on
// (src/lib/dm/roll-about.ts: about, creature, terrain, by, against,
// magical). A rule applies when the roll fits its key (keyFits), and a
// model's call that leaves a field the key reads unnamed is asked for it
// (unnamedRollKeys): both read the same keys, built from the traits the
// roller holds, so only a held trait is ever asked about and a roller who
// holds none costs nothing.
//
// Pure.

import type { CheckAbout, SaveAgainstValue } from "@/lib/dm/roll-about";
import type { CreatureType } from "@/lib/bestiary/statblock";
import { textKey } from "@/lib/language/text-logic";
import { sameRulesKey } from "@/lib/srd/name-forms";

export type RollKey = {
  roll: "check" | "save";
  skills?: readonly string[];
  abilities?: readonly string[];
  // Only a check the roller is proficient in (Natural Explorer).
  proficient?: true;
  about?: CheckAbout;
  // Creature types or races by their rules names (Favored Enemy's picks).
  creatures?: readonly string[];
  terrains?: readonly string[];
  // The sense the check needs (a blinded or deafened roller fails it).
  by?: readonly string[];
  against?: readonly SaveAgainstValue[];
  magical?: true;
  // Named by the engines that know a spell's caster, never asked (Holy
  // Nimbus).
  casterTypes?: readonly CreatureType[];
};

// One roll as the keys read it, its fields as the call named them ('none'
// included, which fits no key).
export type KeyedRoll = {
  roll: "check" | "save";
  skill?: string;
  ability?: string;
  proficient?: boolean;
  about?: string;
  creature?: string;
  terrain?: string;
  by?: string;
  against?: string;
  magical?: boolean;
  casterType?: string;
};

export type RollGap = { field: "about" | "creature" | "terrain" | "by" | "against" | "magical"; values: string[] };

// The fields the key reads and the roll leaves unnamed, or null when the
// roll does not fit the key on what it does name.
function keyGaps(key: RollKey, roll: KeyedRoll): RollGap[] | null {
  if (key.roll !== roll.roll) {
    return null;
  }
  if (key.skills && !(roll.skill && key.skills.includes(roll.skill))) {
    return null;
  }
  if (key.abilities && !(roll.ability && key.abilities.includes(roll.ability))) {
    return null;
  }
  if (key.proficient && !roll.proficient) {
    return null;
  }
  const casterType = roll.casterType;
  if (key.casterTypes && !(casterType && key.casterTypes.some((type) => type === casterType))) {
    return null;
  }
  const gaps: RollGap[] = [];
  if (key.about) {
    if (roll.about === undefined) {
      gaps.push({ field: "about", values: [key.about] });
    } else if (roll.about !== key.about) {
      return null;
    }
  }
  const creature = roll.creature;
  if (key.creatures) {
    if (creature === undefined) {
      gaps.push({ field: "creature", values: [...key.creatures] });
    } else if (!key.creatures.some((type) => sameRulesKey(type, textKey(creature)))) {
      return null;
    }
  }
  const terrain = roll.terrain;
  if (key.terrains) {
    if (terrain === undefined) {
      gaps.push({ field: "terrain", values: [...key.terrains] });
    } else if (!key.terrains.includes(terrain)) {
      return null;
    }
  }
  const by = roll.by;
  if (key.by) {
    if (by === undefined) {
      gaps.push({ field: "by", values: [...key.by] });
    } else if (!key.by.includes(by)) {
      return null;
    }
  }
  const against = roll.against;
  if (key.against) {
    if (against === undefined) {
      gaps.push({ field: "against", values: [...key.against] });
    } else if (!key.against.some((value) => value === against)) {
      return null;
    }
  }
  if (key.magical) {
    if (roll.magical === undefined) {
      gaps.push({ field: "magical", values: [] });
    } else if (!roll.magical) {
      return null;
    }
  }
  return gaps;
}

export function keyFits(key: RollKey, roll: KeyedRoll): boolean {
  return keyGaps(key, roll)?.length === 0;
}

// The keys as GAME STATE lists them under the character, so a call names
// the fields at once rather than being asked: the roll each rides and the
// values it reads. Null for a roller who holds none. A key read only with a
// caster's type the engines name (Holy Nimbus) is left out.
export function rollKeyCue(keys: readonly RollKey[]): string | null {
  const parts = new Set<string>();
  for (const key of keys) {
    if (key.casterTypes) {
      continue;
    }
    const kind = key.roll === "save" ? "saves" : "checks";
    const target = key.skills
      ? `${key.skills.map((skill) => skill.replaceAll("_", " ")).join(", ")} ${kind}`
      : key.abilities
        ? `${key.abilities.map((ability) => ability.toUpperCase()).join(", ")} ${kind}${key.proficient ? " they are proficient in" : ""}`
        : kind;
    const fields = [
      ...(key.about ? [`about '${key.about}'`] : []),
      ...(key.creatures ? [`creature (${key.creatures.join(", ")})`] : []),
      ...(key.terrains ? [`terrain '${key.terrains.join("', '")}'`] : []),
      ...(key.by ? [`by '${key.by.join("', '")}'`] : []),
      ...(key.against ? [`against '${key.against.join("', '")}'`] : []),
      ...(key.magical ? ["magical"] : []),
    ];
    if (fields.length) {
      parts.add(`${target}: ${fields.join(", ")}`);
    }
  }
  return parts.size ? [...parts].join("; ") : null;
}

// The fields of a call the roller's keys read and the call leaves unnamed,
// with the values those keys would answer; empty when the roller holds no
// key the roll fits.
export function unnamedRollKeys(roll: KeyedRoll, keys: readonly RollKey[]): RollGap[] {
  const out = new Map<RollGap["field"], Set<string>>();
  for (const key of keys) {
    for (const gap of keyGaps(key, roll) ?? []) {
      const values = out.get(gap.field) ?? new Set<string>();
      gap.values.forEach((value) => values.add(value));
      out.set(gap.field, values);
    }
  }
  return [...out].map(([field, values]) => ({ field, values: [...values] }));
}
