// What the level-up dialog shows before the level is taken, computed with
// the engine's own pure functions so the preview and the server agree
// (src/lib/srd/level-up.ts builds the level; this reads the same pieces).
//
// It exists because the dialog kept its own copies of the rules and they
// drifted (U:UB1 to UB6): a third caster was never offered spells, the
// racial and innate cantrips were counted against the class's, expertise
// read only the class taking the level, the hit point preview left out the
// per-level bonuses, Draconic Resilience and Primal Champion, and the spell
// allowance read the scores from before the Ability Score Improvement.
//
// Pure, no JSX, so scripts/test-enforce-ui-dm.mjs drives it.
import { spellClassFor } from "@/lib/classes";
import type { AbilityScores, AsiChoice, CharacterSheet } from "@/lib/schemas/sheet";
import { findClass, findRace } from "@/lib/srd";
import { applyFeatIncrease } from "@/lib/srd/feat-effects";
import { expertiseSlotsFor } from "@/lib/srd/features";
import { freeCantripCount } from "@/lib/srd/free-cantrips";
import {
  fixedDieValue,
  hpBonusPerLevelFor,
  levelHpGain,
  retroactiveHp,
  type HpMethod,
} from "@/lib/srd/hit-points";
import { applyChoices } from "@/lib/srd/level-up";
import { classListFor } from "@/lib/srd/multiclass";
import { hpBonusPerLevel, srdRaceId } from "@/lib/srd/race-id";
import {
  cantripCapOf,
  maxSpellLevelOf,
  spellCapOf,
  spellStyleFor,
  type CasterView,
  type SpellStyle,
} from "@/lib/srd/spell-prep";
import { bundledSpellSchool } from "@/lib/srd/spell-facts";
import {
  THIRD_CASTER_ABILITY,
  THIRD_CASTER_LIST,
  isThirdCaster,
  thirdCasterOutside,
  thirdCasterSchoolProblem,
} from "@/lib/srd/third-caster";
import { PRIMAL_CHAMPION_CAP, featureHitPoints, holdsFeature } from "@/lib/srd/trait-rules";

type ClassRow = { id: string; subclass: string; level: number };

const lower = (value: string) => value.trim().toLowerCase();

// The scores after this level: the improvements chosen (and a half-feat's
// point), then Primal Champion at barbarian 20, in the server's order.
export function abilitiesAfterLevel(
  sheet: Pick<CharacterSheet, "abilities" | "features">,
  choices: AsiChoice[],
  leveled: { id: string; level: number },
): { abilities: AbilityScores; feats: string[]; primalChampion: boolean } {
  let abilities = applyChoices(sheet.abilities, choices);
  const feats: string[] = [];
  for (const choice of choices) {
    if (choice.mode !== "feat") {
      continue;
    }
    feats.push(choice.feat);
    const raised = applyFeatIncrease(abilities, choice.feat, choice.ability ?? null);
    if (!("error" in raised)) {
      abilities = raised.abilities;
    }
  }
  const primalChampion =
    lower(leveled.id) === "barbarian" && leveled.level === 20 && !holdsFeature(sheet, "primal champion");
  if (primalChampion) {
    abilities = {
      ...abilities,
      str: Math.min(PRIMAL_CHAMPION_CAP, abilities.str + 4),
      con: Math.min(PRIMAL_CHAMPION_CAP, abilities.con + 4),
    };
  }
  return { abilities, feats, primalChampion };
}

export type HpPreview = {
  // The whole gain at the table's fixed value (average or maximum).
  fixed: number;
  // The whole gain on the lowest and highest roll of the die.
  min: number;
  max: number;
  // What rides on top of the die, one line each, for the dialog to list.
  extras: string[];
};

// Hit points the level adds, as src/lib/srd/level-up.ts adds them: the die
// (or its fixed value) plus the Constitution after this level's
// improvements, the per-level bonus (hill dwarf, Tough), back pay for the
// levels already held when Constitution or that bonus rose, and a feature's
// hit points (Draconic Resilience).
export function levelUpHpPreview(input: {
  sheet: CharacterSheet;
  hitDie: number;
  method: HpMethod;
  abilitiesAfter: AbilityScores;
  featsAfter: string[];
  classesAfter: ClassRow[];
  targetLevel: number;
}): HpPreview {
  const { sheet, hitDie, abilitiesAfter } = input;
  const dwarf = hpBonusPerLevel(sheet.race) > 0;
  const bonusBefore = hpBonusPerLevelFor(dwarf, sheet.feats);
  const bonusAfter = hpBonusPerLevelFor(dwarf, [...sheet.feats, ...input.featsAfter]);
  const hpClasses = classListFor(sheet).map((entry) => ({
    die: findClass(entry.id)?.hitDie ?? Number(sheet.hitDice.die.slice(1)),
    level: entry.level,
  }));
  const backPay = Math.max(
    0,
    retroactiveHp(
      hpClasses,
      { con: sheet.abilities.con, perLevelBonus: bonusBefore },
      { con: abilitiesAfter.con, perLevelBonus: bonusAfter },
    ),
  );
  const featureHp = Math.max(
    0,
    featureHitPoints({
      ...sheet,
      classes: input.classesAfter,
      class: input.classesAfter[0]?.id ?? sheet.class,
      level: input.targetLevel,
    }) - featureHitPoints(sheet),
  );
  const onTop = backPay + featureHp;
  const gainAt = (face: number) => levelHpGain(face, abilitiesAfter.con, bonusAfter) + onTop;
  const fixedFace = input.method === "max" ? hitDie : fixedDieValue(hitDie);
  const extras: string[] = [];
  if (dwarf) {
    extras.push("+1 hill dwarf toughness");
  }
  if (bonusAfter > (dwarf ? 1 : 0)) {
    extras.push(`+${bonusAfter - (dwarf ? 1 : 0)} Tough`);
  }
  if (backPay) {
    extras.push(`+${backPay} for the levels already held`);
  }
  if (featureHp) {
    extras.push(`+${featureHp} Draconic Resilience`);
  }
  return { fixed: gainAt(fixedFace), min: gainAt(1), max: gainAt(hitDie), extras };
}

