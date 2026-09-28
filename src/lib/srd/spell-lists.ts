import spellManifest from "@/lib/srd/manifest/spells.json";

// Cantrips live in their own list on a sheet (spellcasting.cantrips), apart
// from prepared and known spells: they are never prepared and never count
// against spells known. Sheets written before that split carried cantrips
// inside prepared/known, so readers heal them through normalizeSpellcasting.
//
// Which names are cantrips comes from the official spell checklist
// (manifest/spells.json, level 0 plus every alias). A homebrew cantrip the
// checklist does not name stays wherever it was written, which is exactly
// how it behaved before the split: it is still castable, just not moved.

type ManifestSpell = { n: string; l: number; a?: string[] };

const CANTRIP_NAMES = new Set(
  (spellManifest as { spells: ManifestSpell[] }).spells
    .filter((spell) => spell.l === 0)
    .flatMap((spell) => [spell.n, ...(spell.a ?? [])])
    .map((name) => name.trim().toLowerCase()),
);

export function isCantripName(name: string): boolean {
  return CANTRIP_NAMES.has(name.trim().toLowerCase());
}

const SPELL_LEVELS = new Map(
  (spellManifest as { spells: ManifestSpell[] }).spells.flatMap((spell) =>
    [spell.n, ...(spell.a ?? [])].map((name) => [name.trim().toLowerCase(), spell.l] as const),
  ),
);

// A spell's level by name from the checklist, or null for a homebrew name it
// does not carry. Lets a sheet file its spells under level tabs without a
// fetch.
export function spellLevelOf(name: string): number | null {
  return SPELL_LEVELS.get(name.trim().toLowerCase()) ?? null;
}

const CHECKLIST = new Map(
  (spellManifest as { spells: Array<ManifestSpell & { c?: string }> }).spells.flatMap((spell) =>
    [spell.n, ...(spell.a ?? [])].map((name) => [name.trim().toLowerCase(), spell] as const),
  ),
);

// Whether the checklist puts `name` on `classSlug`'s list at a level from 1
// to `maxLevel`, answered with the spell's canonical name. The fallback when
// the content pack is not installed.
export function checklistClassSpell(
  name: string,
  classSlug: string,
  maxLevel: number,
): string | null {
  const spell = CHECKLIST.get(name.trim().toLowerCase());
  if (!spell || spell.l < 1 || spell.l > maxLevel) {
    return null;
  }
  return classesOf(spell).includes(classSlug.toLowerCase()) ? spell.n : null;
}

// The checklist's class lists come from Open5e's spell lists, which leave the
// paladin off nearly every spell it shares with the cleric and the ranger off
// much of what it shares with the druid. These are the two lists as SRD 5.1
// prints them ("Spell Lists", Paladin Spells and Ranger Spells), added to
// whatever the checklist says so an honest paladin can prepare Bless.
const SRD_LIST_SUPPLEMENT: Record<string, string[]> = {
  paladin: [
    "Bless", "Command", "Cure Wounds", "Detect Evil and Good", "Detect Magic",
    "Detect Poison and Disease", "Divine Favor", "Heroism", "Protection from Evil and Good",
    "Purify Food and Drink", "Shield of Faith",
    "Aid", "Branding Smite", "Find Steed", "Lesser Restoration", "Locate Object", "Magic Weapon",
    "Protection from Poison", "Zone of Truth",
    "Create Food and Water", "Daylight", "Dispel Magic", "Magic Circle", "Remove Curse", "Revivify",
    "Banishment", "Death Ward", "Locate Creature",
    "Dispel Evil and Good", "Geas", "Raise Dead",
  ],
  ranger: [
    "Alarm", "Animal Friendship", "Cure Wounds", "Detect Magic", "Detect Poison and Disease",
    "Fog Cloud", "Goodberry", "Hunter's Mark", "Jump", "Longstrider", "Speak with Animals",
    "Animal Messenger", "Barkskin", "Darkvision", "Find Traps", "Lesser Restoration",
    "Locate Animals or Plants", "Locate Object", "Pass without Trace", "Protection from Poison",
    "Silence", "Spike Growth",
    "Conjure Animals", "Daylight", "Nondetection", "Plant Growth", "Protection from Energy",
    "Speak with Plants", "Water Breathing", "Water Walk", "Wind Wall",
    "Conjure Woodland Beings", "Freedom of Movement", "Locate Creature", "Stoneskin",
    "Commune with Nature", "Tree Stride",
  ],
};

