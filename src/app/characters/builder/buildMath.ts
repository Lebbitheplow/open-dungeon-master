// The build math table (backlog F10): every number the sheet will carry,
// beside the picks, with the parts each is made of. Pure, so
// scripts/test-builder-build-math.mjs can check it without React.
//
// Nothing is worked out here. Each number is read from the calculation the
// save and the sheet use: computeSheetDerived's parts for saves, skills,
// initiative and spellcasting, builderHp.ts for hit points, acBreakdownFor
// for armor class, the gear receipt's weapon lines (receiptMath.ts) and the
// slots the save stores (casting.ts builderSpellSlots). This module only
// lays them out as rows and says what changed.
import type { Ability } from "@/lib/schemas/sheet";
import { pickedVariant, type SpeciesVariantGroup } from "@/lib/content/species-variants";
import { SRD_SKILLS, findSkill, formatModifier, proficiencyBonus, type DerivedPart } from "@/lib/srd";
import { ABILITY_NAMES } from "@/lib/srd/legality/types";
import { armorClassLine, hitPointsLine } from "./derivedReasons";
import type { BuilderDerived } from "./useBuilderDerived";

const ABILITIES: Ability[] = ["str", "dex", "con", "int", "wis", "cha"];
const COUNT_WORDS: Record<number, string> = { 1: "one", 2: "two", 3: "three", 4: "four" };

export type BuildMathRow = {
  // Stable across renders: the announcement compares rows by it.
  id: string;
  // The row header.
  label: string;
  value: string;
  // How the number is made: "Dex +3, proficiency +2".
  working: string;
};

export type BuildMathSection = { id: string; title: string; rows: BuildMathRow[] };

export type BuildMathInput = {
  derived: Pick<
    BuilderDerived,
    | "preview"
    | "hp"
    | "acInfo"
    | "ac"
    | "shownAbilities"
    | "effectiveLevel"
    | "spellSlots"
    | "purse"
    | "racialBonus"
    | "abilityGains"
  > &
    // A character with levels in more than one class (backlog F9).
    Partial<Pick<BuilderDerived, "extras" | "casterKlass" | "casterLevel" | "pactSlots" | "multiclass">>;
  // The scores as assigned, before the race's bonus.
  scores: Record<Ability, number | null>;
  klass: { name: string; hitDie: number } | undefined;
  // Built for a table that has chosen how hit points are worked.
  atTable: boolean;
};

// The parts as a line, in the sheet's own words and signs, as the sheet's
// own breakdown writes them: "DEX modifier +3, proficiency +2".
export function workingOf(parts: DerivedPart[]): string {
  return parts
    .map((part) => `${part.label} ${formatModifier(part.value)}`)
    .join(", ");
}

// The slot levels in order, keyed as the sheet keys its slots.
const SLOT_LEVELS: Array<[string, string]> = [
  ["1", "1st"], ["2", "2nd"], ["3", "3rd"], ["4", "4th"], ["5", "5th"], ["6", "6th"], ["7", "7th"], ["8", "8th"], ["9", "9th"],
];

