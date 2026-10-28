import type { Ability } from "@/lib/schemas/sheet";
import { classFeaturesFor, expertiseSlotsFor, racialTraitsFor, subclassLevelFor } from "@/lib/srd/features";
import { fightingStyleChoices, fightingStyleSlots, type FightingStyleId } from "@/lib/srd/feature-effects";
import { findOptionByFeatureName, optionSlotsFor } from "@/lib/srd/options";
import { innateCantripsFor, repeatedGrants } from "@/lib/srd/racial-grants";
import { withSpeciesVariant } from "@/lib/content/species-variants";
import { spellLevelOf } from "@/lib/srd/spell-lists";
import { builderCasting } from "./casting";
import { castingIndexOf } from "./multiclassBuild";
import { multiclassGrantsFor } from "@/lib/srd/multiclass";
import { bonusLanguageCount, type BlockerTarget } from "./submit";
import type { BackgroundOption, ClassOption, RaceOption } from "./useBuilderOptions";
import { textKey } from "@/lib/language/text-logic";

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
// React. Slot-indexed picks (the racial ability bumps and skills, the
// background's skills, bonus languages) keep their positions: an invalid
// slot is blanked, not shifted.

export type BuilderPicks = {
  // The option of a workshop species' choice (a Half-Dragon's ancestry), by
  // id. First, since what it grants changes what the other racial picks may be.
  racialVariant: string;
  chosenSkills: string[];
  racialSkills: string[];
  racialAsi: Array<Ability | "">;
  racialCantrips: string[];
  racialTool: string;
  // The skill picked in place of one the race and the background both give.
  repeatSkills: string[];
  backgroundSkills: string[];
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
  // The character's level. With classes after the first (backlog F9) the
  // first class holds what they leave of it.
  level: number;
  // The classes taken after the first, each with its row, its levels, its
  // subclass and the skills its multiclass grant let the player pick.
  extras?: ReadonlyArray<ReconcileExtra>;
};

export type ReconcileExtra = { klass?: ClassOption; subclass: string; level: number; skills?: string[] };

// A pick that no longer fits, named for the player: what kind of pick it
// was ("bonus language"), which one ("Dwarvish"), and the block on the step
// where it is made again, so a notice can take them there (issue #124: the
// list was computed and then thrown away).
export type DroppedPick = { label: string; value: string; target: BlockerTarget };


function unique<T extends string>(list: T[]): T[] {
  const seen = new Set<string>();
  return list.filter((entry) => {
    const key = textKey(entry);
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
    if (!entry || !valid(entry, index) || seen.has(textKey(entry))) {
      return "" as T;
    }
    seen.add(textKey(entry));
    return entry;
  });
}

// Which skills the class step must grey out, and why: the race's fixed
// grants (a wood elf's Perception), the background's (an outlander's
// Survival), and the skills picked for either (a half-elf's two, a
// background's "choose one"). The pill and the toggle both read this, so a
// skill the toggle refuses is one the pill explains (issue #109: Perception
// looked pickable and silently did nothing). A background's claim outranks
// the race's only in the label; both are "already yours".
export type SkillGrantSource = "race" | "background";

export function grantedSkillSources(input: {
  race?: Pick<RaceOption, "skills">;
  background?: Pick<BackgroundOption, "skills">;
  racialSkills?: string[];
  backgroundSkills?: string[];
}): Map<string, SkillGrantSource> {
  const sources = new Map<string, SkillGrantSource>();
  for (const skill of [...(input.background?.skills ?? []), ...(input.backgroundSkills ?? [])]) {
    if (skill) {
      sources.set(skill.trim().toLowerCase(), "background");
    }
  }
  for (const skill of [...(input.race?.skills ?? []), ...(input.racialSkills ?? [])]) {
    if (skill && !sources.has(skill.trim().toLowerCase())) {
      sources.set(skill.trim().toLowerCase(), "race");
    }
  }
  return sources;
}

// The racial trait that hands a skill over, by name, for the pill's
// explanation: a wood elf's Perception is "Keen Senses". The SRD trait
// lines read "Perception proficiency (Keen Senses)"; the bracketed name is
// what a player knows it as. Null when no trait line names the skill (a
// pack race, or a grant with no trait behind it).
export function grantingTrait(raceId: string, skillName: string): string | null {
  const wanted = skillName.trim().toLowerCase();
  if (!wanted) {
    return null;
  }
  const line = racialTraitsFor(raceId).find((trait) => trait.name.toLowerCase().includes(wanted));
  if (!line) {
    return null;
  }
  const bracketed = /\(([^)]+)\)/.exec(line.name);
  return bracketed ? bracketed[1].trim() : line.name.trim();
}

