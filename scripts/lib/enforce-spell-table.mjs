// Eighty-odd well known spells as the rulebook prints them, typed by hand
// from SRD 5.1 (and, for the three marked srd: false, from the book ODM's
// own authored-spells.json says it restates). Nothing here is read from
// ODM's data: scripts/test-enforce-spell-data.mjs and
// scripts/test-enforce-spell-mechanics.mjs hold ODM's data and its derived
// mechanics up against this.
//
// Fields:
//   level, school
//   time      "action" | "bonus" | "reaction" | a number of minutes
//   range     as printed, lower case ("150 feet", "touch", "self")
//   comp      the letters, e.g. "VSM"
//   material  words the material line must contain (a cost, a gem)
//   duration  as printed without the concentration prefix, lower case
//   conc, ritual
//   how       "attack" | "save" | "auto" | "heal" | null (no roll to derive)
//   save      the save ability, half: whether a save halves the damage
//   dice      the damage or healing dice at the spell's own level
//   type      the damage type
//   up        dice added per slot level above the spell's own
//   tiers     a cantrip's dice at 5th, 11th and 17th level
//   whole     the full damage expression where `dice` is only its first term
//
// A field left out is one this table does not vouch for.

const A = "action";
const B = "bonus";
const R = "reaction";

export const SPELL_TABLE = [
  // ---- cantrips ----
  { name: "Fire Bolt", level: 0, school: "evocation", time: A, range: "120 feet", comp: "VS", duration: "instantaneous", how: "attack", dice: "1d10", type: "fire", tiers: ["2d10", "3d10", "4d10"] },
  { name: "Eldritch Blast", level: 0, school: "evocation", time: A, range: "120 feet", comp: "VS", duration: "instantaneous", how: "attack", dice: "1d10", type: "force" },
  { name: "Sacred Flame", level: 0, school: "evocation", time: A, range: "60 feet", comp: "VS", duration: "instantaneous", how: "save", save: "dex", half: false, dice: "1d8", type: "radiant", tiers: ["2d8", "3d8", "4d8"] },
  { name: "Ray of Frost", level: 0, school: "evocation", time: A, range: "60 feet", comp: "VS", duration: "instantaneous", how: "attack", dice: "1d8", type: "cold", tiers: ["2d8", "3d8", "4d8"] },
  { name: "Shocking Grasp", level: 0, school: "evocation", time: A, range: "touch", comp: "VS", duration: "instantaneous", how: "attack", dice: "1d8", type: "lightning", tiers: ["2d8", "3d8", "4d8"] },
  { name: "Chill Touch", level: 0, school: "necromancy", time: A, range: "120 feet", comp: "VS", duration: "1 round", how: "attack", dice: "1d8", type: "necrotic", tiers: ["2d8", "3d8", "4d8"] },
  { name: "Acid Splash", level: 0, school: "conjuration", time: A, range: "60 feet", comp: "VS", duration: "instantaneous", how: "save", save: "dex", half: false, dice: "1d6", type: "acid", tiers: ["2d6", "3d6", "4d6"] },
  { name: "Poison Spray", level: 0, school: "conjuration", time: A, range: "10 feet", comp: "VS", duration: "instantaneous", how: "save", save: "con", half: false, dice: "1d12", type: "poison", tiers: ["2d12", "3d12", "4d12"] },
  { name: "Vicious Mockery", level: 0, school: "enchantment", time: A, range: "60 feet", comp: "V", duration: "instantaneous", how: "save", save: "wis", half: false, dice: "1d4", type: "psychic", tiers: ["2d4", "3d4", "4d4"] },
  { name: "Guidance", level: 0, school: "divination", time: A, range: "touch", comp: "VS", duration: "1 minute", conc: true },
  { name: "Light", level: 0, school: "evocation", time: A, range: "touch", comp: "VM", duration: "1 hour", conc: false },
  { name: "Mage Hand", level: 0, school: "conjuration", time: A, range: "30 feet", comp: "VS", duration: "1 minute", conc: false },
  { name: "Toll the Dead", srd: false, level: 0, school: "necromancy", time: A, range: "60 feet", comp: "VS", duration: "instantaneous", how: "save", save: "wis", half: false, dice: "1d8", type: "necrotic", tiers: ["2d8", "3d8", "4d8"] },

  // ---- 1st level ----
  { name: "Magic Missile", level: 1, school: "evocation", time: A, range: "120 feet", comp: "VS", duration: "instantaneous", how: "auto", type: "force" },
  { name: "Cure Wounds", level: 1, school: "evocation", time: A, range: "touch", comp: "VS", duration: "instantaneous", how: "heal", dice: "1d8", up: "1d8" },
  { name: "Healing Word", level: 1, school: "evocation", time: B, range: "60 feet", comp: "V", duration: "instantaneous", how: "heal", dice: "1d4", up: "1d4" },
  { name: "Shield", level: 1, school: "abjuration", time: R, range: "self", comp: "VS", duration: "1 round", conc: false },
  { name: "Bless", level: 1, school: "enchantment", time: A, range: "30 feet", comp: "VSM", material: ["holy water"], duration: "1 minute", conc: true },
  { name: "Bane", level: 1, school: "enchantment", time: A, range: "30 feet", comp: "VSM", material: ["blood"], duration: "1 minute", conc: true, how: "save", save: "cha" },
  { name: "Hunter's Mark", level: 1, school: "divination", time: B, range: "90 feet", comp: "V", duration: "1 hour", conc: true },
  { name: "Hex", srd: false, level: 1, school: "enchantment", time: B, range: "90 feet", comp: "VSM", duration: "1 hour", conc: true },
  { name: "Sleep", level: 1, school: "enchantment", time: A, range: "90 feet", comp: "VSM", duration: "1 minute", conc: false },
  { name: "Thunderwave", level: 1, school: "evocation", time: A, range: "self", comp: "VS", duration: "instantaneous", how: "save", save: "con", half: true, dice: "2d8", type: "thunder", up: "1d8" },
  { name: "Burning Hands", level: 1, school: "evocation", time: A, range: "self", comp: "VS", duration: "instantaneous", how: "save", save: "dex", half: true, dice: "3d6", type: "fire", up: "1d6" },
  { name: "Guiding Bolt", level: 1, school: "evocation", time: A, range: "120 feet", comp: "VS", duration: "1 round", how: "attack", dice: "4d6", type: "radiant", up: "1d6" },
  { name: "Inflict Wounds", level: 1, school: "necromancy", time: A, range: "touch", comp: "VS", duration: "instantaneous", how: "attack", dice: "3d10", type: "necrotic", up: "1d10" },
  { name: "Mage Armor", level: 1, school: "abjuration", time: A, range: "touch", comp: "VSM", material: ["leather"], duration: "8 hours", conc: false },
  { name: "Detect Magic", level: 1, school: "divination", time: A, range: "self", comp: "VS", duration: "10 minutes", conc: true, ritual: true },
  { name: "Identify", level: 1, school: "divination", time: 1, range: "touch", comp: "VSM", material: ["pearl", "100 gp"], duration: "instantaneous", conc: false, ritual: true },
  { name: "Find Familiar", level: 1, school: "conjuration", time: 60, range: "10 feet", comp: "VSM", material: ["10 gp"], duration: "instantaneous", conc: false, ritual: true },
  { name: "Chromatic Orb", srd: false, level: 1, school: "evocation", time: A, range: "90 feet", comp: "VSM", material: ["diamond", "50 gp"], duration: "instantaneous", how: "attack", dice: "3d8", up: "1d8" },
  { name: "Faerie Fire", level: 1, school: "evocation", time: A, range: "60 feet", comp: "V", duration: "1 minute", conc: true, how: "save", save: "dex" },
  { name: "Charm Person", level: 1, school: "enchantment", time: A, range: "30 feet", comp: "VS", duration: "1 hour", conc: false, how: "save", save: "wis" },
  { name: "Command", level: 1, school: "enchantment", time: A, range: "60 feet", comp: "V", duration: "1 round", conc: false, how: "save", save: "wis" },
  { name: "Shield of Faith", level: 1, school: "abjuration", time: B, range: "60 feet", comp: "VSM", duration: "10 minutes", conc: true },
  { name: "Feather Fall", level: 1, school: "transmutation", time: R, range: "60 feet", comp: "VM", duration: "1 minute", conc: false },
  { name: "Hellish Rebuke", level: 1, school: "evocation", time: R, range: "60 feet", comp: "VS", duration: "instantaneous", how: "save", save: "dex", half: true, dice: "2d10", type: "fire", up: "1d10" },
  { name: "Divine Favor", level: 1, school: "evocation", time: B, range: "self", comp: "VS", duration: "1 minute", conc: true },

  // ---- 2nd level ----
  { name: "Hold Person", level: 2, school: "enchantment", time: A, range: "60 feet", comp: "VSM", material: ["iron"], duration: "1 minute", conc: true, how: "save", save: "wis", condition: "paralyzed" },
  { name: "Misty Step", level: 2, school: "conjuration", time: B, range: "self", comp: "V", duration: "instantaneous", conc: false },
  { name: "Spiritual Weapon", level: 2, school: "evocation", time: B, range: "60 feet", comp: "VS", duration: "1 minute", conc: false },
  { name: "Scorching Ray", level: 2, school: "evocation", time: A, range: "120 feet", comp: "VS", duration: "instantaneous", how: "attack", dice: "2d6", type: "fire" },
  { name: "Invisibility", level: 2, school: "illusion", time: A, range: "touch", comp: "VSM", duration: "1 hour", conc: true },
  { name: "Blur", level: 2, school: "illusion", time: A, range: "self", comp: "V", duration: "1 minute", conc: true },
  { name: "Lesser Restoration", level: 2, school: "abjuration", time: A, range: "touch", comp: "VS", duration: "instantaneous", conc: false },
  { name: "Web", level: 2, school: "conjuration", time: A, range: "60 feet", comp: "VSM", duration: "1 hour", conc: true, how: "save", save: "dex", condition: "restrained" },
  { name: "Shatter", level: 2, school: "evocation", time: A, range: "60 feet", comp: "VSM", material: ["mica"], duration: "instantaneous", how: "save", save: "con", half: true, dice: "3d8", type: "thunder", up: "1d8" },
  { name: "Silence", level: 2, school: "illusion", time: A, range: "120 feet", comp: "VS", duration: "10 minutes", conc: true, ritual: true },
  { name: "Moonbeam", level: 2, school: "evocation", time: A, range: "120 feet", comp: "VSM", duration: "1 minute", conc: true, how: "save", save: "con", half: true, dice: "2d10", type: "radiant", up: "1d10" },

  // ---- 3rd level ----
  { name: "Fireball", level: 3, school: "evocation", time: A, range: "150 feet", comp: "VSM", material: ["guano", "sulfur"], duration: "instantaneous", conc: false, ritual: false, how: "save", save: "dex", half: true, dice: "8d6", type: "fire", up: "1d6" },
  { name: "Lightning Bolt", level: 3, school: "evocation", time: A, range: "self", comp: "VSM", duration: "instantaneous", how: "save", save: "dex", half: true, dice: "8d6", type: "lightning", up: "1d6" },
  { name: "Counterspell", level: 3, school: "abjuration", time: R, range: "60 feet", comp: "S", duration: "instantaneous", conc: false },
  // Cast with cast_buff: an aura that makes each enemy starting its turn in
  // it save (WIS, half), held in test-enforce-spell-engine.mjs.
  { name: "Spirit Guardians", level: 3, school: "conjuration", time: A, range: "self", comp: "VSM", material: ["holy symbol"], duration: "10 minutes", conc: true, how: "buff", dice: "3d8", up: "1d8" },
  { name: "Haste", level: 3, school: "transmutation", time: A, range: "30 feet", comp: "VSM", material: ["licorice"], duration: "1 minute", conc: true },
  { name: "Slow", level: 3, school: "transmutation", time: A, range: "120 feet", comp: "VSM", material: ["molasses"], duration: "1 minute", conc: true, how: "save", save: "wis" },
  { name: "Revivify", level: 3, time: A, range: "touch", comp: "VSM", material: ["diamond", "300 gp", "consume"], duration: "instantaneous", conc: false },
  { name: "Dispel Magic", level: 3, school: "abjuration", time: A, range: "120 feet", comp: "VS", duration: "instantaneous", conc: false },
  { name: "Fly", level: 3, school: "transmutation", time: A, range: "touch", comp: "VSM", duration: "10 minutes", conc: true },
  { name: "Call Lightning", level: 3, school: "conjuration", time: A, range: "120 feet", comp: "VS", duration: "10 minutes", conc: true, how: "save", save: "dex", half: true, dice: "3d10", type: "lightning", up: "1d10" },
  { name: "Animate Dead", level: 3, school: "necromancy", time: 1, range: "10 feet", comp: "VSM", duration: "instantaneous", conc: false },

  // ---- 4th level ----
  { name: "Polymorph", level: 4, school: "transmutation", time: A, range: "60 feet", comp: "VSM", material: ["cocoon"], duration: "1 hour", conc: true },
  { name: "Banishment", level: 4, school: "abjuration", time: A, range: "60 feet", comp: "VSM", duration: "1 minute", conc: true, how: "save", save: "cha" },
  { name: "Stoneskin", level: 4, school: "abjuration", time: A, range: "touch", comp: "VSM", material: ["diamond dust", "100 gp", "consume"], duration: "1 hour", conc: true },
  { name: "Greater Invisibility", level: 4, school: "illusion", time: A, range: "touch", comp: "VS", duration: "1 minute", conc: true },
  { name: "Dimension Door", level: 4, school: "conjuration", time: A, range: "500 feet", comp: "V", duration: "instantaneous", conc: false },
  { name: "Ice Storm", level: 4, school: "evocation", time: A, range: "300 feet", comp: "VSM", duration: "instantaneous", how: "save", save: "dex", half: true, dice: "2d8", whole: "2d8+4d6" },
  { name: "Wall of Fire", level: 4, school: "evocation", time: A, range: "120 feet", comp: "VSM", duration: "1 minute", conc: true, how: "save", save: "dex", half: true, dice: "5d8", type: "fire", up: "1d8" },
  { name: "Blight", level: 4, school: "necromancy", time: A, range: "30 feet", comp: "VS", duration: "instantaneous", how: "save", save: "con", half: true, dice: "8d8", type: "necrotic", up: "1d8" },

  // ---- 5th level ----
  { name: "Raise Dead", level: 5, school: "necromancy", time: 60, range: "touch", comp: "VSM", material: ["diamond", "500 gp", "consume"], duration: "instantaneous", conc: false },
  { name: "Cone of Cold", level: 5, school: "evocation", time: A, range: "self", comp: "VSM", duration: "instantaneous", how: "save", save: "con", half: true, dice: "8d8", type: "cold", up: "1d8" },
  { name: "Hold Monster", level: 5, school: "enchantment", time: A, range: "90 feet", comp: "VSM", duration: "1 minute", conc: true, how: "save", save: "wis", condition: "paralyzed" },
  { name: "Flame Strike", level: 5, school: "evocation", time: A, range: "60 feet", comp: "VSM", duration: "instantaneous", how: "save", save: "dex", half: true, dice: "4d6", whole: "4d6+4d6" },
  { name: "Greater Restoration", level: 5, school: "abjuration", time: A, range: "touch", comp: "VSM", material: ["diamond dust", "100 gp", "consume"], duration: "instantaneous", conc: false },
  { name: "Wall of Force", level: 5, school: "evocation", time: A, range: "120 feet", comp: "VSM", duration: "10 minutes", conc: true },

  // ---- 6th level ----
  { name: "Disintegrate", level: 6, school: "transmutation", time: A, range: "60 feet", comp: "VSM", material: ["lodestone"], duration: "instantaneous", how: "save", save: "dex", half: false, dice: "10d6", whole: "10d6+40", type: "force", up: "3d6" },
  { name: "Heal", level: 6, school: "evocation", time: A, range: "60 feet", comp: "VS", duration: "instantaneous", conc: false },
  { name: "Chain Lightning", level: 6, school: "evocation", time: A, range: "150 feet", comp: "VSM", duration: "instantaneous", how: "save", save: "dex", half: true, dice: "10d8", type: "lightning" },
  { name: "Harm", level: 6, school: "necromancy", time: A, range: "60 feet", comp: "VS", duration: "instantaneous", how: "save", save: "con", half: true, dice: "14d6", type: "necrotic" },

  // ---- 7th to 9th level ----
  { name: "Finger of Death", level: 7, school: "necromancy", time: A, range: "60 feet", comp: "VS", duration: "instantaneous", how: "save", save: "con", half: true, dice: "7d8", whole: "7d8+30", type: "necrotic" },
  { name: "Teleport", level: 7, school: "conjuration", time: A, range: "10 feet", comp: "V", duration: "instantaneous", conc: false },
  { name: "Resurrection", level: 7, school: "necromancy", time: 60, range: "touch", comp: "VSM", material: ["diamond", "1,000 gp", "consume"], duration: "instantaneous", conc: false },
  { name: "Fire Storm", level: 7, school: "evocation", time: A, range: "150 feet", comp: "VS", duration: "instantaneous", how: "save", save: "dex", half: true, dice: "7d10", type: "fire" },
  { name: "Power Word Stun", level: 8, school: "enchantment", time: A, range: "60 feet", comp: "V", duration: "instantaneous", conc: false },
  { name: "Sunburst", level: 8, school: "evocation", time: A, range: "150 feet", comp: "VSM", duration: "instantaneous", how: "save", save: "con", half: true, dice: "12d6", type: "radiant" },
  { name: "Power Word Kill", level: 9, school: "enchantment", time: A, range: "60 feet", comp: "V", duration: "instantaneous", conc: false },
  { name: "Wish", level: 9, school: "conjuration", time: A, range: "self", comp: "V", duration: "instantaneous", conc: false },
  { name: "Meteor Swarm", level: 9, school: "evocation", time: A, range: "1 mile", comp: "VS", duration: "instantaneous", how: "save", save: "dex", half: true, dice: "20d6", whole: "20d6+20d6" },
  { name: "True Resurrection", level: 9, school: "necromancy", time: 60, range: "touch", comp: "VSM", material: ["25,000 gp", "consume"], duration: "instantaneous", conc: false },
  { name: "Time Stop", level: 9, school: "transmutation", time: A, range: "self", comp: "V", duration: "instantaneous", conc: false },
];

