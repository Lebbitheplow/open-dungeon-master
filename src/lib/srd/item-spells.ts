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
//
// An item with no charges casts its rows at will (charges 0): use_item casts
// them without spending anything (src/lib/dm/item-use.ts). One whose text
// says "can't be used this way again until the next dawn" holds one charge
// that comes back at dawn (scripts/generate-magic-items.mjs reads it), and
// its spell costs that charge.

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
  // The item's own spell attack bonus (Circlet of Blasting: "When you make
  // the spell's attacks, you do so with an attack bonus of +5"); absent, the
  // wielder's own.
  attackBonus?: number;
  // Cast as a bonus action rather than an action (Ring of Jumping: "cast the
  // jump spell from it as a bonus action at will").
  bonusAction?: boolean;
  // The cast uses the item up (Elemental Gem: "an elemental is summoned as if
  // you had cast the conjure elemental spell, and the gem's magic is lost").
  usesUp?: boolean;
  // An ability check the cast waits on (Amulet of the Planes: "make a DC 15
  // Intelligence check. On a successful check, you cast the plane shift
  // spell").
  check?: { ability: "str" | "dex" | "con" | "int" | "wis" | "cha"; dc: number };
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
  ...WONDROUS_ROWS(),
];

// The rest of the SRD 5.1 items that cast a named spell: the at-will ones,
// the once-a-dawn ones (one charge, scripts/generate-magic-items.mjs), the
// rings and blades that spend charges, and the families whose member decides
// what it casts (a Crystal Ball of Telepathy, a Ring of Air Elemental
// Command). Each row quotes the sentence it is read from.
function WONDROUS_ROWS(): ItemSpellRow[] {
  const conjure: ItemSpell[] = [{ spell: "Conjure Elemental", charges: 1, level: 5 }];
  // "Spells cast from the ring have a save DC of 17." "You can expend 2 of
  // the ring's charges to cast dominate monster on an air elemental", and
  // once the wearer has helped slay one of its kind, "You can cast the
  // following spells from the ring, expending the necessary number of
  // charges" (that condition is the GM's to judge).
  const command = (spells: ItemSpell[]): ItemSpell[] => [{ spell: "Dominate Monster", charges: 2, level: 8, dc: 17 }, ...spells.map((entry) => ({ ...entry, dc: 17 }))];
  const scrying: ItemSpell = { spell: "Scrying", charges: 0, level: 5, dc: 17 };
  return [
    // "cast the disguise self spell from it at will"
    { item: /^hat of disguise$/i, spells: [{ spell: "Disguise Self", charges: 0, level: 1 }] },
    // "cast the levitate spell on yourself at will"
    { item: /^boots of levitation$/i, spells: [{ spell: "Levitate", charges: 0, level: 2 }] },
    // "cast the comprehend languages spell from it at will"
    { item: /^helm of comprehending languages$/i, spells: [{ spell: "Comprehend Languages", charges: 0, level: 1 }] },
    // "cast the jump spell from it as a bonus action at will, but can target only yourself"
    { item: /^ring of jumping$/i, spells: [{ spell: "Jump", charges: 0, level: 1, bonusAction: true }] },
    // "cast the telekinesis spell at will, but you can target only objects that aren't being worn or carried"
    { item: /^ring of telekinesis$/i, spells: [{ spell: "Telekinesis", charges: 0, level: 5 }] },
    // "cast one of the following spells from it: detect evil and good, detect
    // magic, detect poison and disease, or see invisibility"
    { item: /^rod of alertness$/i, spells: [
      { spell: "Detect Evil and Good", charges: 0, level: 1 },
      { spell: "Detect Magic", charges: 0, level: 1 },
      { spell: "Detect Poison and Disease", charges: 0, level: 1 },
      { spell: "See Invisibility", charges: 0, level: 2 },
    ] },
    // "cast the detect thoughts spell (save DC 13) from it", and "cast the
    // suggestion spell (save DC 13) from the helm on that creature. Once
    // used, the suggestion property can't be used again until the next dawn."
    { item: /^helm of telepathy$/i, spells: [
      { spell: "Detect Thoughts", charges: 0, level: 2, dc: 13 },
      { spell: "Suggestion", charges: 1, level: 2, dc: 13 },
    ] },
    // "While touching it, you can cast the scrying spell (save DC 17) with
    // it", and the legendary variants' "cast the detect thoughts spell (save
    // DC 17) while you are scrying" and "cast the suggestion spell (save DC
    // 17) ... Once used, the suggestion power ... can't be used again until
    // the next dawn."
    { item: /^crystal ball(?: of true seeing| \(true seeing\))?$/i, spells: [scrying] },
    { item: /^crystal ball (?:of mind reading|\(mind reading\))$/i, spells: [scrying, { spell: "Detect Thoughts", charges: 0, level: 2, dc: 17 }] },
    { item: /^crystal ball (?:of telepathy|\(telepathy\))$/i, spells: [scrying, { spell: "Suggestion", charges: 1, level: 2, dc: 17 }] },
    // "cast the scorching ray spell with it. When you make the spell's
    // attacks, you do so with an attack bonus of +5. The circlet can't be
    // used this way again until the next dawn."
    { item: /^circlet of blasting$/i, spells: [{ spell: "Scorching Ray", charges: 1, level: 2, attackBonus: 5 }] },
    // "cast the web spell (save DC 13) ... Once used, this property of the
    // cloak can't be used again until the next dawn."
    { item: /^cloak of arachnida$/i, spells: [{ spell: "Web", charges: 1, level: 2, dc: 13 }] },
    // "cast polymorph on yourself, transforming into a bat ... The cloak
    // can't be used this way again until the next dawn."
    { item: /^cloak of the bat$/i, spells: [{ spell: "Polymorph", charges: 1, level: 4 }] },
    // "summon a water elemental, as if you had cast the conjure elemental
    // spell. The bowl can't be used this way again until the next dawn."
    { item: /^bowl of commanding water elementals$/i, spells: conjure },
    { item: /^brazier of commanding fire elementals$/i, spells: conjure },
    { item: /^censer of controlling air elementals$/i, spells: conjure },
    { item: /^stone of controlling earth elementals$/i, spells: conjure },
    // "When you use an action to break the gem, an elemental is summoned as
    // if you had cast the conjure elemental spell, and the gem's magic is lost."
    { item: /^elemental gem(?: \(.+\))?$|^(?:blue sapphire|yellow diamond|red corundum|emerald) elemental gem$/i, spells: [{ spell: "Conjure Elemental", charges: 0, level: 5, usesUp: true }] },
    // "cast the gust of wind spell (save DC 13) from it. Once used, the fan
    // shouldn't be used again until the next dawn."
    { item: /^wind fan$/i, spells: [{ spell: "Gust of Wind", charges: 1, level: 2, dc: 13 }] },
    // "make a DC 15 Intelligence check. On a successful check, you cast the
    // plane shift spell."
    { item: /^amulet of the planes$/i, spells: [{ spell: "Plane Shift", charges: 0, level: 7, check: { ability: "int", dc: 15 } }] },
    // Silver Raven: "While in raven form, the figurine allows you to cast the
    // animal messenger spell on it at will."
    { item: /^figurine of wondrous power \(silver raven\)$|^silver raven(?: figurine)?$/i, spells: [{ spell: "Animal Messenger", charges: 0, level: 2 }] },
    // Luck Blade: "expend 1 charge and cast the wish spell from it"; Ring of
    // Three Wishes: "expend 1 of its 3 charges to cast the wish spell from it".
    // Any sword ("Luck Blade Rapier", "Luck Blade (Longsword)"). The text
    // adds "This property can't be used again until the next dawn", which
    // the row's one count (its charges) cannot hold as well.
    { item: /^luck blade(?: .+)?$/i, spells: [{ spell: "Wish", charges: 1, level: 9 }] },
    { item: /^ring of three wishes$/i, spells: [{ spell: "Wish", charges: 1, level: 9 }] },
    // "expend 1 charge to cast dominate beast (save DC 15) from it on a beast
    // that has an innate swimming speed"
    { item: /^trident of fish command$/i, spells: [{ spell: "Dominate Beast", charges: 1, level: 4, dc: 15 }] },
    { item: /^ring of elemental command$/i, spells: command([]) },
    // "chain lightning (3 charges), gust of wind (2 charges), or wind wall (1 charge)"
    { item: /^ring of (?:air elemental command|elemental command \(air\))$/i, spells: command([
      { spell: "Chain Lightning", charges: 3, level: 6 },
      { spell: "Gust of Wind", charges: 2, level: 2 },
      { spell: "Wind Wall", charges: 1, level: 3 },
    ]) },
    // "stone shape (2 charges), stoneskin (3 charges), or wall of stone (3 charges)"
    { item: /^ring of (?:earth elemental command|elemental command \(earth\))$/i, spells: command([
      { spell: "Stone Shape", charges: 2, level: 4 },
      { spell: "Stoneskin", charges: 3, level: 4 },
      { spell: "Wall of Stone", charges: 3, level: 5 },
    ]) },
    // "burning hands (1 charge), fireball (2 charges), and wall of fire (3 charges)"
    { item: /^ring of (?:fire elemental command|elemental command \(fire\))$/i, spells: command([
      { spell: "Burning Hands", charges: 1, level: 1 },
      { spell: "Fireball", charges: 2, level: 3 },
      { spell: "Wall of Fire", charges: 3, level: 4 },
    ]) },
    // "create or destroy water (1 charge), control water (3 charges), ice
    // storm (2 charges), or wall of ice (3 charges)"
    { item: /^ring of (?:water elemental command|elemental command \(water\))$/i, spells: command([
      { spell: "Create or Destroy Water", charges: 1, level: 1 },
      { spell: "Control Water", charges: 3, level: 4 },
      { spell: "Ice Storm", charges: 2, level: 4 },
      { spell: "Wall of Ice", charges: 3, level: 6 },
    ]) },
    // A bead is a charge: "This necklace has 1d4+2 magic beads ... Each bead
    // contains a spell that you can cast from it as a bonus action (using
    // your spell save DC if a save is necessary). Once a magic bead's spell
    // is cast, that bead can't be used again until the next dawn." Which
    // beads a necklace holds is the GM's ("The GM decides the type of each
    // bead"); these are the six kinds.
    { item: /^necklace of prayer beads$/i, spells: [
      { spell: "Bless", charges: 1, level: 1, bonusAction: true },
      { spell: "Cure Wounds", charges: 1, level: 2, bonusAction: true },
      { spell: "Lesser Restoration", charges: 1, level: 2, bonusAction: true },
      { spell: "Greater Restoration", charges: 1, level: 5, bonusAction: true },
      { spell: "Branding Smite", charges: 1, level: 2, bonusAction: true },
      { spell: "Planar Ally", charges: 1, level: 6, bonusAction: true },
      { spell: "Wind Walk", charges: 1, level: 6, bonusAction: true },
    ] },
  ];
}

