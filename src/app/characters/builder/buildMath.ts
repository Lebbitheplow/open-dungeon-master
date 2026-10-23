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
import { SRD_SKILLS, formatModifier, type DerivedPart } from "@/lib/srd";
import { ABILITY_NAMES } from "@/lib/srd/legality/types";
import { armorClassLine, hitPointsLine } from "./derivedReasons";
import type { BuilderDerived } from "./useBuilderDerived";

const ABILITIES: Ability[] = ["str", "dex", "con", "int", "wis", "cha"];

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
  >;
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
  });
  const parts = hp.parts;
  const hpWorking = preview.hpKept
    ? hpLine.reason
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

  const slotRows = SLOT_LEVELS.flatMap(([level, ordinal]) => {
    const slot = derived.spellSlots[level];
    return slot && slot.max > 0
      ? [{ id: `slots-${level}`, label: `${ordinal}-level slots`, value: String(slot.max), working: `${klass.name} table at level ${effectiveLevel}` }]
      : [];
  });
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
