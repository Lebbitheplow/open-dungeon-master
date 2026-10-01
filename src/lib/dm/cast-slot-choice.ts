// Which slot a cast with no level named is made from, apart from the
// spell's own level (src/lib/dm/cast-rules.ts slotPlan asks these):
//   - a warlock's Pact Magic slots are all one level, and every spell is
//     cast at it (SRD 5.1, Warlock);
//   - a wizard's Spell Mastery spells are cast at their own level with no
//     slot at all (SRD 5.1, Wizard 18).
// Pure: the sheet and the spell come in as values.

import type { CharacterSheet } from "@/lib/schemas/sheet";
import type { SpellFacts } from "@/lib/srd/spell-facts";

type Caster = Pick<CharacterSheet, "class" | "classes" | "spellcasting" | "features">;

const keyOf = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const hasName = (list: string[] | undefined, names: Set<string>) =>
  (list ?? []).some((entry) => names.has(keyOf(entry)));

// Whether a wizard's Spell Mastery names this spell: the choice is kept on
// the feature ("Spell Mastery: Shield, Misty Step").
export function masteredSpell(sheet: Caster, names: Set<string>): boolean {
  return sheet.features.some((feature) => {
    const match = /^spell mastery\s*[:(-]\s*(.+?)\)?$/i.exec(feature.name.trim());
    return Boolean(match && match[1].split(/,|\band\b/).some((entry) => names.has(keyOf(entry))));
  });
}

// The slot level a cast with no level named is made at. The spell's own,
// except for a warlock: Pact Magic slots are all one level and every spell
// is cast at it (SRD 5.1, Warlock). A caster whose only slots sit at one
// level at or above the spell (a single-class warlock's sheet), or whose
// warlock list carries the spell while the pact slot is free and the
// spell's own level has none, casts at that level.
export function pactLevelFor(sheet: Caster, facts: SpellFacts, names: Set<string>): number {
  const own = facts.level;
  const casting = sheet.spellcasting;
  if (!casting || own < 1) {
    return own;
  }
  const levels = Object.entries(casting.slots)
    .filter(([, slot]) => slot.max > 0)
    .map(([level]) => Number(level));
  const pact = casting.pact;
  const single = [...new Set([...levels, ...(pact && pact.max > 0 ? [pact.level] : [])])];
  const warlockOnly =
    (sheet.classes?.length ? sheet.classes.every((entry) => entry.id.trim().toLowerCase() === "warlock") : sheet.class.trim().toLowerCase() === "warlock");
  if (warlockOnly && single.length === 1 && single[0] >= own) {
    return single[0];
  }
  const warlock = casting.casters?.find((caster) => caster.classId.trim().toLowerCase() === "warlock");
  const onWarlockList = Boolean(
    warlock && hasName([...(warlock.cantrips ?? []), ...warlock.known, ...warlock.prepared], names),
  );
  const ownFree = (casting.slots[String(own)]?.max ?? 0) > (casting.slots[String(own)]?.used ?? 0);
  if (pact && onWarlockList && pact.level >= own && pact.used < pact.max && !ownFree) {
    return pact.level;
  }
  return own;
}
