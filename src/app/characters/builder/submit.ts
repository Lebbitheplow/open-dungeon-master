import { backgroundFeatureFor } from "@/lib/backgrounds";
import { adaptSheetToLevel } from "@/lib/characters/adapt";
import type { Ability, AsiChoice, CreateSheetInput, Spellcasting } from "@/lib/schemas/sheet";
import { SRD_CLASSES, spellSlotsFor } from "@/lib/srd";
import { expertiseSlotsFor, racialTraitsFor, subclassLevelFor, subclassSpellsFor } from "@/lib/srd/features";
import { fightingStyleFeatureName } from "@/lib/srd/feature-effects";
import { featAbilityIncrease } from "@/lib/srd/feat-effects";
import { featPicksOwed, type FeatChoices, type FeatGrantSpec } from "@/lib/srd/feat-grants";
import { STANDARD_ARRAY } from "@/lib/srd/legality/abilities";
import { racialFeatCount } from "@/lib/srd/race-id";
import {
  POINT_BUY_BUDGET,
  POINT_BUY_MAX,
  POINT_BUY_MIN,
  pointBuyRemaining,
} from "@/lib/srd/point-buy";
import { findDraconicAncestry, innateCantripsFor, repeatedGrants, takesDraconicAncestry } from "@/lib/srd/racial-grants";
import { reconcilePicks } from "./reconcile";
import { builderCasting } from "./casting";
import type { BackgroundOption, ClassOption, RaceOption } from "./useBuilderOptions";
import type { BuilderDerived } from "./useBuilderDerived";
import type { BuilderState, EquipmentItem } from "./useBuilderState";

export type BuilderResult = { level: number; sheet: CreateSheetInput };

// Where on its step the missing pick sits, named for the block that collects
// it (the step marks the block with data-builder-target). The wizard's
// footer shows the message beside Continue and takes the player there on a
// tap (issue #117: an acolyte's two languages were nine screens down).
export type BlockerTarget =
  | "name"
  | "backgroundSkills"
  | "race"
  | "languages"
  | "racialAsi"
  | "racialSkills"
  | "racialTool"
  | "racialCantrip"
  | "racialFeat"
  | "ancestry"
  | "repeatSkills"
  | "class"
  | "classSkills"
  | "tools"
  | "subclass"
  | "styles"
  | "expertise"
  | "options"
  | "scores"
  | "asi"
  | "spells"
  | "gear";

export type StepBlock = { message: string; target: BlockerTarget };

const block = (target: BlockerTarget, message: string): StepBlock => ({ target, message });

type SubmitInput = {
  state: BuilderState;
  derived: BuilderDerived;
  race: RaceOption | undefined;
  klass: ClassOption | undefined;
  background: BackgroundOption | undefined;
  // The stored sheet an edit starts from; absent when creating.
  initial?: CreateSheetInput;
};

// Everything the wizard's per-step Continue buttons gate on, so a player
// cannot reach the end with a hole the final check would reject. Each
// returns the message the old single-page form showed at submit, and the
// block on the step where the pick is made.
export function identityBlocker(state: BuilderState, background?: BackgroundOption): StepBlock | null {
  if (!state.name.trim()) {
    return block("name", "Give your character a name.");
  }
  if (background?.skillChoice && state.backgroundSkills.filter(Boolean).length < background.skillChoice.count) {
    return block("backgroundSkills", `Pick your ${background.name} skill proficiencies first.`);
  }
  return null;
}

// Languages the player chooses: the race's bonus ones plus the background's
// (an acolyte learns two more). Both are picked on the ancestry step.
export function bonusLanguageCount(
  race: RaceOption | undefined,
  background: BackgroundOption | undefined,
): number {
  return (race?.bonusLanguages ?? 0) + (background?.languages ?? 0);
}

