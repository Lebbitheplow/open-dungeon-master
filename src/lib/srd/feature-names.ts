// Whether a feature, feat or condition as a sheet writes it is the one a rule
// names. The whole name decides, compared by textKey, in the formats ODM
// itself writes: the name alone ("Lucky"), with a bracket note ("Lucky
// (reroll nat 1)", "frightened (Dragon)"), or, for a feature, as one choice
// of a family ("Maneuver: Riposte" is Riposte). A name that only contains
// another is a different one: a homebrew "Unlucky" is no Lucky, "War Caster
// Lite" no War Caster, "exhausted" no exhaustion, "Maneuver" no Riposte, and
// a story condition "Curse: Blinded" no blinded.
//
// Imports only text-logic, by a relative path, so the pure engines and the
// scripts that load them without the path alias read it.
import { textKey } from "../language/text-logic.ts";

// The spellings a written name answers to: itself, without its bracket note,
// and, for a feature, the choice of a "Family: Choice".
function spellings(written: string, family: boolean): string[] {
  const bare = written.replace(/\s*\([^()]*\)\s*$/, "");
  const colon = family ? bare.indexOf(":") : -1;
  return [written, bare, colon > 0 ? bare.slice(colon + 1) : ""].map(textKey).filter(Boolean);
}

export function isNamed(written: string, ...names: string[]): boolean {
  const held = spellings(written, true);
  return names.some((name) => held.includes(textKey(name)));
}

// A condition as a sheet or a call writes it: the whole name, or with a
// bracket note.
export function isConditionNamed(written: string, ...names: string[]): boolean {
  const held = spellings(written, false);
  return names.some((name) => held.includes(textKey(name)));
}

// Whether the sheet holds a feature or feat by one of these names, as
// isNamed reads a name: racial traits carry their gist in brackets ("Brave
// (adv. vs frightened)"), a choice its family ("Hunter's Prey: Giant
// Killer").
export function holdsFeature(sheet: { features?: ReadonlyArray<{ name: string }>; feats?: readonly string[] }, ...names: string[]): boolean {
  return [...(sheet.features ?? []).map((feature) => feature.name), ...(sheet.feats ?? [])].some((name) => isNamed(name, ...names));
}

// The family a "Family: Choice" name belongs to ("Dragon Ancestor: Red" is
// of Dragon Ancestor), else the name itself.
export function familyOf(written: string): string {
  const colon = written.indexOf(":");
  return colon > 0 ? written.slice(0, colon) : written;
}

// The choice a name records, or null: its bracket note, else what follows
// its family ("Dragon Ancestor (gold)" is "gold", "Dragon Ancestor: Red"
// "Red").
export function nameChoice(written: string): string | null {
  const note = /\(([^()]*)\)\s*$/.exec(written)?.[1];
  const colon = written.indexOf(":");
  return (note ?? (colon > 0 ? written.slice(colon + 1) : "")).trim() || null;
}

// The choice a "Family: Choice" name records when its family is the one
// asked for ("Fighting Style: Archery" holds Archery of Fighting Style), else
// null: the family's own feature ("Fighting Style") holds no choice.
export function choiceIn(written: string, family: string): string | null {
  const colon = written.indexOf(":");
  return colon > 0 && textKey(written.slice(0, colon)) === textKey(family) ? written.slice(colon + 1).trim() || null : null;
}
