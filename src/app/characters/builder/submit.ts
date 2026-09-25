import { adaptSheetToLevel } from "@/lib/characters/adapt";
import type { Ability, AsiChoice, CreateSheetInput, Spellcasting } from "@/lib/schemas/sheet";
import { SRD_CLASSES, spellSlotsFor } from "@/lib/srd";
import { expertiseSlotsFor, subclassLevelFor, subclassSpellsFor } from "@/lib/srd/features";
import { fightingStyleFeatureName } from "@/lib/srd/feature-effects";
import { POINT_BUY_BUDGET, POINT_BUY_MIN, pointBuyRemaining } from "@/lib/srd/point-buy";
import type { BackgroundOption, ClassOption, RaceOption } from "./useBuilderOptions";
import type { BuilderDerived } from "./useBuilderDerived";
import type { BuilderState } from "./useBuilderState";

export type BuilderResult = { level: number; sheet: CreateSheetInput };

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
// returns the message the old single-page form showed at submit.
export function identityBlocker(state: BuilderState): string | null {
  return state.name.trim() ? null : "Give your character a name.";
}

// Languages the player chooses: the race's bonus ones plus the background's
// (an acolyte learns two more). Both are picked on the ancestry step.
export function bonusLanguageCount(
  race: RaceOption | undefined,
  background: BackgroundOption | undefined,
): number {
  return (race?.bonusLanguages ?? 0) + (background?.languages ?? 0);
}