// The picks a feat leaves open, as the gate asks for them: what the feat's
// text grants (derived.featSpecOf) against what is picked so far.
function featPicksBlock(
  feats: string[],
  featChoices: FeatChoices | undefined,
  specOf: ((name: string) => FeatGrantSpec) | undefined,
): string | null {
  if (!specOf) {
    return null;
  }
  for (const feat of feats) {
    const owed = featPicksOwed(feat, specOf(feat), featChoices?.[feat.trim().toLowerCase()]);
    if (owed) {
      return owed;
    }
  }
  return null;
}

export function ancestryBlocker(
  state: BuilderState,
  race: RaceOption | undefined,
  background?: BackgroundOption,
  derived?: Pick<BuilderDerived, "featSpecOf">,
): StepBlock | null {
  if (!race) {
    return block("race", "Pick a race.");
  }
  const { bonusLanguages, racialAsi, racialSkills, racialTool, racialCantrip } = state;
  const languageCount = bonusLanguageCount(race, background);
  if (languageCount > 0 && bonusLanguages.filter(Boolean).length < languageCount) {
    const left = languageCount - bonusLanguages.filter(Boolean).length;
    return block("languages", `Pick ${left} more ${left === 1 ? "language" : "languages"} first.`);
  }
  if (race.asiChoice && racialAsi.filter(Boolean).length < race.asiChoice.count) {
    return block("racialAsi", `Pick which abilities your ${race.name} bonus raises first.`);
  }
  if (race.skillChoice && racialSkills.filter(Boolean).length < race.skillChoice.count) {
    return block("racialSkills", `Pick your ${race.name} skill proficiencies first.`);
  }
  if (race.toolChoice && !racialTool) {
    return block("racialTool", `Pick your ${race.name} tool proficiency first.`);
  }
  if (race.cantripChoice && !racialCantrip) {
    return block("racialCantrip", `Pick your ${race.name} cantrip first.`);
  }
  // The variant human's feat is a racial choice like the others, and used
  // to be the one no gate asked for (issue #124).
  const featsOwed = racialFeatCount(race.id) - (state.feats ?? []).length;
  if (featsOwed > 0) {
    return block("racialFeat", `Pick your ${race.name} feat first.`);
  }
  // What the feat itself leaves open: Linguist's three languages, Skill
  // Expert's skill and expertise (issue #125).
  const featPicks = featPicksBlock((state.feats ?? []).slice(0, racialFeatCount(race.id)), state.featChoices, derived?.featSpecOf);
  if (featPicks) {
    return block("racialFeat", featPicks);
  }
  if (takesDraconicAncestry(race.id) && !findDraconicAncestry(state.racialAncestry ?? "")) {
    return block("ancestry", `Pick your ${race.name}'s draconic ancestry first.`);
  }
  const repeats = repeatedGrants(background?.skills, race.skills).length;
  if (repeats && (state.repeatSkills ?? []).filter(Boolean).length < repeats) {
    return block("repeatSkills", `Your race and background both give the same skill; pick ${repeats === 1 ? "another skill" : `${repeats} other skills`} in its place.`);
  }
  return null;
}

// Whether the counts the SRD gives are rules for this class or only advice.
// The tables in src/lib/content/mechanics.ts are the SRD's; a homebrew or
// setting class borrows a list and may well have its own idea of how many.
export function srdClass(klass: ClassOption): boolean {
  return !klass.genres && SRD_CLASSES.some((entry) => entry.id === klass.id);
}

