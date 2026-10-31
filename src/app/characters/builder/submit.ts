import { backgroundFeatureFor } from "@/lib/backgrounds";
import type { Ability, AsiChoice, ClassEntry, CreateSheetInput, Spellcasting } from "@/lib/schemas/sheet";
import { SRD_CLASSES } from "@/lib/srd";
import { expertiseAllowed, expertiseSlotsFor, racialTraitsFor, subclassLevelFor, subclassSpellsFor } from "@/lib/srd/features";
import { fightingStyleFeatureName } from "@/lib/srd/feature-effects";
import { featAbilityIncrease } from "@/lib/srd/feat-effects";
import { featOwed, type FeatChoices, type FeatGrantSpec } from "@/lib/srd/feat-grants";
import { STANDARD_ARRAY } from "@/lib/srd/legality/abilities";
import { racialFeatCount } from "@/lib/srd/race-id";
import {
  POINT_BUY_BUDGET,
  POINT_BUY_MAX,
  POINT_BUY_MIN,
  pointBuyRemaining,
} from "@/lib/srd/point-buy";
import { findDraconicAncestry, innateCantripsFor, repeatedGrants, takesDraconicAncestry } from "@/lib/srd/racial-grants";
import { racialCantripFields } from "@/lib/srd/racial-cantrips";
import { pickedVariant, variantFeatureNames, withSpeciesVariant } from "@/lib/content/species-variants";
import { reconcilePicks, type ReconcileContext } from "./reconcile";
import { builderCasting, builderSpellSlots } from "./casting";
import { fitExtraClasses, fitSpellLists, primaryLevelOf, unmetPrereqs } from "./multiclassBuild";
import { multiclassGrantsFor } from "@/lib/srd/multiclass";
import { unmetFeatMessage, type FeatJudge } from "./featPrereqs";
import type { BackgroundOption, ClassOption, RaceOption } from "./useBuilderOptions";
import type { BuilderDerived } from "./useBuilderDerived";
import type { BuilderState, EquipmentItem } from "./useBuilderState";
import { textKey } from "@/lib/language/text-logic";
import { featChoice } from "@/lib/schemas/sheet";
import { normalizeAttraction } from "@/lib/attraction";

export type BuilderResult = { level: number; sheet: CreateSheetInput };

// Where on its step the missing pick sits, named for the block that collects
// it (the step marks the block with data-builder-target). The wizard's
// footer shows the message beside Continue and takes the player there on a
// tap (issue #117: an acolyte's two languages were nine screens down).
export type BlockerTarget =
  | "name"
  | "background"
  | "backgroundSkills"
  | "race"
  | "languages"
  | "racialAsi"
  | "racialSkills"
  | "racialTool"
  | "racialCantrip"
  | "racialFeat"
  | "ancestry"
  | "variant"
  | "repeatSkills"
  | "class"
  // The classes taken after the first (backlog F9).
  | "multiclass"
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

// `label`: the pick's own name where the race names it (a workshop
// species' "Bloodline"), for the line of choices left (owed.ts).
export type StepBlock = { message: string; target: BlockerTarget; label?: string };

const block = (target: BlockerTarget, message: string, label?: string): StepBlock => ({ target, message, ...(label ? { label } : {}) });
const blockOf = block;

type SubmitInput = {
  state: BuilderState;
  derived: BuilderDerived;
  race: RaceOption | undefined;
  klass: ClassOption | undefined;
  background: BackgroundOption | undefined;
  // The stored sheet an edit starts from; absent when creating.
  initial?: CreateSheetInput;
  // The feat pickers' prerequisite check, for a feat a later choice broke.
  featJudge?: FeatJudge;
};

// Everything the wizard's per-step Continue buttons gate on, so a player
// cannot reach the end with a hole the final check would reject. Each
// returns the message the old single-page form showed at submit, and the
// block on the step where the pick is made.
//
// Each step has two forms: `...Blocks` lists every pick still owed, in the
// order the gate asks for them, for the step's "choices left" line; the
// `...Blocker` gate is the first of them.
//
// The name is asked last (backlog F4: how you want to play comes first, who
// the hero is once they exist), so nothing before the identity step waits
// on it.
export function identityBlocks(state: Pick<BuilderState, "name">): StepBlock[] {
  return state.name.trim() ? [] : [block("name", "Give your character a name.")];
}

export function identityBlocker(state: Pick<BuilderState, "name">): StepBlock | null {
  return identityBlocks(state)[0] ?? null;
}

