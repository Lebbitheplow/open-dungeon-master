// What a worn magic item does to an ability check. magic-items.ts carries the
// AC, save, score and resistance riders; the SRD items whose numbers ride
// checks are listed here, authored from their SRD 5.1 text, and read by the
// roll resolver (src/lib/dm/rolls.ts) and the passive scores.
//
// The same rules as the other riders: the item is worn (or, where its text
// says so, carried), attuned if it asks for attunement, and a second copy
// adds nothing.

import { isWorn } from "@/lib/srd/armor";

type Skill = string;

type CheckRiderRow = {
  names: string[];
  requiresAttunement: boolean;
  // Works from the pack ("while this polished agate is on your person").
  carried?: boolean;
  // Added to every ability check (Stone of Good Luck).
  bonus?: number;
  // Added to checks of these skills (Gloves of Thievery: Sleight of Hand).
  skillBonus?: Record<Skill, number>;
  // Advantage on checks of these skills. The SRD's narrower wording ("that
  // rely on sight", "to move silently") is the ordinary use of the skill,
  // which is how the table reads it.
  advantage?: Skill[];
  effect: string;
};

const ROWS: CheckRiderRow[] = [
  {
    names: ["stone of good luck", "luckstone", "stone of good luck (luckstone)"],
    requiresAttunement: true,
    carried: true,
    bonus: 1,
    effect: "Stone of Good Luck: +1 to ability checks",
  },
  {
    names: ["cloak of elvenkind"],
    requiresAttunement: true,
    advantage: ["stealth"],
    effect: "Cloak of Elvenkind: advantage on Stealth checks",
  },
  {
    names: ["boots of elvenkind"],
    requiresAttunement: false,
    advantage: ["stealth"],
    effect: "Boots of Elvenkind: advantage on Stealth checks to move silently",
  },
  {
    names: ["eyes of the eagle"],
    requiresAttunement: true,
    advantage: ["perception"],
    effect: "Eyes of the Eagle: advantage on Perception checks that rely on sight",
  },
  {
    names: ["robe of eyes"],
    requiresAttunement: true,
    advantage: ["perception"],
    effect: "Robe of Eyes: advantage on Perception checks that rely on sight",
  },
  {
    names: ["eyes of minute seeing"],
    requiresAttunement: false,
    advantage: ["investigation"],
    effect: "Eyes of Minute Seeing: advantage on Investigation checks that rely on sight",
  },
  {
    names: ["gloves of thievery"],
    requiresAttunement: false,
    skillBonus: { sleight_of_hand: 5 },
    effect: "Gloves of Thievery: +5 to Sleight of Hand checks",
  },
];

const keyOf = (name: string) =>
  name.trim().toLowerCase().replace(/^\+\d\s+/, "").replace(/\s+/g, " ");

// What a published item adds to checks, in the workshop's words, for a copy
// to start from (src/lib/workshop/catalog-mechanics.ts).
export function checkRidersOf(name: string): {
  bonus?: number;
  skillBonus?: Record<string, number>;
  advantage?: string[];
  requiresAttunement: boolean;
  carried: boolean;
} | null {
  const row = rowFor(name);
  if (!row) {
    return null;
  }
  return {
    requiresAttunement: row.requiresAttunement,
    carried: row.carried === true,
    ...(row.bonus ? { bonus: row.bonus } : {}),
    ...(row.skillBonus ? { skillBonus: row.skillBonus } : {}),
    ...(row.advantage?.length ? { advantage: row.advantage } : {}),
  };
}

function rowFor(name: string): CheckRiderRow | null {
  const key = keyOf(name);
  const bare = key.replace(/\s*\([^()]*\)\s*$/, "");
  return ROWS.find((row) => row.names.includes(key) || row.names.includes(bare)) ?? null;
}

type CarriedItem = { name: string; equipped?: boolean; attuned?: boolean; gear?: unknown };

type RowGear = {
  checks?: { bonus?: number; skillBonus?: Record<string, number>; advantage?: string[] };
  magic?: { requiresAttunement?: boolean; carried?: boolean };
};

// A workshop item's own check riders, as a row of this table: what it adds
// to checks rides on its line (src/lib/homebrew/item-data.ts).
function homebrewRow(item: CarriedItem): CheckRiderRow | null {
  const gear = item.gear as RowGear | undefined;
  const checks = gear?.checks;
  if (!checks) {
    return null;
  }
  const bits = [
    checks.bonus ? `${checks.bonus >= 0 ? "+" : ""}${checks.bonus} to ability checks` : "",
    ...Object.entries(checks.skillBonus ?? {}).map(([skill, bonus]) => `${bonus >= 0 ? "+" : ""}${bonus} to ${skill.replace(/_/g, " ")} checks`),
    checks.advantage?.length ? `advantage on ${checks.advantage.map((skill) => skill.replace(/_/g, " ")).join(", ")} checks` : "",
  ].filter(Boolean);
  return {
    names: [keyOf(item.name)],
    requiresAttunement: gear?.magic?.requiresAttunement === true,
    ...(gear?.magic?.carried ? { carried: true } : {}),
    ...(checks.bonus ? { bonus: checks.bonus } : {}),
    ...(checks.skillBonus ? { skillBonus: checks.skillBonus } : {}),
    ...(checks.advantage?.length ? { advantage: checks.advantage } : {}),
    effect: `${item.name}: ${bits.join("; ")}`,
  };
}

export type ItemCheckRiders = {
  bonus: number;
  advantage: boolean;
  notes: string[];
};

// The riders the character's items put on one check. `skill` is the skill
// id for a skill check, absent for a raw ability check (which still takes the
// flat bonus of a Stone of Good Luck).
export function itemCheckRiders(
  equipment: CarriedItem[] | undefined,
  skill?: string,
): ItemCheckRiders {
  const out: ItemCheckRiders = { bonus: 0, advantage: false, notes: [] };
  const counted = new Set<CheckRiderRow>();
  for (const item of equipment ?? []) {
    const row = homebrewRow(item) ?? rowFor(item.name);
    if (!row || counted.has(row) || [...counted].some((seen) => seen.names[0] === row.names[0] && seen.effect === row.effect)) {
      continue;
    }
    if (!row.carried && !isWorn(item, equipment ?? [])) {
      continue;
    }
    if (row.requiresAttunement && !item.attuned) {
      continue;
    }
    let applies = false;
    if (row.bonus) {
      out.bonus += row.bonus;
      applies = true;
    }
    if (skill && row.skillBonus?.[skill]) {
      out.bonus += row.skillBonus[skill];
      applies = true;
    }
    if (skill && row.advantage?.includes(skill)) {
      out.advantage = true;
      applies = true;
    }
    if (applies) {
      counted.add(row);
      out.notes.push(row.effect);
    }
  }
  return out;
}
