import type { CharacterSheet } from "@/lib/schemas/sheet";
import type { RuleContext } from "@/lib/dm/prompt-rules";
import { classListFor } from "@/lib/srd/multiclass";

// What a compact prompt's rules are chosen by (src/lib/dm/prompt-rules.ts):
// what the party can do, read from every sheet at the table, AI companions
// and summoned creatures included, so a rule is left out only when nobody
// it could apply to is there.

const FEAT_SPELLS = /\b(fey touched|shadow touched|magic initiate|ritual caster)\b/i;
// Level-one features the class-feature rules cover: a ranger's Favored Enemy
// and Natural Explorer, and the racial traits a check's about triggers.
const LEVEL_ONE_FEATURES_CLASS = /\branger\b/i;
const LEVEL_ONE_FEATURES_RACE = /\b(dwarf|gnome|goliath)\b/i;

// The SRD's classes; a line about one of them rides only when someone at the
// table has it (prompt-rules.ts "class:" needs).
const SRD_CLASSES = new Set(["barbarian", "bard", "cleric", "druid", "fighter", "monk", "paladin", "ranger", "rogue", "sorcerer", "warlock", "wizard"]);

// Every class at the table, multiclass levels included; null when any is a
// class a world pack added, whose features may be any of the SRD's.
export function tableClasses(sheets: readonly CharacterSheet[]): Set<string> | null {
  const classes = new Set<string>();
  for (const sheet of sheets) {
    for (const entry of classListFor(sheet)) {
      const id = entry.id.trim().toLowerCase();
      if (!SRD_CLASSES.has(id)) {
        return null;
      }
      classes.add(id);
    }
  }
  return classes;
}

export function casts(sheet: CharacterSheet): boolean {
  const spells = sheet.spellcasting;
  if (!spells) {
    return false;
  }
  return (
    (spells.prepared?.length ?? 0) + (spells.known?.length ?? 0) + (spells.cantrips?.length ?? 0) > 0 ||
    Object.keys(spells.slots ?? {}).length > 0
  );
}

export function ruleContextFor(input: {
  sheets: readonly CharacterSheet[];
  inEncounter: boolean;
  groups: Iterable<string>;
  arc: boolean;
  recall: boolean;
  map: boolean;
  legendary: boolean;
}): RuleContext {
  const sheets = input.sheets;
  return {
    inEncounter: input.inEncounter,
    groups: new Set(input.groups),
    caster: sheets.some(casts),
    features: sheets.some((sheet) => Object.keys(sheet.resources ?? {}).length > 0),
    classFeatures: sheets.some(
      (sheet) =>
        sheet.level >= 2 ||
        Boolean(sheet.subclass) ||
        LEVEL_ONE_FEATURES_CLASS.test(sheet.class) ||
        LEVEL_ONE_FEATURES_RACE.test(sheet.race),
    ),
    featSpells: sheets.some((sheet) => sheet.feats.some((feat) => FEAT_SPELLS.test(feat))),
    dying: sheets.some((sheet) => sheet.currentHp <= 0 || sheet.deathSaves?.dead === true),
    arc: input.arc,
    recall: input.recall,
    map: input.map,
    legendary: input.legendary,
    classes: tableClasses(sheets),
  };
}
