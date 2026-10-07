import { SRD_ARMOR } from "@/lib/srd/armor";
import { PACKS, type KitItem } from "@/lib/srd/starting-kit-data";
import { SRD_WEAPONS } from "@/lib/srd/weapons";

// SRD 5.1 adventuring gear, tools, instruments and foci: name, price and
// weight, as the "Adventuring Gear", "Tools" and "Equipment Packs" tables
// print them, under the catalog's own names (the ones src/lib/srd/
// starting-kit-data.ts writes the packs in). Three readers:
//
// - the builder's purse (starting-wealth.ts bundledPriceCopper), which had
//   prices for weapons and armor only, so a backpack bought at creation was
//   refused as "no listed price" while the server, pricing from the content
//   pack, would have taken it (issue #111);
// - the encumbrance rule (encumbrance.ts), as a fallback when the pack
//   stamps no weight;
// - resolveBackgroundGear below, which turns a background's prose kit ("a
//   set of common clothes, a hunting trap, an explorer's pack") into the
//   catalog items the class kits already arrive as, so packs open, items
//   weigh what they weigh, and "work leathers" stays a flavour line rather
//   than becoming Leather armor (issue #113).
//
// Pure data and string work: scripts/test-adventuring-gear.mjs drives it.

export type SrdGear = {
  name: string;
  // Copper pieces; null for an item the book lists in a pack but never
  // prices on its own (vestments, an alms box).
  costCp: number | null;
  // Pounds; null when the book gives none.
  weightLb: number | null;
  // Other ways the prose names it.
  aliases?: string[];
};

const gp = (gold: number) => Math.round(gold * 100);
const sp = (silver: number) => Math.round(silver * 10);

