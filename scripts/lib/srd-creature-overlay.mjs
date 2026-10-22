// What the content pack's SRD rows cannot say on their own, for the
// creature table scripts/generate-srd-creatures.mjs writes
// (src/lib/srd/srd-creatures.json): which creatures the table holds and
// why, the familiar forms the spells name, and each place where the pack's
// row disagrees with the SRD 5.1 text (src/lib/rulebook/srd-5.1.json).
// The generator stops on any disagreement this file does not settle, and on
// a correction the pack no longer needs, so every entry here stays true.

// Pact of the Chain's four special forms (SRD 5.1, Eldritch Invocations).
export const CHAIN_FORMS = ["Imp", "Pseudodragon", "Quasit", "Sprite"];

// Every creature of the SRD 5.1 but the swarms. The spells read their own
// share of it: Wild Shape, Polymorph and Animal Shapes a beast, True
// Polymorph any creature, Shapechange any but a construct or an undead, the
// conjuring spells a kind and a challenge rating, Find Familiar, Find Steed,
// Giant Insect, Animate Dead and Create Undead the creatures they name. A
// swarm is "a swarm of Tiny beasts", a crowd and not one creature, so no
// spell gives one or makes one.
export function inRoster(row, data) {
  return !/swarm/i.test(String(data.subtype ?? ""));
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
  "Animated Armor": { title: "Animated Armor (Animated Object)" },
  "Flying Sword": { title: "Flying Sword (Animated Object)" },
  "Rug of Smothering": { title: "Rug of Smothering (Animated Object)" },
  Drow: { title: "Elf, Drow" },
  "Deep Gnome (Svirfneblin)": { title: "Gnome, Deep" },
  "Half-Red Dragon Veteran": { title: "Half-Dragon Template", from: "Half-Red Dragon Veteran" },
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
  // The same rule in the row's own shorthand; the SRD's words are kept.
  Imp: { resist: "cold; bludgeoning, piercing, and slashing from nonmagical attacks that aren't silvered" },
  // Claws (Bite in Beast Form); the row says Claw.
  Quasit: { attackNames: { "Claw (Bite in Beast Form)": "Claws (Bite in Beast Form)" } },
  // Turning Defiance; the row says Turn Defiance.
  Ghast: { traitNames: { "Turn Defiance": "Turning Defiance" } },
  // Speed 40 ft., burrow 30 ft., fly 80 ft.; the row has burrow 40.
  "Adult Brass Dragon": { speeds: { walk: 40, fly: 80, burrow: 30 } },
  // Speed 40 ft., burrow 20 ft., fly 80 ft.; the row has burrow 40.
  "Young Blue Dragon": { speeds: { walk: 40, fly: 80, burrow: 20 } },
  // Archmage: damage from spells and, from its stoneskin, nonmagical
  // weapons; the row's "non magical" splits the word the damage rules read.
  Archmage: { resist: "damage from spells; nonmagical bludgeoning, piercing, and slashing (from stoneskin)" },
  // Sneak Attack, as the SRD names it; the row says Sneak Attack (1/Turn).
  Assassin: { traitNames: { "Sneak Attack (1/Turn)": "Sneak Attack" } },
  // Armor Class 15 (natural armor); the row has 12.
  Basilisk: { ac: 15 },
  // Challenge 8 (3,900 XP) and Saving Throws Con +7, Wis +4, Cha +5; the row
  // has the Monster Manual's 11 and no saves.
  "Chain Devil": { cr: 8, saves: ["con", "wis", "cha"] },
  // Hit Points 33 (6d8 + 6); the row has 22.
  "Cult Fanatic": { hp: 33 },
  // Claw; the row says Claws.
  Hezrou: { attackNames: { Claws: "Claw" } },
  // Hit Points 148 (17d10+55); the row has the Monster Manual's 178.
  "Horned Devil": { hp: 148 },
  // Damage Immunities cold, fire, poison; the row drops cold.
  "Ice Devil": { immune: "cold, fire, poison" },
  // +17 to hit (Strength 30 and a proficiency bonus of 7); the row has +7.
  Kraken: { attackFields: { Bite: { toHit: 17 }, Tentacle: { toHit: 17 } } },
  // Damage Vulnerabilities fire; the row has bludgeoning.
  "Mummy Lord": { vulnerable: "fire" },
  // Speed 30 ft.; the row has 25.
  Priest: { speeds: { walk: 30 } },
};

// Where the SRD text in the repository is the one that slipped and the
// pack's row is right: the line contradicts the block's own scores, which
// the row agrees with. Each names the field the comparison leaves to the
// row, and why.
export const PACK_KEEPS = {
  // Dagger "4 (1d4 + 1)", but its Dexterity is 14 and its +5 to hit counts
  // the +2; the row has 1d4 + 2.
  Mage: { attacks: "the dagger's damage counts its Dexterity modifier" },
  // Harpoon "11 (2d6+3)", but its Strength is 18 and its +6 to hit counts
  // the +4; the row has 2d6 + 4.
  Merrow: { attacks: "the harpoon's damage counts its Strength modifier" },
  // Dagger "5 (1d4 + 2)", but its Dexterity is 16 and its +5 to hit counts
  // the +3; the row has 1d4 + 3.
  "Bandit Captain": { attacks: "the dagger's damage counts its Dexterity modifier" },
  // The text gives the guardian naga the spirit naga's saving throws and the
  // spirit naga none; the row's saves are each block's own (Intelligence 16
  // and a proficiency bonus of 4 make the guardian naga's +7).
  "Guardian Naga": { saves: "the text lists the spirit naga's saves" },
  "Spirit Naga": { saves: "the text drops the saving throws line" },
};

// A trait or action the SRD prints beside a block rather than in it: a
// variant rule, or what a coven of three shares. Neither is the creature a
// spell calls.
export function sidebarEntry(name) {
  return /^variant:|coven|^night hag items$/i.test(String(name).trim());
}
