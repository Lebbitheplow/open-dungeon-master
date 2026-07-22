// SRD beast stat blocks for the transformation engine: the forms druids
// actually take with Wild Shape and the classic Polymorph targets. Before
// this table the model invented every number (formHp/formAc were free
// integers) and the form had no abilities, speed, or attacks at all.
//
// Pure data like weapons.ts/armor.ts so scripts/test-beast-forms.mjs can
// import it directly. Data derived from the SRD 5.1, (c) Wizards of the
// Coast LLC, CC-BY-4.0. See docs/LICENSES.md.

export type BeastAttack = {
  name: string;
  toHit: number;
  // A dice expression the dice engine accepts ("2d4+2").
  damage: string;
  type: string;
};

export type BeastForm = {
  name: string;
  cr: number;
  ac: number;
  hp: number;
  // Walking speed in feet; fly/swim mark the movement modes that gate
  // which druid levels may take the form.
  speed: number;
  fly?: boolean;
  swim?: boolean;
  size: "Tiny" | "Small" | "Medium" | "Large" | "Huge";
  // Full ability scores. Wild Shape swaps only STR/DEX/CON onto the druid;
  // Polymorph replaces all six.
  abilities: { str: number; dex: number; con: number; int: number; wis: number; cha: number };
  attacks: BeastAttack[];
  // Attacks per turn (Multiattack); 1 when absent.
  attacksPerTurn?: number;
  // One line of the form's special senses/traits for the DM to narrate.
  traits?: string;
};

export const BEAST_FORMS: BeastForm[] = [
  {
    name: "Wolf", cr: 0.25, ac: 13, hp: 11, speed: 40, size: "Medium",
    abilities: { str: 12, dex: 15, con: 12, int: 3, wis: 12, cha: 6 },
    attacks: [{ name: "Bite", toHit: 4, damage: "2d4+2", type: "piercing" }],
    traits: "Keen Hearing and Smell; Pack Tactics (advantage when an ally is adjacent to the target). A bitten Medium-or-smaller target saves STR DC 11 or falls prone.",
  },
  {
    name: "Dire Wolf", cr: 1, ac: 14, hp: 37, speed: 50, size: "Large",
    abilities: { str: 17, dex: 15, con: 15, int: 3, wis: 12, cha: 7 },
    attacks: [{ name: "Bite", toHit: 5, damage: "2d6+3", type: "piercing" }],
    traits: "Keen Hearing and Smell; Pack Tactics. A bitten target saves STR DC 13 or falls prone.",
  },
  {
    name: "Black Bear", cr: 0.5, ac: 11, hp: 19, speed: 40, size: "Medium",
    abilities: { str: 15, dex: 10, con: 14, int: 2, wis: 12, cha: 7 },
    attacks: [
      { name: "Bite", toHit: 3, damage: "1d6+2", type: "piercing" },
      { name: "Claws", toHit: 3, damage: "2d4+2", type: "slashing" },
    ],
    attacksPerTurn: 2,
    traits: "Keen Smell; 30 ft climb.",
  },
  {
    name: "Brown Bear", cr: 1, ac: 11, hp: 34, speed: 40, size: "Large",
    abilities: { str: 19, dex: 10, con: 16, int: 2, wis: 13, cha: 7 },
    attacks: [
      { name: "Bite", toHit: 5, damage: "1d8+4", type: "piercing" },
      { name: "Claws", toHit: 5, damage: "2d6+4", type: "slashing" },
    ],
    attacksPerTurn: 2,
    traits: "Keen Smell; 30 ft climb.",
  },
  {
    name: "Panther", cr: 0.25, ac: 12, hp: 13, speed: 50, size: "Medium",
    abilities: { str: 14, dex: 15, con: 10, int: 3, wis: 14, cha: 7 },
    attacks: [
      { name: "Bite", toHit: 4, damage: "1d6+2", type: "piercing" },
      { name: "Claw", toHit: 4, damage: "1d4+2", type: "slashing" },
    ],
    traits: "Keen Smell; 40 ft climb; Pounce (a 20 ft charge before a claw hit knocks prone on a failed STR DC 12 save, then a bonus-action bite).",
  },
  {
    name: "Boar", cr: 0.25, ac: 11, hp: 11, speed: 40, size: "Medium",
    abilities: { str: 13, dex: 11, con: 12, int: 2, wis: 9, cha: 5 },
    attacks: [{ name: "Tusk", toHit: 3, damage: "1d6+1", type: "slashing" }],
    traits: "Charge (+1d6 after 20 ft straight); Relentless (once per rest, drops to 1 HP instead of 0).",
  },
  {
    name: "Elk", cr: 0.25, ac: 10, hp: 13, speed: 50, size: "Large",
    abilities: { str: 16, dex: 10, con: 12, int: 2, wis: 10, cha: 6 },
    attacks: [{ name: "Ram", toHit: 5, damage: "1d6+3", type: "bludgeoning" }],
    traits: "Charge (+2d6 and a prone save after 20 ft straight).",
  },
  {
    name: "Ape", cr: 0.5, ac: 12, hp: 19, speed: 30, size: "Medium",
    abilities: { str: 16, dex: 14, con: 14, int: 6, wis: 12, cha: 7 },
    attacks: [{ name: "Fist", toHit: 5, damage: "1d6+3", type: "bludgeoning" }],
    attacksPerTurn: 2,
    traits: "30 ft climb; can throw rocks (+5, 1d6+3, range 25/50).",
  },
  {
    name: "Crocodile", cr: 0.5, ac: 12, hp: 19, speed: 20, swim: true, size: "Large",
    abilities: { str: 15, dex: 10, con: 13, int: 2, wis: 10, cha: 5 },
    attacks: [{ name: "Bite", toHit: 4, damage: "1d10+2", type: "piercing" }],
    traits: "30 ft swim; Hold Breath 15 minutes; the bite grapples (escape DC 12).",
  },
  {
    name: "Giant Spider", cr: 1, ac: 14, hp: 26, speed: 30, size: "Large",
    abilities: { str: 14, dex: 16, con: 12, int: 2, wis: 11, cha: 4 },
    attacks: [{ name: "Bite", toHit: 5, damage: "1d8+3", type: "piercing" }],
    traits: "30 ft climb, Spider Climb, Web Sense; the bite adds 2d8 poison (CON DC 11 halves) and can paralyze at 0 HP; Web (recharge 5-6) restrains at range.",
  },
  {
    name: "Giant Eagle", cr: 1, ac: 13, hp: 26, speed: 10, fly: true, size: "Large",
    abilities: { str: 16, dex: 17, con: 13, int: 8, wis: 14, cha: 10 },
    attacks: [
      { name: "Beak", toHit: 5, damage: "1d6+3", type: "piercing" },
      { name: "Talons", toHit: 5, damage: "2d6+3", type: "slashing" },
    ],
    attacksPerTurn: 2,
    traits: "80 ft fly; Keen Sight (advantage on sight Perception).",
  },
  {
    name: "Giant Octopus", cr: 1, ac: 11, hp: 52, speed: 10, swim: true, size: "Large",
    abilities: { str: 17, dex: 13, con: 13, int: 4, wis: 10, cha: 4 },
    attacks: [{ name: "Tentacles", toHit: 5, damage: "2d6+3", type: "bludgeoning" }],
    traits: "60 ft swim; Hold Breath out of water; the tentacles grapple and restrain (escape DC 16); ink cloud to flee.",
  },
  {
    name: "Giant Constrictor Snake", cr: 2, ac: 12, hp: 60, speed: 30, swim: true, size: "Huge",
    abilities: { str: 19, dex: 14, con: 12, int: 1, wis: 10, cha: 3 },
    attacks: [
      { name: "Bite", toHit: 6, damage: "2d6+4", type: "piercing" },
      { name: "Constrict", toHit: 6, damage: "2d8+4", type: "bludgeoning" },
    ],
    traits: "30 ft swim; Constrict grapples and restrains (escape DC 16).",
  },
  {
    name: "Mammoth", cr: 6, ac: 13, hp: 126, speed: 40, size: "Huge",
    abilities: { str: 24, dex: 9, con: 21, int: 3, wis: 11, cha: 6 },
    attacks: [{ name: "Gore", toHit: 10, damage: "4d8+7", type: "piercing" }],
    traits: "Trampling Charge (a gore after 20 ft straight knocks prone on a failed STR DC 18 save, then a bonus-action stomp for 4d10+7).",
  },
  {
    name: "Giant Ape", cr: 7, ac: 12, hp: 157, speed: 40, size: "Huge",
    abilities: { str: 23, dex: 14, con: 18, int: 7, wis: 12, cha: 7 },
    attacks: [{ name: "Fist", toHit: 9, damage: "3d10+6", type: "bludgeoning" }],
    attacksPerTurn: 2,
    traits: "40 ft climb; can throw rocks (+9, 7d6+6, range 50/100).",
  },
  {
    name: "Tyrannosaurus Rex", cr: 8, ac: 13, hp: 136, speed: 50, size: "Huge",
    abilities: { str: 25, dex: 10, con: 19, int: 2, wis: 12, cha: 9 },
    attacks: [
      { name: "Bite", toHit: 10, damage: "4d12+7", type: "piercing" },
      { name: "Tail", toHit: 10, damage: "3d8+7", type: "bludgeoning" },
    ],
    attacksPerTurn: 2,
    traits: "The bite grapples a Medium-or-smaller target (escape DC 17); Multiattack cannot aim both at the same target.",
  },
];

