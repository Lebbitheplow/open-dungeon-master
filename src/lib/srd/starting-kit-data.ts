// The starting equipment of every class, as the books print it. SRD 5.1,
// "Starting Equipment" in each of the twelve classes; the artificer's from
// its 2014-era printing (Tasha's Cauldron of Everything); ODM's 36 setting
// classes carry no list of their own, so each has a small fixed kit of
// ODM's writing that matches its theme and training (src/lib/srd/genre-kits.ts).
//
// Pure data, no imports beyond types: the rules that read it live in
// src/lib/srd/starting-kit.ts.
//
// Every line of a class's list is one KitLine. A line the book prints as
// "(a) ... or (b) ..." has one option per letter; a line with no choice has
// one option. "Any simple weapon" and its kin are a slot, filled with one
// weapon from the weapon table (src/lib/srd/weapons.ts). Packs are written
// out as the items inside them, the way the builder's "adventurer's starter
// pack" adds its contents, so the sheet carries rope and torches rather than
// a line called "Explorer's Pack".

export type KitItem = { name: string; qty: number };

// What a slot may be filled with: the weapon table's simple or martial
// weapons, their melee half, or a musical instrument.
export type SlotFilter = "simple" | "simple-melee" | "martial" | "martial-melee" | "instrument";

export type KitSlot = {
  filter: SlotFilter;
  // What the slot holds when nobody names a weapon for it: a companion the
  // engine drafts, or a request that left the pick out.
  default: string;
  // Names the slot may not take ("any OTHER musical instrument").
  except?: string[];
};

// "(if proficient)": the cleric's warhammer and chain mail.
export type KitRequirement = "heavy-armor" | "warhammer";

export type KitOption = {
  label: string;
  items: KitItem[];
  slots?: KitSlot[];
  requires?: KitRequirement;
};

export type KitLine = { options: KitOption[] };

export type ClassKit = {
  // "srd": SRD 5.1. "published": a 2014-era book outside the SRD. "odm": a
  // kit ODM wrote for a class of its own.
  source: "srd" | "published" | "odm";
  lines: KitLine[];
};

const one = (name: string, qty = 1): KitItem => ({ name, qty });
const fixed = (label: string, items: KitItem[], slots?: KitSlot[]): KitLine => ({
  options: [{ label, items, ...(slots ? { slots } : {}) }],
});

// SRD 5.1, Equipment Packs, item for item.
export const PACKS: Record<string, KitItem[]> = {
  burglar: [
    one("Backpack"), one("Ball Bearings (bag of 1000)"), one("String (10 feet)"), one("Bell"),
    one("Candle", 5), one("Crowbar"), one("Hammer"), one("Piton", 10), one("Lantern, Hooded"),
    one("Oil (flask)", 2), one("Rations (1 day)", 5), one("Tinderbox"), one("Waterskin"),
    one("Rope, Hempen (50 feet)"),
  ],
  diplomat: [
    one("Chest"), one("Case, Map or Scroll", 2), one("Clothes, Fine"), one("Ink (1 ounce bottle)"),
    one("Ink Pen"), one("Lamp"), one("Oil (flask)", 2), one("Paper (one sheet)", 5),
    one("Perfume (vial)"), one("Sealing Wax"), one("Soap"),
  ],
  dungeoneer: [
    one("Backpack"), one("Crowbar"), one("Hammer"), one("Piton", 10), one("Torch", 10),
    one("Tinderbox"), one("Rations (1 day)", 10), one("Waterskin"), one("Rope, Hempen (50 feet)"),
  ],
  entertainer: [
    one("Backpack"), one("Bedroll"), one("Clothes, Costume", 2), one("Candle", 5),
    one("Rations (1 day)", 5), one("Waterskin"), one("Disguise Kit"),
  ],
  explorer: [
    one("Backpack"), one("Bedroll"), one("Mess Kit"), one("Tinderbox"), one("Torch", 10),
    one("Rations (1 day)", 10), one("Waterskin"), one("Rope, Hempen (50 feet)"),
  ],
  priest: [
    one("Backpack"), one("Blanket"), one("Candle", 10), one("Tinderbox"), one("Alms Box"),
    one("Block of Incense", 2), one("Censer"), one("Vestments"), one("Rations (1 day)", 2),
    one("Waterskin"),
  ],
  scholar: [
    one("Backpack"), one("Book"), one("Ink (1 ounce bottle)"), one("Ink Pen"),
    one("Parchment (one sheet)", 10), one("Little Bag of Sand"), one("Small Knife"),
  ],
};

