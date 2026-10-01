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

function rowFor(name: string): CheckRiderRow | null {
  const key = keyOf(name);
  const bare = key.replace(/\s*\([^()]*\)\s*$/, "");
  return ROWS.find((row) => row.names.includes(key) || row.names.includes(bare)) ?? null;
}

type CarriedItem = { name: string; equipped?: boolean; attuned?: boolean };

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
    const row = rowFor(item.name);
    if (!row || counted.has(row)) {
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