export function buildMathSections({ derived, scores, klass, atTable }: BuildMathInput): BuildMathSection[] {
  const { preview, hp, shownAbilities, effectiveLevel } = derived;
  if (!preview || !shownAbilities || !hp || !klass) {
    return [];
  }
  const sheet = preview.derived;
  const sections: BuildMathSection[] = [];

  const hpLine = hitPointsLine({
    hitDie: klass.hitDie,
    level: effectiveLevel,
    maxHp: preview.maxHp,
    range: preview.hpRange,
    method: preview.hpMethod,
    kept: preview.hpKept,
    atTable,
    ...(derived.multiclass ? { dice: [klass.hitDie, ...(derived.extras ?? []).map((entry) => entry.klass.hitDie)] } : {}),
  });
  const parts = hp.parts;
  // A class list's later levels, class by class: each its own die.
  const split = hp.split ?? null;
  const nameOf = (id: string) =>
    derived.extras?.find((entry) => entry.klass.id === id)?.klass.name ?? klass.name;
  const hpWorking = preview.hpKept
    ? hpLine.reason
    : split
      ? [
          `level 1: d${parts.hitDie} ${parts.hitDie}, Con ${formatModifier(parts.conMod)}${parts.bonusPerLevel ? `, bonus ${formatModifier(parts.bonusPerLevel)}` : ""} = ${parts.firstLevel}`,
          ...split
            .filter((entry) => entry.levels > 0)
            .map((entry) =>
              preview.hpMethod === "rolled"
                ? `${entry.levels} ${nameOf(entry.id).toLowerCase()} ${entry.levels === 1 ? "level" : "levels"} rolled on a d${entry.hitDie} by the server when you save`
                : `${entry.levels} ${entry === split[0] ? "more " : ""}${nameOf(entry.id).toLowerCase()} ${entry.levels === 1 ? "level" : "levels"} at ${entry.perLevel} each (d${entry.hitDie}) = ${entry.levels * entry.perLevel}`,
            ),
          ...(parts.featureHp ? [`features ${formatModifier(parts.featureHp)}`] : []),
        ].join("; ")
      : [
        `level 1: d${parts.hitDie} ${parts.hitDie}, Con ${formatModifier(parts.conMod)}${parts.bonusPerLevel ? `, bonus ${formatModifier(parts.bonusPerLevel)}` : ""} = ${parts.firstLevel}`,
        ...(effectiveLevel > 1
          ? [
              preview.hpMethod === "rolled"
                ? `${effectiveLevel - 1} more levels rolled by the server when you save`
                : `${effectiveLevel - 1} more levels at ${parts.perLevel} each (${preview.hpMethod === "max" ? "die's highest face" : "average"} ${parts.face}, Con ${formatModifier(parts.conMod)}${parts.bonusPerLevel ? `, bonus ${formatModifier(parts.bonusPerLevel)}` : ""}) = ${parts.laterLevels}`,
            ]
          : []),
        ...(parts.featureHp ? [`features ${formatModifier(parts.featureHp)}`] : []),
      ].join("; ");
  const acLine = armorClassLine(derived.acInfo?.ac ?? derived.ac, derived.acInfo?.parts);
  sections.push({
    id: "core",
    title: "Core",
    rows: [
      { id: "ac", label: "Armor class", value: acLine.value, working: acLine.reason },
      { id: "hp", label: "Hit points", value: hpLine.value, working: hpWorking },
      { id: "initiative", label: "Initiative", value: formatModifier(sheet.initiative), working: workingOf(sheet.parts.initiative) },
      {
        id: "proficiency",
        label: "Proficiency bonus",
        value: formatModifier(sheet.proficiencyBonus),
        working: `level ${effectiveLevel}`,
      },
      {
        id: "passive-perception",
        label: "Passive Perception",
        value: String(sheet.passivePerception),
        working: workingOf(sheet.parts.passivePerception),
      },
    ],
  });

  sections.push({
    id: "abilities",
    title: "Ability scores",
    rows: ABILITIES.map((ability) => {
      const assigned = scores[ability];
      const race = derived.racialBonus[ability] ?? 0;
      const gains = derived.abilityGains[ability] ?? [];
      const working = [
        assigned === null ? null : `assigned ${assigned}`,
        race ? `race ${formatModifier(race)}` : null,
        ...gains.filter((gain) => gain.amount).map((gain) => `${gain.source} ${formatModifier(gain.amount)}`),
      ].filter(Boolean);
      return {
        id: `ability-${ability}`,
        label: ABILITY_NAMES[ability],
        value: `${shownAbilities[ability]} (${formatModifier(sheet.abilityMods[ability])})`,
        working: working.join(", "),
      };
    }),
  });

  sections.push({
    id: "saves",
    title: "Saving throws",
    rows: ABILITIES.map((ability) => ({
      id: `save-${ability}`,
      label: `${ABILITY_NAMES[ability]} save`,
      value: formatModifier(sheet.saves[ability]),
      working: workingOf(sheet.parts.saves[ability]),
    })),
  });

  sections.push({
    id: "skills",
    title: "Skills",
    rows: SRD_SKILLS.map((skill) => ({
      id: `skill-${skill.id}`,
      label: skill.name,
      value: formatModifier(sheet.skills[skill.id] ?? 0),
      working: workingOf(sheet.parts.skills[skill.id] ?? []),
    })),
  });

  // The table the slots are read from: the casting class's at its own
  // level, the first class's for a single class.
  const slotTable = derived.multiclass && derived.casterKlass
    ? `${derived.casterKlass.name} table at ${derived.casterKlass.name.toLowerCase()} level ${derived.casterLevel ?? effectiveLevel}`
    : `${klass.name} table at level ${effectiveLevel}`;
  const slotRows = [
    ...SLOT_LEVELS.flatMap(([level, ordinal]) => {
      const slot = derived.spellSlots[level];
      return slot && slot.max > 0
        ? [{ id: `slots-${level}`, label: `${ordinal}-level slots`, value: String(slot.max), working: slotTable }]
        : [];
    }),
    // A warlock's pact slots on a class list sit apart from the rest.
    ...(derived.pactSlots
      ? [
          {
            id: "slots-pact",
            label: "Pact magic slots",
            value: `${derived.pactSlots.max} at ${SLOT_LEVELS[derived.pactSlots.level - 1]?.[1] ?? derived.pactSlots.level} level`,
            working: "warlock levels, recovered on a short rest",
          },
        ]
      : []),
  ];
  if (sheet.spellSaveDc !== null || slotRows.length) {
    sections.push({
      id: "spells",
      title: "Spellcasting",
      rows: [
        ...(sheet.spellSaveDc !== null
          ? [{ id: "spell-dc", label: "Spell save DC", value: String(sheet.spellSaveDc), working: workingOf(sheet.parts.spellSaveDc) }]
          : []),
        ...(sheet.spellAttack !== null
          ? [{ id: "spell-attack", label: "Spell attack", value: formatModifier(sheet.spellAttack), working: workingOf(sheet.parts.spellAttack) }]
          : []),
        ...slotRows,
      ],
    });
  }

  const weapons = derived.purse.receipt.rows.flatMap((row) =>
    row.weapon && row.qty > 0
      ? [
          {
            id: `weapon-${row.name}`,
            label: row.name,
            value: `${formatModifier(row.weapon.toHit)} to hit, ${row.weapon.damage} ${row.weapon.damageType}`,
            working: [
              `to hit: ${workingOf(row.weapon.toHitParts)}`,
              `damage adds ${row.weapon.ability} modifier`,
              ...row.weapon.notes,
            ].join("; "),
          },
        ]
      : [],
  );
  if (weapons.length) {
    sections.push({ id: "weapons", title: "Weapons", rows: weapons });
  }
  return sections;
}

