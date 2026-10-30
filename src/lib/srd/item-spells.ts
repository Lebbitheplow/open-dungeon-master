// The spells the SRD 5.1 charged items cast, with what each costs and the
// numbers it is cast with. Read by use_item (src/lib/dm/item-use.ts) when a
// charge is spent to cast a spell, so the spell the model then resolves
// spends no slot and carries the item's own DC (src/lib/srd/
// item-cast-credit.ts).
//
// `charges` is the cost, 0 for a spell the item casts at will ("without
// using any charges"); `level` the spell level cast for it, 0 for a cantrip.
// `perCharge`: each charge beyond the first raises the spell's level by one
// (the wands of fireballs, lightning bolts and magic missiles, cure wounds
// from a Staff of Healing, the beads of a Necklace of Fireballs, up to
// `maxLevel`). `dc` is the item's own save DC; absent, the wielder's own
// spell save DC (the staffs say "using your spell save DC").
//
// SRD 5.1, Magic Items, Spells: "Some magic items allow the user to cast a
// spell from the item. The spell is cast at the lowest possible spell level,
// doesn't expend any of the user's spell slots". An item missing here casts
// with the caster's own slot and DC, or not at all for one who does not know
// the spell, so every SRD item that names a spell it casts has a row.

import type { ToolError } from "@/lib/dm/tool-errors";
import { textKey } from "@/lib/language/text-logic";
import { rowName, type RowItem } from "@/lib/srd/item-row";

export type ItemSpell = {
  spell: string;
  charges: number;
  level: number;
  perCharge?: boolean;
  maxLevel?: number;
  dc?: number;
};

type ItemSpellRow = { item: RegExp; spells: ItemSpell[] };