// The class step's own picks: skills, the subclass once the level calls for
// one, fighting styles and expertise. Every one of these used to be a
// suggestion a player could scroll past; a character built without them
// then started play with holes the rules do not allow.
export function callingBlocker(
  klass: ClassOption | undefined,
  state?: BuilderState,
  derived?: BuilderDerived,
): StepBlock | null {
  if (!klass) {
    return block("class", "Pick a class.");
  }
  if (!state || !derived) {
    return null;
  }
  const strict = srdClass(klass);
  const skillsLeft = klass.skillChoices.count - state.chosenSkills.length;
  if (strict && skillsLeft > 0) {
    return block("classSkills", `Pick ${skillsLeft} more class ${skillsLeft === 1 ? "skill" : "skills"}.`);
  }
  // An open tool grant ("three musical instruments") waits for its pick.
  const toolsOwed = derived.toolGrants.choices.findIndex((_, index) => derived.toolGrants.left[index] > 0);
  if (toolsOwed >= 0) {
    const left = derived.toolGrants.left[toolsOwed];
    const choice = derived.toolGrants.choices[toolsOwed];
    return block("tools", `Pick ${left} more ${choice.label}${left === 1 ? "" : "s"} for your tool proficiency.`);
  }
  const pickLevel = subclassLevelFor(klass.id);
  if (pickLevel !== null && derived.effectiveLevel >= pickLevel && !state.subclass.trim()) {
    return block("subclass", `Pick a subclass: a ${klass.name.toLowerCase()} chooses one at level ${pickLevel}.`);
  }
  const stylesLeft = derived.styleSlots - state.stylePicks.slice(0, derived.styleSlots).length;
  if (stylesLeft > 0) {
    return block("styles", `Pick ${stylesLeft === 1 ? "a fighting style" : `${stylesLeft} fighting styles`}.`);
  }
  const expertiseSlots = expertiseSlotsFor(klass.id, derived.effectiveLevel);
  // Counted against the skills the character still has, the same list the
  // panel draws: a pick in a dropped skill is not a pick.
  const expertiseLeft =
    expertiseSlots -
    state.expertisePicks.filter((skillId) => derived.proficientSkills.includes(skillId)).length;
  if (expertiseLeft > 0) {
    return block("expertise", `Pick ${expertiseLeft} more expertise ${expertiseLeft === 1 ? "skill" : "skills"}.`);
  }
  const slot = derived.optionSlots.find((entry) => entry.remaining > 0);
  if (slot) {
    return block("options", `Pick ${slot.remaining} more ${slot.label.toLowerCase()}.`);
  }
  return null;
}

// The spells step: a caster leaves with every cantrip and spell the rules
// give them at this level. A setting class borrows an SRD class's list and
// its counts with it, the same counts the server holds a level-up to.
export function spellsBlocker(
  state: BuilderState,
  derived: BuilderDerived,
  klass: ClassOption | undefined,
): StepBlock | null {
  if (!klass || !derived.casts) {
    return null;
  }
  const cantripsLeft = (derived.cantripAdvice ?? 0) - derived.chosenCantrips.length;
  if (cantripsLeft > 0) {
    return block("spells", `Pick ${cantripsLeft} more ${cantripsLeft === 1 ? "cantrip" : "cantrips"}.`);
  }
  if (derived.cantripAdvice !== null && cantripsLeft < 0) {
    return block("spells", `Remove ${-cantripsLeft} ${cantripsLeft === -1 ? "cantrip" : "cantrips"}: a ${klass.name.toLowerCase()} knows ${derived.cantripAdvice ?? 0} at this level.`);
  }
  if (derived.spellbookAdvice !== null) {
    // A wizard fills the book first, then prepares from it.
    const bookLeft = derived.spellbookAdvice - derived.chosenSpells.length;
    if (bookLeft > 0) {
      return block("spells", `Write ${bookLeft} more ${bookLeft === 1 ? "spell" : "spells"} in your spellbook.`);
    }
    if (bookLeft < 0) {
      return block("spells", `Remove ${-bookLeft} ${bookLeft === -1 ? "spell" : "spells"} from your spellbook: a level ${derived.effectiveLevel} wizard starts with ${derived.spellbookAdvice}.`);
    }
  }
  if (derived.spellAdvice) {
    // Never more prepared than the book holds.
    const target =
      derived.spellbookAdvice !== null
        ? Math.min(derived.spellAdvice.count, derived.chosenSpells.length)
        : derived.spellAdvice.count;
    const spellsLeft = target - derived.chosenPrepared.length;
    if (spellsLeft > 0) {
      return block(
        "spells",
        derived.spellbookAdvice !== null
          ? `Prepare ${spellsLeft} more ${spellsLeft === 1 ? "spell" : "spells"} from your spellbook.`
          : `Pick ${spellsLeft} more ${spellsLeft === 1 ? "spell" : "spells"} (${derived.spellAdvice.label}).`,
      );
    }
    if (spellsLeft < 0) {
      return block("spells", `Remove ${-spellsLeft} ${spellsLeft === -1 ? "spell" : "spells"}: the limit is ${derived.spellAdvice.count} ${derived.spellAdvice.label}.`);
    }
  }
  return null;
}