// The background, asked beside the ancestry: the background itself, the
// skills a content pack's leaves open, and every open tool grant ("three
// musical instruments", "one type of artisan's tools"). The tools are asked
// here, the first step where both the class's and the background's grants
// are known.
export function backgroundBlocks(
  state: Pick<BuilderState, "backgroundSkills">,
  background?: BackgroundOption,
  derived?: Pick<BuilderDerived, "toolGrants">,
): StepBlock[] {
  const owed: StepBlock[] = [];
  // No background stands in until one is picked: the first row used to,
  // and an Acolyte nobody chose owed two languages.
  if (!background) {
    owed.push(block("background", "Choose what your hero did before adventuring (background)."));
  }
  if (background?.skillChoice && state.backgroundSkills.filter(Boolean).length < background.skillChoice.count) {
    owed.push(block("backgroundSkills", `Pick the skills your ${background.name} past trained (skill proficiencies).`));
  }
  // An open tool grant ("three musical instruments") waits for its pick.
  const grants = derived?.toolGrants;
  const toolsOwed = grants ? grants.choices.findIndex((_, index) => grants.left[index] > 0) : -1;
  if (grants && toolsOwed >= 0) {
    const left = grants.left[toolsOwed];
    const choice = grants.choices[toolsOwed];
    owed.push(block("tools", `Pick ${left} more ${choice.label}${left === 1 ? "" : "s"} you know how to use (tool proficiency).`));
  }
  return owed;
}

export function backgroundBlocker(
  state: Pick<BuilderState, "backgroundSkills">,
  background?: BackgroundOption,
  derived?: Pick<BuilderDerived, "toolGrants">,
): StepBlock | null {
  return backgroundBlocks(state, background, derived)[0] ?? null;
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
    const owed = featOwed(feat, specOf(feat), featChoice(featChoices, feat));
    if (owed) {
      return owed;
    }
  }
  return null;
}

export function ancestryBlocks(
  state: BuilderState,
  race: RaceOption | undefined,
  background?: BackgroundOption,
  derived?: Pick<BuilderDerived, "featSpecOf">,
  featJudge?: FeatJudge,
): StepBlock[] {
  if (!race) {
    return [block("race", "Choose where your hero comes from (race).")];
  }
  const owed: StepBlock[] = [];
  const { bonusLanguages, racialAsi, racialSkills, racialTool, racialCantrips } = state;
  // The species' own choice comes first: it changes what the picks below
  // offer (a +1 it gives cannot take a pick of the player's choice too).
  if (race.variants && !race.variants.options.some((option) => option.id === state.racialVariant)) {
    owed.push(block("variant", `Pick your ${race.name}'s ${race.variants.label.toLowerCase()}.`, race.variants.label));
  }
  const languageCount = bonusLanguageCount(race, background);
  if (languageCount > 0 && bonusLanguages.filter(Boolean).length < languageCount) {
    const left = languageCount - bonusLanguages.filter(Boolean).length;
    owed.push(block("languages", `Pick ${left} more ${left === 1 ? "language" : "languages"} your hero can speak.`));
  }
  if (race.asiChoice && racialAsi.filter(Boolean).length < race.asiChoice.count) {
    owed.push(block("racialAsi", `Pick which abilities your ${race.name} heritage makes stronger (ability score increase).`));
  }
  const racialFrom = race.skillChoice?.from ?? [];
  if (race.skillChoice && racialSkills.filter(Boolean).length < race.skillChoice.count) {
    owed.push(block("racialSkills", `Pick the skills your ${race.name} heritage trained (skill proficiencies).`));
  } else if (racialFrom.length && racialSkills.some((skill) => skill && !racialFrom.includes(skill))) {
    owed.push(block("racialSkills", `Your ${race.name} heritage trains only some skills: pick its skill proficiencies from its list.`));
  }
  if (race.toolChoice && !racialTool) {
    owed.push(block("racialTool", `Pick a tool your ${race.name} knows how to use (tool proficiency).`));
  }
  // Every cantrip the race offers (a homebrew species may offer three),
  // each a different spell.
  const cantripChoice = race.cantripChoice;
  const cantripsPicked = cantripChoice ? new Set(racialCantrips.filter(Boolean).map(textKey)).size : 0;
  if (cantripChoice && cantripsPicked < cantripChoice.count) {
    const left = cantripChoice.count - cantripsPicked;
    owed.push(
      block(
        "racialCantrip",
        cantripChoice.count === 1
          ? `Pick the simple spell your ${race.name} can cast at will (cantrip).`
          : `Pick ${left} ${cantripsPicked ? "more " : ""}simple ${left === 1 ? "spell" : "spells"} your ${race.name} can cast at will (${left === 1 ? "cantrip" : "cantrips"}).`,
      ),
    );
  }
  // The variant human's feat is a racial choice like the others, and used
  // to be the one no gate asked for (issue #124).
  const featsOwed = racialFeatCount(race.id) - (state.feats ?? []).length;
  if (featsOwed > 0) {
    owed.push(block("racialFeat", `Pick your ${race.name}'s special talent (feat).`));
  }
  // What the feat itself leaves open: Linguist's three languages, Skill
  // Expert's skill and expertise (issue #125).
  const featPicks = featPicksBlock((state.feats ?? []).slice(0, racialFeatCount(race.id)), state.featChoices, derived?.featSpecOf);
  if (featPicks) {
    owed.push(block("racialFeat", featPicks));
  }
  // A feat whose prerequisite a later choice broke: flagged, never dropped.
  const racialUnmet = unmetFeatMessage(featJudge, (state.feats ?? []).slice(0, racialFeatCount(race.id)));
  if (racialUnmet) {
    owed.push(block("racialFeat", racialUnmet));
  }
  if (takesDraconicAncestry(race.id) && !findDraconicAncestry(state.racialAncestry ?? "")) {
    owed.push(block("ancestry", `Pick the kind of dragon your ${race.name} descends from (draconic ancestry).`));
  }
  const repeats = repeatedGrants(background?.skills, race.skills).length;
  if (repeats && (state.repeatSkills ?? []).filter(Boolean).length < repeats) {
    owed.push(block("repeatSkills", `Your race and background both give the same skill; pick ${repeats === 1 ? "another skill" : `${repeats} other skills`} in its place.`));
  }
  return owed;
}

