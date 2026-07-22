// 5e multiclassing rules as pure data and math: ability prerequisites (both
// directions, per RAW), the shared multiclass spell-slot table, per-class
// caster-level contributions, and the proficiencies a class grants when
// taken as a second class. Pure and dependency-light (like asi.ts) so
// scripts/test-multiclass.mjs can exercise it directly.

import spellSlotsJson from "@/lib/srd/spell-slots.json";
import { findClass, spellSlotsFor } from "@/lib/srd";
import type { Ability, AbilityScores, ClassEntry } from "@/lib/schemas/sheet";

// UI sanity cap: RAW is unbounded, but nobody at this table needs four.
export const MULTICLASS_CAP = 3;

export const MULTICLASS_MIN_SCORE = 13;

// The subset of a sheet the helpers need; loose so test doubles and
// half-built payloads pass.
export type ClassListSource = {
  class: string;
  subclass?: string;
  level?: number;
  classes?: ClassEntry[];
};

// The sheet's class list. Empty/absent `classes` = legacy single-class:
// a one-entry list is derived from the scalar fields so consumers never
// branch on which shape a sheet holds.
export function classListFor(sheet: ClassListSource): ClassEntry[] {
  if (sheet.classes && sheet.classes.length > 0) {
    return sheet.classes;
  }
  return [
    {
      id: sheet.class,
      subclass: sheet.subclass ?? "",
      level: Math.max(1, sheet.level ?? 1),
    },
  ];
}

// Levels held in one class; 0 when the character has none.
export function classLevelFor(sheet: ClassListSource, classId: string): number {
  const wanted = classId.trim().toLowerCase();
  const entry = classListFor(sheet).find((candidate) => candidate.id.toLowerCase() === wanted);
  return entry?.level ?? 0;
}

export function isMulticlass(sheet: ClassListSource): boolean {
  return (sheet.classes?.length ?? 0) > 1;
}

// Combined caster level for the shared slot table: full casters add their
// level, half casters add half rounded DOWN (artificer rounds up, per its
// own rule), and warlocks add nothing here because Pact Magic is tracked
// apart from the shared pool.
export function casterLevelFor(classList: ClassEntry[]): number {
  let total = 0;
  for (const entry of classList) {
    const klass = findClass(entry.id);
    if (!klass) {
      continue;
    }
    if (klass.casterType === "full") {
      total += entry.level;
    } else if (klass.casterType === "half") {
      total += Math.floor(entry.level / 2);
    } else if (klass.casterType === "artificer") {
      total += Math.ceil(entry.level / 2);
    }
  }
  return Math.min(20, total);
}

const FULL_TABLE = (spellSlotsJson as unknown as { full: Record<string, number[]> }).full;

// Shared spell slots {level: max} at a combined caster level. The 5e
// multiclass table IS the full-caster table, so it is reused directly.
export function multiclassSlots(casterLevel: number): Record<string, number> {
  if (casterLevel < 1) {
    return {};
  }
  const row = FULL_TABLE[String(Math.min(20, Math.floor(casterLevel)))] ?? [];
  return Object.fromEntries(row.map((max, index) => [String(index + 1), max]));
}

// The slot table a sheet's SHARED pool should follow. Two or more slot
// casters = the multiclass table at the combined caster level; exactly one
// = that class's own table at its class level (RAW: the shared table only
// kicks in with a second spellcasting class); none = no shared slots
// (warlock Pact Magic lives in spellcasting.pact, not here).
export function slotTableFor(sheet: ClassListSource): Record<string, number> {
  const classList = classListFor(sheet);
  const casters = classList.filter((entry) => {
    const type = findClass(entry.id)?.casterType;
    return type !== undefined && type !== "none" && type !== "pact";
  });
  if (casters.length >= 2) {
    return multiclassSlots(casterLevelFor(classList));
  }
  if (casters.length === 1) {
    return spellSlotsFor(casters[0].id, casters[0].level);
  }
  return {};
}

const PACT_TABLE = (
  spellSlotsJson as unknown as { pact: Record<string, { slots: number; slotLevel: number }> }
).pact;

// Warlock Pact Magic slots at a warlock level: all one level, short-rest
// refilled, tracked apart from the shared pool on multiclass sheets.
export function pactSlotsFor(warlockLevel: number): { level: number; max: number } | null {
  if (warlockLevel < 1) {
    return null;
  }
  const row = PACT_TABLE[String(Math.min(20, Math.floor(warlockLevel)))];
  return row ? { level: row.slotLevel, max: row.slots } : null;
}

// PHB multiclass prerequisites for the SRD classes: outer array = OR
// alternatives, inner = scores that must ALL be 13+.
const MULTICLASS_PREREQS: Record<string, Ability[][]> = {
  barbarian: [["str"]],
  bard: [["cha"]],
  cleric: [["wis"]],
  druid: [["wis"]],
  fighter: [["str"], ["dex"]],
  monk: [["dex", "wis"]],
  paladin: [["str", "cha"]],
  ranger: [["dex", "wis"]],
  rogue: [["dex"]],
  sorcerer: [["cha"]],
  warlock: [["cha"]],
  wizard: [["int"]],
  artificer: [["int"]],
};

// The prerequisite for any class: the PHB table for SRD classes; for the
// custom genre classes, 13 in the class's spellcasting ability when it is a
// caster, else its first save-proficiency ability.
export function multiclassPrereq(classId: string): Ability[][] | null {
  const listed = MULTICLASS_PREREQS[classId.trim().toLowerCase()];
  if (listed) {
    return listed;
  }
  const klass = findClass(classId);
  if (!klass) {
    return null;
  }
  if (klass.casterType !== "none" && klass.spellAbility) {
    return [[klass.spellAbility]];
  }
  return klass.saves.length ? [[klass.saves[0]]] : null;
}