const sameNumbers = (left: number[], right: number[]) =>
  left.length === right.length &&
  [...left].sort((a, b) => a - b).join() === [...right].sort((a, b) => a - b).join();

// `state` is optional so the rule about the scores themselves can still be
// asked without it; with it, each method is held to what it gives: the
// standard array's six numbers once each, a point buy inside its range and
// its budget, and rolled scores that are the six totals thrown.
export function abilitiesBlocker(
  derived: BuilderDerived,
  state?: Pick<BuilderState, "method" | "scores"> & Partial<Pick<BuilderState, "rollPool" | "featChoices">>,
): StepBlock | null {
  if (!derived.abilities) {
    return block("scores", "Assign all six ability scores first.");
  }
  const placed = state ? Object.values(state.scores).map((score) => score ?? POINT_BUY_MIN) : [];
  if (state?.method === "standard" && !sameNumbers(placed, STANDARD_ARRAY)) {
    return block("scores", `The standard array is ${STANDARD_ARRAY.join(", ")}, each used once. Place each number on one ability.`);
  }
  if (state?.method === "pointbuy") {
    const outside = placed.find((score) => score < POINT_BUY_MIN || score > POINT_BUY_MAX);
    if (outside !== undefined) {
      return block("scores", `A point buy score runs from ${POINT_BUY_MIN} to ${POINT_BUY_MAX}; ${outside} is outside it.`);
    }
    const over = -pointBuyRemaining(placed);
    if (over > 0) {
      return block("scores", `Point buy is ${over} ${over === 1 ? "point" : "points"} over its ${POINT_BUY_BUDGET}. Lower a score first.`);
    }
  }
  if (state?.method === "roll") {
    const thrown = (state.rollPool ?? []).map((entry) => entry.total);
    if (!sameNumbers(placed, thrown)) {
      return block("scores", "Rolled scores are the six totals thrown, each placed on one ability. Roll the dice, then place all six.");
    }
  }
  const unresolvedSlot = derived.activeAsiChoices.findIndex(
    (choice, index) => choice === null && !derived.asiTakenInPlay[index],
  );
  if (unresolvedSlot !== -1) {
    return block("asi", `Resolve your level ${derived.asiSlotLevels[unresolvedSlot]} ability score improvement first.`);
  }
  // A feat taken with an improvement names what it leaves open (issue #125).
  const asiFeats = derived.activeAsiChoices.flatMap((choice) => (choice?.mode === "feat" ? [choice.feat] : []));
  const featPicks = featPicksBlock(asiFeats, state?.featChoices, derived.featSpecOf);
  if (featPicks) {
    return block("asi", featPicks);
  }
  return null;
}

// The pack: what it costs against the coin the character starts with.
export function gearBlocker(derived: BuilderDerived): StepBlock | null {
  const problems = [...new Set(derived.purse?.problems ?? [])];
  if (!problems.length) {
    return null;
  }
  // The equipment block lists every problem beside the items; the footer
  // says the first and how many more.
  return block(
    "gear",
    problems.length === 1 ? problems[0] : `${problems[0]} (${problems.length - 1} more listed under Equipment.)`,
  );
}