export const SRD_GEAR: SrdGear[] = [
  { name: "Abacus", costCp: gp(2), weightLb: 2 },
  { name: "Acid (vial)", costCp: gp(25), weightLb: 1, aliases: ["acid", "vial of acid"] },
  { name: "Alchemist's Fire (flask)", costCp: gp(50), weightLb: 1, aliases: ["alchemist's fire", "flask of alchemist's fire"] },
  { name: "Alms Box", costCp: null, weightLb: null },
  { name: "Antitoxin (vial)", costCp: gp(50), weightLb: null, aliases: ["antitoxin"] },
  { name: "Arcane Focus", costCp: gp(10), weightLb: 1, aliases: ["crystal", "orb", "rod", "wand", "arcane focus (crystal)", "arcane focus (orb)", "arcane focus (rod)", "arcane focus (staff)", "arcane focus (wand)"] },
  { name: "Backpack", costCp: gp(2), weightLb: 5 },
  { name: "Ball Bearings (bag of 1000)", costCp: gp(1), weightLb: 2, aliases: ["ball bearings", "bag of 1000 ball bearings", "bag of 1,000 ball bearings"] },
  { name: "Barrel", costCp: gp(2), weightLb: 70 },
  { name: "Basket", costCp: sp(4), weightLb: 2 },
  { name: "Bedroll", costCp: gp(1), weightLb: 7 },
  { name: "Bell", costCp: gp(1), weightLb: null },
  { name: "Blanket", costCp: sp(5), weightLb: 3, aliases: ["winter blanket"] },
  { name: "Block and Tackle", costCp: gp(1), weightLb: 5 },
  { name: "Block of Incense", costCp: null, weightLb: null, aliases: ["incense (block)", "blocks of incense"] },
  { name: "Book", costCp: gp(25), weightLb: 5 },
  { name: "Bottle, Glass", costCp: gp(2), weightLb: 2, aliases: ["glass bottle"] },
  { name: "Bucket", costCp: 5, weightLb: 2 },
  { name: "Caltrops (bag of 20)", costCp: gp(1), weightLb: 2, aliases: ["caltrops", "bag of caltrops"] },
  { name: "Candle", costCp: 1, weightLb: null },
  { name: "Case, Crossbow Bolt", costCp: gp(1), weightLb: 1, aliases: ["crossbow bolt case", "bolt case"] },
  { name: "Case, Map or Scroll", costCp: gp(1), weightLb: 1, aliases: ["scroll case", "map case", "map or scroll case"] },
  { name: "Censer", costCp: null, weightLb: null },
  { name: "Chain (10 feet)", costCp: gp(5), weightLb: 10, aliases: ["chain", "10 feet of chain"] },
  { name: "Chalk (1 piece)", costCp: 1, weightLb: null, aliases: ["chalk", "piece of chalk"] },
  { name: "Chest", costCp: gp(5), weightLb: 25 },
  { name: "Climber's Kit", costCp: gp(25), weightLb: 12 },
  { name: "Clothes, Common", costCp: sp(5), weightLb: 3, aliases: ["common clothes", "set of common clothes", "common clothing"] },
  { name: "Clothes, Costume", costCp: gp(5), weightLb: 4, aliases: ["costume", "costume clothes", "set of costume clothes"] },
  { name: "Clothes, Fine", costCp: gp(15), weightLb: 6, aliases: ["fine clothes", "set of fine clothes", "fine clothing"] },
  { name: "Clothes, Traveler's", costCp: gp(2), weightLb: 4, aliases: ["traveler's clothes", "traveller's clothes", "traveling clothes", "travelling clothes", "set of traveler's clothes", "set of traveller's clothes"] },
  { name: "Component Pouch", costCp: gp(25), weightLb: 2 },
  { name: "Crowbar", costCp: gp(2), weightLb: 5 },
  { name: "Druidic Focus", costCp: gp(1), weightLb: null, aliases: ["sprig of mistletoe", "totem", "yew wand", "druidic focus (sprig of mistletoe)", "druidic focus (totem)", "druidic focus (wooden staff)", "druidic focus (yew wand)"] },
  { name: "Fishing Tackle", costCp: gp(1), weightLb: 4 },
  { name: "Flask", costCp: 2, weightLb: 1, aliases: ["flask or tankard", "tankard"] },
  { name: "Grappling Hook", costCp: gp(2), weightLb: 4 },
  { name: "Hammer", costCp: gp(1), weightLb: 3 },
  { name: "Hammer, Sledge", costCp: gp(2), weightLb: 10, aliases: ["sledge hammer", "sledgehammer"] },
  { name: "Healer's Kit", costCp: gp(5), weightLb: 3, aliases: ["healer's satchel"] },
  { name: "Holy Symbol", costCp: gp(5), weightLb: 1, aliases: ["amulet", "emblem", "reliquary", "holy symbol (amulet)", "holy symbol (emblem)", "holy symbol (reliquary)", "holy symbol (amulet or reliquary)"] },
  { name: "Holy Water (flask)", costCp: gp(25), weightLb: 1, aliases: ["holy water", "flask of holy water"] },
  { name: "Hourglass", costCp: gp(25), weightLb: 1 },
  { name: "Hunting Trap", costCp: gp(5), weightLb: 25 },
  { name: "Ink (1 ounce bottle)", costCp: gp(10), weightLb: null, aliases: ["ink", "bottle of ink", "bottle of black ink", "ink bottle", "1 ounce bottle of ink"] },
  { name: "Ink Pen", costCp: 2, weightLb: null, aliases: ["pen", "quill", "quill pen"] },
  { name: "Jug", costCp: 2, weightLb: 4, aliases: ["jug or pitcher", "pitcher"] },
  { name: "Ladder (10-foot)", costCp: sp(1), weightLb: 25, aliases: ["ladder", "10-foot ladder"] },
  { name: "Lamp", costCp: sp(5), weightLb: 1 },
  { name: "Lantern, Bullseye", costCp: gp(10), weightLb: 2, aliases: ["bullseye lantern"] },
  { name: "Lantern, Hooded", costCp: gp(5), weightLb: 2, aliases: ["hooded lantern", "lantern"] },
  { name: "Little Bag of Sand", costCp: null, weightLb: null, aliases: ["bag of sand", "small bag of sand"] },
  { name: "Lock", costCp: gp(10), weightLb: 1 },
  { name: "Magnifying Glass", costCp: gp(100), weightLb: null },
  { name: "Manacles", costCp: gp(2), weightLb: 6 },
  { name: "Mess Kit", costCp: sp(2), weightLb: 1 },
  { name: "Mirror, Steel", costCp: gp(5), weightLb: 0.5, aliases: ["steel mirror", "mirror"] },
  { name: "Oil (flask)", costCp: sp(1), weightLb: 1, aliases: ["oil", "flask of oil", "lamp oil", "lamp oil (flask)"] },
  { name: "Paper (one sheet)", costCp: sp(2), weightLb: null, aliases: ["paper", "sheet of paper"] },
  { name: "Parchment (one sheet)", costCp: sp(1), weightLb: null, aliases: ["parchment", "sheet of parchment"] },
  { name: "Perfume (vial)", costCp: gp(5), weightLb: null, aliases: ["perfume", "vial of perfume"] },
  { name: "Pick, Miner's", costCp: gp(2), weightLb: 10, aliases: ["miner's pick", "pick"] },
  { name: "Piton", costCp: 5, weightLb: 0.25 },
  { name: "Poison, Basic (vial)", costCp: gp(100), weightLb: null, aliases: ["basic poison", "vial of basic poison"] },
  { name: "Pole (10-foot)", costCp: 5, weightLb: 7, aliases: ["pole", "10-foot pole"] },
  { name: "Pot, Iron", costCp: gp(2), weightLb: 10, aliases: ["iron pot", "cooking pot"] },
  { name: "Potion of Healing", costCp: gp(50), weightLb: 0.5 },
  { name: "Pouch", costCp: sp(5), weightLb: 1, aliases: ["belt pouch"] },
  { name: "Quiver", costCp: gp(1), weightLb: 1 },
  { name: "Ram, Portable", costCp: gp(4), weightLb: 35, aliases: ["portable ram"] },
  { name: "Rations (1 day)", costCp: sp(5), weightLb: 2, aliases: ["rations", "ration", "day of rations", "days of rations", "days rations", "day's rations", "days' rations", "days worth of rations", "days' worth of rations", "trail rations"] },
  { name: "Robes", costCp: gp(1), weightLb: 4, aliases: ["robe"] },
  { name: "Rope, Hempen (50 feet)", costCp: gp(1), weightLb: 10, aliases: ["hempen rope", "rope", "50 feet of hempen rope", "50 feet of rope", "50 ft of rope", "50 ft rope", "50 ft hempen rope", "50-foot rope", "50-foot hempen rope", "rope, hempen"] },
  { name: "Rope, Silk (50 feet)", costCp: gp(10), weightLb: 5, aliases: ["silk rope", "50 feet of silk rope", "50 ft silk rope", "50 ft of silk rope", "50-foot silk rope", "rope, silk"] },
  { name: "Sack", costCp: 1, weightLb: 0.5 },
  { name: "Scale, Merchant's", costCp: gp(5), weightLb: 3, aliases: ["merchant's scale", "merchant's scales"] },
  { name: "Sealing Wax", costCp: sp(5), weightLb: null },
  { name: "Shovel", costCp: gp(2), weightLb: 5 },
  { name: "Signal Whistle", costCp: 5, weightLb: null, aliases: ["whistle"] },
  { name: "Signet Ring", costCp: gp(5), weightLb: null },
  { name: "Small Knife", costCp: null, weightLb: 0.5, aliases: ["knife", "penknife", "small penknife"] },
  { name: "Soap", costCp: 2, weightLb: null },
  { name: "Spellbook", costCp: gp(50), weightLb: 3, aliases: ["spell book"] },
  { name: "Spikes, Iron (10)", costCp: gp(1), weightLb: 5, aliases: ["iron spikes", "iron spike"] },
  { name: "Spyglass", costCp: gp(1000), weightLb: 1 },
  { name: "String (10 feet)", costCp: null, weightLb: null, aliases: ["string", "10 feet of string"] },
  { name: "Tent, Two-Person", costCp: gp(2), weightLb: 20, aliases: ["tent", "two-person tent", "tent (two-person)"] },
  { name: "Tinderbox", costCp: sp(5), weightLb: 1, aliases: ["tinder box"] },
  { name: "Torch", costCp: 1, weightLb: 1 },
  { name: "Vestments", costCp: null, weightLb: null },
  { name: "Vial", costCp: gp(1), weightLb: null },
  { name: "Waterskin", costCp: sp(2), weightLb: 5, aliases: ["water skin"] },
  { name: "Whetstone", costCp: 1, weightLb: 1 },
  // Tools (SRD 5.1, "Tools").
  { name: "Alchemist's Supplies", costCp: gp(50), weightLb: 8 },
  { name: "Brewer's Supplies", costCp: gp(20), weightLb: 9 },
  { name: "Calligrapher's Supplies", costCp: gp(10), weightLb: 5 },
  { name: "Carpenter's Tools", costCp: gp(8), weightLb: 6 },
  { name: "Cartographer's Tools", costCp: gp(15), weightLb: 6, aliases: ["cartographers' tools"] },
  { name: "Cobbler's Tools", costCp: gp(5), weightLb: 5 },
  { name: "Cook's Utensils", costCp: gp(1), weightLb: 8 },
  { name: "Glassblower's Tools", costCp: gp(30), weightLb: 5 },
  { name: "Jeweler's Tools", costCp: gp(25), weightLb: 2 },
  { name: "Leatherworker's Tools", costCp: gp(5), weightLb: 5, aliases: ["set of leatherworker's tools"] },
  { name: "Mason's Tools", costCp: gp(10), weightLb: 8 },
  { name: "Painter's Supplies", costCp: gp(10), weightLb: 5 },
  { name: "Potter's Tools", costCp: gp(10), weightLb: 3 },
  { name: "Smith's Tools", costCp: gp(20), weightLb: 8 },
  { name: "Tinker's Tools", costCp: gp(50), weightLb: 10 },
  { name: "Weaver's Tools", costCp: gp(1), weightLb: 5 },
  { name: "Woodcarver's Tools", costCp: gp(1), weightLb: 5 },
  { name: "Disguise Kit", costCp: gp(25), weightLb: 3 },
  { name: "Forgery Kit", costCp: gp(15), weightLb: 5 },
  { name: "Dice Set", costCp: sp(1), weightLb: null, aliases: ["gaming set (dice)", "set of dice", "dice"] },
  { name: "Playing Card Set", costCp: sp(5), weightLb: null, aliases: ["gaming set (playing cards)", "deck of cards", "deck of playing cards", "playing cards"] },
  { name: "Herbalism Kit", costCp: gp(5), weightLb: 3, aliases: ["herbalist kit", "herbalist's kit"] },
  { name: "Navigator's Tools", costCp: gp(25), weightLb: 2 },
  { name: "Poisoner's Kit", costCp: gp(50), weightLb: 2 },
  { name: "Thieves' Tools", costCp: gp(25), weightLb: 1, aliases: ["thieves tools", "thief's tools"] },
  // Musical instruments (SRD 5.1, "Tools").
  { name: "Bagpipes", costCp: gp(30), weightLb: 6 },
  { name: "Drum", costCp: gp(6), weightLb: 3 },
  { name: "Dulcimer", costCp: gp(25), weightLb: 10 },
  { name: "Flute", costCp: gp(2), weightLb: 1 },
  { name: "Lute", costCp: gp(35), weightLb: 2 },
  { name: "Lyre", costCp: gp(30), weightLb: 2 },
  { name: "Horn", costCp: gp(3), weightLb: 2 },
  { name: "Pan Flute", costCp: gp(12), weightLb: 2 },
  { name: "Shawm", costCp: gp(2), weightLb: 1 },
  { name: "Viol", costCp: gp(30), weightLb: 1 },
];