export function ancestryBlocker(
  state: BuilderState,
  race: RaceOption | undefined,
  background?: BackgroundOption,
  derived?: Pick<BuilderDerived, "featSpecOf">,
  featJudge?: FeatJudge,
): StepBlock | null {
  return ancestryBlocks(state, race, background, derived, featJudge)[0] ?? null;
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
export function callingBlocks(
  klass: ClassOption | undefined,
  state?: BuilderState,
  derived?: BuilderDerived,
): StepBlock[] {
  if (!klass) {
    return [block("class", "Choose how you fight or use magic (class).")];
  }
  if (!state || !derived) {
    return [];
  }
  const owed: StepBlock[] = [];
  const strict = srdClass(klass);
  const skillsLeft = klass.skillChoices.count - state.chosenSkills.length;
  if (strict && skillsLeft > 0) {
    owed.push(block("classSkills", `Pick ${skillsLeft} more ${skillsLeft === 1 ? "skill" : "skills"} your training taught you (class skills).`));
  }
  // Open tool grants are asked with the background (backgroundBlocks).
  // The first class's subclass comes at its own level, not the character's.
  const primaryLevel = derived.primaryLevel ?? derived.effectiveLevel;
  const pickLevel = subclassLevelFor(klass.id);
  if (pickLevel !== null && primaryLevel >= pickLevel && !state.subclass.trim()) {
    owed.push(block("subclass", `Choose your ${klass.name.toLowerCase()}'s path (subclass): a ${klass.name.toLowerCase()} chooses one at level ${pickLevel}.`));
  }
  owed.push(...multiclassBlocks(state, derived));
  // What the subclass's training leaves to the player: a Lore bard's three
  // skills, a Knowledge cleric's languages and skills (issue 251).
  for (const grant of derived.subclassTraining ?? []) {
    const left = featOwed(grant.name, grant.spec, featChoice(state.featChoices, grant.name));
    if (left) {
      owed.push(block("subclass", left));
      break;
    }
  }
  const stylesLeft = derived.styleSlots - state.stylePicks.slice(0, derived.styleSlots).length;
  if (stylesLeft > 0) {
    owed.push(block("styles", `Pick how you like to fight (${stylesLeft === 1 ? "fighting style" : `${stylesLeft} fighting styles`}).`));
  }
  // Each class's own, at its own level (a rogue taken second brings two).
  const expertiseSlots = derived.expertiseSlots ?? expertiseSlotsFor(klass.id, derived.effectiveLevel);
  const classIds = derived.classList?.length ? derived.classList.map((entry) => entry.id) : [klass.id];
  // Counted against the skills the character still has, the same list the
  // panel draws: a pick in a dropped skill is not a pick.
  const expertiseLeft =
    expertiseSlots -
    state.expertisePicks.filter((skillId) => expertiseAllowed(skillId, derived.proficientSkills, classIds)).length;
  if (expertiseLeft > 0) {
    owed.push(block("expertise", `Pick ${expertiseLeft} more ${expertiseLeft === 1 ? "skill" : "skills"} you are especially good at (expertise).`));
  }
  const slot = derived.optionSlots.find((entry) => entry.remaining > 0);
  if (slot) {
    owed.push(block("options", `Pick ${slot.remaining} more ${slot.label.toLowerCase()}.`));
  }
  return owed;
}

export function callingBlocker(
  klass: ClassOption | undefined,
  state?: BuilderState,
  derived?: BuilderDerived,
): StepBlock | null {
  return callingBlocks(klass, state, derived)[0] ?? null;
}

// What the classes taken after the first still owe (backlog F9): each one's
// subclass once its own level reaches the pick, the skill its multiclass
// grant lets the player choose, and the two rules a split is held to here.
function multiclassBlocks(state: BuilderState, derived: BuilderDerived): StepBlock[] {
  const extras = derived.extras ?? [];
  if (!extras.length) {
    return [];
  }
  const owed: StepBlock[] = [];
  // A table that turns multiclassing off takes a new character with one
  // class; one already split keeps what it has, or part of it, as the
  // setting promises, and takes no class it did not hold.
  const held = new Set(state.storedClassIds ?? []);
  const keepsHeld = held.size > 1 && derived.classList.every((entry) => held.has(entry.id));
  if (derived.multiclassAllowed === false && !keepsHeld) {
    owed.push(block("multiclass", "This table turns multiclassing off: remove the second class to make the character here."));
  }
  for (const entry of extras) {
    const name = entry.klass.name.toLowerCase();
    const pickLevel = subclassLevelFor(entry.klass.id);
    if (pickLevel !== null && entry.level >= pickLevel && !entry.subclass.trim()) {
      owed.push(block("multiclass", `Choose your ${name}'s path (subclass): a ${name} chooses one at its level ${pickLevel}.`));
    }
    const grant = multiclassGrantsFor(entry.klass.id).skillChoice;
    const left = grant ? grant.count - entry.skills.filter(Boolean).length : 0;
    if (left > 0) {
      owed.push(block("multiclass", `Pick the ${left === 1 ? "skill" : `${left} skills`} your ${name} levels taught you (skill proficiency).`));
    }
  }
  return owed;
}

// The spells step: a caster leaves with every cantrip and spell the rules
// give them at this level. A setting class borrows an SRD class's list and
// its counts with it, the same counts the server holds a level-up to.
export function spellsBlocks(
  derived: BuilderDerived,
  firstClass: ClassOption | undefined,
): StepBlock[] {
  if (!firstClass) {
    return [];
  }
  // Each casting class's own lists at its own level (backlog F9, phase 2);
  // with more than one, each message names its class.
  const desks: DeskCounts[] = derived.casterDesks
    ? derived.casterDesks.filter((desk) => desk.casts)
    : derived.casts
      ? [{ ...derived, klass: derived.casterKlass ?? firstClass, casterLevel: derived.casterLevel ?? derived.effectiveLevel }]
      : [];
  return desks.flatMap((desk) => deskBlocks(desk, desks.length > 1 ? `${desk.klass.name}: ` : ""));
}

// The counts one casting class's spell desk is held to.
type DeskCounts = Pick<
  BuilderDerived,
  "spellSupply" | "cantripAdvice" | "chosenCantrips" | "spellbookAdvice" | "chosenSpells" | "spellAdvice" | "chosenPrepared"
> & { klass: Pick<ClassOption, "name">; casterLevel: number };

function deskBlocks(desk: DeskCounts, who: string): StepBlock[] {
  const derived = desk;
  const { klass, casterLevel } = desk;
  const block = (target: BlockerTarget, message: string) => blockOf(target, `${who}${message}`);
  const owed: StepBlock[] = [];
  // A pick the bundled list cannot supply is not asked for (spellSupply.ts):
  // the server holds a caster to at most its count, never to at least it.
  const supply = derived.spellSupply ?? null;
  const cantripsLeft = Math.min(derived.cantripAdvice ?? 0, supply?.cantrips ?? Infinity) - derived.chosenCantrips.length;
  const cantripsOver = derived.chosenCantrips.length - (derived.cantripAdvice ?? 0);
  if (cantripsLeft > 0) {
    owed.push(block("spells", `Pick ${cantripsLeft} more ${cantripsLeft === 1 ? "simple spell" : "simple spells"} you can cast at will (${cantripsLeft === 1 ? "cantrip" : "cantrips"}).`));
  }
  if (derived.cantripAdvice !== null && cantripsOver > 0) {
    owed.push(block("spells", `Remove ${cantripsOver} ${cantripsOver === 1 ? "cantrip" : "cantrips"}: a ${klass.name.toLowerCase()} knows ${derived.cantripAdvice ?? 0} at this level.`));
  }
  if (derived.spellbookAdvice !== null) {
    // A wizard fills the book first, then prepares from it.
    const bookLeft = Math.min(derived.spellbookAdvice, supply?.spells ?? Infinity) - derived.chosenSpells.length;
    if (bookLeft > 0) {
      owed.push(block("spells", `Write ${bookLeft} more ${bookLeft === 1 ? "spell" : "spells"} in your spellbook.`));
    }
    const bookOver = derived.chosenSpells.length - derived.spellbookAdvice;
    if (bookOver > 0) {
      owed.push(block("spells", `Remove ${bookOver} ${bookOver === 1 ? "spell" : "spells"} from your spellbook: a level ${casterLevel} wizard starts with ${derived.spellbookAdvice}.`));
    }
  }
  if (derived.spellAdvice) {
    // Never more prepared than the book holds.
    const target =
      derived.spellbookAdvice !== null
        ? Math.min(derived.spellAdvice.count, derived.chosenSpells.length)
        : Math.min(derived.spellAdvice.count, supply?.spells ?? Infinity);
    const spellsLeft = target - derived.chosenPrepared.length;
    const spellsOver = derived.chosenPrepared.length - derived.spellAdvice.count;
    if (spellsLeft > 0) {
      owed.push(block(
        "spells",
        derived.spellbookAdvice !== null
          ? `Prepare ${spellsLeft} more ${spellsLeft === 1 ? "spell" : "spells"} from your spellbook.`
          : `Pick ${spellsLeft} more ${spellsLeft === 1 ? "spell" : "spells"} (${derived.spellAdvice.label}).`,
      ));
    }
    if (spellsOver > 0) {
      owed.push(block("spells", `Remove ${spellsOver} ${spellsOver === 1 ? "spell" : "spells"}: the limit is ${derived.spellAdvice.count} ${derived.spellAdvice.label}.`));
    }
  }
  return owed;
}

export function spellsBlocker(
  derived: BuilderDerived,
  klass: ClassOption | undefined,
): StepBlock | null {
  return spellsBlocks(derived, klass)[0] ?? null;
}

const sameNumbers = (left: number[], right: number[]) =>
  left.length === right.length &&
  [...left].sort((a, b) => a - b).join() === [...right].sort((a, b) => a - b).join();

// `state` is optional so the rule about the scores themselves can still be
// asked without it; with it, each method is held to what it gives: the
// standard array's six numbers once each, a point buy inside its range and
// its budget, and rolled scores that are the six totals thrown.
export function abilitiesBlocks(
  derived: BuilderDerived,
  state?: Pick<BuilderState, "method" | "scores"> & Partial<Pick<BuilderState, "rollPool" | "featChoices">>,
  featJudge?: FeatJudge,
): StepBlock[] {
  if (!derived.abilities) {
    return [block("scores", "Give each of the six abilities a score (ability scores).")];
  }
  const owed: StepBlock[] = [];
  const placed = state ? Object.values(state.scores).map((score) => score ?? POINT_BUY_MIN) : [];
  if (state?.method === "standard" && !sameNumbers(placed, STANDARD_ARRAY)) {
    owed.push(block("scores", `The standard array is ${STANDARD_ARRAY.join(", ")}, each used once. Place each number on one ability.`));
  }
  if (state?.method === "pointbuy") {
    const outside = placed.find((score) => score < POINT_BUY_MIN || score > POINT_BUY_MAX);
    if (outside !== undefined) {
      owed.push(block("scores", `A point buy score runs from ${POINT_BUY_MIN} to ${POINT_BUY_MAX}; ${outside} is outside it.`));
    }
    const over = -pointBuyRemaining(placed);
    if (over > 0) {
      owed.push(block("scores", `Point buy is ${over} ${over === 1 ? "point" : "points"} over its ${POINT_BUY_BUDGET}. Lower a score first.`));
    }
  }
  if (state?.method === "roll") {
    const thrown = (state.rollPool ?? []).map((entry) => entry.total);
    if (!sameNumbers(placed, thrown)) {
      owed.push(block("scores", "Rolled scores are the six totals thrown, each placed on one ability. Roll the dice, then place all six."));
    }
  }
  // Each class's prerequisite, on the final scores as the server reads
  // them (the plan's decision 1): never dropped, the player chooses what
  // to change.
  for (const line of unmetPrereqs(derived.classList ?? [], derived.abilities, (id) => classNameOf(derived, id))) {
    owed.push(block("scores", `${line} Raise that score, or change the classes.`));
  }
  const unresolvedSlot = derived.activeAsiChoices.findIndex(
    (choice, index) => choice === null && !derived.asiTakenInPlay[index],
  );
  if (unresolvedSlot !== -1) {
    owed.push(block("asi", `Choose what your hero gains at level ${derived.asiSlotLevels[unresolvedSlot]}: higher scores or a feat (ability score improvement).`));
  }
  // A feat taken with an improvement names what it leaves open (issue #125).
  const asiFeats = derived.activeAsiChoices.flatMap((choice) => (choice?.mode === "feat" ? [choice.feat] : []));
  const featPicks = featPicksBlock(asiFeats, state?.featChoices, derived.featSpecOf);
  if (featPicks) {
    owed.push(block("asi", featPicks));
  }
  // A feat whose prerequisite a later choice broke: flagged, never dropped.
  const asiUnmet = unmetFeatMessage(featJudge, asiFeats);
  if (asiUnmet) {
    owed.push(block("asi", asiUnmet));
  }
  return owed;
}

function classNameOf(derived: BuilderDerived, id: string): string {
  if (derived.primaryRow?.id === id) {
    return derived.primaryRow.name;
  }
  return derived.extras?.find((entry) => entry.klass.id === id)?.klass.name ?? id;
}

export function abilitiesBlocker(
  derived: BuilderDerived,
  state?: Pick<BuilderState, "method" | "scores"> & Partial<Pick<BuilderState, "rollPool" | "featChoices">>,
  featJudge?: FeatJudge,
): StepBlock | null {
  return abilitiesBlocks(derived, state, featJudge)[0] ?? null;
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
): { kind: "error" | "spellWarning"; message: string; target?: BlockerTarget } | null {
  const { derived, klass, background } = input;
  const race = input.race && withSpeciesVariant(input.race, input.state.racialVariant);
  // Each missing piece by its own name and step: this used to say "Assign
  // all six ability scores first." whatever was missing.
  if (!race) {
    return { kind: "error", message: "Choose where your hero comes from (race).", target: "race" };
  }
  if (!klass) {
    return { kind: "error", message: "Choose how you fight or use magic (class).", target: "class" };
  }
  if (!background) {
    return { kind: "error", message: "Choose what your hero did before adventuring (background).", target: "background" };
  }
  if (!derived.abilities || !derived.preview) {
    return { kind: "error", message: "Give each of the six abilities a score (ability scores).", target: "scores" };
  }
  // The gates read the picks as the sheet will carry them, not as they were
  // typed: buildBuilderResult reconciles once more, and a pick that step
  // would blank (a racial skill also taken as a class skill) has to be asked
  // for here, or the sheet leaves with one fewer than the race gave (issue
  // #124). In the wizard the state is already reconciled, so this changes
  // nothing it shows; a caller that fills the fields directly is held to
  // the same sheet.
  const { picks } = reconcilePicks(input.state, reconcileContextOf(input, race));
  const state: BuilderState = { ...input.state, ...picks };
  // In the wizard's order, so the save names the earliest step's pick; the
  // name is last, as the wizard asks it.
  const blocked =
    callingBlocker(klass, state, derived) ??
    ancestryBlocker(state, race, background, derived, input.featJudge) ??
    backgroundBlocker(state, background, derived) ??
    abilitiesBlocker(derived, state, input.featJudge) ??
    spellsBlocker(derived, klass) ??
    gearBlocker(derived) ??
    identityBlocker(state);
  if (blocked) {
    return { kind: "error", message: blocked.message, target: blocked.target };
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

// What the picks are checked against as the sheet is built: the classes,
// race, background and level, and the classes taken after the first.
function reconcileContextOf(input: SubmitInput, race: RaceOption | undefined): ReconcileContext {
  return {
    race,
    klass: input.klass,
    background: input.background,
    level: input.derived.effectiveLevel,
    extras: input.derived.extras ?? [],
  };
}

// The sheet exactly as the single-page builder used to submit it. Call only
// after validateBuilder returned null.
export function buildBuilderResult(input: SubmitInput): BuilderResult {
  const { state, derived } = input;
  // With the species option picked, however the caller read the race.
  const race = withSpeciesVariant(input.race as RaceOption, state.racialVariant);
  const klass = input.klass as ClassOption;
  const background = input.background as BackgroundOption;
  const abilities = derived.abilities as NonNullable<BuilderDerived["abilities"]>;
  const preview = derived.preview as NonNullable<BuilderDerived["preview"]>;
  const { effectiveLevel } = derived;

  const resolvedAsiChoices = derived.activeAsiChoices
    .filter((choice): choice is AsiChoice => choice !== null)
    // A half-feat with a choice of score raises the first it offers when
    // the player left the choice: a content pack feat's text arrives after
    // the pick, and the editor shows that same first score.
    .map((choice) => {
      if (choice.mode !== "feat" || choice.ability) {
        return choice;
      }
      const from = featAbilityIncrease(choice.feat, derived.featDescOf?.(choice.feat))?.from ?? [];
      return from.length > 1 ? { ...choice, ability: from[0] } : choice;
    });
  const asiFeats = resolvedAsiChoices.flatMap((choice) =>
    choice.mode === "feat" ? [choice.feat] : [],
  );
  // The picks were checked against every change as it was made; checked
  // once more here so the sheet can never carry what the rules do not allow.
  const reconciled = reconcilePicks(state, reconcileContextOf(input, race));
  const { picks } = reconciled;
  // The classes taken after the first (backlog F9), as the server keeps
  // them: the first class first, at the levels the others leave it.
  const extras = fitExtraClasses(state.extraClasses ?? [], { primaryId: klass.id, total: effectiveLevel });
  const multiclass = extras.length > 0;
  const classes: ClassEntry[] = multiclass
    ? [
        { id: klass.id, subclass: picks.subclass, level: primaryLevelOf(effectiveLevel, extras) },
        ...extras.map((entry) => ({ id: entry.classId, subclass: entry.subclass, level: entry.level })),
      ]
    : [];
  // The class whose spells the builder holds, at its own level: the first
  // class, or the one after it that casts.
  const casterKlass = derived.casterKlass ?? (multiclass ? undefined : klass);
  const casterAt = casterKlass ? classes.findIndex((entry) => entry.id === casterKlass.id) : -1;
  const casterSubclass = multiclass ? (casterAt >= 0 ? (classes[casterAt].subclass ?? "") : "") : picks.subclass;
  const casterLevel = multiclass ? (casterAt >= 0 ? classes[casterAt].level : effectiveLevel) : effectiveLevel;
  // How the class casts at this level: an Eldritch Knight or Arcane
  // Trickster with Intelligence and a third caster's slots (./casting.ts).
  const casting = builderCasting(casterKlass, casterSubclass, casterLevel);
  const slots = multiclass ? derived.spellSlots : builderSpellSlots(klass, state.subclass, effectiveLevel);
  const isKnownCaster = derived.spellStyle === "known";
  const isWizard = derived.spellStyle === "spellbook";
  // The skill each class taken second let the player pick, as checked.
  const extraSkills = reconciled.extraSkills.flat();
  // The racial cantrips (a high elf's one) join the cantrip list for
  // casters. A non-caster has nowhere to put them, so each rides along as a
  // feature instead, which populateFeatures keeps and the DM prompt can see.
  const { spells, cantrips, racialCantrips } = picks;
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
      ...picks.repeatSkills.filter(Boolean),
      ...extraSkills,
    ]),
  ];
  const proficiencies = {
    ...preview.proficiencies,
    skills,
    expertise: picks.expertisePicks.filter((skill) =>
      expertiseAllowed(skill, skills, multiclass ? classes.map((entry) => entry.id) : [klass.id]),
    ),
    languages: [
      ...new Set([
        ...(race.languages ?? []),
        ...(background.knownLanguages ?? []),
        ...picks.bonusLanguages.filter(Boolean),
        ...(klass.languages ?? []),
        ...(derived.extras ?? []).flatMap((entry) => entry.klass.languages ?? []),
      ]),
    ],
  };
  // The race's own cantrips (a tiefling's thaumaturgy) ride on top, free.
  const finalCantrips = [
    ...new Set([
      ...cantrips,
      ...racialCantrips,
      ...innateCantripsFor(race.id, effectiveLevel),
    ]),
  ];
  // Domain, circle, oath and patron spells are always prepared and free:
  // they ride onto the list on top of whatever the player picked, as does
  // a chain warlock's find familiar (src/lib/srd/class-spell-grants.ts).
  const grantedSpells = (
    casterKlass ? [...subclassSpellsFor(casterKlass.id, casterSubclass, casterLevel), ...(derived.spellGrants?.learned ?? [])] : []
  ).filter(
    (spell) => !spells.some((entry) => textKey(entry) === textKey(spell)),
  );
  const finalSpells = casting.ability ? [...spells, ...grantedSpells] : spells;
  const racialFeatures = casting.ability
    ? []
    : racialCantrips.map((name) => ({ name: `Racial cantrip: ${name}`, source: "story" as const }));
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
  const racialFeatChoice = featAbilityIncrease(state.feats[0] ?? "", derived.featDescOf?.(state.feats[0] ?? ""))?.from ?? [];
  const racialFeatAbility =
    racialFeatChoice.length > 1
      ? racialFeatChoice.includes(state.racialFeatAbility as Ability)
        ? (state.racialFeatAbility as Ability)
        : racialFeatChoice[0]
      : null;
  // The species option's own (its record, resistances and breath) as the
  // server writes them; the server writes every race feature again anyway.
  const option = pickedVariant(race);
  const packRaceTraits = racialTraitsFor(race.id).length
    ? []
    : [...race.traitNames, ...(option && race.variants ? variantFeatureNames(race.variants.label, option, race.traitNames) : [])].map(
        (traitName) => ({ name: traitName.slice(0, 80), source: "race" as const }),
      );

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
      // Who they are drawn to (issue 501): identity, so an edit keeps it
      // the way it keeps the gender, because the builder holds it.
      attraction: normalizeAttraction(state.attraction),
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
      // A split's class list, the first class first (backlog F9); empty for
      // one class. The server builds the hit dice of each class itself.
      classes,
      hitDicePools: null,
      proficiencies,
      // The catalog price and magic mark rode along for the purse; the
      // server prices the pack again from its own catalog.
      equipment: derived.fullEquipment.map((entry) => {
        const item: EquipmentItem = { ...entry };
        delete item.priceCp;
        delete item.magic;
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
        [...new Set([...asiFeats, ...state.feats, ...(derived.subclassTraining ?? []).map((grant) => grant.name)])]
          .map((feat) => [textKey(feat), featChoice(state.featChoices, feat)] as const)
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
        ...racialCantripFields(racialCantrips),
        tool: picks.racialTool,
        ancestry: takesDraconicAncestry(race.id) ? (findDraconicAncestry(state.racialAncestry ?? "")?.id ?? "") : "",
        variant: race.variants ? picks.racialVariant : "",
        ...(racialFeatAbility ? { featAbility: racialFeatAbility } : {}),
      },
      backgroundChoices: {
        skills: picks.backgroundSkills.filter(Boolean),
        gear: (derived.backgroundKit?.choices ?? []).map((choice) => choice.pick),
      },
      // The class kit's either-or choices, which the server hands out free.
      ...(derived.kitChoices ? { kitChoices: derived.kitChoices } : {}),
      spellcasting: casting.ability
        ? withCasterEntry(
            {
              ability: casting.ability,
              ...(casting.profile ? { progression: casting.profile } : {}),
              slots,
              prepared: isKnownCaster ? [] : isWizard ? picks.bookPrepared : finalSpells,
              known: isKnownCaster ? finalSpells : [],
              cantrips: finalCantrips,
              ...(isWizard ? { spellbook: finalSpells } : {}),
            },
            multiclass && casterKlass ? casterKlass.id : null,
            multiclass ? otherCasterEntries(derived, classes) : [],
            derived.pactSlots ?? null,
          )
        : null,
      notes: "",
      backstory: state.backstory.trim(),
      // A state written before the field (a saved draft, a test's double)
      // has none.
      hopes: (state.hopes ?? "").trim(),
    }),
  };
}