// The final check before the payload is built. The same rules as the step
// gates, re-run in case a later choice invalidated an earlier step (a level
// change adds an ASI slot, a class change empties the spell list), plus the
// one soft rule: a caster with no spells needs a second press to confirm.
export function validateBuilder(
  input: SubmitInput,
): { kind: "error" | "spellWarning"; message: string } | null {
  const { derived, race, klass, background } = input;
  if (!derived.abilities || !derived.preview || !race || !klass || !background) {
    return { kind: "error", message: "Assign all six ability scores first." };
  }
  // The gates read the picks as the sheet will carry them, not as they were
  // typed: buildBuilderResult reconciles once more, and a pick that step
  // would blank (a racial skill also taken as a class skill) has to be asked
  // for here, or the sheet leaves with one fewer than the race gave (issue
  // #124). In the wizard the state is already reconciled, so this changes
  // nothing it shows; a caller that fills the fields directly is held to
  // the same sheet.
  const { picks } = reconcilePicks(input.state, { race, klass, background, level: derived.effectiveLevel });
  const state: BuilderState = { ...input.state, ...picks };
  const blocked =
    identityBlocker(state, background) ??
    abilitiesBlocker(derived, state) ??
    ancestryBlocker(state, race, background, derived) ??
    callingBlocker(klass, state, derived) ??
    spellsBlocker(state, derived, klass) ??
    gearBlocker(derived);
  if (blocked) {
    return { kind: "error", message: blocked.message };
  }
  // Casters with no spells at all can still be submitted (homebrew varies),
  // but not by accident: one confirmation makes it a deliberate choice.
  if (derived.castingLabel && !state.spells.length && !state.cantrips.length && !state.spellWarningAck) {
    return {
      kind: "spellWarning",
      message: `${state.name.trim() || "This character"} has no ${derived.castingLabel.toLowerCase()} selected and will start unable to cast. Press again to continue anyway.`,
    };
  }
  return null;
}