export function reconcilePicks(
  input: Partial<BuilderPicks>,
  context: ReconcileContext,
): { picks: BuilderPicks; dropped: string[]; drops: DroppedPick[]; extraSkills: string[][] } {
  const { klass, background, level } = context;
  const extras = context.extras ?? [];
  // The first class's own levels: its subclass, expertise, styles and
  // options are read at them, never at the character's level.
  const primaryLevel = Math.max(1, level - extras.reduce((sum, entry) => sum + entry.level, 0));
  // A caller may hold only some of the lists (an edit stub, an older state
  // shape); a missing list is an empty one.
  const picks: BuilderPicks = {
    racialVariant: input.racialVariant ?? "",
    chosenSkills: input.chosenSkills ?? [],
    racialSkills: input.racialSkills ?? [],
    racialAsi: input.racialAsi ?? [],
    racialCantrips: input.racialCantrips ?? [],
    racialTool: input.racialTool ?? "",
    repeatSkills: input.repeatSkills ?? [],
    backgroundSkills: input.backgroundSkills ?? [],
    bonusLanguages: input.bonusLanguages ?? [],
    subclass: input.subclass ?? "",
    expertisePicks: input.expertisePicks ?? [],
    stylePicks: input.stylePicks ?? [],
    optionPicks: input.optionPicks ?? [],
    spells: input.spells ?? [],
    bookPrepared: input.bookPrepared ?? [],
    cantrips: input.cantrips ?? [],
  };
  const drops: DroppedPick[] = [];
  const note = (label: string, target: BlockerTarget, before: string[], after: string[]) => {
    const kept = new Set(after.filter(Boolean).map(textKey));
    for (const entry of before) {
      if (entry && !kept.has(textKey(entry))) {
        drops.push({ label, value: entry, target });
      }
    }
  };

  // The species' own choice first: an option the species no longer offers
  // (removed in the workshop, or another species picked) is dropped and
  // asked for again, and every rule below reads the race with the option
  // picked, so a racial pick it now covers is dropped too.
  const group = context.race?.variants;
  const racialVariant = group?.options.some((option) => option.id === picks.racialVariant) ? picks.racialVariant : "";
  note((group?.label ?? "species choice").toLowerCase(), "variant", [picks.racialVariant], [racialVariant]);
  const race = context.race && withSpeciesVariant(context.race, racialVariant);

  // Skills the background and race hand over outright are not picks, and a
  // pick that duplicates one is a wasted slot the player never sees.
  const granted = new Set([...(background?.skills ?? []), ...(race?.skills ?? [])].map(textKey));

  // A background's skill pick comes first: its list is the narrowest, and
  // the class and racial picks below treat it as taken.
  const backgroundChoice = background?.skillChoice;
  const backgroundSkills = backgroundChoice
    ? slotted(
        picks.backgroundSkills,
        backgroundChoice.count,
        (skill) => !granted.has(textKey(skill)) && backgroundChoice.from.some((entry) => textKey(entry) === textKey(skill)),
      )
    : [];
  note("background skill", "backgroundSkills", picks.backgroundSkills, backgroundSkills);
  const backgroundPicked = new Set(backgroundSkills.filter(Boolean).map(textKey));

  const skillChoices = klass?.skillChoices;
  const skillPool = skillChoices?.from.length ? new Set(skillChoices.from.map(textKey)) : null;
  const chosenSkills = klass
    ? unique(picks.chosenSkills.filter((skill) => !granted.has(textKey(skill)) && !backgroundPicked.has(textKey(skill)) && (!skillPool || skillPool.has(textKey(skill)))))
        .slice(0, skillChoices?.count ?? picks.chosenSkills.length)
    : [];
  note("class skill", "classSkills", picks.chosenSkills, chosenSkills);

  const classPicked = new Set(chosenSkills.map(textKey));
  // A race that names its skills (the Orc's Primal Intuition) keeps only
  // picks from them.
  const racialPool = race?.skillChoice?.from?.length ? new Set(race.skillChoice.from.map(textKey)) : null;
  const racialSkills = race?.skillChoice
    ? slotted(picks.racialSkills, race.skillChoice.count, (skill) => !granted.has(textKey(skill)) && !classPicked.has(textKey(skill)) && !backgroundPicked.has(textKey(skill)) && (!racialPool || racialPool.has(textKey(skill))))
    : [];
  note("racial skill", "racialSkills", picks.racialSkills, racialSkills);

  // The skill picked in place of one the race and the background both give
  // (SRD 5.1, Backgrounds) stays only while they still both give one: a
  // species option, a race or a background that no longer repeats a skill
  // leaves it replacing nothing, and the server would refuse it as a skill
  // the character was never offered.
  const racialPicked = new Set(racialSkills.filter(Boolean).map(textKey));
  const repeatSkills = slotted(
    picks.repeatSkills,
    repeatedGrants(background?.skills, race?.skills).length,
    (skill) => !granted.has(textKey(skill)) && !classPicked.has(textKey(skill)) && !backgroundPicked.has(textKey(skill)) && !racialPicked.has(textKey(skill)),
  );
  note("replacement skill", "repeatSkills", picks.repeatSkills, repeatSkills);

  // The skill a class taken second lets the player pick (a rogue's one from
  // the rogue list): never one the character already has from elsewhere.
  const repeatPicked = new Set(repeatSkills.filter(Boolean).map(textKey));
  const extraPicked = new Set<string>();
  const extraSkills = extras.map((entry) => {
    const grant = entry.klass ? multiclassGrantsFor(entry.klass.id).skillChoice : undefined;
    const before = entry.skills ?? [];
    const pool = grant?.from.length ? new Set(grant.from.map(textKey)) : null;
    const kept = grant
      ? unique(before)
          .filter((skill) => {
            const key = textKey(skill);
            return (
              !granted.has(key) && !classPicked.has(key) && !backgroundPicked.has(key) && !racialPicked.has(key) &&
              !repeatPicked.has(key) && !extraPicked.has(key) && (!pool || pool.has(key))
            );
          })
          .slice(0, grant.count)
      : [];
    kept.forEach((skill) => extraPicked.add(textKey(skill)));
    note("second class skill", "classSkills", before, kept);
    return kept;
  });

  const fixedAsi = new Set(
    Object.entries(race?.asi ?? {})
      .filter(([, bonus]) => (bonus ?? 0) !== 0)
      .map(([ability]) => ability),
  );
  // An either-or increase (delver's Strength or Dexterity) only from its two.
  const asiFrom = race?.asiChoice?.from;
  const racialAsi = race?.asiChoice
    ? slotted(
        picks.racialAsi,
        race.asiChoice.count,
        (ability) => !fixedAsi.has(ability) && (!asiFrom || asiFrom.includes(ability as Ability)),
      )
    : [];
  note("racial ability bump", "racialAsi", picks.racialAsi, racialAsi);

  const racialTool =
    race?.toolChoice && race.toolChoice.from.some((tool) => textKey(tool) === textKey(picks.racialTool))
      ? picks.racialTool
      : "";
  note("racial tool", "racialTool", [picks.racialTool], [racialTool]);
  // As many different cantrips as the race offers, and none from a race
  // that offers none.
  const racialCantrips = race?.cantripChoice ? unique(picks.racialCantrips).slice(0, race.cantripChoice.count) : [];
  note("racial cantrip", "racialCantrip", picks.racialCantrips, racialCantrips);

  // Languages: never one the race, class or background already speaks; a
  // slot that comes from a short list ("your choice of Common or
  // Undercommon") only from it; no more slots than the race and background
  // offer together.
  const spoken = new Set(
    [
      ...(race?.languages ?? []),
      ...(klass?.languages ?? []),
      ...extras.flatMap((entry) => entry.klass?.languages ?? []),
      ...(background?.knownLanguages ?? []),
    ].map(textKey),
  );
  const choice = race?.languageChoice;
  const bonusLanguages = slotted(
    picks.bonusLanguages,
    bonusLanguageCount(race, background),
    (language, index) =>
      !spoken.has(textKey(language)) &&
      (!choice || index >= choice.count || choice.from.some((entry) => textKey(entry) === textKey(language))),
  );
  note("bonus language", "languages", picks.bonusLanguages, bonusLanguages);

  const pickLevel = klass ? subclassLevelFor(klass.id) : null;
  const subclass = klass && (pickLevel === null || primaryLevel >= pickLevel) ? picks.subclass : "";
  note("subclass", "subclass", [picks.subclass], [subclass]);

  const proficient = new Set(
    [...chosenSkills, ...racialSkills, ...backgroundSkills, ...extraSkills.flat(), ...granted].filter(Boolean).map(textKey),
  );
  // Each class at its own levels: a rogue taken second brings its two
  // expertise picks at its 1st level.
  const classes = [
    ...(klass ? [{ klass, subclass, level: primaryLevel }] : []),
    ...extras.flatMap((entry) => (entry.klass ? [{ klass: entry.klass, subclass: entry.subclass, level: entry.level }] : [])),
  ];
  const expertiseSlots = classes.reduce((sum, entry) => sum + expertiseSlotsFor(entry.klass.id, entry.level), 0);
  const expertisePicks = klass
    ? unique(picks.expertisePicks.filter((skill) => proficient.has(textKey(skill)))).slice(0, expertiseSlots)
    : [];
  note("expertise", "expertise", picks.expertisePicks, expertisePicks);

  const featuresOf = classes.map((entry) => classFeaturesFor(entry.klass.id, entry.subclass, entry.level));
  const features = featuresOf.flat();
  // Only the styles the slots allow (a Swords bard: Dueling or Two-Weapon
  // Fighting); a pick may name the style rather than its id.
  const allowedStyles = new Set(fightingStyleChoices(features).flatMap((style) => [style.id, textKey(style.name)]));
  const stylePicks = unique(picks.stylePicks.filter((pick) => allowedStyles.has(pick) || allowedStyles.has(textKey(pick)))).slice(0, fightingStyleSlots(features));
  note("fighting style", "styles", picks.stylePicks, stylePicks);

  const perKind = new Map<string, number>();
  const optionPicks = unique(picks.optionPicks).filter((featureName) => {
    const option = findOptionByFeatureName(featureName);
    if (!option || !klass) {
      return false;
    }
    const taken = perKind.get(option.k) ?? 0;
    const slots = classes.reduce(
      (sum, entry, index) => sum + optionSlotsFor(entry.klass.id, entry.subclass, entry.level, option.k, featuresOf[index]),
      0,
    );
    if (taken >= slots) {
      return false;
    }
    perKind.set(option.k, taken + 1);
    return true;
  });
  note("class option", "options", picks.optionPicks, optionPicks);

  // Spells: only for a class that casts at this level, only up to the level
  // its slots reach. A spell above that is one the spell book cannot show, so
  // it has to go here or the player is asked to remove what they cannot see.
  // An Eldritch Knight or Arcane Trickster casts too (./casting.ts).
  // With classes after the first, the class that casts holds the list, at
  // its own level (phase 1 of F9 builds one casting class).
  const casterAt = classes.length > 1 ? castingIndexOf(classes.map((entry) => ({ row: entry.klass, subclass: entry.subclass, level: entry.level }))) : 0;
  const caster = casterAt >= 0 ? classes[casterAt] : undefined;
  const { maxSpellLevel, cantripCap, casts } = builderCasting(caster?.klass, caster?.subclass, caster?.level ?? level);
  // The race's cantrips are not class picks: a stored sheet lists them with
  // the class's (submit.ts finalCantrips), and read back they would count
  // against the class's allowance (issue #118).
  const racialKnown = new Set(
    [...racialCantrips, ...innateCantripsFor(race?.id ?? "", level)].filter(Boolean).map(textKey),
  );
  const classCantrips = unique(picks.cantrips).filter((name) => !racialKnown.has(textKey(name)));
  const cantrips = casts && cantripCap !== null ? classCantrips : [];
  note("cantrip", "spells", classCantrips, cantrips);
  const spells = casts
    ? unique(picks.spells).filter((name) => {
        const spellLevel = spellLevelOf(name);
        return spellLevel === null || (spellLevel > 0 && spellLevel <= maxSpellLevel);
      })
    : [];
  note("spell", "spells", picks.spells, spells);
  const book = new Set(spells.map(textKey));
  const bookPrepared = unique(picks.bookPrepared).filter((name) => book.has(textKey(name)));
  note("prepared", "spells", picks.bookPrepared, bookPrepared);

  return {
    picks: {
      racialVariant,
      chosenSkills,
      racialSkills,
      racialAsi,
      racialCantrips,
      racialTool,
      repeatSkills,
      backgroundSkills,
      bonusLanguages,
      subclass,
      expertisePicks,
      stylePicks,
      optionPicks,
      spells,
      bookPrepared,
      cantrips,
    },
    dropped: drops.map((drop) => `${drop.label}: ${drop.value}`),
    drops,
    extraSkills,
  };
}
