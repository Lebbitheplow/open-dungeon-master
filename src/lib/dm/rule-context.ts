import type { CharacterSheet } from "@/lib/schemas/sheet";
import type { RuleContext } from "@/lib/dm/prompt-rules";

// What a compact prompt's rules are chosen by (src/lib/dm/prompt-rules.ts):
// what the party can do, read from every sheet at the table, AI companions
// and summoned creatures included, so a rule is left out only when nobody
// it could apply to is there.

const FEAT_SPELLS = /\b(fey touched|shadow touched|magic initiate|ritual caster)\b/i;
// Level-one features the class-feature rules cover: a ranger's Favored Enemy
// and Natural Explorer, and the racial traits a check's reason triggers.
const LEVEL_ONE_FEATURES_CLASS = /\branger\b/i;
const LEVEL_ONE_FEATURES_RACE = /\b(dwarf|gnome|goliath)\b/i;

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
  };
}