// The sheet exactly as the single-page builder used to submit it. Call only
// after validateBuilder returned null.
export function buildBuilderResult(input: SubmitInput): BuilderResult {
  const { state, derived } = input;
  const race = input.race as RaceOption;
  const klass = input.klass as ClassOption;
  const background = input.background as BackgroundOption;
  const abilities = derived.abilities as NonNullable<BuilderDerived["abilities"]>;
  const preview = derived.preview as NonNullable<BuilderDerived["preview"]>;
  const { effectiveLevel } = derived;

  const resolvedAsiChoices = derived.activeAsiChoices.filter(
    (choice): choice is AsiChoice => choice !== null,
  );
  const asiFeats = resolvedAsiChoices.flatMap((choice) =>
    choice.mode === "feat" ? [choice.feat] : [],
  );
  // How the class casts at this level: an Eldritch Knight or Arcane
  // Trickster with Intelligence and a third caster's slots (./casting.ts).
  const casting = builderCasting(klass, state.subclass, effectiveLevel);
  const slots = Object.fromEntries(
    Object.entries(spellSlotsFor(klass.id, effectiveLevel, state.subclass)).map(([slotLevel, max]) => [
      slotLevel,
      { max, used: 0 },
    ]),
  );
  const isKnownCaster = derived.spellStyle === "known";
  const isWizard = derived.spellStyle === "spellbook";
  // The picks were checked against every change as it was made; checked
  // once more here so the sheet can never carry what the rules do not allow.
  const { picks } = reconcilePicks(state, { race, klass, background, level: effectiveLevel });
  // A racial cantrip (high elf) joins the cantrip list for casters. A
  // non-caster has nowhere to put it, so it rides along as a feature
  // instead, which populateFeatures keeps and the DM prompt can see.
  const { spells, cantrips, racialCantrip } = picks;
  // Skills, expertise and languages are picks too, so they come from the
  // reconciled ones: what the class, the background and the race grant, and
  // no more of the player's own than each of them offers.
  const skills = [
    ...new Set([
      ...picks.chosenSkills,
      ...(background.skills ?? []),
      ...picks.backgroundSkills.filter(Boolean),
      ...(race.skills ?? []),
      ...picks.racialSkills.filter(Boolean),
      ...(state.repeatSkills ?? []).filter(Boolean),
    ]),
  ];
  const proficiencies = {
    ...preview.proficiencies,
    skills,
    expertise: picks.expertisePicks.filter((skill) => skills.includes(skill)),
    languages: [
      ...new Set([
        ...(race.languages ?? []),
        ...(background.knownLanguages ?? []),
        ...picks.bonusLanguages.filter(Boolean),
        ...(klass.languages ?? []),
      ]),
    ],
  };
  // The race's own cantrips (a tiefling's thaumaturgy) ride on top, free.
  const finalCantrips = [
    ...new Set([
      ...cantrips,
      ...(racialCantrip ? [racialCantrip] : []),
      ...innateCantripsFor(race.id, effectiveLevel),
    ]),
  ];
  // Domain, circle, oath and patron spells are always prepared and free:
  // they ride onto the list on top of whatever the player picked.
  const grantedSpells = subclassSpellsFor(klass.id, picks.subclass, effectiveLevel).filter(
    (spell) => !spells.some((entry) => entry.toLowerCase() === spell.toLowerCase()),
  );
  const finalSpells = casting.ability ? [...spells, ...grantedSpells] : spells;
  const racialFeatures =
    racialCantrip && !casting.ability
      ? [{ name: `Racial cantrip: ${racialCantrip}`, source: "story" as const }]
      : [];
  // The server grants the feature of every bundled background itself
  // (db/sheets.ts withBackgroundFeature); a content-pack background's is
  // known only here, so it rides along the same way.
  const packBackgroundFeature =
    background.feature && !backgroundFeatureFor(background.id)
      ? [{ name: `${background.feature} (${background.name})`.slice(0, 80), source: "background" as const }]
      : [];
  // Likewise a content-pack race's traits: the server grants the bundled
  // races' (racialTraitsFor) and has no other copy of a Catfolk's.
  // The score a variant human's half-feat raises where it offers a choice;
  // the server adds the point (src/lib/srd/legality/half-feats.ts).
  const racialFeatChoice = featAbilityIncrease(state.feats[0] ?? "")?.from ?? [];
  const racialFeatAbility =
    racialFeatChoice.length > 1
      ? racialFeatChoice.includes(state.racialFeatAbility as Ability)
        ? (state.racialFeatAbility as Ability)
        : racialFeatChoice[0]
      : null;
  const packRaceTraits = racialTraitsFor(race.id).length
    ? []
    : race.traitNames.map((traitName) => ({ name: traitName.slice(0, 80), source: "race" as const }));

  return {
    level: effectiveLevel,
    sheet: keepUnedited(input.initial, {
      name: state.name.trim(),
      race: race.id,
      class: klass.id,
      subclass: picks.subclass,
      background: background.id,
      alignment: state.alignment,
      gender: state.gender,
      appearance: state.appearance.trim(),
      abilities,
      maxHp: preview.maxHp,
      ac: derived.ac,
      // The armor class is the armor engine's. Pinning one is a correction,
      // which whoever runs the table makes in play.
      acOverride: false,
      portrait: state.portrait,
      speed: race.speed,
      hitDice: {
        die: `d${klass.hitDie}` as "d6" | "d8" | "d10" | "d12",
        total: effectiveLevel,
        spent: 0,
      },
      // Characters are always built single-class; multiclassing happens
      // at level-up in play.
      classes: [],
      hitDicePools: null,
      proficiencies,
      // The catalog price rode along for the purse; the server prices the
      // pack again from its own catalog.
      equipment: derived.fullEquipment.map((entry) => {
        const item: EquipmentItem = { ...entry };
        delete item.priceCp;
        return item;
      }),
      // The coin left once the pack is paid for: the background's purse (or
      // the wealth the server rolled) less what was bought. The server works
      // the same sum from its own prices and stores its answer.
      gold: derived.purse?.gold ?? state.gold,
      copper: derived.purse?.copper ?? 0,
      feats: [...new Set([...asiFeats, ...state.feats])],
      // The picks those feats leave open, for the feats on the sheet only
      // (src/lib/srd/feat-grants.ts); the server applies them.
      featChoices: Object.fromEntries(
        [...new Set([...asiFeats, ...state.feats])]
          .map((feat) => [feat.trim().toLowerCase(), (state.featChoices ?? {})[feat.trim().toLowerCase()]] as const)
          .filter((entry): entry is readonly [string, NonNullable<(typeof entry)[1]>] => Boolean(entry[1])),
      ),
      // Server-side creation populates SRD class features, racial traits
      // and the background feature; the builder contributes only what has
      // no other home, like a non-caster's racial cantrip.
      features: [
        ...racialFeatures,
        ...packRaceTraits,
        ...packBackgroundFeature,
        ...picks.stylePicks.map((id) => ({ name: fightingStyleFeatureName(id), source: "choice" as const })),
        // Invocations, maneuvers, metamagic and the rest ride along as
        // "choice" features, the same shape as a fighting style, so the
        // level-up regrant preserves them.
        ...picks.optionPicks.map((optionName) => ({ name: optionName, source: "choice" as const })),
      ],
      asiChoices: resolvedAsiChoices,
      racialChoices: {
        asi: picks.racialAsi.filter((ability): ability is Ability => Boolean(ability)),
        skills: picks.racialSkills.filter(Boolean),
        cantrip: racialCantrip,
        tool: picks.racialTool,
        ancestry: takesDraconicAncestry(race.id) ? (findDraconicAncestry(state.racialAncestry ?? "")?.id ?? "") : "",
        ...(racialFeatAbility ? { featAbility: racialFeatAbility } : {}),
      },
      backgroundChoices: {
        skills: picks.backgroundSkills.filter(Boolean),
        gear: (derived.backgroundKit?.choices ?? []).map((choice) => choice.alternatives[choice.chosen].label),
      },
      // The class kit's either-or choices, which the server hands out free.
      ...(derived.kitChoices ? { kitChoices: derived.kitChoices } : {}),
      spellcasting: casting.ability
        ? {
            ability: casting.ability,
            slots,
            prepared: isKnownCaster ? [] : isWizard ? picks.bookPrepared : finalSpells,
            known: isKnownCaster ? finalSpells : [],
            cantrips: finalCantrips,
            ...(isWizard ? { spellbook: finalSpells } : {}),
          }
        : null,
      notes: "",
      backstory: state.backstory.trim(),
    }, effectiveLevel),
  };
}

