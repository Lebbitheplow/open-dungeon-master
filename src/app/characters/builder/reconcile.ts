import { spellClassFor } from "@/lib/classes";
import { suggestedCantripCount } from "@/lib/content/mechanics";
import type { Ability } from "@/lib/schemas/sheet";
import { spellSlotsFor } from "@/lib/srd";
import { classFeaturesFor, expertiseSlotsFor, subclassLevelFor } from "@/lib/srd/features";
import { fightingStyleSlots, type FightingStyleId } from "@/lib/srd/feature-effects";
import { findOptionByFeatureName, optionSlotsFor } from "@/lib/srd/options";
import { spellLevelOf } from "@/lib/srd/spell-lists";
import { bonusLanguageCount } from "./submit";
import type { BackgroundOption, ClassOption, RaceOption } from "./useBuilderOptions";

// Every pick the player makes in the builder depends on an earlier choice:
// class skills on the class, and on what the background and race already
// grant; expertise on being proficient and on the class's slots; maneuvers
// on the subclass; spells on the class and the level; racial choices on the
// race. Going back and changing that earlier choice used to leave the picks
// exactly where they were, so a sheet could carry Battle Master maneuvers
// under a Champion or an acolyte's two languages under a criminal (issue
// #37). This is the one place that knows which picks are still valid, run
// after every change of race, class, subclass, background or level, when the
// content pack replaces the option rows, and once more as the sheet is built.
//
// Pure, so scripts/test-builder-reconcile.mjs can prove every rule without
// React. Slot-indexed picks (the racial ability bumps and skills, bonus
// languages) keep their positions: an invalid slot is blanked, not shifted.

export type BuilderPicks = {
  chosenSkills: string[];
  racialSkills: string[];
  racialAsi: Array<Ability | "">;
  racialCantrip: string;
  racialTool: string;
  bonusLanguages: string[];
  subclass: string;
  expertisePicks: string[];
  stylePicks: FightingStyleId[];
  optionPicks: string[];
  spells: string[];
  bookPrepared: string[];
  cantrips: string[];
};

export type ReconcileContext = {
  race?: RaceOption;
  klass?: ClassOption;
  background?: BackgroundOption;
  level: number;
};

const lower = (value: string) => value.trim().toLowerCase();