export const SCHOOLS = [
  "abjuration", "conjuration", "divination", "enchantment",
  "evocation", "illusion", "necromancy", "transmutation",
];

export const SPELL_CLASSES = [
  "artificer", "bard", "cleric", "druid", "paladin", "ranger", "sorcerer", "warlock", "wizard",
];

// A printed casting time as the action economy reads it, or null when the
// text is none of them.
export function castingTimeOf(text) {
  const clean = String(text ?? "").trim().toLowerCase();
  const match = /^(\d+)\s+(action|bonus action|reaction|minute|hour|round)s?\b/.exec(clean);
  if (!match) {
    return null;
  }
  const count = Number(match[1]);
  switch (match[2]) {
    case "action":
      return count === 1 ? "action" : null;
    case "bonus action":
      return count === 1 ? "bonus" : null;
    case "reaction":
      return count === 1 ? "reaction" : null;
    case "minute":
      return count;
    case "hour":
      return count * 60;
    default:
      return null;
  }
}

// "V, S, M (a pinch of sulfur)" -> "VSM".
export function componentLetters(text) {
  const head = String(text ?? "").split("(")[0].toUpperCase();
  return ["V", "S", "M"].filter((letter) => new RegExp(`\\b${letter}\\b`).test(head)).join("");
}

// A printed duration without its concentration prefix, lower case.
export function plainDuration(text) {
  return String(text ?? "")
    .trim()
    .toLowerCase()
    .replace(/^concentration,\s*/, "")
    .replace(/^up to\s+/, "");
}