// What is already settled before the table can be worked out: before six
// scores there is no modifier, but the proficiency bonus, the class's hit
// die and saves, the ancestry's bonuses and speed and the skills picked so
// far are the sheet's already. Read from the same rows the save reads.
// The race is the one the builder reads, with its species option folded in
// (species-variants.ts withSpeciesVariant), so the option's bonuses are in
// racialBonus and the option itself is named.
export function knownSoFarRows({
  level,
  klass,
  race,
  racialBonus,
  proficientSkills,
}: {
  level: number;
  klass: { name: string; hitDie: number; saves: string[] } | undefined;
  race:
    | {
        name: string;
        speed: number;
        asi?: Partial<Record<Ability, number>>;
        asiChoice?: { count: number; amount: number };
        variants?: SpeciesVariantGroup;
      }
    | undefined;
  racialBonus: Partial<Record<Ability, number>>;
  proficientSkills: string[];
}): BuildMathRow[] {
  const bonuses = ABILITIES.flatMap((ability) =>
    racialBonus[ability] ? [`${ABILITY_NAMES[ability]} ${formatModifier(racialBonus[ability] ?? 0)}`] : [],
  );
  // The bumps the race leaves to the player (a half-elf's two +1s) that are
  // not placed yet: a placed one is in racialBonus beyond the race's own.
  const choice = race?.asiChoice;
  if (choice && choice.amount > 0) {
    const placed = ABILITIES.reduce((sum, ability) => sum + Math.max(0, (racialBonus[ability] ?? 0) - (race?.asi?.[ability] ?? 0)), 0);
    const owed = choice.count - Math.round(placed / choice.amount);
    if (owed > 0) {
      bonuses.push(`+${choice.amount} to ${COUNT_WORDS[owed] ?? owed} ${bonuses.length ? "more " : ""}of your choice`);
    }
  }
  const variant = race?.variants ? pickedVariant(race) : null;
  const skills = proficientSkills.flatMap((id) => {
    const skill = findSkill(id);
    return skill ? [skill.name] : [];
  });
  return [
    { id: "proficiency", label: "Proficiency bonus", value: formatModifier(proficiencyBonus(level)), working: `level ${level}` },
    ...(klass
      ? [
          { id: "hit-die", label: "Hit die", value: `d${klass.hitDie}`, working: klass.name },
          {
            id: "save-proficiencies",
            label: "Proficient saves",
            value: klass.saves.map((save) => ABILITY_NAMES[save] ?? save).join(", "),
            working: klass.name,
          },
        ]
      : []),
    ...(race?.variants
      ? [{ id: "species-choice", label: race.variants.label, value: variant?.name ?? "still to choose", working: race.name }]
      : []),
    ...(race
      ? [
          { id: "ancestry-bonuses", label: "Ancestry bonuses", value: bonuses.join(", ") || "none", working: race.name },
          { id: "speed", label: "Speed", value: `${race.speed} ft`, working: race.name },
        ]
      : []),
    ...(skills.length
      ? [{ id: "skill-proficiencies", label: "Proficient skills", value: skills.join(", "), working: "class, background and ancestry picks" }]
      : []),
  ];
}