type CasterEntryOut = NonNullable<NonNullable<Spellcasting>["casters"]>[number];

// Each casting class but the lead, its own lists at its own level (backlog
// F9, phase 2): checked once more against what it casts, with its
// subclass's always-prepared spells on top, filed the way its class keeps
// them (known, prepared, or a wizard's book and what is prepared from it).
function otherCasterEntries(derived: BuilderDerived, classes: ClassEntry[]): CasterEntryOut[] {
  return (derived.casterDesks ?? []).flatMap((desk): CasterEntryOut[] => {
    const entry = classes.find((held) => held.id === desk.classId);
    if (desk.lead || !entry || !desk.ability) {
      return [];
    }
    const { lists } = fitSpellLists(desk.lists, { row: desk.klass, subclass: entry.subclass ?? "", level: entry.level });
    const granted = desk.subclassSpells.filter((spell) => !lists.spells.some((name) => textKey(name) === textKey(spell)));
    const all = [...lists.spells, ...granted];
    const profile = builderCasting(desk.klass, entry.subclass, entry.level).profile;
    return [
      {
        classId: desk.classId,
        ability: desk.ability,
        ...(profile ? { progression: profile } : {}),
        known: desk.spellStyle === "known" ? all : [],
        prepared: desk.spellStyle === "known" ? [] : desk.spellStyle === "spellbook" ? lists.bookPrepared : all,
        cantrips: lists.cantrips,
        ...(desk.spellStyle === "spellbook" ? { spellbook: all } : {}),
      },
    ];
  });
}

