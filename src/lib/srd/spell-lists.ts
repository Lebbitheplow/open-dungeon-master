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

type SpellLists = { known: string[]; prepared: string[]; cantrips?: string[] };

// Every spell a caster can reach for: cantrips, known and prepared.
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