// "Rope, Hempen (50 feet)" -> "rope hempen 50 feet"; apostrophes and case
// go, a trailing plural goes ("torches" -> "torch", "clothes" is kept by
// the alias list naming it).
export function gearKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[^a-z0-9'+]+/g, " ")
    .replace(/'/g, "")
    .trim()
    .replace(/\s+/g, " ");
}

function singular(key: string): string {
  if (/(ss|us|is)$/.test(key) || key.length < 4) {
    return key;
  }
  if (/ches$/.test(key)) {
    return key.replace(/es$/, "");
  }
  if (/ies$/.test(key)) {
    return key.replace(/ies$/, "y");
  }
  return key.replace(/s$/, "");
}

const byKey = new Map<string, SrdGear>();
function index(key: string, gear: SrdGear) {
  if (key && !byKey.has(key)) {
    byKey.set(key, gear);
  }
}
for (const gear of SRD_GEAR) {
  const whole = gearKey(gear.name);
  index(whole, gear);
  // "Clothes, Common" is also "common clothes"; "Rope, Hempen (50 feet)"
  // also "hempen rope"; the bracket alone falls away too.
  const bare = gear.name.replace(/\s*\([^)]*\)\s*$/, "");
  index(gearKey(bare), gear);
  const comma = /^([^,]+),\s*(.+)$/.exec(bare);
  if (comma) {
    index(gearKey(`${comma[2]} ${comma[1]}`), gear);
  }
  for (const alias of gear.aliases ?? []) {
    index(gearKey(alias), gear);
  }
}

