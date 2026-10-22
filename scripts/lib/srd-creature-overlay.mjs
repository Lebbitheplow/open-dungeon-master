// What the content pack's SRD rows cannot say on their own, for the
// creature table scripts/generate-srd-creatures.mjs writes
// (src/lib/srd/srd-creatures.json): which creatures the table holds and
// why, the familiar forms the spells name, and each place where the pack's
// row disagrees with the SRD 5.1 text (src/lib/rulebook/srd-5.1.json).
// The generator stops on any disagreement this file does not settle, and on
// a correction the pack no longer needs, so every entry here stays true.

// The undead Animate Dead and Create Undead make, by name (SRD 5.1).
const MADE_UNDEAD = ["Skeleton", "Zombie", "Ghoul", "Ghast", "Wight", "Mummy"];

// Pact of the Chain's four special forms (SRD 5.1, Eldritch Invocations).
export const CHAIN_FORMS = ["Imp", "Pseudodragon", "Quasit", "Sprite"];

// The creatures a spell or feature may call or become, read off the spells
// (SRD 5.1):
//   - every beast: Wild Shape, Polymorph, True Polymorph, Shapechange and
//     Animal Shapes take a beast's form, Conjure Animals and Conjure Fey
//     call one, Find Familiar, Find Steed and Giant Insect name some. A
//     swarm is "a swarm of Tiny beasts", a crowd and not one beast, so no
//     spell that names a beast gives one;
//   - fey: Conjure Woodland Beings (CR 2 or lower) and Conjure Fey (CR 6,
//     one higher for each slot level above 6th, so 9 at most);
//   - elementals: Conjure Minor Elementals (CR 2) and Conjure Elemental
//     (CR 5, one higher for each slot level above 5th: 9 at most);
//   - celestials: Conjure Celestial (CR 4, 5 from a 9th level slot);
//   - the undead the two necromancy spells make, and Pact of the Chain's
//     forms (a fiend, a dragon and a fey among them).
export function inRoster(row, data) {
  const type = String(row.type).toLowerCase();
  if (type === "beast") {
    return !/swarm/i.test(String(data.subtype ?? ""));
  }
  if (type === "fey" || type === "elemental") {
    return row.cr <= 9;
  }
  if (type === "celestial") {
    return row.cr <= 5;
  }
  return MADE_UNDEAD.includes(row.name) || CHAIN_FORMS.includes(row.name);
}

// Find Familiar's forms (SRD 5.1: "bat, cat, crab, frog (toad), hawk,
// lizard, octopus, owl, poisonous snake, fish (quipper), rat, raven, sea
// horse, spider, or weasel"), each by its stat block's name, with the other
// names the spell and the table's older entries give it ("Snake" was the
// poisonous snake's name here before).
export const FAMILIARS = [
  { name: "Bat" },
  { name: "Cat" },
  { name: "Crab" },
  { name: "Frog", aliases: ["Toad"] },
  { name: "Hawk" },
  { name: "Lizard" },
  { name: "Octopus" },
  { name: "Owl" },
  { name: "Poisonous Snake", aliases: ["Snake"] },
  { name: "Quipper", aliases: ["Fish"] },
  { name: "Rat" },
  { name: "Raven" },
  { name: "Sea Horse" },
  { name: "Spider" },
  { name: "Weasel" },
];

// The rulebook page a row is checked against when its name is not a
// page's, and the sidebar whose action replaces the page's own.
export const RULEBOOK_PAGE = {
  "Giant Rat (Diseased)": { title: "Giant Rat", variant: "Variant: Diseased Giant Rats" },
};

// A variant whose row lacks what the SRD gives it: the diseased giant rat
// is a giant rat with another bite ("the following action instead of its
// normal bite attack"), so it keeps the giant rat's Keen Smell and Pack
// Tactics.
export const TRAITS_FROM = {
  "Giant Rat (Diseased)": "Giant Rat",
};

// Where the pack's row says otherwise than the SRD 5.1 text, the SRD's
// value. Wording that means the same is set to the SRD's own words too, so
// the block reads as the book prints it.
export const CORRECTIONS = {
  // Speed 20 ft., swim 30 ft.; the row has swim 20.
  Crocodile: { speeds: { walk: 20, swim: 30 } },
  // Armor Class 14 (natural armor); the row has 15.
  "Giant Elk": { ac: 14 },
  // Senses blindsight 30 ft.; the row has darkvision 30.
  "Hunter Shark": { senses: { blindsight: 30 } },
  // Damage Immunities poison; the row files it under resistances.
  Skeleton: { resist: "", immune: "poison" },
  // Damage Immunities poison; the row has none.
  Zombie: { immune: "poison" },
  // The row moves the resistances into immunities and drops exhaustion.
  Wight: {
    resist: "necrotic; bludgeoning, piercing, and slashing from nonmagical attacks that aren't silvered",
    immune: "poison",
    conditionImmune: "exhaustion, poisoned",
  },
  // The same rule in the row's words; the SRD's are kept.
  Gargoyle: { resist: "bludgeoning, piercing, and slashing from nonmagical attacks that aren't adamantine" },
  Xorn: { resist: "piercing and slashing from nonmagical attacks that aren't adamantine" },
  Imp: { resist: "cold; bludgeoning, piercing, and slashing from nonmagical attacks not made with silvered weapons" },
  // Claws (Bite in Beast Form); the row says Claw.
  Quasit: { attackNames: { "Claw (Bite in Beast Form)": "Claws (Bite in Beast Form)" } },
  // Turning Defiance; the row says Turn Defiance.
  Ghast: { traitNames: { "Turn Defiance": "Turning Defiance" } },
};

// A trait or action the SRD prints beside a block rather than in it: a
// variant rule, or what a coven of three shares. Neither is the creature a
// spell calls.
export function sidebarEntry(name) {
  return /^variant:|coven/i.test(String(name).trim());
}
