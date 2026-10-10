// How many of what a summoning spell makes, from which slot, for how long
// (SRD 5.1). Pure: src/lib/dm/summon-cast.ts asks summonPlan before anything
// is spent, and spawns what it answers.

import { findSummonForm, type SummonForm } from "@/lib/srd/summon-forms";

const HOUR = 600;
const DAY = 14400;

export type SummonSpell = {
  name: string;
  // Durable Summons reads it: a conjuration spell's creatures get its hit points.
  school: string;
  level: number;
  concentration: boolean;
  // Rounds the creatures last (null: until dismissed or destroyed).
  rounds: number | null;
  // The creature types it may call, or the named forms it makes.
  types?: string[];
  forms?: string[];
  // How many creatures of a challenge rating one casting brings (Conjure
  // Animals: [2, 1], [1, 2], [0.5, 4], [0.25, 8]).
  byCr?: Array<[number, number]>;
  // How the count multiplies with the slot ([5, 2]: twice from 5th).
  multiplier?: Array<[number, number]>;
  // One creature of at most this challenge rating, one more per slot level
  // above the spell's own when `crPerSlot`.
  maxCr?: number;
  crPerSlot?: number;
  // Conjure Celestial: a 9th level slot raises the rating to 5.
  maxCrBySlot?: Array<[number, number]>;
  // A fixed number of each named form (Giant Insect), and the creatures one
  // more slot level adds (Animate Dead: two).
  countByForm?: Record<string, number>;
  base?: number;
  perSlotLevel?: number;
  // Create Undead: what each slot level makes.
  bySlot?: Array<[number, Record<string, number>]>;
  // Animate Objects: a budget of objects, larger ones counting for more.
  objectBudget?: { base: number; perSlotLevel: number; cost: Record<string, number> };
  hostileOnBreak?: boolean;
  // Animate Dead, Create Undead: the duration is the caster's control, not
  // the creature's life. When it runs out the undead stays and turns on the
  // party; a casting may instead reassert control over this many of the
  // ones already made (and `reassertPerSlot` more a slot level above).
  controlExpires?: boolean;
  reassert?: number;
  reassertPerSlot?: number;
  // "group": one initiative roll for the lot, on its own turns; "caster": it
  // acts right after its maker (Giant Insect: "they act on your turn").
  initiative: "group" | "caster";
  // Find Steed: one at a time; a new casting replaces the old.
  single?: boolean;
  // Find Steed: an Intelligence below 6 becomes 6.
  minInt?: number;
  // Phantom Steed's speed.
  speed?: number;
  // Faithful Hound: it acts at the start of its caster's turn (its entry
  // goes right before the caster's).
  beforeCaster?: boolean;
  // The conditions it arrives with (the invisible hound).
  conditions?: string[];
  note: string;
};


const CR_TIERS: Array<[number, number]> = [[2, 1], [1, 2], [0.5, 4], [0.25, 8]];

