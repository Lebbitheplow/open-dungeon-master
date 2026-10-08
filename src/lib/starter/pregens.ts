import type { CreateSheetInput } from "@/lib/schemas/sheet";

// Four ready-made heroes for a table that wants to start in ten minutes.
// Each is a complete level 1 sheet in the shape the character builder
// submits: standard array with the human's +1 on every score, the class's
// starting kit as the book's first choices, the background's tool pick
// made. They pass the same admission door as any player's character
// (src/lib/characters/admit.ts, scripts/test-starter.mjs proves it), so
// nothing here is special-cased at the table: once picked, a hero is a
// library character like any other.

export type Pregen = {
  id: string;
  // What the picker card says.
  tagline: string;
  blurb: string;
  sheet: CreateSheetInput;
};

const pack = (names: Array<[string, number?]>) => names.map(([name, qty]) => ({ name, qty: qty ?? 1 }));

const EXPLORER = pack([
  ["Backpack"], ["Bedroll"], ["Mess Kit"], ["Tinderbox"], ["Torch", 10], ["Rations (1 day)", 10], ["Waterskin"], ["Rope, Hempen (50 feet)"],
]);
const DUNGEONEER = pack([
  ["Backpack"], ["Crowbar"], ["Hammer"], ["Piton", 10], ["Torch", 10], ["Tinderbox"], ["Rations (1 day)", 10], ["Waterskin"], ["Rope, Hempen (50 feet)"],
]);
const BURGLAR = pack([
  ["Backpack"], ["Ball Bearings (bag of 1000)"], ["String (10 feet)"], ["Bell"], ["Candle", 5], ["Crowbar"], ["Hammer"], ["Piton", 10],
  ["Lantern, Hooded"], ["Oil (flask)", 2], ["Rations (1 day)", 5], ["Tinderbox"], ["Waterskin"], ["Rope, Hempen (50 feet)"],
]);
const PRIEST = pack([
  ["Backpack"], ["Blanket"], ["Candle", 10], ["Tinderbox"], ["Alms Box"], ["Block of Incense", 2], ["Censer"], ["Vestments"], ["Rations (1 day)", 2], ["Waterskin"],
]);

const base: Pick<
  CreateSheetInput,
  | "subclass" | "alignment" | "gender" | "appearance" | "speed" | "classes" | "hitDicePools" | "gold" | "copper"
  | "feats" | "features" | "asiChoices" | "spellcasting" | "portrait" | "notes" | "backstory"
> = {
  subclass: "",
  alignment: "",
  gender: "",
  appearance: "",
  speed: 30,
  classes: [],
  hitDicePools: null,
  gold: 0,
  copper: 0,
  feats: [],
  features: [],
  asiChoices: [],
  spellcasting: null,
  portrait: null,
  notes: "",
  backstory: "",
};