// Expertise picks still open after this level, summed over every class the
// character has (a rogue 6 taking bard 3 has two more), as the server sums
// them.
export function expertiseOpen(
  sheet: Pick<CharacterSheet, "proficiencies">,
  classesAfter: ClassRow[],
): number {
  const slots = classesAfter.reduce((sum, entry) => sum + expertiseSlotsFor(entry.id, entry.level), 0);
  return Math.max(0, slots - (sheet.proficiencies.expertise ?? []).length);
}

export type CasterPreview = {
  casts: boolean;
  // The class spell list the picker searches.
  list: string;
  ability: "int" | "wis" | "cha" | null;
  style: SpellStyle;
  // The highest spell level learnable at the new class level (0: cantrips only).
  maxLevel: number;
  cantripCap: number | null;
  spellCap: { label: string; count: number } | null;
};

// A warlock's Mystic Arcanum reaches past pact slots.
function arcanumTop(list: string, level: number): number {
  if (list !== "warlock") {
    return 0;
  }
  return level >= 17 ? 9 : level >= 15 ? 8 : level >= 13 ? 7 : level >= 11 ? 6 : 0;
}

// The chosen class's casting at its new level. An Eldritch Knight or Arcane
// Trickster casts from the wizard's list with Intelligence and knows its
// spells; every count comes from src/lib/srd/spell-prep.ts.
export function casterPreview(input: {
  classId: string;
  subclass: string;
  level: number;
  abilitiesAfter: AbilityScores;
}): CasterPreview {
  const third = isThirdCaster(input.classId, input.subclass);
  const klass = findClass(input.classId);
  const ability = third
    ? THIRD_CASTER_ABILITY
    : ((klass?.casterType !== "none" ? klass?.spellAbility : null) ?? null);
  const list = third ? THIRD_CASTER_LIST : spellClassFor(input.classId);
  const style: SpellStyle = third ? "known" : spellStyleFor(input.classId);
  if (!ability) {
    return { casts: false, list, ability: null, style, maxLevel: 0, cantripCap: null, spellCap: null };
  }
  const view: CasterView = {
    classId: input.classId,
    ability,
    level: input.level,
    subclass: input.subclass,
    style,
    known: [],
    prepared: [],
    cantrips: [],
    pending: [],
    spellbook: [],
  };
  const cantripCap = cantripCapOf(view);
  const spellCap = spellCapOf(view, input.abilitiesAfter);
  const maxLevel = Math.max(maxSpellLevelOf(view), arcanumTop(list, input.level));
  // A third caster below 3rd level casts nothing yet.
  const casts = !third || input.level >= 3;
  return { casts, list, ability, style, maxLevel, cantripCap, spellCap };
}

// Cantrips in this list that the race gave, which the class count leaves
// out (src/lib/srd/free-cantrips.ts; the level-up route uses the same).
export function freeCantripsIn(
  sheet: Pick<CharacterSheet, "race" | "level"> & { racialChoices?: { cantrip?: string } | null },
  cantrips: string[],
): number {
  const racial = findRace(srdRaceId(sheet.race))?.cantripChoice?.count ?? 0;
  return freeCantripCount(
    {
      race: sheet.race,
      level: sheet.level,
      racialChoices: sheet.racialChoices ?? null,
      spellcasting: { ability: "int", slots: {}, prepared: [], known: [], cantrips },
    },
    racial,
  );
}

// The engine's sentence when one more levelled spell would take an Eldritch
// Knight or Arcane Trickster past what it may learn outside its two schools
// (src/lib/srd/third-caster.ts, which the level-up route asks too); null when
// the pick is fine. A school the pack row names wins over the checklist's.
export function thirdCasterPickRefusal(input: {
  classId: string;
  subclass: string;
  level: number;
  known: string[];
  picks: string[];
  adding: string;
  schoolOf?: (name: string) => string | null | undefined;
}): string | null {
  const of = (name: string) => ({ name, school: input.schoolOf?.(name) ?? bundledSpellSchool(name) });
  return thirdCasterSchoolProblem({
    classId: input.classId,
    subclass: input.subclass,
    level: input.level,
    spells: [...input.known, ...input.picks, input.adding].map(of),
    heldOutside: thirdCasterOutside(input.classId, input.known.map(of)),
  });
}