export function ancestryBlocker(
  state: BuilderState,
  race: RaceOption | undefined,
  background?: BackgroundOption,
): string | null {
  if (!race) {
    return "Pick a race.";
  }
  const { bonusLanguages, racialAsi, racialSkills, racialTool, racialCantrip } = state;
  const languageCount = bonusLanguageCount(race, background);
  if (languageCount > 0 && bonusLanguages.filter(Boolean).length < languageCount) {
    const left = languageCount - bonusLanguages.filter(Boolean).length;
    return `Pick ${left} more ${left === 1 ? "language" : "languages"} first.`;
  }
  if (race.asiChoice && racialAsi.filter(Boolean).length < race.asiChoice.count) {
    return `Pick which abilities your ${race.name} bonus raises first.`;
  }
  if (race.skillChoice && racialSkills.filter(Boolean).length < race.skillChoice.count) {
    return `Pick your ${race.name} skill proficiencies first.`;
  }
  if (race.toolChoice && !racialTool) {
    return `Pick your ${race.name} tool proficiency first.`;
  }
  if (race.cantripChoice && !racialCantrip) {
    return `Pick your ${race.name} cantrip first.`;
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
): string | null {
  if (!klass) {
    return "Pick a class.";
  }
  if (!state || !derived) {
    return null;
  }
  const strict = srdClass(klass);
  const skillsLeft = klass.skillChoices.count - state.chosenSkills.length;
  if (strict && skillsLeft > 0) {
    return `Pick ${skillsLeft} more class ${skillsLeft === 1 ? "skill" : "skills"}.`;
  }
  const pickLevel = subclassLevelFor(klass.id);
  if (pickLevel !== null && derived.effectiveLevel >= pickLevel && !state.subclass.trim()) {
    return `Pick a subclass: a ${klass.name.toLowerCase()} chooses one at level ${pickLevel}.`;
  }
  const stylesLeft = derived.styleSlots - state.stylePicks.slice(0, derived.styleSlots).length;
  if (stylesLeft > 0) {
    return `Pick ${stylesLeft === 1 ? "a fighting style" : `${stylesLeft} fighting styles`}.`;
  }
  const expertiseSlots = expertiseSlotsFor(klass.id, derived.effectiveLevel);
  // Counted against the skills the character still has, the same list the
  // panel draws: a pick in a dropped skill is not a pick.
  const expertiseLeft =
    expertiseSlots -
    state.expertisePicks.filter((skillId) => derived.proficientSkills.includes(skillId)).length;
  if (expertiseLeft > 0) {
    return `Pick ${expertiseLeft} more expertise ${expertiseLeft === 1 ? "skill" : "skills"}.`;
  }
  const slot = derived.optionSlots.find((entry) => entry.remaining > 0);
  if (slot) {
    return `Pick ${slot.remaining} more ${slot.label.toLowerCase()}.`;
  }
  return null;
}

// The spells step: an SRD caster leaves with every cantrip and spell the
// rules give them at this level. Setting classes keep the old soft rule
// (validateBuilder's one-press warning) because their counts are advice.
export function spellsBlocker(
  state: BuilderState,
  derived: BuilderDerived,
  klass: ClassOption | undefined,
): string | null {
  if (!klass || !derived.casts || !srdClass(klass)) {
    return null;
  }
  const cantripsLeft = (derived.cantripAdvice ?? 0) - derived.chosenCantrips.length;
  if (cantripsLeft > 0) {
    return `Pick ${cantripsLeft} more ${cantripsLeft === 1 ? "cantrip" : "cantrips"}.`;
  }
  if (derived.cantripAdvice !== null && cantripsLeft < 0) {
    return `Remove ${-cantripsLeft} ${cantripsLeft === -1 ? "cantrip" : "cantrips"}: a ${klass.name.toLowerCase()} knows ${derived.cantripAdvice ?? 0} at this level.`;
  }
  if (derived.spellbookAdvice !== null) {
    // A wizard fills the book first, then prepares from it.
    const bookLeft = derived.spellbookAdvice - derived.chosenSpells.length;
    if (bookLeft > 0) {
      return `Write ${bookLeft} more ${bookLeft === 1 ? "spell" : "spells"} in your spellbook.`;
    }
    if (bookLeft < 0) {
      return `Remove ${-bookLeft} ${bookLeft === -1 ? "spell" : "spells"} from your spellbook: a level ${derived.effectiveLevel} wizard starts with ${derived.spellbookAdvice}.`;
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
      return derived.spellbookAdvice !== null
        ? `Prepare ${spellsLeft} more ${spellsLeft === 1 ? "spell" : "spells"} from your spellbook.`
        : `Pick ${spellsLeft} more ${spellsLeft === 1 ? "spell" : "spells"} (${derived.spellAdvice.label}).`;
    }
    if (spellsLeft < 0) {
      return `Remove ${-spellsLeft} ${spellsLeft === -1 ? "spell" : "spells"}: the limit is ${derived.spellAdvice.count} ${derived.spellAdvice.label}.`;
    }
  }
  return null;
}

// `state` is optional so the rule about the scores themselves can still be
// asked without it; with it, point buy is held to its budget.
export function abilitiesBlocker(
  derived: BuilderDerived,
  state?: Pick<BuilderState, "method" | "scores">,
): string | null {
  if (!derived.abilities) {
    return "Assign all six ability scores first.";
  }
  if (state?.method === "pointbuy") {
    const over = -pointBuyRemaining(
      Object.values(state.scores).map((score) => score ?? POINT_BUY_MIN),
    );
    if (over > 0) {
      return `Point buy is ${over} ${over === 1 ? "point" : "points"} over its ${POINT_BUY_BUDGET}. Lower a score first.`;
    }
  }
  const unresolvedSlot = derived.activeAsiChoices.findIndex(
    (choice, index) => choice === null && !derived.asiTakenInPlay[index],
  );
  if (unresolvedSlot !== -1) {
    return `Resolve your level ${derived.asiSlotLevels[unresolvedSlot]} ability score improvement first.`;
  }
  return null;
}

// The final check before the payload is built. The same rules as the step
// gates, re-run in case a later choice invalidated an earlier step (a level
// change adds an ASI slot, a class change empties the spell list), plus the
// one soft rule: a caster with no spells needs a second press to confirm.
export function validateBuilder(
  input: SubmitInput,
): { kind: "error" | "spellWarning"; message: string } | null {
  const { state, derived, race, klass, background } = input;
  if (!derived.abilities || !derived.preview || !race || !klass || !background) {
    return { kind: "error", message: "Assign all six ability scores first." };
  }
  const message =
    identityBlocker(state) ??
    abilitiesBlocker(derived, state) ??
    ancestryBlocker(state, race, background) ??
    callingBlocker(klass, state, derived) ??
    spellsBlocker(state, derived, klass);
  if (message) {
    return { kind: "error", message };
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
  const slots = Object.fromEntries(
    Object.entries(spellSlotsFor(klass.id, effectiveLevel)).map(([slotLevel, max]) => [
      slotLevel,
      { max, used: 0 },
    ]),
  );
  const isKnownCaster = derived.spellStyle === "known";
  const isWizard = derived.spellStyle === "spellbook";
  // A racial cantrip (high elf) joins the cantrip list for casters. A
  // non-caster has nowhere to put it, so it rides along as a feature
  // instead, which populateFeatures keeps and the DM prompt can see.
  const { spells, cantrips, racialCantrip } = state;
  const finalCantrips =
    racialCantrip && !cantrips.includes(racialCantrip) ? [...cantrips, racialCantrip] : cantrips;
  // Domain, circle, oath and patron spells are always prepared and free:
  // they ride onto the list on top of whatever the player picked.
  const grantedSpells = subclassSpellsFor(klass.id, state.subclass, effectiveLevel).filter(
    (spell) => !spells.some((entry) => entry.toLowerCase() === spell.toLowerCase()),
  );
  const finalSpells = klass.spellAbility ? [...spells, ...grantedSpells] : spells;
  const racialFeatures =
    racialCantrip && !klass.spellAbility
      ? [{ name: `Racial cantrip: ${racialCantrip}`, source: "story" as const }]
      : [];

  return {
    level: effectiveLevel,
    sheet: keepUnedited(input.initial, {
      name: state.name.trim(),
      race: race.id,
      class: klass.id,
      subclass: state.subclass,
      background: background.id,
      alignment: state.alignment,
      gender: state.gender,
      appearance: state.appearance.trim(),
      abilities,
      maxHp: preview.maxHp,
      ac: derived.ac,
      acOverride: state.acOverride !== null,
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
      proficiencies: preview.proficiencies,
      equipment: derived.fullEquipment,
      gold: state.gold,
      // Starting wealth is quoted in whole gold pieces everywhere in the
      // PHB, so a new character starts with no small change.
      copper: 0,
      feats: [...new Set([...asiFeats, ...state.feats])],
      // Server-side creation populates SRD class features, racial traits
      // and the background feature; the builder contributes only what has
      // no other home, like a non-caster's racial cantrip.
      features: [
        ...racialFeatures,
        ...state.stylePicks
          .slice(0, derived.styleSlots)
          .map((id) => ({ name: fightingStyleFeatureName(id), source: "choice" as const })),
        // Invocations, maneuvers, metamagic and the rest ride along as
        // "choice" features, the same shape as a fighting style, so the
        // level-up regrant preserves them.
        ...state.optionPicks.map((optionName) => ({ name: optionName, source: "choice" as const })),
      ],
      asiChoices: resolvedAsiChoices,
      racialChoices: {
        asi: state.racialAsi.filter((ability): ability is Ability => Boolean(ability)),
        skills: state.racialSkills.filter(Boolean),
        cantrip: racialCantrip,
        tool: state.racialTool,
      },
      spellcasting: klass.spellAbility
        ? {
            ability: klass.spellAbility,
            slots,
            prepared: isKnownCaster ? [] : isWizard ? derived.chosenPrepared : finalSpells,
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
  const primaryLists = { ability: built.ability, known: built.known, prepared: built.prepared };
  return {
    ...stored,
    ...primaryLists,
    casters: stored.casters?.map((caster) =>
      caster.classId.toLowerCase() === primaryClass.toLowerCase()
        ? { ...caster, ...primaryLists }
        : caster,
    ),
  };
}