export const PREGENS: Pregen[] = [
  {
    id: "brakk",
    tagline: "Brakk, human barbarian",
    blurb: "Hits first and asks later. Swing the greataxe, shrug off blows, and keep the others alive by standing in front of them.",
    sheet: {
      ...base,
      name: "Brakk",
      race: "human",
      class: "barbarian",
      background: "outlander",
      abilities: { str: 16, dex: 14, con: 15, int: 9, wis: 13, cha: 11 },
      maxHp: 14,
      ac: 14,
      hitDice: { die: "d12", total: 1, spent: 0 },
      proficiencies: { saves: ["str", "con"], skills: ["athletics", "survival"], expertise: [], languages: ["Common"], tools: ["drum"], armor: [], weapons: [] },
      equipment: [...pack([["Greataxe"], ["Handaxe", 2]]), ...EXPLORER, ...pack([["Javelin", 4]])],
      backstory: "Raised in the high passes, Brakk came down to the lowlands when the herds died, and has not found a reason to go back.",
    },
  },
  {
    id: "kara",
    tagline: "Kara, human fighter",
    blurb: "Shield, sword and chain mail. The steadiest hand at the table: hard to hit, harder to move, and always has a plan for the door.",
    sheet: {
      ...base,
      name: "Kara",
      race: "human",
      class: "fighter",
      background: "soldier",
      abilities: { str: 16, dex: 15, con: 14, int: 13, wis: 11, cha: 9 },
      maxHp: 12,
      ac: 18,
      hitDice: { die: "d10", total: 1, spent: 0 },
      proficiencies: { saves: ["str", "con"], skills: ["athletics", "perception"], expertise: [], languages: ["Common"], tools: ["dice set"], armor: [], weapons: [] },
      equipment: [...pack([["Chain Mail"], ["Longsword"], ["Shield"], ["Light Crossbow"], ["Crossbow Bolts", 20]]), ...DUNGEONEER],
      backstory: "Ten years in a river baron's guard, mustered out when the baron ran out of money. Still salutes by habit.",
    },
  },
  {
    id: "vex",
    tagline: "Vex, human rogue",
    blurb: "Locks, shadows and a rapier. Scout ahead, find the trap before it finds you, and strike where it hurts.",
    sheet: {
      ...base,
      name: "Vex",
      race: "human",
      class: "rogue",
      background: "criminal",
      abilities: { str: 9, dex: 16, con: 14, int: 13, wis: 11, cha: 15 },
      maxHp: 10,
      ac: 14,
      hitDice: { die: "d8", total: 1, spent: 0 },
      proficiencies: {
        saves: ["dex", "int"],
        skills: ["stealth", "acrobatics", "perception", "investigation"],
        expertise: ["stealth", "perception"],
        languages: ["Common"],
        tools: ["thieves' tools", "dice set"],
        armor: [],
        weapons: [],
      },
      equipment: [...pack([["Rapier"], ["Shortbow"], ["Quiver"], ["Arrows", 20]]), ...BURGLAR, ...pack([["Leather"], ["Dagger", 2], ["Thieves' Tools"]])],
      backstory: "Left a city guild one step ahead of a debt. Keeps a list of people who are owed, and a shorter list of people who are owed by Vex.",
    },
  },
  {
    id: "sera",
    tagline: "Sera, human cleric of life",
    blurb: "Mace, shield and a healer's hands. Keeps the party standing with Cure Wounds and Bless, and can hold a line herself.",
    sheet: {
      ...base,
      name: "Sera",
      race: "human",
      class: "cleric",
      subclass: "life",
      background: "acolyte",
      abilities: { str: 14, dex: 9, con: 15, int: 11, wis: 16, cha: 13 },
      maxHp: 10,
      ac: 15,
      hitDice: { die: "d8", total: 1, spent: 0 },
      proficiencies: { saves: ["wis", "cha"], skills: ["medicine", "insight"], expertise: [], languages: ["Common"], tools: [], armor: [], weapons: [] },
      equipment: [...pack([["Mace"], ["Scale Mail"], ["Spear"]]), ...PRIEST, ...pack([["Shield"], ["Holy Symbol"]])],
      spellcasting: {
        ability: "wis",
        slots: { "1": { max: 2, used: 0 } },
        prepared: ["Cure Wounds", "Bless", "Guiding Bolt", "Healing Word"],
        cantrips: ["Sacred Flame", "Guidance", "Light"],
        known: [],
      },
      backstory: "A chapel orphan who learned that a steady voice and a steadier hand do more good than a sermon.",
    },
  },
];

export function pregenById(id: string): Pregen | null {
  return PREGENS.find((pregen) => pregen.id === id) ?? null;
}

// What the picker shows: no sheet, nothing to tamper with.
export function pregenSummaries() {
  return PREGENS.map((pregen) => ({
    id: pregen.id,
    name: pregen.sheet.name,
    tagline: pregen.tagline,
    blurb: pregen.blurb,
    race: pregen.sheet.race,
    class: pregen.sheet.class,
  }));
}
