import type { HomebrewKind } from "@/lib/schemas/homebrew";
import type { SheetRenamer } from "@/lib/homebrew/sheet-refs";

// The other Homebrew entries one entry names inside its own data, by name:
// a subclass's always-prepared spells, the spells a magic item casts, the
// kit lines a background hands out. (A subclass's class is held by id,
// src/lib/homebrew/class-data.ts, and travels apart.)
//
// The same three callers as the sheet's list (src/lib/homebrew/sheet-refs.ts)
// read these: a rename carries them, a bundle's renamed arrivals are named
// through them, and "only what this workshop uses" follows them, so a
// subclass that grants a spell at level 5 brings the spell along.

type Rec = Record<string, unknown>;

const isRec = (value: unknown): value is Rec => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string" && Boolean(entry.trim())) : []);

export function homebrewDataRefs(kind: HomebrewKind, data: Rec): { spell: string[]; item: string[] } {
  if (kind === "archetype" && isRec(data.spells)) {
    return { spell: [...new Set(Object.values(data.spells).flatMap(strings))], item: [] };
  }
  if (kind === "item" && Array.isArray(data.spells)) {
    return { spell: [...new Set(data.spells.filter(isRec).flatMap((entry) => (typeof entry.spell === "string" ? [entry.spell] : [])))], item: [] };
  }
  if (kind === "background" && isRec(data.grants)) {
    return { spell: [], item: [...new Set(strings(data.grants.equipment))] };
  }
  return { spell: [], item: [] };
}

// The data with every name the renamer changes written under its new name,
// and whether anything changed. A background's prose kit line is written
// from its grants, so the caller normalizes the data again after a change
// (src/lib/homebrew/gear.ts normalizeHomebrewData).
export function renameHomebrewDataRefs(kind: HomebrewKind, data: Rec, rename: SheetRenamer): { data: Rec; changed: boolean } {
  let changed = false;
  const to = (refKind: "spell" | "item", name: string) => {
    const next = rename(refKind, name);
    if (next !== name) changed = true;
    return next;
  };
  if (kind === "archetype" && isRec(data.spells)) {
    const spells = Object.fromEntries(
      Object.entries(data.spells).map(([level, names]) => [level, Array.isArray(names) ? names.map((name) => (typeof name === "string" ? to("spell", name) : name)) : names]),
    );
    return changed ? { data: { ...data, spells }, changed } : { data, changed };
  }
  if (kind === "item" && Array.isArray(data.spells)) {
    const spells = data.spells.map((entry) => (isRec(entry) && typeof entry.spell === "string" ? { ...entry, spell: to("spell", entry.spell) } : entry));
    return changed ? { data: { ...data, spells }, changed } : { data, changed };
  }
  if (kind === "background" && isRec(data.grants) && Array.isArray(data.grants.equipment)) {
    const equipment = data.grants.equipment.map((line) => (typeof line === "string" ? to("item", line) : line));
    return changed ? { data: { ...data, grants: { ...data.grants, equipment } }, changed } : { data, changed };
  }
  return { data, changed: false };
}

// A hand-built monster's spells, by name: the list its stat block prints and
// the spellcasting block's own (src/lib/bestiary/monster-draft.ts), so a
// creature that casts a homebrew spell brings the spell and follows it.
export function monsterStatsSpells(stats: unknown): string[] {
  if (!isRec(stats)) return [];
  const casting = isRec(stats.spellcasting) && Array.isArray(stats.spellcasting.spells) ? stats.spellcasting.spells.filter(isRec) : [];
  return [...new Set([...strings(stats.spells), ...casting.flatMap((spell) => (typeof spell.name === "string" ? [spell.name] : []))])];
}

export function renameMonsterStatsSpells<T>(stats: T, rename: SheetRenamer): { stats: T; changed: boolean } {
  if (!isRec(stats)) return { stats, changed: false };
  let changed = false;
  const to = (name: string) => {
    const next = rename("spell", name);
    if (next !== name) changed = true;
    return next;
  };
  const next: Rec = { ...stats };
  if (Array.isArray(next.spells)) next.spells = next.spells.map((name) => (typeof name === "string" ? to(name) : name));
  if (isRec(next.spellcasting) && Array.isArray(next.spellcasting.spells)) {
    next.spellcasting = {
      ...next.spellcasting,
      spells: next.spellcasting.spells.map((spell) => (isRec(spell) && typeof spell.name === "string" ? { ...spell, name: to(spell.name) } : spell)),
    };
  }
  return changed ? { stats: next as T, changed } : { stats, changed: false };
}