// On a class list each casting class's lists are its own entry, the shape
// the server judges per class (src/lib/srd/legality/spells.ts), the lead's
// first; the top-level lists are their union, the mirror every other reader
// uses, and a warlock's pact slots sit apart from the shared ones.
function withCasterEntry(
  casting: NonNullable<Spellcasting>,
  classId: string | null,
  others: CasterEntryOut[],
  pact: { level: number; max: number; used: number } | null,
): NonNullable<Spellcasting> {
  if (!classId) {
    return casting;
  }
  const lead: CasterEntryOut = {
    classId,
    ability: casting.ability,
    ...(casting.progression ? { progression: casting.progression } : {}),
    known: casting.known,
    prepared: casting.prepared,
    cantrips: casting.cantrips ?? [],
    ...(casting.spellbook ? { spellbook: casting.spellbook } : {}),
  };
  const casters = [lead, ...others];
  const union = (pick: (entry: CasterEntryOut) => string[] | undefined) => [
    ...new Map(casters.flatMap((entry) => pick(entry) ?? []).map((name) => [textKey(name), name])).values(),
  ];
  const spellbook = union((entry) => entry.spellbook);
  const merged: NonNullable<Spellcasting> = {
    ...casting,
    known: union((entry) => entry.known),
    prepared: union((entry) => entry.prepared),
    cantrips: union((entry) => entry.cantrips),
    casters,
    ...(pact ? { pact } : {}),
  };
  delete merged.spellbook;
  delete merged.progression;
  return {
    ...merged,
    ...(casting.progression && !others.length ? { progression: casting.progression } : {}),
    ...(spellbook.length ? { spellbook } : {}),
  };
}