// What a screen reader hears when picks move the numbers: the first number
// that changed, said as "Armor class 16, was 14", and how many more did. A
// row that appears is said with its value alone; one that goes is not said.
export function changeLine(before: ReadonlyMap<string, string>, after: BuildMathSection[]): string | null {
  const changed: string[] = [];
  for (const row of after.flatMap((section) => section.rows)) {
    const was = before.get(row.id);
    if (was === undefined) {
      changed.push(`${row.label} ${row.value}`);
    } else if (was !== row.value) {
      changed.push(`${row.label} ${row.value}, was ${was}`);
    }
  }
  if (!changed.length) {
    return null;
  }
  const more = changed.length - 1;
  return more ? `${changed[0]}. ${more} more ${more === 1 ? "number" : "numbers"} changed.` : `${changed[0]}.`;
}

export function snapshotOf(sections: BuildMathSection[]): Map<string, string> {
  return new Map(sections.flatMap((section) => section.rows.map((row) => [row.id, row.value] as const)));
}

type Timers = {
  setTimeout: (run: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
};

// One polite line per burst of changes. The first change after a quiet
// spell opens a window of `waitMs`; every change inside it is folded into
// the line said when it closes, compared against what was last said. The
// first table seen is the starting point and is not announced.
export function createChangeAnnouncer({
  say,
  waitMs = 1200,
  timers = { setTimeout: (run, ms) => setTimeout(run, ms), clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>) },
}: {
  say: (line: string) => void;
  waitMs?: number;
  timers?: Timers;
}) {
  let said: Map<string, string> | null = null;
  let latest: BuildMathSection[] = [];
  let pending: unknown = null;
  const flush = () => {
    pending = null;
    const line = said ? changeLine(said, latest) : null;
    said = snapshotOf(latest);
    if (line) {
      say(line);
    }
  };
  return {
    update(sections: BuildMathSection[]) {
      latest = sections;
      if (said === null || said.size === 0) {
        // Nothing to compare with yet: the table filling in for the first
        // time is not a change.
        said = snapshotOf(sections);
        return;
      }
      if (pending === null) {
        pending = timers.setTimeout(flush, waitMs);
      }
    },
    dispose() {
      if (pending !== null) {
        timers.clearTimeout(pending);
        pending = null;
      }
    },
  };
}