// The spells an item casts, or an empty list for one the table does not
// know. The whole name first, so a family's member named in brackets
// ("Crystal Ball (Telepathy)") casts its own; then without the note a sheet
// adds in brackets ("Wand of Fireballs (7 charges)").
export function itemSpellsOf(itemName: string): ItemSpell[] {
  const whole = itemName.trim();
  const name = whole.replace(/\s*\([^()]*\)\s*$/, "");
  return (ROWS.find((row) => row.item.test(whole)) ?? ROWS.find((row) => row.item.test(name)))?.spells ?? [];
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
export type ItemSpellCast = Pick<ItemSpell, "spell" | "charges" | "level" | "dc" | "attackBonus" | "bonusAction" | "usesUp" | "check">;

export function itemSpellCast(
  item: string | (RowItem & { gear?: unknown }),
  spell: string,
  charges: number | undefined,
): ItemSpellCast | ToolError {
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
  return {
    spell: row.spell,
    charges: spent,
    level,
    ...(row.dc ? { dc: row.dc } : {}),
    ...(row.attackBonus ? { attackBonus: row.attackBonus } : {}),
    ...(row.bonusAction ? { bonusAction: true } : {}),
    ...(row.usesUp ? { usesUp: true } : {}),
    ...(row.check ? { check: row.check } : {}),
  };
}