export const SUMMON_SPELLS: SummonSpell[] = [
  {
    name: "Conjure Animals", school: "conjuration", level: 3, concentration: true, rounds: HOUR, types: ["beast"],
    byCr: CR_TIERS, multiplier: [[5, 2], [7, 3], [9, 4]], initiative: "group",
    note: "Fey spirits in beast form: one beast of CR 2, two of CR 1, four of CR 1/2 or eight of CR 1/4 (twice as many from a 5th level slot, three times from 7th, four from 9th).",
  },
  {
    name: "Conjure Woodland Beings", school: "conjuration", level: 4, concentration: true, rounds: HOUR, types: ["fey"],
    byCr: CR_TIERS, multiplier: [[6, 2], [8, 3]], initiative: "group",
    note: "Fey creatures: one of CR 2, two of CR 1, four of CR 1/2 or eight of CR 1/4 (twice as many from a 6th level slot, three times from 8th).",
  },
  {
    name: "Conjure Minor Elementals", school: "conjuration", level: 4, concentration: true, rounds: HOUR, types: ["elemental"],
    byCr: CR_TIERS, multiplier: [[6, 2], [8, 3]], initiative: "group",
    note: "Elementals: one of CR 2, two of CR 1, four of CR 1/2 or eight of CR 1/4 (twice as many from a 6th level slot, three times from 8th).",
  },
  {
    name: "Conjure Elemental", school: "conjuration", level: 5, concentration: true, rounds: HOUR, types: ["elemental"],
    maxCr: 5, crPerSlot: 1, hostileOnBreak: true, initiative: "group",
    note: "One elemental of CR 5 or lower (one higher for each slot level above 5th). If concentration breaks it stays and turns hostile.",
  },
  {
    name: "Conjure Fey", school: "conjuration", level: 6, concentration: true, rounds: HOUR, types: ["fey", "beast"],
    maxCr: 6, crPerSlot: 1, hostileOnBreak: true, initiative: "group",
    note: "One fey or fey spirit in beast form of CR 6 or lower (one higher for each slot level above 6th). If concentration breaks it stays and turns hostile.",
  },
  {
    name: "Conjure Celestial", school: "conjuration", level: 7, concentration: true, rounds: HOUR, types: ["celestial"],
    maxCr: 4, maxCrBySlot: [[9, 5]], initiative: "group",
    note: "One celestial of CR 4 or lower (CR 5 from a 9th level slot).",
  },
  {
    name: "Animate Dead", school: "necromancy", level: 3, concentration: false, rounds: DAY, forms: ["Skeleton", "Zombie"],
    base: 1, perSlotLevel: 2, initiative: "group", controlExpires: true, reassert: 4, reassertPerSlot: 2,
    note: "A skeleton or zombie under the caster's command for 24 hours (two more for each slot level above 3rd); a bonus action commands them all.",
  },
  {
    name: "Create Undead", school: "necromancy", level: 6, concentration: false, rounds: DAY, forms: ["Ghoul", "Ghast", "Wight", "Mummy"],
    controlExpires: true, reassert: 3, reassertPerSlot: 1,
    bySlot: [
      [6, { Ghoul: 3 }],
      [7, { Ghoul: 4 }],
      [8, { Ghoul: 5, Ghast: 2, Wight: 2 }],
      [9, { Ghoul: 6, Ghast: 3, Wight: 3, Mummy: 2 }],
    ],
    initiative: "group",
    note: "Ghouls under the caster's command for 24 hours; from 8th level ghasts or wights, from 9th mummies.",
  },
  {
    name: "Giant Insect", school: "transmutation", level: 4, concentration: true, rounds: 100,
    forms: ["Giant Centipede", "Giant Spider", "Giant Wasp", "Giant Scorpion"],
    countByForm: { "Giant Centipede": 10, "Giant Spider": 3, "Giant Wasp": 5, "Giant Scorpion": 1 },
    initiative: "caster",
    note: "Ten centipedes, three spiders, five wasps or one scorpion grow giant for 10 minutes and act on the caster's turn.",
  },
  {
    name: "Find Steed", school: "conjuration", level: 2, concentration: false, rounds: null,
    forms: ["Warhorse", "Pony", "Camel", "Elk", "Mastiff"], base: 1, single: true, minInt: 6,
    initiative: "caster",
    note: "A celestial, fey or fiend steed with the chosen form's statistics (Intelligence at least 6), until dismissed or dropped to 0 hit points; one at a time.",
  },
  {
    name: "Phantom Steed", school: "illusion", level: 3, concentration: false, rounds: HOUR, forms: ["Riding Horse"], base: 1,
    speed: 100, initiative: "caster",
    note: "A quasi-real horse with a riding horse's statistics and a speed of 100 feet for an hour; it disappears if it takes any damage.",
  },
  {
    name: "Animate Objects", school: "transmutation", level: 5, concentration: true, rounds: 10,
    forms: ["Animated Object (Tiny)", "Animated Object (Small)", "Animated Object (Medium)", "Animated Object (Large)", "Animated Object (Huge)"],
    objectBudget: {
      base: 10,
      perSlotLevel: 2,
      cost: { "Animated Object (Tiny)": 1, "Animated Object (Small)": 1, "Animated Object (Medium)": 2, "Animated Object (Large)": 4, "Animated Object (Huge)": 8 },
    },
    initiative: "caster",
    note: "Ten objects (Medium count as two, Large four, Huge eight; two more per slot level above 5th) with the spell's table; a bonus action commands them.",
  },
  {
    name: "Arcane Hand", school: "evocation", level: 5, concentration: true, rounds: 10, forms: ["Arcane Hand"], base: 1,
    initiative: "caster",
    note: "A Large hand of force: AC 20, hit points equal to the caster's hit point maximum, Strength 26; Clenched Fist is a melee spell attack at the caster's bonus for 4d8 force (2d8 more per slot level above 5th); it grapples with its own Strength (Grasping Hand, crushing for 2d6 + the caster's spellcasting modifier), shoves (Forceful Hand) or gives half cover (Interposing Hand).",
  },
  {
    name: "Faithful Hound", school: "conjuration", level: 4, concentration: false, rounds: 8 * HOUR, forms: ["Faithful Hound"], base: 1,
    beforeCaster: true, conditions: ["invisible"], initiative: "caster",
    note: "An invisible phantom watchdog that cannot be harmed and stays where it was conjured for 8 hours; at the start of the caster's turns it bites one hostile creature within 5 feet (the caster's spell attack bonus, 4d8 piercing).",
  },
  {
    name: "Unseen Servant", school: "conjuration", level: 1, concentration: false, rounds: HOUR, forms: ["Unseen Servant"], base: 1,
    initiative: "caster",
    note: "An invisible force (AC 10, 1 hit point, Strength 2) that cannot attack.",
  },
];

