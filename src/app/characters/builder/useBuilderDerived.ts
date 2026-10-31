import type { Genre } from "@/lib/schemas/game-settings";
import { expertiseAllowed, expertiseSlotsFor, subclassExpandedSpellsFor, subclassSpellListsFor } from "@/lib/srd/features";
import { multiclassGrantsFor, type MulticlassGrant } from "@/lib/srd/multiclass";
import { useMemo as useReactMemo, type DependencyList } from "react";
import { starterSpellsFor } from "@/lib/help";
import type { Ability, AbilityScores, AsiChoice, ClassEntry, EquipmentItem } from "@/lib/schemas/sheet";
import { acBreakdownFor, computeSheetDerived } from "@/lib/srd";
import { applyAsiChoices, asiLevelsFor, asiSlotsTakenInPlay } from "@/lib/srd/asi";
import type { HpMethod } from "@/lib/srd/hit-points";
import { reachesPrimalChampion, withPrimalChampion } from "@/lib/srd/trait-rules";
import { racialFeatCount } from "@/lib/srd/race-id";
import { innateCantripsFor } from "@/lib/srd/racial-grants";
import { halfFeatPicks, scoresWithHalfFeats, settledHalfFeats } from "@/lib/srd/legality/half-feats";
import {
  gearNameKey,
  layeredPrice,
  judgeStartingGear,
  type StartingWealthMethod,
} from "@/lib/srd/starting-wealth";
import { suggestArmor } from "@/lib/srd/armor";
import { classFeaturesFor, subclassSpellsFor } from "@/lib/srd/features";
import { fightingStyleChoices, fightingStyleSlots } from "@/lib/srd/feature-effects";
import { openOptionSlots, optionFeatureName, type OptionSlot } from "@/lib/srd/options";
import { spellStyleFor, spellbookAllowance, type SpellStyle } from "@/lib/srd/spell-prep";
import {
  chooseKitOption as withKitOption,
  classKitFor,
  kitLineOfSlot,
  kitNames,
  pickKitSlot as withKitPick,
  removedAfterKitChange,
  resolveKit,
  startingKitFor,
  type KitTraining,
} from "@/lib/srd/starting-kit";
import { suggestWeapons } from "@/lib/srd/weapons";
import { abilityGains } from "./abilityGains";
import { builderCasting, builderClassListSlots, builderSpellAdvice, builderSpellSlots } from "./casting";
import { builderAsiSlotLevels, castingIndexOf, classCasts, primaryLevelOf, type ExtraClass, type SpellLists } from "./multiclassBuild";
import { abilityMod, proficiencyBonus } from "@/lib/srd";
import { grantedSkillSources } from "./reconcile";
import { authoredFeatDesc } from "@/lib/srd/feat-effects";
import { applyFeatGrants, featGrantSpec, type FeatGrantSpec } from "@/lib/srd/feat-grants";
import { applySubclassTraining, grantsForHeldTraining, subclassGrants } from "@/lib/srd/subclass-training";
import { featSpellGrants, featSpellNames } from "@/lib/srd/feat-spells";
import { expandBackgroundGear } from "@/lib/srd/gear-choices";
import { splitToolGrants, type ToolChoice } from "@/lib/srd/tool-choices";
import { builderHitPoints } from "./builderHp";
import { bundledSpellSupply } from "./spellSupply";
import { classSpellGrants, type ClassSpellGrants } from "@/lib/srd/class-spell-grants";
import { buildReceipt, settleQty, weaponLineFor, withAddedQty } from "./receiptMath";
import { combatRiders, fightingStyleFeatureName } from "@/lib/srd/feature-effects";
import type { BackgroundOption, ClassOption, RaceOption } from "./useBuilderOptions";
import type { BuilderState, EquipmentItem as BuilderItem } from "./useBuilderState";
import { textKey } from "@/lib/language/text-logic";

// The derivation memoises each value with React's useMemo while the wizard
// renders. Not marked "use client", so the server can run the same body
// once, outside any render, through deriveBuilder below: the AI DM's
// drafted pregens (src/lib/characters/pregen-drafts.ts) are built by the
// quick-build engine against exactly the numbers the wizard would show.
let memoize: <T>(compute: () => T, deps: DependencyList) => T = useReactMemo;
function useMemo<T>(compute: () => T, deps: DependencyList): T {
  return memoize(compute, deps);
}

// Everything the builder computes from its fields: final abilities, the sheet
// preview, the auto loadout and AC, spell counts and the class option slots.
// Kept apart from the fields so each wizard step can read what it needs
// without knowing how it was derived.
// What the table has set for the numbers the server derives. Absent in the
// library, where a character is built under the defaults.
export type TableRules = {
  hpMethod: HpMethod;
  startingWealth: StartingWealthMethod;
  // Gold the server rolled for this class, at a table that rolls wealth;
  // null until it has.
  wealthRoll?: number | null;
  // False at a table that turns multiclassing off (backlog F9).
  multiclassAllowed?: boolean;
};

// The class's and background's tool grants with the player's picks placed on
// the open ones they fit. Nothing is picked for the player: `left` is what
// each open grant still waits for, and the class step holds until it is 0.
// A tool the hero already has from elsewhere (`held`: the ancestry's tools
// and its tool pick) fills no open grant, as the library's door counts it
// (src/lib/srd/legality/proficiencies.ts): a dwarf's brewer's supplies are
// not also a folk hero's artisan's tools.
export function resolveToolPicks(
  grants: string[],
  picks: string[],
  held: string[] = [],
): { fixed: string[]; choices: ToolChoice[]; chosen: string[]; left: number[] } {
  const { fixed, choices } = splitToolGrants(grants);
  const taken = new Set([...fixed, ...held].filter(Boolean).map((tool) => textKey(tool)));
  const left = choices.map((choice) => choice.count);
  const chosen: string[] = [];
  for (const pick of picks.map((tool) => textKey(tool))) {
    const slot = choices.findIndex((choice, index) => left[index] > 0 && choice.from.some((tool) => textKey(tool) === pick));
    const tool = slot >= 0 ? choices[slot].from.find((entry) => textKey(entry) === pick) : undefined;
    if (tool !== undefined && !chosen.includes(tool) && !taken.has(pick)) {
      left[slot] -= 1;
      chosen.push(tool);
    }
  }
  return { fixed, choices, chosen, left };
}

// A class taken after the first (backlog F9) with the row it was picked
// from: what the derivation reads for its levels, hit die, training,
// features and casting.
export type ExtraClassRow = ExtraClass & { klass: ClassOption };

// The classes after the first with their rows, in the order taken. A class
// whose row is not offered (a content pack's not yet arrived) is left out
// of the numbers until it is; the save still sends it (submit.ts).
export function extraClassRows(extras: ReadonlyArray<ExtraClass> | undefined, classes: ReadonlyArray<ClassOption>): ExtraClassRow[] {
  return (extras ?? []).flatMap((entry) => {
    const klass = classes.find((row) => row.id === entry.classId);
    return klass ? [{ ...entry, klass }] : [];
  });
}

const NO_EXTRAS: ExtraClassRow[] = [];
const NO_LISTS: SpellLists = { spells: [], bookPrepared: [], cantrips: [] };