const ROWS: ItemSpellRow[] = [
  { item: /^wand of fireballs$/i, spells: [{ spell: "Fireball", charges: 1, level: 3, perCharge: true, dc: 15 }] },
  { item: /^wand of lightning bolts$/i, spells: [{ spell: "Lightning Bolt", charges: 1, level: 3, perCharge: true, dc: 15 }] },
  { item: /^wand of magic missiles?$/i, spells: [{ spell: "Magic Missile", charges: 1, level: 1, perCharge: true }] },
  { item: /^wand of web$/i, spells: [{ spell: "Web", charges: 1, level: 2, dc: 15 }] },
  { item: /^wand of polymorph$/i, spells: [{ spell: "Polymorph", charges: 1, level: 4, dc: 15 }] },
  { item: /^wand of binding$/i, spells: [
    { spell: "Hold Monster", charges: 5, level: 5, dc: 17 },
    { spell: "Hold Person", charges: 2, level: 2, dc: 17 },
  ] },
  { item: /^wand of fear$/i, spells: [{ spell: "Command", charges: 1, level: 1, dc: 15 }] },
  { item: /^wand of magic detection$/i, spells: [{ spell: "Detect Magic", charges: 1, level: 1 }] },
  { item: /^staff of fire$/i, spells: [
    { spell: "Burning Hands", charges: 1, level: 1 },
    { spell: "Fireball", charges: 3, level: 3 },
    { spell: "Wall of Fire", charges: 4, level: 4 },
  ] },
  { item: /^staff of frost$/i, spells: [
    { spell: "Cone of Cold", charges: 5, level: 5 },
    { spell: "Fog Cloud", charges: 1, level: 1 },
    { spell: "Ice Storm", charges: 4, level: 4 },
    { spell: "Wall of Ice", charges: 4, level: 6 },
  ] },
  { item: /^staff of healing$/i, spells: [
    { spell: "Cure Wounds", charges: 1, level: 1, perCharge: true, maxLevel: 4 },
    { spell: "Lesser Restoration", charges: 2, level: 2 },
    { spell: "Mass Cure Wounds", charges: 5, level: 5 },
  ] },
  { item: /^staff of charming$/i, spells: [
    { spell: "Charm Person", charges: 1, level: 1 },
    { spell: "Command", charges: 1, level: 1 },
    { spell: "Comprehend Languages", charges: 1, level: 1 },
  ] },
  { item: /^staff of swarming insects$/i, spells: [
    { spell: "Giant Insect", charges: 4, level: 4 },
    { spell: "Insect Plague", charges: 5, level: 5 },
  ] },
  { item: /^staff of the woodlands$/i, spells: [
    { spell: "Animal Friendship", charges: 1, level: 1 },
    { spell: "Awaken", charges: 5, level: 5 },
    { spell: "Barkskin", charges: 2, level: 2 },
    { spell: "Locate Animals or Plants", charges: 2, level: 2 },
    { spell: "Speak with Animals", charges: 1, level: 1 },
    { spell: "Speak with Plants", charges: 3, level: 3 },
    { spell: "Wall of Thorns", charges: 6, level: 6 },
    // "cast the pass without trace spell from the staff without using any charges"
    { spell: "Pass without Trace", charges: 0, level: 2 },
  ] },
  { item: /^staff of power$/i, spells: [
    { spell: "Cone of Cold", charges: 5, level: 5 },
    { spell: "Fireball", charges: 5, level: 5 },
    { spell: "Globe of Invulnerability", charges: 6, level: 6 },
    { spell: "Hold Monster", charges: 5, level: 5 },
    { spell: "Levitate", charges: 2, level: 2 },
    { spell: "Lightning Bolt", charges: 5, level: 5 },
    { spell: "Magic Missile", charges: 1, level: 1 },
    { spell: "Ray of Enfeeblement", charges: 1, level: 2 },
    { spell: "Wall of Force", charges: 5, level: 5 },
  ] },
  { item: /^staff of the magi$/i, spells: [
    { spell: "Conjure Elemental", charges: 7, level: 5 },
    { spell: "Dispel Magic", charges: 3, level: 3 },
    { spell: "Fireball", charges: 7, level: 7 },
    { spell: "Flaming Sphere", charges: 2, level: 2 },
    { spell: "Ice Storm", charges: 4, level: 4 },
    { spell: "Invisibility", charges: 2, level: 2 },
    { spell: "Knock", charges: 2, level: 2 },
    { spell: "Lightning Bolt", charges: 7, level: 7 },
    { spell: "Passwall", charges: 5, level: 5 },
    { spell: "Plane Shift", charges: 7, level: 7 },
    { spell: "Telekinesis", charges: 5, level: 5 },
    { spell: "Wall of Fire", charges: 4, level: 4 },
    { spell: "Web", charges: 2, level: 2 },
    // "cast one of the following spells from the staff without using any
    // charges: arcane lock, detect magic, enlarge/reduce, light, mage hand,
    // or protection from evil and good"
    { spell: "Arcane Lock", charges: 0, level: 2 },
    { spell: "Detect Magic", charges: 0, level: 1 },
    { spell: "Enlarge/Reduce", charges: 0, level: 2 },
    { spell: "Light", charges: 0, level: 0 },
    { spell: "Mage Hand", charges: 0, level: 0 },
    { spell: "Protection from Evil and Good", charges: 0, level: 1 },
  ] },
  { item: /^ring of shooting stars$/i, spells: [
    { spell: "Faerie Fire", charges: 1, level: 1 },
    // "you can cast dancing lights and light from the ring at will"
    { spell: "Dancing Lights", charges: 0, level: 0 },
    { spell: "Light", charges: 0, level: 0 },
  ] },
  { item: /^eyes of charming$/i, spells: [{ spell: "Charm Person", charges: 1, level: 1, dc: 13 }] },
  { item: /^medallion of thoughts$/i, spells: [{ spell: "Detect Thoughts", charges: 1, level: 2, dc: 13 }] },
  { item: /^helm of teleportation$/i, spells: [{ spell: "Teleport", charges: 1, level: 7 }] },
  // "press one side of the cube to cast the gate spell ... press one side
  // twice, you can cast the plane shift spell (save DC 17) ... Each use of
  // the cube expends 1 charge."
  { item: /^cubic gate$/i, spells: [
    { spell: "Gate", charges: 1, level: 9 },
    { spell: "Plane Shift", charges: 1, level: 7, dc: 17 },
  ] },
  // A bead is a charge: "the bead detonates as a 3rd-level fireball spell
  // (save DC 15)", and "increase the level of the fireball by 1 for each
  // bead beyond the first".
  { item: /^necklace of fireballs$/i, spells: [{ spell: "Fireball", charges: 1, level: 3, perCharge: true, dc: 15 }] },
  // A star is a charge: "pull off one of the stars and use it to cast magic
  // missile as a 5th-level spell".
  { item: /^robe of stars$/i, spells: [{ spell: "Magic Missile", charges: 1, level: 5 }] },
  // Once a day, the power tracked as a charge (scripts/lib/magic-item-riders.mjs).
  { item: /^cape of the mountebank$/i, spells: [{ spell: "Dimension Door", charges: 1, level: 4 }] },
  // SRD 5.1, Artifacts: "cast one of the following spells (save DC 18) from
  // it: cure wounds (5th-level version, 3 charges), daylight (1 charge),
  // death ward (2 charges), or scrying (3 charges). You can also use an
  // action to cast the detect magic spell from the orb without using any
  // charges."
  { item: /^orb of dragonkind$/i, spells: [
    { spell: "Cure Wounds", charges: 3, level: 5, dc: 18 },
    { spell: "Daylight", charges: 1, level: 3, dc: 18 },
    { spell: "Death Ward", charges: 2, level: 4, dc: 18 },
    { spell: "Scrying", charges: 3, level: 5, dc: 18 },
    { spell: "Detect Magic", charges: 0, level: 1, dc: 18 },
  ] },
  { item: /^ring of animal influence$/i, spells: [
    { spell: "Animal Friendship", charges: 1, level: 1, dc: 13 },
    { spell: "Fear", charges: 1, level: 3, dc: 13 },
    { spell: "Speak with Animals", charges: 1, level: 1 },
  ] },
];