// An edit rebuilds the whole sheet from the builder's fields and the server
// stores it whole, so what the builder has no field for comes from the
// stored sheet: the notes and small change synced back from play, and what
// play granted (story boons, feats, the background's feature, an item's
// attunement). A multiclass split is the builder's own now (backlog F9),
// each casting class's spell lists with it: the class list it built and
// the lists it holds are the sheet's.
function keepUnedited(
  initial: CreateSheetInput | undefined,
  built: CreateSheetInput,
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
  return kept;
}

// Features the builder has no step for. The server re-grants class and race
// features from the SRD, and "choice" ones are the builder's own picks, so
// what is left came from play: a story boon, a feat granted at the table,
// the background's feature (kept only while the background is). A feat
// feature goes when the edit took its feat off the sheet.
function grantedInPlay(initial: CreateSheetInput, built: CreateSheetInput) {
  const builtNames = new Set(built.features.map((feature) => textKey(feature.name)));
  const keptFeats = new Set(built.feats.map(textKey));
  const droppedFeats = new Set((initial.feats ?? []).map(textKey).filter((feat) => !keptFeats.has(feat)));
  return (initial.features ?? []).filter((feature) => {
    if (builtNames.has(textKey(feature.name))) {
      return false;
    }
    if (feature.source === "background") {
      return initial.background === built.background;
    }
    if (feature.source === "feat") {
      return !droppedFeats.has(textKey(feature.name));
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