// SRD 5.1, Musical Instruments.
export const INSTRUMENTS = [
  "Bagpipes", "Drum", "Dulcimer", "Flute", "Lute", "Lyre", "Horn", "Pan Flute", "Shawm", "Viol",
];

const pack = (id: keyof typeof PACKS, label: string): KitOption => ({ label, items: PACKS[id] });
const simple = (fallback: string): KitSlot => ({ filter: "simple", default: fallback });
const simpleMelee = (fallback: string): KitSlot => ({ filter: "simple-melee", default: fallback });
const martial = (fallback: string): KitSlot => ({ filter: "martial", default: fallback });
const bolts = [one("Light Crossbow"), one("Crossbow Bolts", 20)];

export const CLASS_KITS: Record<string, ClassKit> = {
  barbarian: {
    source: "srd",
    lines: [
      { options: [
        { label: "a greataxe", items: [one("Greataxe")] },
        { label: "any martial melee weapon", items: [], slots: [{ filter: "martial-melee", default: "Battleaxe" }] },
      ] },
      { options: [
        { label: "two handaxes", items: [one("Handaxe", 2)] },
        { label: "any simple weapon", items: [], slots: [simple("Spear")] },
      ] },
      fixed("an explorer's pack and four javelins", [...PACKS.explorer, one("Javelin", 4)]),
    ],
  },
  bard: {
    source: "srd",
    lines: [
      { options: [
        { label: "a rapier", items: [one("Rapier")] },
        { label: "a longsword", items: [one("Longsword")] },
        { label: "any simple weapon", items: [], slots: [simple("Quarterstaff")] },
      ] },
      { options: [pack("diplomat", "a diplomat's pack"), pack("entertainer", "an entertainer's pack")] },
      { options: [
        { label: "a lute", items: [one("Lute")] },
        { label: "any other musical instrument", items: [], slots: [{ filter: "instrument", default: "Flute", except: ["Lute"] }] },
      ] },
      fixed("leather armor and a dagger", [one("Leather"), one("Dagger")]),
    ],
  },
  cleric: {
    source: "srd",
    lines: [
      { options: [
        { label: "a mace", items: [one("Mace")] },
        { label: "a warhammer (if proficient)", items: [one("Warhammer")], requires: "warhammer" },
      ] },
      { options: [
        { label: "scale mail", items: [one("Scale Mail")] },
        { label: "leather armor", items: [one("Leather")] },
        { label: "chain mail (if proficient)", items: [one("Chain Mail")], requires: "heavy-armor" },
      ] },
      { options: [
        { label: "a light crossbow and 20 bolts", items: bolts },
        { label: "any simple weapon", items: [], slots: [simple("Spear")] },
      ] },
      { options: [pack("priest", "a priest's pack"), pack("explorer", "an explorer's pack")] },
      fixed("a shield and a holy symbol", [one("Shield"), one("Holy Symbol")]),
    ],
  },
  druid: {
    source: "srd",
    lines: [
      { options: [
        { label: "a wooden shield", items: [one("Wooden Shield")] },
        { label: "any simple weapon", items: [], slots: [simple("Quarterstaff")] },
      ] },
      { options: [
        { label: "a scimitar", items: [one("Scimitar")] },
        { label: "any simple melee weapon", items: [], slots: [simpleMelee("Club")] },
      ] },
      fixed("leather armor, an explorer's pack and a druidic focus", [
        one("Leather"), ...PACKS.explorer, one("Druidic Focus"),
      ]),
    ],
  },
  fighter: {
    source: "srd",
    lines: [
      { options: [
        { label: "chain mail", items: [one("Chain Mail")] },
        { label: "leather armor, a longbow and 20 arrows", items: [one("Leather"), one("Longbow"), one("Arrows", 20)] },
      ] },
      { options: [
        { label: "a martial weapon and a shield", items: [one("Shield")], slots: [martial("Longsword")] },
        { label: "two martial weapons", items: [], slots: [martial("Longsword"), martial("Longsword")] },
      ] },
      { options: [
        { label: "a light crossbow and 20 bolts", items: bolts },
        { label: "two handaxes", items: [one("Handaxe", 2)] },
      ] },
      { options: [pack("dungeoneer", "a dungeoneer's pack"), pack("explorer", "an explorer's pack")] },
    ],
  },
  monk: {
    source: "srd",
    lines: [
      { options: [
        { label: "a shortsword", items: [one("Shortsword")] },
        { label: "any simple weapon", items: [], slots: [simple("Quarterstaff")] },
      ] },
      { options: [pack("dungeoneer", "a dungeoneer's pack"), pack("explorer", "an explorer's pack")] },
      fixed("10 darts", [one("Dart", 10)]),
    ],
  },
  paladin: {
    source: "srd",
    lines: [
      { options: [
        { label: "a martial weapon and a shield", items: [one("Shield")], slots: [martial("Longsword")] },
        { label: "two martial weapons", items: [], slots: [martial("Longsword"), martial("Longsword")] },
      ] },
      { options: [
        { label: "five javelins", items: [one("Javelin", 5)] },
        { label: "any simple melee weapon", items: [], slots: [simpleMelee("Mace")] },
      ] },
      { options: [pack("priest", "a priest's pack"), pack("explorer", "an explorer's pack")] },
      fixed("chain mail and a holy symbol", [one("Chain Mail"), one("Holy Symbol")]),
    ],
  },
  ranger: {
    source: "srd",
    lines: [
      { options: [
        { label: "scale mail", items: [one("Scale Mail")] },
        { label: "leather armor", items: [one("Leather")] },
      ] },
      { options: [
        { label: "two shortswords", items: [one("Shortsword", 2)] },
        { label: "two simple melee weapons", items: [], slots: [simpleMelee("Handaxe"), simpleMelee("Handaxe")] },
      ] },
      { options: [pack("dungeoneer", "a dungeoneer's pack"), pack("explorer", "an explorer's pack")] },
      fixed("a longbow and a quiver of 20 arrows", [one("Longbow"), one("Quiver"), one("Arrows", 20)]),
    ],
  },
  rogue: {
    source: "srd",
    lines: [
      { options: [
        { label: "a rapier", items: [one("Rapier")] },
        { label: "a shortsword", items: [one("Shortsword")] },
      ] },
      { options: [
        { label: "a shortbow and a quiver of 20 arrows", items: [one("Shortbow"), one("Quiver"), one("Arrows", 20)] },
        { label: "a shortsword", items: [one("Shortsword")] },
      ] },
      { options: [
        pack("burglar", "a burglar's pack"),
        pack("dungeoneer", "a dungeoneer's pack"),
        pack("explorer", "an explorer's pack"),
      ] },
      fixed("leather armor, two daggers and thieves' tools", [
        one("Leather"), one("Dagger", 2), one("Thieves' Tools"),
      ]),
    ],
  },
  sorcerer: {
    source: "srd",
    lines: [
      { options: [
        { label: "a light crossbow and 20 bolts", items: bolts },
        { label: "any simple weapon", items: [], slots: [simple("Quarterstaff")] },
      ] },
      { options: [
        { label: "a component pouch", items: [one("Component Pouch")] },
        { label: "an arcane focus", items: [one("Arcane Focus")] },
      ] },
      { options: [pack("dungeoneer", "a dungeoneer's pack"), pack("explorer", "an explorer's pack")] },
      fixed("two daggers", [one("Dagger", 2)]),
    ],
  },
  warlock: {
    source: "srd",
    lines: [
      { options: [
        { label: "a light crossbow and 20 bolts", items: bolts },
        { label: "any simple weapon", items: [], slots: [simple("Quarterstaff")] },
      ] },
      { options: [
        { label: "a component pouch", items: [one("Component Pouch")] },
        { label: "an arcane focus", items: [one("Arcane Focus")] },
      ] },
      { options: [pack("scholar", "a scholar's pack"), pack("dungeoneer", "a dungeoneer's pack")] },
      fixed("leather armor, any simple weapon and two daggers", [one("Leather"), one("Dagger", 2)], [
        simple("Quarterstaff"),
      ]),
    ],
  },
  wizard: {
    source: "srd",
    lines: [
      { options: [
        { label: "a quarterstaff", items: [one("Quarterstaff")] },
        { label: "a dagger", items: [one("Dagger")] },
      ] },
      { options: [
        { label: "a component pouch", items: [one("Component Pouch")] },
        { label: "an arcane focus", items: [one("Arcane Focus")] },
      ] },
      { options: [pack("scholar", "a scholar's pack"), pack("explorer", "an explorer's pack")] },
      fixed("a spellbook", [one("Spellbook")]),
    ],
  },
  // Tasha's Cauldron of Everything (2020), Artificer, Equipment: the 2014
  // rules the rest of the table plays by.
  artificer: {
    source: "published",
    lines: [
      fixed("any two simple weapons", [], [simple("Light Hammer"), simple("Dagger")]),
      fixed("a light crossbow and 20 bolts", bolts),
      { options: [
        { label: "studded leather armor", items: [one("Studded Leather")] },
        { label: "scale mail", items: [one("Scale Mail")] },
      ] },
      fixed("thieves' tools and a dungeoneer's pack", [one("Thieves' Tools"), ...PACKS.dungeoneer]),
    ],
  },
};