const SUPPLEMENT_BY_SPELL = new Map<string, string[]>();
for (const [classSlug, names] of Object.entries(SRD_LIST_SUPPLEMENT)) {
  for (const name of names) {
    const key = name.trim().toLowerCase();
    SUPPLEMENT_BY_SPELL.set(key, [...(SUPPLEMENT_BY_SPELL.get(key) ?? []), classSlug]);
  }
}

// The classes whose list a spell is on, from the checklist and the
// supplement together, lowercased.
function classesOf(spell: ManifestSpell & { c?: string }): string[] {
  const listed = (spell.c ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  const more = [spell.n, ...(spell.a ?? [])].flatMap(
    (name) => SUPPLEMENT_BY_SPELL.get(name.trim().toLowerCase()) ?? [],
  );
  return [...new Set([...listed, ...more])];
}

// What the checklist says of a spell by name: its canonical name, its level
// and the class lists it is on. Null for a name it does not carry.
export function checklistSpell(
  name: string,
): { name: string; level: number; classes: string[] } | null {
  const spell = CHECKLIST.get(name.trim().toLowerCase());
  if (!spell) {
    return null;
  }
  return { name: spell.n, level: spell.l, classes: classesOf(spell) };
}

// Every spell the checklist puts on one class's list, cantrips included, by
// canonical name in the checklist's own order. For a caller that has to
// CHOOSE spells (a companion the engine builds) rather than judge a choice.
export function checklistSpellsOn(classSlug: string): Array<{ name: string; level: number }> {
  const wanted = classSlug.trim().toLowerCase();
  return (spellManifest as { spells: Array<ManifestSpell & { c?: string }> }).spells
    .filter((spell) => classesOf(spell).includes(wanted))
    .map((spell) => ({ name: spell.n, level: spell.l }));
}

type SpellLists = { known: string[]; prepared: string[]; cantrips?: string[] };

// Every spell a caster can reach for: cantrips, known and prepared. A
// wizard's unprepared spellbook and the spells waiting for a long rest are
// deliberately absent: neither can be cast.
export function allSpellNames(lists: SpellLists | null | undefined): string[] {
  if (!lists) {
    return [];
  }
  return [...(lists.cantrips ?? []), ...lists.known, ...lists.prepared];
}

// How many of `names` count against a class's spells known / prepared
// allowance: cantrips never do, and neither do the always-prepared spells a
// subclass grants (domain, circle, oath, patron), passed as `granted`.
export function spellsAgainstLimit(names: string[], granted: string[] = []): number {
  const free = new Set(granted.map((name) => name.trim().toLowerCase()));
  return names.filter((name) => !isCantripName(name) && !free.has(name.trim().toLowerCase()))
    .length;
}

function dedupe(names: string[]): string[] {
  const seen = new Set<string>();
  return names.filter((name) => {
    const key = name.trim().toLowerCase();
    if (!key || seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

// Moves checklist cantrips out of known/prepared into cantrips. Idempotent,
// and returns a new object only for lists it actually touches.
export function splitCantrips<T extends SpellLists>(lists: T): T & { cantrips: string[] } {
  const known = Array.isArray(lists.known) ? lists.known : [];
  const prepared = Array.isArray(lists.prepared) ? lists.prepared : [];
  const cantrips = Array.isArray(lists.cantrips) ? lists.cantrips : [];
  const moved = [...known, ...prepared].filter(isCantripName);
  return {
    ...lists,
    known: known.filter((name) => !isCantripName(name)),
    prepared: prepared.filter((name) => !isCantripName(name)),
    cantrips: dedupe([...cantrips, ...moved]),
  };
}

// The whole spellcasting block, multiclass casters included.
export function normalizeSpellcasting<
  T extends SpellLists & { casters?: SpellLists[] },
>(spellcasting: T | null | undefined): (T & { cantrips: string[] }) | null {
  if (!spellcasting) {
    return null;
  }
  const top = splitCantrips(spellcasting);
  if (Array.isArray(spellcasting.casters)) {
    top.casters = spellcasting.casters.map((caster) => splitCantrips(caster));
  }
  return top;
}