// One casting class's spell desk (backlog F9, phase 2): what it casts at its
// own level, its counts, its lists and the picks it has made, under the same
// names the lead's carry on the derived object, so the spell step, its gate
// and the fill read any class's the way they read the lead's.
export type CasterDesk = {
  classId: string;
  klass: ClassOption;
  // The class whose lists are the builder's own spell fields.
  lead: boolean;
  casterKlass: ClassOption;
  casterSubclass: string;
  casterLevel: number;
  casts: boolean;
  spellSearchClass: string;
  maxSpellLevel: number;
  spellWider: { spells: string[]; lists: string[] };
  cantripAdvice: number | null;
  spellAdvice: ReturnType<typeof builderSpellAdvice>;
  starters: ReturnType<typeof starterSpellsFor> | null;
  subclassSpells: string[];
  castingLabel: string;
  spellStyle: SpellStyle | null;
  spellbookAdvice: number | null;
  racialCantrips: string[];
  featSpells: { cantrips: string[]; spells: string[] };
  chosenCantrips: string[];
  chosenSpells: string[];
  chosenPrepared: string[];
  spellSupply: ReturnType<typeof bundledSpellSupply> | null;
  ability: "int" | "wis" | "cha" | null;
  spellSaveDc: number | null;
  spellAttack: number | null;
  lists: SpellLists;
  // Magical Secrets, the Book of Shadows, Pact of the Chain's find familiar
  // (src/lib/srd/class-spell-grants.ts): the picks from any class's list the
  // spell step offers as their own group, and the extras on the counts.
  spellGrants: ClassSpellGrants;
};

// The free spells with the ones a feature teaches (a chain warlock's find
// familiar), which the creation check takes as granted too
// (src/lib/srd/spell-prep.ts grantedSpellsOf).
function withLearned(subclassSpells: string[], grants: ClassSpellGrants): string[] {
  const learned = grants.learned.filter((name) => !subclassSpells.some((held) => textKey(held) === textKey(name)));
  return learned.length ? [...subclassSpells, ...learned] : subclassSpells;
}

// A class's counts with what its features add on top (Additional Magical
// Secrets' two spells, the Book of Shadows' three cantrips), as the creation
// check counts them (src/lib/srd/spell-prep.ts spellListProblems).
function withExtras(
  advice: ReturnType<typeof builderSpellAdvice>,
  grants: ClassSpellGrants,
): ReturnType<typeof builderSpellAdvice> {
  return advice ? { ...advice, count: advice.count + grants.extraSpells } : null;
}

// A casting class's desk worked out from its row, its level and its lists;
// the lead's comes from the derivation itself.
function casterDeskOf(
  row: ClassOption,
  subclass: string,
  level: number,
  lists: SpellLists,
  abilities: AbilityScores | null,
  characterLevel: number,
  // The class's features and the option picks (a pact boon).
  features: Array<{ name: string }> = [],
): CasterDesk {
  const casting = builderCasting(row, subclass, level);
  const casts = casting.casts;
  const spellGrants = classSpellGrants({ classId: casts ? row.id : "", level, subclass, features });
  const subclassSpells = casts ? withLearned(subclassSpellsFor(row.id, subclass, level), spellGrants) : [];
  const spellWider = casts
    ? { spells: subclassExpandedSpellsFor(row.id, subclass, level), lists: subclassSpellListsFor(row.id, subclass) }
    : { spells: [], lists: [] };
  const spellStyle: SpellStyle | null = !casts
    ? null
    : casting.third
      ? "known"
      : row.knownCaster === true
        ? "known"
        : row.knownCaster === false && spellStyleFor(row.id) === "known"
          ? "prepared"
          : spellStyleFor(row.id);
  const free = new Set(subclassSpells.map(textKey));
  const chosenSpells = lists.spells.filter((name) => !free.has(textKey(name)));
  const book = new Set(lists.spells.map(textKey));
  const mod = abilities && casting.ability ? abilityMod(abilities[casting.ability]) : null;
  return {
    classId: row.id,
    klass: row,
    lead: false,
    casterKlass: row,
    casterSubclass: subclass,
    casterLevel: level,
    casts,
    spellSearchClass: casting.list,
    maxSpellLevel: casting.maxSpellLevel,
    spellWider,
    cantripAdvice: casting.cantripCap === null ? null : casting.cantripCap + spellGrants.extraCantrips,
    spellAdvice: withExtras(casts && abilities ? builderSpellAdvice(casting, row, subclass, level, abilities) : null, spellGrants),
    starters: casts ? starterSpellsFor(casting.profile ?? row.id) : null,
    subclassSpells,
    castingLabel: casts ? row.castingLabel || "spells" : "",
    spellStyle,
    spellbookAdvice: spellStyle === "spellbook" ? spellbookAllowance(level) : null,
    racialCantrips: [],
    featSpells: { cantrips: [], spells: [] },
    chosenCantrips: lists.cantrips,
    chosenSpells,
    chosenPrepared: spellStyle === "spellbook" ? lists.bookPrepared.filter((name) => book.has(textKey(name))) : chosenSpells,
    spellSupply:
      casts && !casting.third
        ? bundledSpellSupply({ spellClass: casting.list, maxSpellLevel: casting.maxSpellLevel, wider: spellWider, free: subclassSpells })
        : null,
    ability: casting.ability,
    spellSaveDc: mod === null ? null : 8 + proficiencyBonus(characterLevel) + mod,
    spellAttack: mod === null ? null : proficiencyBonus(characterLevel) + mod,
    lists,
    spellGrants,
  };
}

