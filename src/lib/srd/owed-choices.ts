// The choices a character's levels have earned and not yet made
// (docs/dnd-rules-audit-2026-10-09-extent.md, F24): the class's skill picks,
// an Ability Score Improvement, the expertise a rogue or bard picks, a
// subclass at its class's level. Level-up leaves them open rather than refusing the level (a
// companion levels without them); they carry to the next level-up, which
// takes them, and the sheet shows them until then.
//
// Pure: the sheet dialog asks the same as the server.

import { asiOwed } from "@/lib/srd/asi-ledger";
import { expertiseAllowed, expertiseSlotsFor, subclassLevelFor, THIEVES_TOOLS } from "@/lib/srd/features";
import { classListFor } from "@/lib/srd/multiclass";
import { SRD_CLASSES } from "@/lib/srd";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { classWords } from "@/lib/sheet-words";

type Owing = Pick<CharacterSheet, "class" | "subclass" | "level" | "classes" | "features" | "proficiencies">;

export function owedChoices(sheet: Owing): string[] {
  const classes = classListFor(sheet);
  const out: string[] = [];
  // The first class's skill picks: as many of its list as it offers.
  const first = SRD_CLASSES.find((entry) => entry.id === (classes[0]?.id ?? sheet.class));
  if (first?.skillChoices?.count) {
    const offered = new Set(first.skillChoices.from.map((id) => id.replace(/_/g, " ")));
    const held = sheet.proficiencies.skills.filter((skill) => offered.has(skill.toLowerCase().replace(/_/g, " "))).length;
    if (held < first.skillChoices.count) {
      const left = first.skillChoices.count - held;
      out.push(`${left} ${first.name} skill${left === 1 ? "" : "s"}`);
    }
  }
  const asi = asiOwed(sheet, classes);
  if (asi > 0) {
    out.push(`${asi} Ability Score Improvement${asi === 1 ? "" : "s"} (two points, or a feat)`);
  }
  const held = sheet.proficiencies.expertise ?? [];
  const slots = classes.reduce((sum, entry) => sum + expertiseSlotsFor(entry.id, entry.level), 0);
  const classIds = classes.map((entry) => entry.id);
  const open = [...sheet.proficiencies.skills, THIEVES_TOOLS].filter((pick) => expertiseAllowed(pick, sheet.proficiencies.skills, classIds) && !held.includes(pick)).length;
  const expertise = Math.min(Math.max(0, slots - held.length), open);
  if (expertise > 0) {
    out.push(`expertise in ${expertise} more ${expertise === 1 ? "proficiency" : "proficiencies"}`);
  }
  for (const entry of classes) {
    if (subclassOwed(entry, entry.level)) {
      // The class by its words: the sheet dialog and the join confirmation
      // read this line, and printed "a subclass for plague_doctor".
      out.push(`a subclass for ${classWords(entry.id)} (due at ${classWords(entry.id)} level ${subclassLevelFor(entry.id)})`);
    }
  }
  return out;
}

// Whether a class at this class level owes its subclass: it has none, and it
// stands at its subclass level or past it. Past it too, because a character
// gets there without one (a level 1 build seated at a level 5 table), and the
// server takes the pick late. The level-up dialog asks this of the level it
// is about to give, so it offers the step whenever the sheet lists the pick
// as owed; it used to ask only at the exact level, which left such a
// character without a subclass for good, since once play starts the
// level-up is a player's only door to one.
export function subclassOwed(entry: { id: string; subclass?: string }, classLevel: number): boolean {
  const at = subclassLevelFor(entry.id);
  return at !== null && !(entry.subclass ?? "").trim() && at <= classLevel;
}
