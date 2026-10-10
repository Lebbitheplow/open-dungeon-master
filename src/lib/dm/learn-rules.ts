// What a spell taught in play must be (learn_spell, src/lib/dm/mutations.ts):
// a spell of one of the caster's classes, of a level that class has slots
// for, and a cantrip only while the Cantrips Known column has room. And what
// a wizard pays to copy it into the book.
//
// SRD 5.1, each class's Spellcasting feature; Wizard, "Your Spellbook":
// copying a spell of 1st level or higher takes 2 hours and 50 gp for each
// level of the spell.
//
// Pure: the sheet and the spell's facts come in as values.

import type { SubclassExtras } from "@/lib/srd/subclass-tables";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { subclassSpellsFor } from "@/lib/srd/features";
import type { SpellFacts } from "@/lib/srd/spell-facts";
import { cantripCapOf, casterViewsOf, maxSpellLevelOf, type CasterView } from "@/lib/srd/spell-prep";

type Learner = Pick<CharacterSheet, "name" | "class" | "level" | "subclass" | "classes" | "abilities" | "spellcasting">;

const lower = (name: string) => name.trim().toLowerCase();

// The caster views whose class list carries the spell: the class's own list,
// or the spells its subclass adds to it (a patron's expanded list).
export function viewsWithSpell(sheet: Learner, facts: SpellFacts, extras?: SubclassExtras): CasterView[] {
  return casterViewsOf(sheet).filter(
    (view) =>
      facts.classes.length === 0 ||
      facts.classes.includes(lower(view.classId)) ||
      subclassSpellsFor(view.classId, view.subclass, view.level, extras).some((name) => lower(name) === lower(facts.name)),
  );
}

export function learnProblem(sheet: Learner, spell: string, facts: SpellFacts | null, extras?: SubclassExtras): string | null {
  if (!facts) {
    return `"${spell}" is not a spell this table knows (published, or written by whoever runs the table), so it cannot be learned. Check the name.`;
  }
  const views = viewsWithSpell(sheet, facts, extras);
  if (!views.length) {
    const classes = casterViewsOf(sheet).map((view) => view.classId).join(" or ") || sheet.class;
    return `${facts.name} is not on the ${classes} spell list, so ${sheet.name} cannot learn it.`;
  }
  if (facts.level === 0) {
    const room = views.some((view) => {
      const cap = cantripCapOf(view);
      return cap !== null && view.cantrips.length < cap;
    });
    if (!room) {
      return `${sheet.name} already knows as many cantrips as their class allows at this level; ${facts.name} cannot be added until the Cantrips Known column grows.`;
    }
    return null;
  }
  const top = Math.max(0, ...views.map((view) => maxSpellLevelOf(view)));
  if (facts.level > top) {
    return `${facts.name} is a level ${facts.level} spell and ${sheet.name} has slots up to level ${top}; it can be learned once they can cast spells of that level.`;
  }
  return null;
}

// What copying a spell into the spellbook costs: gold and hours.
export function copyCost(facts: SpellFacts): { gold: number; hours: number } {
  return { gold: 50 * facts.level, hours: 2 * facts.level };
}