function lookup(key: string): SrdGear | null {
  return byKey.get(key) ?? byKey.get(singular(key)) ?? null;
}

// The gear row a name points at: the catalog name, the book's inverted
// form, an alias, singular or plural. Null for anything else.
export function matchGear(text: string): SrdGear | null {
  const key = gearKey(text);
  return key ? lookup(key) : null;
}

export function gearPriceCopper(name: string): number | null {
  return matchGear(name)?.costCp ?? null;
}

export function gearWeightLb(name: string): number | null {
  return matchGear(name)?.weightLb ?? null;
}

// ---- a background's kit, read into catalog items ----

const COUNT_WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  twelve: 12, twenty: 20, fifty: 50, hundred: 100,
};
// "5 sticks of incense", "7 days of rations", "10 sheets of paper", "a set
// of common clothes": the count, the unit it counts in, the thing.
const UNITS = /^(?:(sticks?|days?|sheets?|pieces?|sets?|pairs?|bottles?|vials?|flasks?|blocks?|bags?)(?:'|’)?s?\s+(?:worth\s+of\s+|of\s+)?)/i;
const PACK_LINE = /\b(burglar|diplomat|dungeoneer|entertainer|explorer|priest|scholar)(?:'|’)s pack\b/i;
// Prose that trails the item: "a shield bearing your employer's symbol",
// "a scroll case of notes". The head is tried on its own.
const TRAILERS = /\s+(?:of|from|with|containing|holding|including|that|which|bearing|emblazoned|for|in|to)\s+/i;
// Lines the catalog would misread: a one-person tent is not the two-person
// one, sticks of incense are not its blocks.
const KEEP_AS_WRITTEN = [/\b(?:one|1)[- ]person\b/i, /\bsticks? of incense\b/i];

const weaponByKey = new Map(SRD_WEAPONS.map((weapon) => [gearKey(weapon.name), weapon.name]));
weaponByKey.set("staff", "Quarterstaff");
weaponByKey.set("wooden staff", "Quarterstaff");
weaponByKey.set("wood staff", "Quarterstaff");
const armorByKey = new Map(SRD_ARMOR.map((armor) => [gearKey(armor.name), armor.name]));
for (const armor of SRD_ARMOR) {
  armorByKey.set(gearKey(`${armor.name} armor`), armor.name);
}

// The catalog name a phrase is, as a weapon, armor or gear; null when it is
// none. Exact names only, so "belaying pin" is not a pin. Armor is matched
// only with `armor` set: a phrase read whole or as the head of a clause,
// never after its adjectives are dropped, so "work leathers" never becomes
// Leather (issue #113).
function catalogName(phrase: string, armor = true): string | null {
  const key = gearKey(phrase);
  if (!key) {
    return null;
  }
  for (const candidate of [key, singular(key)]) {
    const weapon = weaponByKey.get(candidate);
    if (weapon) {
      return weapon;
    }
    const worn = armor ? armorByKey.get(candidate) : undefined;
    if (worn) {
      return worn;
    }
  }
  return lookup(key)?.name ?? null;
}

// The catalog name for a phrase, trying the phrase whole, then what its
// brackets say ("belaying pin (club)"), then without its leading adjectives
// ("dark common clothes", "winter blanket"), then its head before a trailing
// clause ("shield bearing your employer's symbol").
function resolvePhrase(phrase: string): string | null {
  const whole = catalogName(phrase);
  if (whole) {
    return whole;
  }
  const bracket = /\(([^)]+)\)/.exec(phrase);
  if (bracket) {
    const inside = catalogName(bracket[1]);
    if (inside) {
      return inside;
    }
    const without = catalogName(phrase.replace(/\s*\([^)]*\)/, ""));
    if (without) {
      return without;
    }
  }
  const words = phrase.trim().split(/\s+/);
  for (let drop = 1; drop <= 2 && drop < words.length; drop += 1) {
    const found = catalogName(words.slice(drop).join(" "), false);
    if (found) {
      return found;
    }
  }
  const trailer = TRAILERS.exec(phrase);
  if (trailer && trailer.index > 0) {
    return resolvePhrase(phrase.slice(0, trailer.index));
  }
  return null;
}

function tidy(line: string): string {
  const text = line.trim().replace(/\s+/g, " ").replace(/\.$/, "");
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

export type ResolvedGearLine = {
  // The catalog items the line comes to, or the one flavour item it stays.
  items: KitItem[];
  // False when nothing in the catalog matched and the line is kept as the
  // book wrote it (a trophy, a letter of introduction).
  resolved: boolean;
};

// One line of a background's kit. A pack opens into its contents; a count
// becomes a quantity; a catalog item takes its catalog name; a choice ("a
// dagger, quarterstaff, or spear") and anything the catalog does not know
// stays as written, tidied.
export function resolveGearLine(raw: string): ResolvedGearLine {
  const line = raw.trim().replace(/\s+/g, " ").replace(/\.$/, "");
  if (!line) {
    return { items: [], resolved: true };
  }
  const pack = PACK_LINE.exec(line);
  if (pack) {
    const items = PACKS[pack[1].toLowerCase() as keyof typeof PACKS];
    return { items: items.map((item) => ({ ...item })), resolved: true };
  }
  if (KEEP_AS_WRITTEN.some((pattern) => pattern.test(line))) {
    return { items: [{ name: tidy(line), qty: 1 }], resolved: false };
  }
  // A choice is the player's to make; it stays one line. A choice inside
  // brackets ("holy symbol (amulet or reliquary)") is a detail of one item.
  const unbracketed = line.replace(/\s*\([^)]*\)/g, "");
  if (/\bor\b/i.test(unbracketed) && !/\bmap or scroll\b|\bjug or pitcher\b|\bflask or tankard\b/i.test(unbracketed)) {
    return { items: [{ name: tidy(line), qty: 1 }], resolved: false };
  }
  // "ink and quill", "vestments and a holy symbol": two items when both
  // halves are catalog items; otherwise the line stays whole.
  const pair = /^(.+?)\s+and\s+(.+)$/i.exec(unbracketed);
  if (pair) {
    const halves = [resolveGearLine(pair[1]), resolveGearLine(pair[2])];
    if (halves.every((half) => half.resolved)) {
      return { items: halves.flatMap((half) => half.items), resolved: true };
    }
  }
  // A rope's length is not a count of ropes.
  const rope = /^(?:a\s+)?(\d+)\s*(?:feet|foot|ft)\.?\s+(?:of\s+)?(hempen|silk)?\s*rope\b/i.exec(line);
  if (rope) {
    return { items: [{ name: rope[2]?.toLowerCase() === "silk" ? "Rope, Silk (50 feet)" : "Rope, Hempen (50 feet)", qty: 1 }], resolved: true };
  }
  let rest = line;
  let qty = 1;
  const count = /^(\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten|twelve|twenty|fifty|hundred)\s+(.+)$/i.exec(rest);
  if (count) {
    qty = /^\d+$/.test(count[1]) ? Number(count[1]) : (COUNT_WORDS[count[1].toLowerCase()] ?? 1);
    rest = count[2];
  }
  const unit = UNITS.exec(rest);
  if (unit) {
    // "a set of fine clothes" counts clothes, not sets; "5 sticks of
    // incense" counts sticks of a thing the catalog has no stick of.
    const thing = rest.slice(unit[0].length);
    const found = resolvePhrase(thing) ?? resolvePhrase(`${unit[1]} of ${thing}`);
    if (found) {
      return { items: [{ name: found, qty: Math.max(1, Math.min(999, qty)) }], resolved: true };
    }
    return { items: [{ name: tidy(line), qty: 1 }], resolved: false };
  }
  const found = resolvePhrase(rest);
  if (found) {
    return { items: [{ name: found, qty: Math.max(1, Math.min(999, qty)) }], resolved: true };
  }
  return { items: [{ name: tidy(line), qty: 1 }], resolved: false };
}

// A background's whole kit as the names the sheet carries, one entry per
// item so a quantity is a repeat (the shape kitNames gives a class kit and
// the free-kit ledger counts). "15 gp" lines are the purse, not an item,
// and are left to splitPurse.
export function resolveBackgroundGear(lines: string[] | undefined): string[] {
  const out: string[] = [];
  for (const line of lines ?? []) {
    if (/^\s*\d[\d,]*\s*gp\s*$/i.test(line)) {
      out.push(line);
      continue;
    }
    for (const item of resolveGearLine(line).items) {
      for (let count = 0; count < item.qty; count += 1) {
        out.push(item.name);
      }
    }
  }
  return out;
}