export function useBuilderDerived({
  state,
  race,
  klass,
  background,
  extras = NO_EXTRAS,
  fixedLevel,
  rules,
  featDescs,
  genre,
}: {
  state: BuilderState;
  race: RaceOption | undefined;
  klass: ClassOption | undefined;
  background: BackgroundOption | undefined;
  // The classes taken after the first (extraClassRows). Absent for a single
  // class, and for the doors that build one (the library's Level up, the AI
  // DM's drafted pregens).
  extras?: ExtraClassRow[];
  fixedLevel?: number;
  rules?: TableRules;
  // The table's genre, when the character is made for one: its setting's
  // armor is suggested to any class trained for it, as the class's own
  // genre's is (issue #434: a fighter at a cyberpunk table saw no vest).
  genre?: Genre;
  // The text of content-pack feats the builder has fetched, by lower-case
  // name (useFeatDescs); ODM's own feats are bundled. What a feat grants is
  // read from its text (src/lib/srd/feat-grants.ts).
  featDescs?: Record<string, string>;
}) {
  const {
    level, scores, racialAsi, asiChoices, chosenSkills, expertisePicks, bonusLanguages,
    racialSkills, racialTool, backgroundSkills, backgroundGearPicks, hpOverride, acOverride, equipment, removedAutoNames,
    toolPicks, repeatSkills,
    subclass, optionPicks, spells, cantrips, bookPrepared, keepsStoredGear, asiRecorded, asiReachedLevel,
  } = state;

  const effectiveLevel = fixedLevel ?? level;
  // The class list (backlog F9): the first class at the levels the others
  // leave it, then each class taken after it. One class is a list of one.
  const primaryLevel = primaryLevelOf(effectiveLevel, extras);
  const classList = useMemo<ClassEntry[]>(
    () =>
      klass
        ? [
            { id: klass.id, subclass: subclass ?? "", level: primaryLevel },
            ...extras.map((entry) => ({ id: entry.klass.id, subclass: entry.subclass, level: entry.level })),
          ]
        : [],
    [klass, subclass, primaryLevel, extras],
  );
  const multiclass = classList.length > 1;
  // What each class taken second adds: the multiclass rows, never a save.
  const grants = useMemo<MulticlassGrant[]>(() => extras.map((entry) => multiclassGrantsFor(entry.klass.id)), [extras]);
  // Improvements are each class's own: a fighter's seven, a rogue's six,
  // counted at that class's levels, the first class's levels first.
  const classId = klass?.id;
  const asiSlotLevels = useMemo(
    () => (classList.length ? builderAsiSlotLevels(classList) : asiLevelsFor(classId).filter((threshold) => effectiveLevel >= threshold)),
    [classList, effectiveLevel, classId],
  );
  const activeAsiChoices = useMemo(
    () => asiSlotLevels.map((_, index) => asiChoices[index] ?? null),
    [asiSlotLevels, asiChoices],
  );
  // Slots an edited character took in play: resolved, and worth nothing
  // here, since the stored scores already include them.
  const asiTakenInPlay = useMemo(
    () => asiSlotsTakenInPlay(asiSlotLevels, asiRecorded, asiReachedLevel),
    [asiSlotLevels, asiRecorded, asiReachedLevel],
  );

  // The race's bumps by ability: the fixed ones and those of the player's
  // choice (half-elf).
  const racialBonus = useMemo(() => {
    const bonus: Partial<Record<Ability, number>> = { ...(race?.asi ?? {}) };
    if (race?.asiChoice) {
      for (const ability of racialAsi) {
        if (ability) {
          bonus[ability] = (bonus[ability] ?? 0) + race.asiChoice.amount;
        }
      }
    }
    return bonus;
  }, [race, racialAsi]);

  // Base scores after racial bonuses, before level ASIs.
  const baseAbilities = useMemo<AbilityScores | null>(() => {
    if (!race || Object.values(scores).some((value) => value === null)) {
      return null;
    }
    const final = { ...(scores as Record<Ability, number>) };
    for (const [ability, bonus] of Object.entries(racialBonus)) {
      final[ability as Ability] += bonus ?? 0;
    }
    return final as AbilityScores;
  }, [scores, race, racialBonus]);

  // The scores with the improvements in, before the half-feats' points and
  // Primal Champion's.
  const improved = useMemo<AbilityScores | null>(
    () => (baseAbilities ? applyAsiChoices(baseAbilities, activeAsiChoices) : null),
    [baseAbilities, activeAsiChoices],
  );
  // Primal Champion's +4 Strength and Constitution, at barbarian 20. The
  // server adds it after the half-feats (src/lib/srd/sheet-legality.ts).
  const primalChampion = useMemo(
    () => (klass ? reachesPrimalChampion({ class: klass.id, level: effectiveLevel, ...(multiclass ? { classes: classList } : {}) }) : false),
    [klass, effectiveLevel, multiclass, classList],
  );
  // The scores the builder SENDS: the improvements in, the half-feats' points
  // not (the server adds those, src/lib/srd/legality/half-feats.ts). An edit
  // of a barbarian whose stored scores carried Primal Champion's +4 sends
  // them with it, as they were stored (useBuilderState took it off to count
  // the improvements beneath it); a new one leaves it to the server.
  const { primalChampionHeld } = state;
  const abilities = useMemo<AbilityScores | null>(
    () => (improved && primalChampion && primalChampionHeld ? withPrimalChampion(improved) : improved),
    [improved, primalChampion, primalChampionHeld],
  );
  // The text of a feat on the sheet, where known: ODM's own, or a content
  // pack's as fetched (useFeatDescs). What its grants and its ability
  // point are read from.
  const featDescOf = useMemo(
    () => (name: string) => featDescs?.[textKey(name)] ?? authoredFeatDesc(name) ?? "",
    [featDescs],
  );
  // The scores the server will STORE, with those points in, and the saving
  // throw Resilient adds: what every number on screen is worked out from.
  const raceId = race?.id;
  const { feats: racialFeatNames, racialFeatAbility } = state;
  // The half-feats in the server's order: the improvements' first, then the
  // race's own feat (a variant human's).
  const halfFeatList = useMemo(() => {
    const asiChoicesMade = activeAsiChoices.filter((choice): choice is AsiChoice => choice !== null);
    const all = halfFeatPicks(
      {
        asiChoices: asiChoicesMade,
        feats: racialFeatNames,
        racialChoices: { featAbility: racialFeatAbility },
      },
      raceId ? racialFeatCount(raceId) : 0,
      featDescOf,
    );
    const fromImprovements = halfFeatPicks({ asiChoices: asiChoicesMade }, 0, featDescOf).length;
    return { all, racial: all.slice(fromImprovements) };
  }, [activeAsiChoices, racialFeatNames, racialFeatAbility, raceId, featDescOf]);
  const halfFeats = useMemo(() => {
    if (!improved) {
      return null;
    }
    const out = scoresWithHalfFeats(improved, halfFeatList.all);
    return primalChampion ? { ...out, abilities: withPrimalChampion(out.abilities) } : out;
  }, [improved, halfFeatList, primalChampion]);
  const shownAbilities = halfFeats?.abilities ?? null;
  // What the improvement cards build on: the base scores with the race's
  // feat point in, since it is taken at 1st level.
  const asiBaseAbilities = useMemo(
    () => (baseAbilities ? scoresWithHalfFeats(baseAbilities, halfFeatList.racial).abilities : null),
    [baseAbilities, halfFeatList],
  );
  // Each score's gains past its racial bonus, for the Abilities step's rows
  // and summary (issue #149). Its finals are shownAbilities once all six
  // are assigned.
  const gains = useMemo(
    () =>
      abilityGains({
        start: Object.fromEntries(
          (Object.keys(scores) as Ability[]).map((ability) => {
            const assigned = scores[ability];
            return [ability, assigned === null ? null : assigned + (racialBonus[ability] ?? 0)];
          }),
        ) as Record<Ability, number | null>,
        slotLevels: asiSlotLevels,
        choices: activeAsiChoices,
        halfFeats: settledHalfFeats(halfFeatList.all),
        primalChampion,
      }),
    [scores, racialBonus, asiSlotLevels, activeAsiChoices, halfFeatList, primalChampion],
  );

  // Every feat on the sheet, racial and ASI, with its text where known.
  const featNames = useMemo(
    () => [
      ...activeAsiChoices.flatMap((choice) => (choice?.mode === "feat" ? [choice.feat] : [])),
      ...racialFeatNames,
    ],
    [activeAsiChoices, racialFeatNames],
  );
  const featSpecOf = useMemo(() => (name: string): FeatGrantSpec => featGrantSpec(featDescOf(name)), [featDescOf]);
  const { featChoices } = state;

  // Skills come from five places, not two: the class picks, the
  // background's fixed grants and its picks, the race's fixed grants (high
  // elf Perception, half-orc Intimidation) and the race's choice grants
  // (half-elf). Known before any
  // ability score is, which the expertise picks on the class step rely on:
  // a rogue or bard chooses them a step ahead of the scores.
  const proficientSkills = useMemo(
    () => [
      ...new Set([
        ...chosenSkills,
        ...(background?.skills ?? []),
        ...backgroundSkills.filter(Boolean),
        ...(race?.skills ?? []),
        ...racialSkills.filter(Boolean),
        ...repeatSkills.filter(Boolean),
        // The skill a class taken second let the player pick.
        ...extras.flatMap((entry) => entry.skills.filter(Boolean)),
      ]),
    ],
    [chosenSkills, background, backgroundSkills, race, racialSkills, repeatSkills, extras],
  );

  // The class's, the background's, then each class taken second's: a
  // rogue's thieves' tools, a bard's one musical instrument to name.
  const toolGrants = useMemo(
    () =>
      resolveToolPicks(
        [...(klass?.tools ?? []), ...(background?.tools ?? []), ...grants.flatMap((grant) => grant.tools)],
        toolPicks,
        [...(race?.tools ?? []), racialTool],
      ),
    [klass, background, grants, toolPicks, race, racialTool],
  );
  // Whose open grant each of those choices is, in words for its panel.
  const toolSources = useMemo(
    () => [
      ...splitToolGrants(klass?.tools ?? []).choices.map(() => (klass ? `your ${klass.name} class` : "")),
      ...splitToolGrants(background?.tools ?? []).choices.map(() => (background ? `your ${background.name} background` : "")),
      ...extras.flatMap((entry, index) => splitToolGrants(grants[index]?.tools ?? []).choices.map(() => `your ${entry.klass.name} levels`)),
    ],
    [klass, background, extras, grants],
  );
  // Every tool the character is trained with, the list the sheet carries;
  // the background's kit fills its "of your choice" lines from it.
  const trainedTools = useMemo(
    () => [
      ...new Set(
        [...toolGrants.fixed, ...(race?.tools ?? []), racialTool, ...toolGrants.chosen].filter(Boolean),
      ),
    ],
    [toolGrants, race, racialTool],
  );
  // The background's kit with its choice lines answered (issue #127): a
  // tool line from the training above, an either-or line from the pick
  // made on the gear step, the book's first until then.
  const backgroundKit = useMemo(
    () =>
      expandBackgroundGear(background?.equipment, {
        tools: trainedTools,
        backgroundTools: background?.tools ?? [],
        picks: backgroundGearPicks,
      }),
    [background, trainedTools, backgroundGearPicks],
  );

  // The training as it stands, known before any ability score is (the feat
  // pickers on the ancestry step read it): the class's, the race's and the
  // background's grants, every skill and language picked, and what the
  // feats grant beyond their point (issue #125), the picks as made so far
  // and the fixed grants always, the way the server applies them.
  // What the chosen subclass trains the character in by this level (issue
  // 251), each grant shaped as a feat's so the class step asks for its picks
  // with the feat pickers (src/lib/srd/subclass-training.ts).
  // A skill or language the character already has becomes a pick (Royal
  // Envoy's Persuasion, Draconic Disciple's Draconic).
  // A class's own secret tongue (Druidic, Thieves' Cant), each class's.
  const classLanguages = useMemo(
    () => [...(klass?.languages ?? []), ...extras.flatMap((entry) => entry.klass.languages ?? [])],
    [klass, extras],
  );
  const subclassTraining = useMemo(
    () =>
      klass && classList.some((entry) => entry.subclass)
        ? grantsForHeldTraining(subclassGrants(classList), {
            skills: proficientSkills,
            languages: [...(race?.languages ?? []), ...(background?.knownLanguages ?? []), ...bonusLanguages.filter(Boolean), ...classLanguages],
          })
        : [],
    [klass, classList, proficientSkills, race, background, bonusLanguages, classLanguages],
  );
  const training = useMemo(() => {
    const skills = proficientSkills;
    const proficiencies = {
      // The first class's saves only: a class taken second gives none.
      saves: klass?.saves ?? [],
      skills,
      // Expertise picks only count while still proficient in the skill.
      expertise: expertisePicks.filter((skillId) => expertiseAllowed(skillId, skills, classList.map((entry) => entry.id))),
      // A class teaches its own secret tongue: Druidic to a druid, Thieves'
      // Cant to a rogue. Without this a druid could never speak Druidic even
      // though the feature says they do.
      languages: [
        ...new Set([
          ...(race?.languages ?? []),
          ...(background?.knownLanguages ?? []),
          ...bonusLanguages.filter(Boolean),
          ...classLanguages,
        ]),
      ],
      tools: trainedTools,
      // Races can teach combat training too: mountain dwarf armor, drow
      // and wood elf weapons. A class taken second adds its multiclass row.
      armor: [...new Set([...(klass?.armor ?? []), ...(race?.armor ?? []), ...grants.flatMap((grant) => grant.armor)])],
      weapons: [...new Set([...(klass?.weapons ?? []), ...(race?.weapons ?? []), ...grants.flatMap((grant) => grant.weapons)])],
    };
    const withFeats = applyFeatGrants({
      proficiencies,
      feats: featNames.map((name) => ({ name, desc: featDescOf(name) })),
      choices: featChoices,
      strict: false,
    }).proficiencies;
    // And the subclass's training (issue 251): a Life Domain's heavy armor,
    // a Lore bard's three skills as picked on the class step.
    return applySubclassTraining({ proficiencies: withFeats, grants: subclassTraining, choices: featChoices, strict: false }).proficiencies;
  }, [proficientSkills, klass, classList, grants, classLanguages, race, background, expertisePicks, bonusLanguages, trainedTools, featNames, featDescOf, featChoices, subclassTraining]);

  // Hit points as the server will work them out (builderHp.ts): lineage,
  // feats, Draconic Resilience and the table's method. A table that rolls
  // them rolls on the server when the character is saved, so the figure is
  // the fixed value and `range` what the dice may give. A stored character
  // keeps the hit points it came home with (hpOverride) only while the
  // server would.
  const storedHp = state.storedHp;
  const hp = useMemo(() => {
    if (!shownAbilities || !klass) {
      return null;
    }
    return builderHitPoints({
      hitDie: klass.hitDie,
      classId: klass.id,
      subclass: subclass ?? "",
      level: effectiveLevel,
      // Each class's die for its own levels, the first class's 1st level at
      // its maximum.
      ...(multiclass
        ? { split: classList.map((entry, index) => ({ ...entry, hitDie: index === 0 ? klass.hitDie : extras[index - 1].klass.hitDie })) }
        : {}),
      con: shownAbilities.con,
      raceId: race?.id ?? null,
      feats: [
        ...state.feats,
        ...activeAsiChoices.flatMap((choice) => (choice?.mode === "feat" ? [choice.feat] : [])),
      ],
      method: rules?.hpMethod ?? null,
      stored: hpOverride !== null && storedHp ? { maxHp: hpOverride, ...storedHp } : null,
    });
  }, [shownAbilities, klass, subclass, effectiveLevel, multiclass, classList, extras, race, state.feats, activeAsiChoices, rules?.hpMethod, hpOverride, storedHp]);

  // The class that leads the spell lists, at its own level: the first class
  // for a single class, else the first in the list with something to cast
  // (castingIndexOf). The derived spell values below are its; each other
  // casting class has its own desk (casterDesks).
  const caster = useMemo(() => {
    if (!klass) {
      return null;
    }
    const entries = [
      { row: klass, subclass: subclass ?? "", level: primaryLevel },
      ...extras.map((entry) => ({ row: entry.klass, subclass: entry.subclass, level: entry.level })),
    ];
    const index = entries.length > 1 ? castingIndexOf(entries) : 0;
    return index >= 0 ? { klass: entries[index].row, subclass: entries[index].subclass, level: entries[index].level, index } : null;
  }, [klass, subclass, primaryLevel, extras]);
  const casterKlass = caster?.klass;
  const casterSubclass = caster?.subclass ?? subclass ?? "";
  const casterLevel = caster?.level ?? effectiveLevel;

  // The slots the save stores (casting.ts), so the preview and the build
  // math table show them rather than an empty book. A class list shares its
  // table as the server works it, with a warlock's pact slots apart.
  const listSlots = useMemo(
    () => (multiclass ? builderClassListSlots(classList, (id) => (id === klass?.id ? klass : extras.find((entry) => entry.klass.id === id)?.klass)) : null),
    [multiclass, classList, klass, extras],
  );
  const spellSlots = useMemo(
    () => listSlots?.slots ?? builderSpellSlots(klass, subclass, effectiveLevel),
    [listSlots, klass, subclass, effectiveLevel],
  );
  const pactSlots = listSlots?.pact ?? null;

  // What this class and subclass actually hand the character at this level.
  // Showing them turns a blind dropdown choice into an informed one. With a
  // class list, each class's at its own level, marked with the class that
  // grants it (the attack riders and option slots read it).
  const featuresByClass = useMemo(
    () =>
      classList.map((entry, index) => ({
        classId: entry.id,
        name: index === 0 ? (klass?.name ?? entry.id) : extras[index - 1].klass.name,
        level: entry.level,
        subclass: entry.subclass ?? "",
        features: classFeaturesFor(entry.id, entry.subclass ?? "", entry.level),
      })),
    [classList, klass, extras],
  );
  const grantedFeatures = useMemo(
    () =>
      multiclass
        ? featuresByClass.flatMap((entry) => entry.features.map((feature) => ({ ...feature, classId: entry.classId })))
        : featuresByClass[0]?.features ?? [],
    [multiclass, featuresByClass],
  );

  const preview = useMemo(() => {
    if (!shownAbilities || !race || !klass || !background || !hp) {
      return null;
    }
    const trained = training;
    // A third caster's Intelligence counts as a spellcasting ability too.
    const castingAbility = builderCasting(casterKlass, casterSubclass, casterLevel).ability;
    // Resilient's save counts in what is shown; the server writes it itself,
    // so the proficiencies sent stay the class's.
    const saves = [...new Set([...klass.saves, ...(halfFeats?.saves ?? [])])];
    // The class's features and the feats count too (Remarkable Athlete and
    // Alert move the initiative), as they do on the stored sheet.
    const derived = computeSheetDerived({
      abilities: shownAbilities,
      level: effectiveLevel,
      class: klass.id,
      features: grantedFeatures,
      feats: [
        ...state.feats,
        ...activeAsiChoices.flatMap((choice) => (choice?.mode === "feat" ? [choice.feat] : [])),
      ],
      proficiencies: { ...trained, saves },
      spellcasting: castingAbility
        ? { ability: castingAbility, slots: spellSlots, prepared: [], known: [], cantrips: [] }
        : null,
    });
    // Hit points are the server's to derive; `hp` is the same arithmetic,
    // shown, and the explainer reads it too.
    return { proficiencies: trained, derived, maxHp: hp.maxHp, hpMethod: hp.method, hpRange: hp.range, hpKept: hp.kept };
  }, [shownAbilities, halfFeats, race, klass, casterKlass, casterSubclass, casterLevel, grantedFeatures, background, training, effectiveLevel, hp, state.feats, activeAsiChoices, spellSlots]);

  // The class's starting equipment rides along automatically (removable
  // chips): the book's list with the either-or choices the player made on
  // the gear step (src/lib/srd/starting-kit.ts), the same kit the server
  // hands out free. A barbarian starts with a greataxe and no armor, and
  // its armor class is its Unarmored Defense.
  const kitChoicesState = state.kitChoices;
  // The training a kit's "(if proficient)" options ask about.
  // The kit is the first class's (the server's rule), its "(if proficient)"
  // options read against all the training, as the server reads them.
  const kitTraining = useMemo<KitTraining>(
    () => ({
      armor: [
        ...(klass?.armor ?? []),
        ...(race?.armor ?? []),
        ...grants.flatMap((grant) => grant.armor),
        ...subclassTraining.flatMap((grant) => grant.spec.armor),
      ],
      weapons: [
        ...(klass?.weapons ?? []),
        ...(race?.weapons ?? []),
        ...grants.flatMap((grant) => grant.weapons),
        ...subclassTraining.flatMap((grant) => grant.spec.fixedWeapons),
      ],
      subclass,
    }),
    [klass, race, grants, subclass, subclassTraining],
  );
  const startingKit = useMemo(
    () =>
      klass
        ? startingKitFor(
            { id: klass.id, armor: kitTraining.armor, weapons: kitTraining.weapons },
            kitChoicesState ?? null,
            subclass,
            klass.name,
          )
        : null,
    [klass, kitTraining, kitChoicesState, subclass],
  );
  const autoLoadout = useMemo(() => startingKit?.items ?? [], [startingKit]);
  const classKit = useMemo(() => (klass && !keepsStoredGear ? classKitFor(klass.id) : null), [klass, keepsStoredGear]);
  // What the sheet stores: the choices as the server reads them, or a
  // stored character's own while it keeps its gear.
  const kitChoices =
    keepsStoredGear
      ? kitChoicesState?.options.length || kitChoicesState?.picks.length
        ? kitChoicesState
        : undefined
      : startingKit?.tabled
        ? startingKit.choices
        : undefined;
  const equipmentSuggestions = useMemo(() => {
    if (!klass) {
      return [];
    }
    const weapons = [...new Set([...klass.weapons, ...grants.flatMap((grant) => grant.weapons)])];
    const armorTraining = [...new Set([...klass.armor, ...grants.flatMap((grant) => grant.armor)])];
    return [
      ...suggestWeapons(weapons).map((weapon) => ({ name: weapon.name, note: weapon.damage })),
      ...suggestArmor(armorTraining, [...(klass.genres ?? []), ...(genre ? [genre] : [])]).map((armor) => ({
        name: armor.name,
        note: armor.category === "shield" ? `+${armor.baseAc} AC` : `AC ${armor.baseAc}`,
      })),
    ];
  }, [klass, grants, genre]);
  const fullEquipment = useMemo(() => {
    if (keepsStoredGear) {
      return equipment;
    }
    const auto = autoLoadout
      .filter((item) => !removedAutoNames.includes(item.name))
      .map((item) => ({ name: item.name, qty: item.qty }));
    // Backgrounds hand over a starting kit too, not just skills.
    const backgroundGear = backgroundKit.names
      .filter((itemName) => !removedAutoNames.includes(itemName))
      .map((itemName) => ({ name: itemName, qty: 1 }));
    // One row per name: a dagger bought beside the rogue's two is a third.
    const rows: BuilderItem[] = [];
    for (const item of [...auto, ...backgroundGear, ...equipment]) {
      const held = rows.findIndex((row) => row.name === item.name);
      if (held >= 0) {
        rows[held] = { ...rows[held], ...item, qty: rows[held].qty + item.qty };
      } else {
        rows.push({ ...item });
      }
    }
    return rows;
  }, [equipment, autoLoadout, removedAutoNames, backgroundKit, keepsStoredGear]);

  // What the pack costs. Under "equipment" the class's gear and the
  // background's kit are free and the background's coin is the purse; under
  // "rolled" the server's roll is the purse and everything is bought. A
  // stored character's pack was earned, so an edit charges only what it adds.
  const wealthMethod = rules?.startingWealth ?? "equipment";
  const purse = useMemo(() => {
    // The pack's price rode in on the pick (EquipmentSection); it is layered
    // under the bundled table exactly as the server layers its catalog, so
    // the purse here and the purse the server works agree (issue #136).
    const priceOf = (itemName: string) => {
      const picked = equipment.find((item) => item.name === itemName);
      return layeredPrice(
        itemName,
        picked?.magic
          ? { copper: null, magic: true }
          : picked?.priceCp !== undefined
            ? { copper: picked.priceCp, magic: false }
            : undefined,
      );
    };
    const freeKit = keepsStoredGear
      ? equipment.flatMap((item) => Array.from({ length: item.qty }, () => item.name))
      : wealthMethod === "rolled"
        ? []
        : [...kitNames(autoLoadout), ...backgroundKit.names];
    const coinCopper = keepsStoredGear
      ? state.gold * 100
      : Math.round(
          (wealthMethod === "rolled" ? (rules?.wealthRoll ?? 0) : (background?.purse ?? 0)) * 100,
        );
    const verdict = judgeStartingGear({ equipment: fullEquipment, freeKit, coinCopper, priceOf });
    const left = Math.max(0, coinCopper - verdict.spentCopper);
    // How many of each name the kits put in the pack, as fullEquipment
    // merged them: those copies leave together, through the removed names.
    const preAdded = new Map<string, number>();
    if (!keepsStoredGear) {
      const kitted = [
        ...autoLoadout.filter((item) => !removedAutoNames.includes(item.name)),
        ...backgroundKit.names.filter((itemName) => !removedAutoNames.includes(itemName)).map((itemName) => ({ name: itemName, qty: 1 })),
      ];
      for (const item of kitted) {
        const name = gearNameKey(item.name);
        preAdded.set(name, (preAdded.get(name) ?? 0) + item.qty);
      }
    }
    const receipt = buildReceipt({ equipment: fullEquipment, preAdded, freeKit, coinCopper, priceOf });
    return {
      receipt,
      method: wealthMethod,
      coinCopper,
      spentCopper: verdict.spentCopper,
      // The kit's choices matter where the kit is free; under rolled wealth
      // they only say what is pre-added to buy.
      problems: [
        ...(keepsStoredGear || wealthMethod === "rolled" ? [] : [...(startingKit?.problems ?? []), ...backgroundKit.problems]),
        ...verdict.problems,
      ],
      gold: Math.floor(left / 100),
      copper: left % 100,
    };
  }, [equipment, fullEquipment, autoLoadout, removedAutoNames, startingKit, backgroundKit, background, keepsStoredGear, wealthMethod, rules?.wealthRoll, state.gold]);

  // AC is derived from the gear above, never typed: equipping a breastplate
  // moves the number here and on the sheet. Pinning an armor class is a
  // correction, and corrections are the DM's or the party lead's to make.
  const acInfo = useMemo(() => {
    if (!klass || !preview || !shownAbilities) {
      return null;
    }
    return acBreakdownFor({
      class: klass.id,
      level: effectiveLevel,
      ...(multiclass ? { classes: classList } : {}),
      abilities: shownAbilities,
      proficiencies: preview.proficiencies,
      equipment: fullEquipment,
      features: grantedFeatures,
    });
  }, [klass, preview, shownAbilities, fullEquipment, grantedFeatures, multiclass, classList, effectiveLevel]);
  const ac = acInfo?.ac ?? acOverride ?? 10;

  // The receipt the gear step shows (src/app/characters/builder/
  // receiptMath.ts), with a to-hit and damage line on each weapon worked
  // as the sheet's attack cards work it: the class's features and fighting
  // styles for riders, Martial Arts only with no armor and no shield.
  const { setEquipment, setRemovedAutoNames, stylePicks } = state;
  const gearReceipt = useMemo(() => {
    const riders = klass
      ? combatRiders({
          class: klass.id,
          level: effectiveLevel,
          ...(multiclass ? { classes: classList } : {}),
          features: [
            ...grantedFeatures,
            ...stylePicks.map((id) => ({ name: fightingStyleFeatureName(id) })),
          ],
        })
      : null;
    const martialArts = !acInfo?.armorName && !acInfo?.shieldName;
    const rows = purse.receipt.rows.map((row) => {
      const item = fullEquipment.find((entry) => entry.name === row.name);
      return preview && riders && item
        ? { ...row, weapon: weaponLineFor(item, preview.derived, preview.proficiencies.weapons ?? [], riders, martialArts) }
        : row;
    });
    // A typed or stepped quantity: copies over the kit's are the player's
    // own added entry; none at all removes the kit's copies too.
    const setQty = (itemName: string, wanted: number) => {
      const row = rows.find((entry) => entry.name === itemName);
      if (!row) {
        return;
      }
      const qty = settleQty(row, wanted);
      setEquipment((current) => withAddedQty(current, itemName, Math.max(0, qty - row.preAdded), row.slug));
      if (qty === 0 && row.preAdded > 0) {
        setRemovedAutoNames((removed) => (removed.includes(itemName) ? removed : [...removed, itemName]));
      }
    };
    return { ...purse.receipt, rows, setQty };
  }, [purse.receipt, fullEquipment, preview, klass, grantedFeatures, multiclass, classList, effectiveLevel, stylePicks, acInfo, setEquipment, setRemovedAutoNames]);
  // The purse the steps read carries the finished receipt, so the gear step
  // shows it through the purse view it already builds.
  const shownPurse = useMemo(() => ({ ...purse, receipt: gearReceipt }), [purse, gearReceipt]);

  // Fighting styles the class has earned by this level. Stored on the sheet
  // as "choice"-sourced features so the level-up regrant preserves them.
  const styleSlots = useMemo(() => fightingStyleSlots(grantedFeatures), [grantedFeatures]);
  // The styles those slots allow (a Swords bard: Dueling or Two-Weapon Fighting).
  const styleChoices = useMemo(() => fightingStyleChoices(grantedFeatures), [grantedFeatures]);

  // Invocations, maneuvers, metamagic, pact boons, infusions, runes and
  // elemental disciplines: the pick-lists that used to be feature names with
  // no way to choose them. Stored like fighting styles, as prefixed
  // "choice" features that survive level-ups.
  // With a class list each class opens its own (a warlock taken second
  // its invocations), and slots of one kind add up.
  const optionSlots = useMemo(() => {
    const features = [...grantedFeatures, ...optionPicks.map((optionName) => ({ name: optionName }))];
    const slots = classList.flatMap((entry, index) =>
      openOptionSlots({
        classId: entry.id,
        subclass: entry.subclass ?? "",
        level: entry.level,
        // The class's own features too: a workshop subclass that
        // borrowed Combat Superiority opens maneuvers by it.
        features,
        // A feat's own picks are counted once, with the first class.
        feats: index === 0 ? featNames : [],
      }),
    );
    return slots.reduce<typeof slots>((merged, slot) => {
      const held = merged.find((entry) => entry.kind === slot.kind);
      if (!held) {
        return [...merged, slot];
      }
      const total = held.total + slot.total;
      return merged.map((entry) => (entry === held ? { ...held, total, remaining: Math.max(0, total - held.chosen.length) } : entry));
    }, []);
  }, [classList, grantedFeatures, optionPicks, featNames]);
  // Expertise each class has earned at its own level: a rogue's two at its
  // 1st, a bard's at its 3rd.
  const expertiseSlots = useMemo(
    () => classList.reduce((sum, entry) => sum + expertiseSlotsFor(entry.id, entry.level), 0),
    [classList],
  );

  // Spell lists and advice go through the borrowed SRD list for catalog
  // casters (a Netrunner searches wizard spells).
  // An Eldritch Knight or Arcane Trickster searches the wizard's list
  // (src/app/characters/builder/casting.ts).
  const casting = useMemo(() => builderCasting(casterKlass, casterSubclass, casterLevel), [casterKlass, casterSubclass, casterLevel]);
  const spellSearchClass = casting.list;
  const maxSpellLevel = casting.maxSpellLevel;
  // What the subclass adds to that list: a warlock patron's expanded spells,
  // a Divine Soul's cleric list (src/lib/srd/spell-prep.ts widerListOf).
  const spellWider = useMemo(
    () =>
      casterKlass && casting.casts
        ? { spells: subclassExpandedSpellsFor(casterKlass.id, casterSubclass, casterLevel), lists: subclassSpellListsFor(casterKlass.id, casterSubclass) }
        : { spells: [], lists: [] },
    [casterKlass, casterSubclass, casterLevel, casting.casts],
  );
  // A class that casts, and has something to cast at this level. A level 1
  // paladin or ranger has a spellcasting ability and no spells, no cantrips
  // and no slots: showing them a spell step with a level 0 search and an
  // "unable to cast" warning was a dead end with nothing to pick.
  const casts = casting.casts;
  // Magical Secrets, the Book of Shadows, Pact of the Chain's find familiar
  // (src/lib/srd/class-spell-grants.ts), read from the class's features and
  // the option picks (a pact boon) as the creation check reads them: the
  // extras sit on the counts, the spell taught is free, and the picks from
  // any class's list are the spell step's own group (any-list-picks-logic.ts).
  const spellGrants = useMemo(
    () =>
      classSpellGrants({
        classId: casts && casterKlass ? casterKlass.id : "",
        level: casterLevel,
        subclass: casterSubclass,
        features: [...grantedFeatures, ...optionPicks.map((optionName) => ({ name: optionName }))],
      }),
    [casts, casterKlass, casterLevel, casterSubclass, grantedFeatures, optionPicks],
  );
  const cantripAdvice = casting.cantripCap === null ? null : casting.cantripCap + spellGrants.extraCantrips;
  const spellAdvice = withExtras(
    casts && casterKlass && shownAbilities
      ? builderSpellAdvice(casting, casterKlass, casterSubclass, casterLevel, shownAbilities)
      : null,
    spellGrants,
  );
  // Opening suggestions, so a player who has never seen a 5e spell list is
  // not left staring at an empty search box. A third caster gets picks from
  // its own two schools, not the wizard's, which its school rule would refuse.
  const starters = useMemo(
    () =>
      casts && casterKlass
        ? starterSpellsFor(casting.profile ?? casterKlass.id)
        : null,
    [casterKlass, casts, casting],
  );
  // Domain, circle, oath and patron spells: always prepared, free, and worth
  // showing at the top of the list so a cleric knows what their domain gives.
  const subclassSpells = useMemo(
    () =>
      casts && casterKlass ? withLearned(subclassSpellsFor(casterKlass.id, casterSubclass, casterLevel), spellGrants) : [],
    [casterKlass, casterSubclass, casterLevel, casts, spellGrants],
  );
  // What this class calls its spells, used in the empty-spell-list warning.
  const castingLabel = casts && casterKlass ? (casterKlass.castingLabel || "spells") : "";
  // How this class holds its spells: known, prepared from the class list, or
  // (a wizard) written in a spellbook and prepared from it. A content-pack
  // class says whether it is a known caster; the rest follow the SRD.
  const spellStyle: SpellStyle | null = !casts || !casterKlass
    ? null
    : casting.third
      ? "known"
      : casterKlass.knownCaster === true
      ? "known"
      : casterKlass.knownCaster === false && spellStyleFor(casterKlass.id) === "known"
        ? "prepared"
        : spellStyleFor(casterKlass.id);
  // A wizard's book: six spells at 1st level, two more every wizard level.
  const spellbookAdvice = spellStyle === "spellbook" ? spellbookAllowance(casterLevel) : null;
  // Cantrips are their own list. Levelled spells count against the class's
  // allowance except the subclass's always-prepared ones, which are free. For
  // a wizard `chosenSpells` is the book and `chosenPrepared` what is
  // prepared from it; for everyone else the two are the same list.
  // Cantrips the race gives (a tiefling's Thaumaturgy, a forest gnome's
  // Minor Illusion, the high elf's pick on the ancestry step) are known on
  // top of the class's, so the spell step shows them granted and the class
  // count leaves them out, as the sheet and a level-up already did (issue
  // #118: a tiefling cleric filled with Thaumaturgy left play two cantrips
  // down).
  const racialCantripPicks = state.racialCantrips;
  const racialCantrips = useMemo(() => {
    const own = race ? innateCantripsFor(race.id, effectiveLevel) : [];
    const seen = new Set<string>();
    return [...racialCantripPicks, ...own].filter((name) => {
      const key = textKey(name);
      if (!key || seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }, [race, effectiveLevel, racialCantripPicks]);
  // The spells the feats teach (src/lib/srd/feat-spells.ts) are known the
  // same way: shown granted, left out of the class's counts.
  const featSpells = useMemo(
    () =>
      featSpellNames(
        featSpellGrants({
          feats: featNames.map((name) => ({ name, desc: featDescOf(name) })),
          choices: featChoices,
          raisedAbility: () => null,
          strict: false,
        }).grants,
      ),
    [featNames, featDescOf, featChoices],
  );
  const chosenCantrips = useMemo(() => {
    const free = new Set([...racialCantrips, ...featSpells.cantrips].map((name) => textKey(name)));
    return cantrips.filter((name) => !free.has(textKey(name)));
  }, [cantrips, racialCantrips, featSpells]);
  const chosenSpells = useMemo(() => {
    const free = new Set(subclassSpells.map((spellName) => textKey(spellName)));
    return spells.filter((spellName) => !free.has(textKey(spellName)));
  }, [spells, subclassSpells]);
  const chosenPrepared = useMemo(() => {
    if (spellStyle !== "spellbook") {
      return chosenSpells;
    }
    const book = new Set(spells.map((spellName) => textKey(spellName)));
    return bookPrepared.filter((spellName) => book.has(textKey(spellName)));
  }, [spellStyle, chosenSpells, spells, bookPrepared]);
  // How many spells the bundled list can give this caster (spellSupply.ts):
  // the spell step's gate asks for no more than exist. A third caster is
  // held to its schools instead, and its list is the wizard's.
  const spellSupply = useMemo(
    () =>
      casts && !casting.third
        ? bundledSpellSupply({
            spellClass: spellSearchClass,
            maxSpellLevel,
            wider: spellWider,
            free: [...racialCantrips, ...featSpells.cantrips, ...featSpells.spells, ...subclassSpells],
          })
        : null,
    [casts, casting.third, spellSearchClass, maxSpellLevel, spellWider, racialCantrips, featSpells, subclassSpells],
  );

  // Every casting class's desk (backlog F9, phase 2), in the order the
  // classes were taken: the lead's from the values above, each other one's
  // from its own lists (state.casterSpells) at its own level. The race's
  // and the feats' spells ride with the lead's, as the server writes them.
  const casterSpellLists = state.casterSpells;
  const leadIndex = caster?.index ?? -1;
  const casterDesks = useMemo<CasterDesk[]>(() => {
    if (!klass) {
      return [];
    }
    const rows = [klass, ...extras.map((entry) => entry.klass)];
    return classList.flatMap((entry, index): CasterDesk[] => {
      const row = rows[index];
      if (index === leadIndex && casterKlass) {
        return [
          {
            classId: casterKlass.id,
            klass: casterKlass,
            lead: true,
            casterKlass,
            casterSubclass,
            casterLevel,
            casts,
            spellSearchClass,
            maxSpellLevel,
            spellWider,
            cantripAdvice,
            spellAdvice,
            starters,
            subclassSpells,
            castingLabel,
            spellStyle,
            spellbookAdvice,
            racialCantrips,
            featSpells,
            chosenCantrips,
            chosenSpells,
            chosenPrepared,
            spellSupply,
            ability: casting.ability,
            spellSaveDc: preview?.derived.spellSaveDc ?? null,
            spellAttack: preview?.derived.spellAttack ?? null,
            lists: { spells, bookPrepared, cantrips },
            spellGrants,
          },
        ];
      }
      if (!multiclass || !classCasts(row, entry.subclass ?? "", entry.level)) {
        return [];
      }
      return [
        casterDeskOf(row, entry.subclass ?? "", entry.level, casterSpellLists?.[row.id] ?? NO_LISTS, shownAbilities, effectiveLevel, [
          ...grantedFeatures,
          ...optionPicks.map((optionName) => ({ name: optionName })),
        ]),
      ];
    });
  }, [
    klass, extras, classList, leadIndex, multiclass, casterSpellLists, shownAbilities, effectiveLevel, casterKlass, casterSubclass,
    casterLevel, casts, spellSearchClass, maxSpellLevel, spellWider, cantripAdvice, spellAdvice, starters, subclassSpells,
    castingLabel, spellStyle, spellbookAdvice, racialCantrips, featSpells, chosenCantrips, chosenSpells, chosenPrepared,
    spellSupply, casting.ability, preview, spells, bookPrepared, cantrips, spellGrants, grantedFeatures, optionPicks,
  ]);

  return {
    effectiveLevel,
    // The class list (backlog F9) and what reads it: the first class's
    // levels, the classes taken after it with their rows, and the class
    // whose spells the spell step holds, at its own level.
    primaryLevel,
    classList,
    multiclass,
    extras,
    // The first class's row, for the readers that walk the class list.
    primaryRow: klass,
    multiclassAllowed: rules?.multiclassAllowed !== false,
    casterKlass,
    casterSubclass,
    casterLevel,
    casterDesks,
    pactSlots,
    featuresByClass,
    expertiseSlots,
    toolSources,
    asiSlotLevels,
    activeAsiChoices,
    asiTakenInPlay,
    baseAbilities,
    asiBaseAbilities,
    racialBonus,
    abilityGains: gains.gains,
    primalChampion,
    abilities,
    shownAbilities,
    proficientSkills,
    toolGrants,
    featNames,
    featDescOf,
    featSpecOf,
    subclassTraining,
    training,
    preview,
    hp,
    spellSlots,
    equipmentSuggestions,
    classKit,
    kitChoices,
    kitTraining,
    backgroundKit,
    fullEquipment,
    purse: shownPurse,
    acInfo,
    ac,
    grantedFeatures,
    styleSlots,
    styleChoices,
    optionSlots,
    spellSearchClass,
    spellWider,
    casts,
    spellAdvice,
    cantripAdvice,
    starters,
    subclassSpells,
    racialCantrips,
    featSpells,
    castingLabel,
    chosenCantrips,
    chosenSpells,
    chosenPrepared,
    spellStyle,
    spellbookAdvice,
    spellSupply,
    maxSpellLevel,
    spellGrants,
  };
}

export type BuilderDerived = ReturnType<typeof useBuilderDerived>;

// useBuilderDerived run once outside a render, each memo simply computed:
// what scripts/lib/enforce-builder.mjs does for the test suites, without
// reaching into React. Synchronous, so no render can interleave.
export function deriveBuilder(input: Parameters<typeof useBuilderDerived>[0]): BuilderDerived {
  const before = memoize;
  memoize = (compute) => compute();
  try {
    // eslint-disable-next-line react-hooks/rules-of-hooks -- no hook state is read: every memo is computed in place
    return useBuilderDerived(input);
  } finally {
    memoize = before;
  }
}

// Action helpers that close over the state setters. Plain functions rather
// than hooks so the steps can call them from any handler.
export function builderActions(
  state: BuilderState,
  klass: ClassOption | undefined,
  race?: RaceOption,
  background?: BackgroundOption,
) {
  // A skill the background or race grants outright, or one picked for
  // either, is not a class pick; taking it again would spend a slot on
  // nothing. The same map greys the pill and labels it (CallingStep).
  const granted = grantedSkillSources({
    race,
    background,
    racialSkills: state.racialSkills,
    backgroundSkills: state.backgroundSkills,
  });
  return {
    addEquipmentItem(entry: {
      name: string;
      qty?: number;
      slug?: string;
      gear?: EquipmentItem["gear"];
      weight?: number;
      priceCp?: number;
      magic?: boolean;
    }) {
      state.setEquipment((current) => {
        const existing = current.find((item) => item.name === entry.name);
        if (existing) {
          return current.map((item) =>
            item.name === entry.name ? { ...item, qty: item.qty + 1 } : item,
          );
        }
        // A homebrew item arrives with its mechanics snapshotted, so the
        // builder's live AC and attack lines read it before it is saved.
        return [
          ...current,
          {
            name: entry.name,
            qty: entry.qty ?? 1,
            slug: entry.slug,
            ...(entry.gear ? { gear: entry.gear } : {}),
            ...(entry.weight !== undefined ? { weight: entry.weight } : {}),
            ...(entry.priceCp !== undefined ? { priceCp: entry.priceCp } : {}),
            ...(entry.magic ? { magic: true } : {}),
          },
        ];
      });
    },
    addEquipmentItems(entries: Array<{ name: string; qty: number }>) {
      state.setEquipment((current) => {
        const names = new Set(current.map((item) => item.name));
        return [...current, ...entries.filter((item) => !names.has(item.name))];
      });
    },
    removeEquipmentItem(itemName: string) {
      if (state.equipment.some((item) => item.name === itemName)) {
        state.setEquipment((current) => current.filter((item) => item.name !== itemName));
      } else {
        state.setRemovedAutoNames((removed) =>
          removed.includes(itemName) ? removed : [...removed, itemName],
        );
      }
    },
    // An either-or line of the class's starting equipment, and the weapon
    // named for an "any simple weapon" slot. The items of that line the
    // player removed come back with a new choice, since the choice is about
    // them; a removal from any other line stands.
    chooseKitOption(line: number, option: number) {
      const kit = klass ? classKitFor(klass.id) : null;
      if (kit) {
        const before = state.kitChoices;
        const after = withKitOption(kit, before, line, option);
        state.setKitChoices(after);
        state.setRemovedAutoNames((removed) => removedAfterKitChange(kit, before, after, line, removed));
      }
    },
    pickKitSlot(index: number, name: string) {
      const kit = klass ? classKitFor(klass.id) : null;
      if (kit) {
        const before = state.kitChoices;
        const after = withKitPick(resolveKit(kit, before, { armor: [], weapons: [] }).choices, index, name);
        state.setKitChoices(after);
        state.setRemovedAutoNames((removed) =>
          removedAfterKitChange(kit, before, after, kitLineOfSlot(kit, before, index), removed),
        );
      }
    },
    // One either-or line of the background's kit answered, by the words of
    // the alternative taken.
    pickBackgroundGear(index: number, label: string) {
      state.setBackgroundGearPicks((current) => {
        const next = current.slice();
        while (next.length < index) {
          next.push("");
        }
        next[index] = label;
        return next;
      });
    },
    toggleSkill(skillId: string) {
      if (!klass || granted.has(skillId.trim().toLowerCase())) {
        return;
      }
      state.setChosenSkills((current) =>
        current.includes(skillId)
          ? current.filter((entry) => entry !== skillId)
          : current.length < klass.skillChoices.count
            ? [...current, skillId]
            : current,
      );
    },
    toggleOption(slot: OptionSlot, optionName: string) {
      const featureName = optionFeatureName(slot.kind, optionName);
      state.setOptionPicks((current) => {
        if (current.includes(featureName)) {
          return current.filter((entry) => entry !== featureName);
        }
        return slot.chosen.length < slot.total ? [...current, featureName] : current;
      });
    },
  };
}

export type BuilderActions = ReturnType<typeof builderActions>;