// The spells an item casts, or an empty list for one the table does not
// know.
export function itemSpellsOf(itemName: string): ItemSpell[] {
  const name = itemName.trim().replace(/\s*\([^()]*\)\s*$/, "");
  return ROWS.find((row) => row.item.test(name))?.spells ?? [];
}

// The spells a carried row casts: a workshop item's own list when it carries
// one (src/lib/homebrew/item-data.ts), else the table's by its row
// (src/lib/srd/item-row.ts), so a "Bacchetta dei dardi" listed as a Wand of
// Magic Missiles casts them.
export function itemSpellsOfRow(item: RowItem & { gear?: unknown }): ItemSpell[] {
  const own = (item.gear as { spells?: ItemSpell[] } | undefined)?.spells;
  return Array.isArray(own) && own.length ? own : itemSpellsOf(rowName(item));
}

// What casting `spell` from this item costs for `charges` spent (the fewest
// it takes when none are named), or an error sentence.
export function itemSpellCast(
  item: string | (RowItem & { gear?: unknown }),
  spell: string,
  charges: number | undefined,
): { spell: string; charges: number; level: number; dc?: number } | ToolError {
  const itemName = typeof item === "string" ? item : item.name;
  const spells = typeof item === "string" ? itemSpellsOf(item) : itemSpellsOfRow(item);
  if (!spells.length) {
    return { error: `${itemName} casts no spell the server knows; spend its charges without a spell and resolve what it does with the tool for it.`, retry: true };
  }
  const wanted = textKey(spell);
  const row = spells.find((entry) => textKey(entry.spell) === wanted);
  const cost = (count: number) => (count ? `${count} charge${count === 1 ? "" : "s"}` : "no charge, at will");
  if (!row) {
    return { error: `${itemName} casts ${spells.map((entry) => `${entry.spell} (${cost(entry.charges)})`).join(", ")}, not ${spell}.`, retry: true };
  }
  const spent = Math.max(row.charges, Math.round(charges ?? row.charges));
  if (!row.perCharge && spent !== row.charges) {
    return { error: row.charges ? `${row.spell} from ${itemName} costs ${cost(row.charges)}, no more and no fewer.` : `${row.spell} from ${itemName} costs no charge: it is cast at will. Leave charges out.`, retry: true };
  }
  const level = row.perCharge ? row.level + (spent - row.charges) : row.level;
  if (row.maxLevel && level > row.maxLevel) {
    return { error: `${row.spell} from ${itemName} is cast at most at level ${row.maxLevel}, ${row.maxLevel - row.level + row.charges} charges.`, retry: true };
  }
  if (level > 9) {
    return { error: `A spell has no level above 9; spend fewer charges on ${row.spell}.`, retry: true };
  }
  return { spell: row.spell, charges: spent, level, ...(row.dc ? { dc: row.dc } : {}) };
}
