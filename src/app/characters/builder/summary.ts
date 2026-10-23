import { ABILITIES } from "@/lib/schemas/abilities";
import type { Ability, AbilityScores } from "@/lib/schemas/sheet";
import { owedPicks, type OwedPick } from "./owed";
import type { StepBlock } from "./submit";

// The summary at the top of the last step (backlog F3): one row per step,
// what it holds in plain words and every pick it still owes, each with a
// way to the field that takes it. An edit opens here and a new build ends
// here, so the rows are what a player reads before saving. Pure, for
// scripts/test-builder-summary.mjs.

export type SummaryRowKey = "identity" | "ancestry" | "calling" | "abilities" | "spells-gear" | "finish";

export type SummaryRow = {
  key: SummaryRowKey;
  label: string;
  // What the step holds, one plain line each.
  lines: string[];
  // What it still owes, in the gate's order (owed.ts).
  owed: OwedPick[];
};

export type SummaryInput = {
  name: string;
  background?: string;
  race?: string;
  klass?: string;
  subclass?: string;
  level: number;
  abilities: AbilityScores | null;
  casts: boolean;
  cantrips: string[];
  spells: string[];
  gear: Array<{ name: string; qty: number }>;
  alignment?: string;
  portrait: boolean;
  appearance: boolean;
  backstory: boolean;
  owed: {
    identity: ReadonlyArray<StepBlock>;
    ancestry: ReadonlyArray<StepBlock>;
    calling: ReadonlyArray<StepBlock>;
    abilities: ReadonlyArray<StepBlock>;
    spells: ReadonlyArray<StepBlock>;
  };
};

const ABILITY_SHORT: Record<Ability, string> = {
  str: "Str",
  dex: "Dex",
  con: "Con",
  int: "Int",
  wis: "Wis",
  cha: "Cha",
};

// "Fire Bolt, Light and 2 more": a few names, then a count.
export function someNames(names: string[], shown = 3): string {
  if (names.length <= shown) {
    if (names.length <= 1) return names.join("");
    return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  }
  return `${names.slice(0, shown).join(", ")} and ${names.length - shown} more`;
}

const counted = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

export function summaryRows(input: SummaryInput): SummaryRow[] {
  const name = input.name.trim();
  const items = input.gear.reduce((sum, item) => sum + Math.max(item.qty, 1), 0);
  const gearLine = items
    ? `Gear: ${counted(items, "item", "items")}, ${someNames(input.gear.map((item) => item.name))}`
    : "No gear packed";
  const touches = [
    input.alignment ? `Alignment ${input.alignment}` : null,
    input.portrait ? "Portrait added" : "No portrait yet",
    input.appearance ? "Appearance written" : null,
    input.backstory ? "Backstory written" : "No backstory yet",
  ].filter((line): line is string => Boolean(line));
  return [
    {
      key: "identity",
      label: "Name and background",
      lines: [name || "No name yet", input.background ? `${input.background} background` : "No background chosen"],
      owed: owedPicks(input.owed.identity),
    },
    {
      key: "ancestry",
      label: "Ancestry",
      lines: [input.race ?? "No ancestry chosen"],
      owed: owedPicks(input.owed.ancestry),
    },
    {
      key: "calling",
      label: "Class",
      lines: input.klass
        ? [`${input.klass}, level ${input.level}`, ...(input.subclass ? [input.subclass] : [])]
        : ["No class chosen"],
      owed: owedPicks(input.owed.calling),
    },
    {
      key: "abilities",
      label: "Ability scores",
      lines: [
        input.abilities
          ? ABILITIES.map((ability) => `${ABILITY_SHORT[ability]} ${input.abilities?.[ability]}`).join(", ")
          : "Not set yet",
      ],
      owed: owedPicks(input.owed.abilities),
    },
    {
      key: "spells-gear",
      label: input.casts ? "Spells and gear" : "Gear",
      lines: [
        ...(input.casts
          ? [
              input.cantrips.length ? `Cantrips: ${someNames(input.cantrips)}` : "No cantrips chosen",
              input.spells.length ? `Spells: ${someNames(input.spells)}` : "No spells chosen",
            ]
          : []),
        gearLine,
      ],
      owed: owedPicks(input.owed.spells),
    },
    { key: "finish", label: "Finishing touches", lines: touches, owed: [] },
  ];
}

// Every pick still owed across the rows, for the line above them.
export function summaryOwedCount(rows: SummaryRow[]): number {
  return rows.reduce((sum, row) => sum + row.owed.length, 0);
}