const byName = new Map(BEAST_FORMS.map((form) => [normalize(form.name), form]));

function normalize(term: string) {
  return term.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

// Fuzzy find: exact first, then a form whose name sits inside the request
// ("shaggy brown bear" -> Brown Bear). Longest name wins so "dire wolf"
// never lands on "Wolf".
export function findBeastForm(term: string): BeastForm | null {
  const wanted = normalize(term);
  if (!wanted) {
    return null;
  }
  const exact = byName.get(wanted);
  if (exact) {
    return exact;
  }
  const candidates = BEAST_FORMS.filter((form) => {
    const name = normalize(form.name);
    return wanted.includes(name) || name.includes(wanted);
  });
  candidates.sort((a, b) => b.name.length - a.name.length);
  return candidates[0] ?? null;
}

// SRD Wild Shape ceilings by druid level; Circle of the Moon raises the CR
// (1 from 2nd, level/3 from 6th) but not the movement gates.
export function wildShapeCapsFor(
  level: number,
  moonDruid: boolean,
): { maxCr: number; fly: boolean; swim: boolean } {
  const clamped = Math.max(1, Math.min(20, Math.floor(level)));
  const baseCr = clamped >= 8 ? 1 : clamped >= 4 ? 0.5 : 0.25;
  const moonCr = clamped >= 6 ? Math.max(1, Math.floor(clamped / 3)) : 1;
  return {
    maxCr: moonDruid ? Math.max(baseCr, moonCr) : baseCr,
    fly: clamped >= 8,
    swim: clamped >= 4,
  };
}

// Human-readable CR ("1/4" not "0.25") for error messages.
export function formatCr(cr: number): string {
  if (cr === 0.125) return "1/8";
  if (cr === 0.25) return "1/4";
  if (cr === 0.5) return "1/2";
  return String(cr);
}
