// The spells the SRD 5.1 charged items cast, with what each costs and the
// numbers it is cast with. Read by use_item (src/lib/dm/item-use.ts) when a
// charge is spent to cast a spell, so the spell the model then resolves
// spends no slot and carries the item's own DC (src/lib/srd/
// item-cast-credit.ts).
//
// `charges` is the cost; `level` the spell level cast for it. `perCharge`: each
// charge beyond the first raises the spell's level by one (the wands of
// fireballs, lightning bolts and magic missiles, cure wounds from a Staff of
// Healing, up to `maxLevel`). `dc` is the item's own save DC; absent, the
// wielder's own spell save DC (the staffs say "using your spell save DC").

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
  ] },
  { item: /^ring of shooting stars$/i, spells: [{ spell: "Faerie Fire", charges: 1, level: 1 }] },
  { item: /^ring of animal influence$/i, spells: [
    { spell: "Animal Friendship", charges: 1, level: 1, dc: 13 },
    { spell: "Fear", charges: 1, level: 3, dc: 13 },
    { spell: "Speak with Animals", charges: 1, level: 1 },
  ] },
];

function key(text: string): string {
  return text.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

// The spells an item casts, or an empty list for one the table does not
// know.
export function itemSpellsOf(itemName: string): ItemSpell[] {
  const name = itemName.trim().replace(/\s*\([^()]*\)\s*$/, "");
  return ROWS.find((row) => row.item.test(name))?.spells ?? [];
}

// What casting `spell` from this item costs for `charges` spent (the fewest
// it takes when none are named), or an error sentence.
export function itemSpellCast(
  itemName: string,
  spell: string,
  charges: number | undefined,
): { spell: string; charges: number; level: number; dc?: number } | { error: string } {
  const spells = itemSpellsOf(itemName);
  if (!spells.length) {
    return { error: `${itemName} casts no spell the server knows; spend its charges without a spell and resolve what it does with the tool for it.` };
  }
  const wanted = key(spell);
  const row = spells.find((entry) => key(entry.spell) === wanted);
  if (!row) {
    return { error: `${itemName} casts ${spells.map((entry) => `${entry.spell} (${entry.charges} charge${entry.charges === 1 ? "" : "s"})`).join(", ")}, not ${spell}.` };
  }
  const spent = Math.max(row.charges, Math.round(charges ?? row.charges));
  if (!row.perCharge && spent !== row.charges) {
    return { error: `${row.spell} from ${itemName} costs ${row.charges} charge${row.charges === 1 ? "" : "s"}, no more and no fewer.` };
  }
  const level = row.perCharge ? row.level + (spent - row.charges) : row.level;
  if (row.maxLevel && level > row.maxLevel) {
    return { error: `${row.spell} from ${itemName} is cast at most at level ${row.maxLevel}, ${row.maxLevel - row.level + row.charges} charges.` };
  }
  if (level > 9) {
    return { error: `A spell has no level above 9; spend fewer charges on ${row.spell}.` };
  }
  return { spell: row.spell, charges: spent, level, ...(row.dc ? { dc: row.dc } : {}) };
}
