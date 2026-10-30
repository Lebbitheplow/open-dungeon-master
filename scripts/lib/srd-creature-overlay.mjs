// What the content pack's SRD rows cannot say on their own, for the
// creature table scripts/generate-srd-creatures.mjs writes
// (src/lib/srd/srd-creatures.json): which creatures the table holds and
// why, the familiar forms the spells name, and each place where the pack's
// row names a thing otherwise than the SRD 5.1 text (src/lib/rulebook/
// srd-5.1.json); the rows' misprinted numbers are corrected in
// src/lib/bestiary/pack-corrections.ts, for the enemy reader and the table
// at once. The generator stops on any disagreement neither settles, and on
// a correction here the pack no longer needs, so every entry stays true.

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

// Where the pack's row names an attack or a trait otherwise than the SRD 5.1
// text, the SRD's name, so the block reads as the book prints it. A number,
// a speed, a sense, a save or a defence the row misprints is corrected in
// src/lib/bestiary/pack-corrections.ts instead, which the generator reads
// every row through: the enemy reader lays the same list over the row, so a
// creature fought and the same creature summoned or shaped into agree.
export const CORRECTIONS = {
  // Claws (Bite in Beast Form); the row says Claw.
  Quasit: { attackNames: { "Claw (Bite in Beast Form)": "Claws (Bite in Beast Form)" } },
  // Turning Defiance; the row says Turn Defiance.
  Ghast: { traitNames: { "Turn Defiance": "Turning Defiance" } },
  // Sneak Attack, as the SRD names it; the row says Sneak Attack (1/Turn).
  Assassin: { traitNames: { "Sneak Attack (1/Turn)": "Sneak Attack" } },
  // Claw; the row says Claws.
  Hezrou: { attackNames: { Claws: "Claw" } },
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