export function meetsPrereq(abilities: AbilityScores, classId: string): boolean {
  const prereq = multiclassPrereq(classId);
  if (!prereq) {
    return true;
  }
  return prereq.some((required) =>
    required.every((ability) => abilities[ability] >= MULTICLASS_MIN_SCORE),
  );
}

const ABILITY_LABEL: Record<Ability, string> = {
  str: "Strength",
  dex: "Dexterity",
  con: "Constitution",
  int: "Intelligence",
  wis: "Wisdom",
  cha: "Charisma",
};

export function describePrereq(classId: string): string {
  const prereq = multiclassPrereq(classId);
  if (!prereq) {
    return "no prerequisite";
  }
  return prereq
    .map((required) => required.map((ability) => `${ABILITY_LABEL[ability]} 13`).join(" and "))
    .join(" or ");
}

// Whether the character may take a first level in a NEW class. RAW checks
// both directions: they must meet the new class's prerequisite AND the
// prerequisites of every class they already have.
export function canMulticlassInto(
  sheet: ClassListSource & { abilities: AbilityScores },
  classId: string,
): { ok: boolean; error?: string } {
  const klass = findClass(classId);
  if (!klass) {
    return { ok: false, error: `Unknown class "${classId}".` };
  }
  const classList = classListFor(sheet);
  const wanted = classId.trim().toLowerCase();
  if (classList.some((entry) => entry.id.toLowerCase() === wanted)) {
    return { ok: false, error: `They already have levels in ${klass.name}.` };
  }
  if (classList.length >= MULTICLASS_CAP) {
    return { ok: false, error: `At most ${MULTICLASS_CAP} classes per character.` };
  }
  if (!meetsPrereq(sheet.abilities, classId)) {
    return {
      ok: false,
      error: `Multiclassing into ${klass.name} requires ${describePrereq(classId)}.`,
    };
  }
  for (const entry of classList) {
    if (!meetsPrereq(sheet.abilities, entry.id)) {
      const held = findClass(entry.id)?.name ?? entry.id;
      return {
        ok: false,
        error: `Leaving ${held} for another class requires ${describePrereq(entry.id)} (RAW checks both directions).`,
      };
    }
  }
  return { ok: true };
}

// Proficiencies gained when taking a class as a SECOND class (PHB table).
// Never saving throws, per RAW. `skillChoice.from` empty = any skill.
export type MulticlassGrant = {
  armor: string[];
  weapons: string[];
  tools: string[];
  skillChoice?: { count: number; from: string[] };
};

const SRD_MULTICLASS_GRANTS: Record<string, Omit<MulticlassGrant, "skillChoice"> & {
  // "class" = one skill from the class's own list; "any" = any skill.
  skillChoice?: "class" | "any";
}> = {
  barbarian: { armor: ["shields"], weapons: ["simple weapons", "martial weapons"], tools: [] },
  bard: { armor: ["light armor"], weapons: [], tools: ["one musical instrument"], skillChoice: "any" },
  cleric: { armor: ["light armor", "medium armor", "shields"], weapons: [], tools: [] },
  druid: { armor: ["light armor", "medium armor", "shields"], weapons: [], tools: [] },
  fighter: {
    armor: ["light armor", "medium armor", "shields"],
    weapons: ["simple weapons", "martial weapons"],
    tools: [],
  },
  monk: { armor: [], weapons: ["simple weapons", "shortswords"], tools: [] },
  paladin: {
    armor: ["light armor", "medium armor", "shields"],
    weapons: ["simple weapons", "martial weapons"],
    tools: [],
  },
  ranger: {
    armor: ["light armor", "medium armor", "shields"],
    weapons: ["simple weapons", "martial weapons"],
    tools: [],
    skillChoice: "class",
  },
  rogue: { armor: ["light armor"], weapons: [], tools: ["thieves' tools"], skillChoice: "class" },
  sorcerer: { armor: [], weapons: [], tools: [] },
  warlock: { armor: ["light armor"], weapons: ["simple weapons"], tools: [] },
  wizard: { armor: [], weapons: [], tools: [] },
  artificer: {
    armor: ["light armor", "medium armor", "shields"],
    weapons: [],
    tools: ["thieves' tools", "tinker's tools"],
  },
};

// What multiclassing into a class actually grants. Custom genre classes
// derive one: their armor list capped at medium (heavy training is a
// first-class privilege) plus their tools; never saves.
export function multiclassGrantsFor(classId: string): MulticlassGrant {
  const id = classId.trim().toLowerCase();
  const listed = SRD_MULTICLASS_GRANTS[id];
  const klass = findClass(classId);
  if (listed) {
    const grant: MulticlassGrant = {
      armor: listed.armor,
      weapons: listed.weapons,
      tools: listed.tools,
    };
    if (listed.skillChoice) {
      grant.skillChoice = {
        count: 1,
        from: listed.skillChoice === "class" ? (klass?.skillChoices.from ?? []) : [],
      };
    }
    return grant;
  }
  if (!klass) {
    return { armor: [], weapons: [], tools: [] };
  }
  return {
    armor: klass.armor.filter((entry) => !/heavy/i.test(entry)),
    weapons: [],
    tools: klass.tools,
  };
}

export function describeGrant(grant: MulticlassGrant): string {
  const parts = [...grant.armor, ...grant.weapons, ...grant.tools];
  if (grant.skillChoice) {
    parts.push(
      grant.skillChoice.from.length ? "one skill from its class list" : "one skill of your choice",
    );
  }
  return parts.length ? parts.join(", ") : "no new proficiencies";
}