// An edit rebuilds the whole sheet from the builder's fields and the server
// stores it whole, so what the builder has no field for comes from the
// stored sheet: the notes and small change synced back from play, what play
// granted (story boons, feats, the background's feature, an item's
// attunement), and a multiclass split. The split survives only under the
// same primary class, adapted to the edited level exactly as joining a
// campaign at that level adapts it (src/lib/characters/adapt.ts); a new
// primary class starts over single-class, since re-splitting levels is not
// something the builder does. A library sheet is stored as it was written,
// so one from before multiclassing has no classes array at all.
function keepUnedited(
  initial: CreateSheetInput | undefined,
  built: CreateSheetInput,
  level: number,
): CreateSheetInput {
  if (!initial) {
    return built;
  }
  const kept = {
    ...built,
    notes: initial.notes,
    copper: initial.copper,
    features: [...built.features, ...grantedInPlay(initial, built)],
    equipment: keptItemDetails(initial.equipment ?? [], built.equipment),
  };
  const storedClasses = initial.classes ?? [];
  if (storedClasses.length < 2 || initial.class !== built.class) {
    return kept;
  }
  const storedLevel = storedClasses.reduce((sum, entry) => sum + entry.level, 0);
  const adapted = adaptSheetToLevel(initial, storedLevel, level);
  const [primary, ...others] = adapted.classes;
  return {
    ...kept,
    classes: [{ ...primary, subclass: built.subclass }, ...others],
    hitDicePools: adapted.hitDicePools,
    spellcasting: keptSpellcasting(adapted.spellcasting, built.spellcasting, built.class),
  };
}