function unique<T extends string>(list: T[]): T[] {
  const seen = new Set<string>();
  return list.filter((entry) => {
    const key = lower(entry);
    if (!key || seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

// Slot-indexed lists: blank what no longer fits, drop a repeat, trim to the
// number of slots the option offers.
function slotted<T extends string>(list: T[], count: number, valid: (entry: T, index: number) => boolean): T[] {
  const seen = new Set<string>();
  return list.slice(0, count).map((entry, index) => {
    if (!entry || !valid(entry, index) || seen.has(lower(entry))) {
      return "" as T;
    }
    seen.add(lower(entry));
    return entry;
  });
}

export function reconcilePicks(
  input: Partial<BuilderPicks>,
  { race, klass, background, level }: ReconcileContext,
): { picks: BuilderPicks; dropped: string[] } {
  // A caller may hold only some of the lists (an edit stub, an older state
  // shape); a missing list is an empty one.
  const picks: BuilderPicks = {
    chosenSkills: input.chosenSkills ?? [],
    racialSkills: input.racialSkills ?? [],
    racialAsi: input.racialAsi ?? [],
    racialCantrip: input.racialCantrip ?? "",
    racialTool: input.racialTool ?? "",
    bonusLanguages: input.bonusLanguages ?? [],
    subclass: input.subclass ?? "",
    expertisePicks: input.expertisePicks ?? [],
    stylePicks: input.stylePicks ?? [],
    optionPicks: input.optionPicks ?? [],
    spells: input.spells ?? [],
    bookPrepared: input.bookPrepared ?? [],
    cantrips: input.cantrips ?? [],
  };
  const dropped: string[] = [];
  const note = (label: string, before: string[], after: string[]) => {
    const kept = new Set(after.filter(Boolean).map(lower));
    for (const entry of before) {
      if (entry && !kept.has(lower(entry))) {
        dropped.push(`${label}: ${entry}`);
      }
    }
  };

  // Skills the background and race hand over outright are not picks, and a
  // pick that duplicates one is a wasted slot the player never sees.
  const granted = new Set([...(background?.skills ?? []), ...(race?.skills ?? [])].map(lower));

  const skillChoices = klass?.skillChoices;
  const skillPool = skillChoices?.from.length ? new Set(skillChoices.from.map(lower)) : null;
  const chosenSkills = klass
    ? unique(picks.chosenSkills.filter((skill) => !granted.has(lower(skill)) && (!skillPool || skillPool.has(lower(skill)))))
        .slice(0, skillChoices?.count ?? picks.chosenSkills.length)
    : [];
  note("class skill", picks.chosenSkills, chosenSkills);

  const classPicked = new Set(chosenSkills.map(lower));
  const racialSkills = race?.skillChoice
    ? slotted(picks.racialSkills, race.skillChoice.count, (skill) => !granted.has(lower(skill)) && !classPicked.has(lower(skill)))
    : [];
  note("racial skill", picks.racialSkills, racialSkills);

  const fixedAsi = new Set(
    Object.entries(race?.asi ?? {})
      .filter(([, bonus]) => (bonus ?? 0) !== 0)
      .map(([ability]) => ability),
  );
  const racialAsi = race?.asiChoice
    ? slotted(picks.racialAsi, race.asiChoice.count, (ability) => !fixedAsi.has(ability))
    : [];
  note("racial ability bump", picks.racialAsi, racialAsi);

  const racialTool =
    race?.toolChoice && race.toolChoice.from.some((tool) => lower(tool) === lower(picks.racialTool))
      ? picks.racialTool
      : "";
  note("racial tool", [picks.racialTool], [racialTool]);
  const racialCantrip = race?.cantripChoice ? picks.racialCantrip : "";
  note("racial cantrip", [picks.racialCantrip], [racialCantrip]);

  // Languages: never one the race or class already speaks; a slot that comes
  // from a short list ("your choice of Common or Undercommon") only from it;
  // no more slots than the race and background offer together.
  const spoken = new Set([...(race?.languages ?? []), ...(klass?.languages ?? [])].map(lower));
  const choice = race?.languageChoice;
  const bonusLanguages = slotted(
    picks.bonusLanguages,
    bonusLanguageCount(race, background),
    (language, index) =>
      !spoken.has(lower(language)) &&
      (!choice || index >= choice.count || choice.from.some((entry) => lower(entry) === lower(language))),
  );
  note("bonus language", picks.bonusLanguages, bonusLanguages);

  const pickLevel = klass ? subclassLevelFor(klass.id) : null;
  const subclass = klass && (pickLevel === null || level >= pickLevel) ? picks.subclass : "";
  note("subclass", [picks.subclass], [subclass]);

  const proficient = new Set([...chosenSkills, ...racialSkills, ...granted].filter(Boolean).map(lower));
  const expertisePicks = klass
    ? unique(picks.expertisePicks.filter((skill) => proficient.has(lower(skill)))).slice(0, expertiseSlotsFor(klass.id, level))
    : [];
  note("expertise", picks.expertisePicks, expertisePicks);

  const features = klass ? classFeaturesFor(klass.id, subclass, level) : [];
  const stylePicks = unique(picks.stylePicks).slice(0, fightingStyleSlots(features));
  note("fighting style", picks.stylePicks, stylePicks);

  const perKind = new Map<string, number>();
  const optionPicks = unique(picks.optionPicks).filter((featureName) => {
    const option = findOptionByFeatureName(featureName);
    if (!option || !klass) {
      return false;
    }
    const taken = perKind.get(option.k) ?? 0;
    if (taken >= optionSlotsFor(klass.id, subclass, level, option.k)) {
      return false;
    }
    perKind.set(option.k, taken + 1);
    return true;
  });
  note("class option", picks.optionPicks, optionPicks);

  // Spells: only for a class that casts at this level, only up to the level
  // its slots reach. A spell above that is one the spell book cannot show, so
  // it has to go here or the player is asked to remove what they cannot see.
  const castingClass = klass?.spellAbility ? klass : undefined;
  const maxSpellLevel = castingClass
    ? Object.keys(spellSlotsFor(castingClass.id, level)).reduce((top, slot) => Math.max(top, Number(slot)), 0)
    : 0;
  const cantripCap = castingClass
    ? suggestedCantripCount(spellClassFor(castingClass.id), level, castingClass.casterType)
    : null;
  const casts = Boolean(castingClass) && (maxSpellLevel > 0 || cantripCap !== null);
  const cantrips = casts && cantripCap !== null ? unique(picks.cantrips) : [];
  note("cantrip", picks.cantrips, cantrips);
  const spells = casts
    ? unique(picks.spells).filter((name) => {
        const spellLevel = spellLevelOf(name);
        return spellLevel === null || (spellLevel > 0 && spellLevel <= maxSpellLevel);
      })
    : [];
  note("spell", picks.spells, spells);
  const book = new Set(spells.map(lower));
  const bookPrepared = unique(picks.bookPrepared).filter((name) => book.has(lower(name)));
  note("prepared", picks.bookPrepared, bookPrepared);

  return {
    picks: {
      chosenSkills,
      racialSkills,
      racialAsi,
      racialCantrip,
      racialTool,
      bonusLanguages,
      subclass,
      expertisePicks,
      stylePicks,
      optionPicks,
      spells,
      bookPrepared,
      cantrips,
    },
    dropped,
  };
}