const key = (name: string) => name.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// A summoning spell spent through a bare slot would leave its creatures to be
// invented: the refusal that sends it to cast_buff, or null.
export function summonSlotProblem(spell: string): string | null {
  const summoning = summonSpellFor(spell);
  return summoning
    ? `${summoning.name} brings its creatures in with their stat blocks: cast it with cast_buff, the creature in variant (and count for fewer). Nothing was spent.`
    : null;
}

export function summonSpellFor(spell: string): SummonSpell | null {
  const wanted = key(spell);
  return SUMMON_SPELLS.find((entry) => key(entry.name) === wanted) ?? null;
}

const crLabel = (cr: number) => (cr === 0.125 ? "1/8" : cr === 0.25 ? "1/4" : cr === 0.5 ? "1/2" : String(cr));

export type SummonPlan = { form: SummonForm; count: number; spell: SummonSpell };

// What one casting of `spell` from `slotLevel` makes of the form the caller
// names, or the rule it breaks. `wanted` caps the count below the most the
// slot allows.
export function summonPlan(
  spell: SummonSpell,
  slotLevel: number,
  formName: string,
  wanted?: number,
): SummonPlan | { error: string } {
  const above = Math.max(0, slotLevel - spell.level);
  const named = formName.trim();
  // A spell with a fixed list reads the caller's word against that list
  // first, so "spider" is Giant Insect's Giant Spider.
  const fromList = spell.forms?.map((name) => findSummonForm(name)).find((form) => form && key(form.name).includes(key(named)));
  const form = fromList ?? (named ? findSummonForm(named) : spell.forms?.length === 1 ? findSummonForm(spell.forms[0]) : null);
  if (!form) {
    const offer = spell.forms?.join(", ") ?? `a ${spell.types?.join(" or ")} the server knows`;
    return { error: `${spell.name} needs the creature in variant (${offer}); "${named}" is not one the server has a stat block for. Nothing was spent.` };
  }
  if (spell.forms && !spell.forms.includes(form.name)) {
    return { error: `${spell.name} makes ${spell.forms.join(", ")}, not a ${form.name}. Nothing was spent.` };
  }
  if (spell.types && !spell.types.includes(form.type)) {
    return { error: `${spell.name} calls a ${spell.types.join(" or ")}; a ${form.name} is a ${form.type}. Nothing was spent.` };
  }
  let most = 1;
  if (spell.byCr) {
    const tier = [...spell.byCr].reverse().find(([cr]) => form.cr <= cr);
    if (!tier) {
      return { error: `${spell.name} calls creatures of challenge rating ${crLabel(spell.byCr[0][0])} or lower; a ${form.name} is CR ${crLabel(form.cr)}. Nothing was spent.` };
    }
    const factor = [...(spell.multiplier ?? [])].reverse().find(([slot]) => slotLevel >= slot)?.[1] ?? 1;
    most = tier[1] * factor;
  } else if (spell.maxCr !== undefined) {
    const bySlot = [...(spell.maxCrBySlot ?? [])].reverse().find(([slot]) => slotLevel >= slot)?.[1];
    const ceiling = bySlot ?? spell.maxCr + (spell.crPerSlot ?? 0) * above;
    if (form.cr > ceiling) {
      return { error: `${spell.name} from a level ${slotLevel} slot calls a creature of challenge rating ${crLabel(ceiling)} or lower; a ${form.name} is CR ${crLabel(form.cr)}. Nothing was spent.` };
    }
  } else if (spell.countByForm) {
    most = spell.countByForm[form.name] ?? 1;
  } else if (spell.bySlot) {
    const row = [...spell.bySlot].reverse().find(([slot]) => slotLevel >= slot)?.[1] ?? {};
    const allowed = row[form.name];
    if (!allowed) {
      return { error: `${spell.name} from a level ${slotLevel} slot makes ${Object.entries(row).map(([name, count]) => `${count} ${name.toLowerCase()}s`).join(" or ")}; not a ${form.name}. Nothing was spent.` };
    }
    most = allowed;
  } else if (spell.objectBudget) {
    const cost = spell.objectBudget.cost[form.name] ?? 1;
    most = Math.floor((spell.objectBudget.base + spell.objectBudget.perSlotLevel * above) / cost);
  } else {
    most = (spell.base ?? 1) + (spell.perSlotLevel ?? 0) * above;
  }
  const count = wanted && wanted > 0 ? Math.min(wanted, most) : most;
  return { form, count: Math.max(1, count), spell };
}