// Features the builder has no step for. The server re-grants class and race
// features from the SRD, and "choice" ones are the builder's own picks, so
// what is left came from play: a story boon, a feat granted at the table,
// the background's feature (kept only while the background is). A feat
// feature goes when the edit took its feat off the sheet.
function grantedInPlay(initial: CreateSheetInput, built: CreateSheetInput) {
  const lower = (text: string) => text.toLowerCase();
  const builtNames = new Set(built.features.map((feature) => lower(feature.name)));
  const keptFeats = new Set(built.feats.map(lower));
  const droppedFeats = new Set((initial.feats ?? []).map(lower).filter((feat) => !keptFeats.has(feat)));
  return (initial.features ?? []).filter((feature) => {
    if (builtNames.has(lower(feature.name))) {
      return false;
    }
    if (feature.source === "background") {
      return initial.background === built.background;
    }
    if (feature.source === "feat") {
      return !droppedFeats.has(lower(feature.name));
    }
    return feature.source === "story";
  });
}

// The builder edits an item's name and count only. Whatever else play set
// on it (equipped, attuned, identified, charges, a typed weight) rides back
// on the item of the same name, one stored item per built one.
function keptItemDetails(
  stored: CreateSheetInput["equipment"],
  built: CreateSheetInput["equipment"],
): CreateSheetInput["equipment"] {
  const unused = [...stored];
  return built.map((item) => {
    const index = unused.findIndex(
      (candidate) => candidate.name === item.name && (candidate.slug ?? "") === (item.slug ?? ""),
    );
    if (index === -1) {
      return item;
    }
    const [match] = unused.splice(index, 1);
    return { ...match, ...item };
  });
}

// The builder only knows the primary class's spells: they replace its lists
// (and its per-class entry), while the shared slot pool, the other classes'
// casting and pact magic stay as stored. A non-caster primary has no spell
// step, so the stored casting is kept whole.
function keptSpellcasting(
  stored: Spellcasting,
  built: Spellcasting,
  primaryClass: string,
): Spellcasting {
  if (!stored || !built) {
    return stored ?? built;
  }
  const primaryLists = {
    ability: built.ability,
    known: built.known,
    prepared: built.prepared,
    cantrips: built.cantrips ?? [],
    ...(built.spellbook ? { spellbook: built.spellbook } : {}),
  };
  if (!stored.casters?.length) {
    const next = { ...stored, ...primaryLists };
    // The edit chose the prepared list afresh; nothing waits for a rest.
    delete next.pending;
    return next;
  }
  const casters = stored.casters.map((caster) => {
    if (caster.classId.toLowerCase() !== primaryClass.toLowerCase()) {
      return caster;
    }
    const next = { ...caster, ...primaryLists };
    delete next.pending;
    if (!built.spellbook) {
      delete next.spellbook;
    }
    return next;
  });
  // The top-level lists stay the union of the per-class ones, the mirror
  // every other reader uses.
  const union = (pick: (caster: (typeof casters)[number]) => string[] | undefined) => {
    const seen = new Set<string>();
    return casters.flatMap((caster) => pick(caster) ?? []).filter((name) => {
      const key = name.trim().toLowerCase();
      if (!key || seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  };
  const pending = union((caster) => caster.pending);
  const spellbook = union((caster) => caster.spellbook);
  const merged = {
    ...stored,
    ability: built.ability,
    known: union((caster) => caster.known),
    prepared: union((caster) => caster.prepared),
    cantrips: union((caster) => caster.cantrips),
    casters,
  };
  delete merged.pending;
  delete merged.spellbook;
  return {
    ...merged,
    ...(pending.length ? { pending } : {}),
    ...(casters.some((caster) => caster.spellbook) ? { spellbook } : {}),
  };
}
