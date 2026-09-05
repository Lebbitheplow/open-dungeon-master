import type { Ability, AsiChoice, CreateSheetInput } from "@/lib/schemas/sheet";
import { spellSlotsFor } from "@/lib/srd";
import { subclassSpellsFor } from "@/lib/srd/features";
import { fightingStyleFeatureName } from "@/lib/srd/feature-effects";
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
};

// Everything the wizard's per-step Continue buttons gate on, so a player
// cannot reach the end with a hole the final check would reject. Each
// returns the message the old single-page form showed at submit.
export function identityBlocker(state: BuilderState): string | null {
  return state.name.trim() ? null : "Give your character a name.";
}

export function ancestryBlocker(state: BuilderState, race: RaceOption | undefined): string | null {
  if (!race) {
    return "Pick a race.";
  }
  const { bonusLanguages, racialAsi, racialSkills, racialTool, racialCantrip } = state;
  if (race.bonusLanguages > 0 && bonusLanguages.filter(Boolean).length < race.bonusLanguages) {
    return `Pick your bonus ${race.bonusLanguages === 1 ? "language" : "languages"} first.`;
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

export function callingBlocker(klass: ClassOption | undefined): string | null {
  return klass ? null : "Pick a class.";
}

export function abilitiesBlocker(derived: BuilderDerived): string | null {
  if (!derived.abilities) {
    return "Assign all six ability scores first.";
  }
  const unresolvedSlot = derived.activeAsiChoices.findIndex((choice) => choice === null);
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
    abilitiesBlocker(derived) ??
    ancestryBlocker(state, race) ??
    callingBlocker(klass);
  if (message) {
    return { kind: "error", message };
  }
  // Casters with no spells at all can still be submitted (homebrew varies),
  // but not by accident: one confirmation makes it a deliberate choice.
  if (derived.castingLabel && !state.spells.length && !state.spellWarningAck) {
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
  const isKnownCaster =
    klass.knownCaster ?? ["bard", "sorcerer", "warlock", "ranger"].includes(klass.id);
  // A racial cantrip (high elf) joins the spell list for casters. A
  // non-caster has nowhere to put it, so it rides along as a feature
  // instead, which populateFeatures keeps and the DM prompt can see.
  const { spells, racialCantrip } = state;
  const spellsWithRacial =
    racialCantrip && !spells.includes(racialCantrip) ? [...spells, racialCantrip] : spells;
  // Domain, circle, oath and patron spells are always prepared and free:
  // they ride onto the list on top of whatever the player picked.
  const grantedSpells = subclassSpellsFor(klass.id, state.subclass, effectiveLevel).filter(
    (spell) => !spellsWithRacial.some((entry) => entry.toLowerCase() === spell.toLowerCase()),
  );
  const finalSpells = klass.spellAbility ? [...spellsWithRacial, ...grantedSpells] : spells;
  const racialFeatures =
    racialCantrip && !klass.spellAbility
      ? [{ name: `Racial cantrip: ${racialCantrip}`, source: "story" as const }]
      : [];

  return {
    level: effectiveLevel,
    sheet: {
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
            prepared: isKnownCaster ? [] : finalSpells,
            known: isKnownCaster ? finalSpells : [],
          }
        : null,
      notes: "",
      backstory: state.backstory.trim(),
    },
  };
}
