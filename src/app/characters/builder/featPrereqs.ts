import { createContext, useContext } from "react";
import { ABILITIES, type Ability, type AbilityScores } from "@/lib/schemas/sheet";
import { ABILITY_SCORE_CAP } from "@/lib/srd/asi";
import { authoredFeatPrerequisite } from "@/lib/srd/feat-effects";
import { packFeatText } from "@/lib/srd/feat-text";
import { subclassLevelFor } from "@/lib/srd/features";
import {
  checkPrerequisite,
  type FeatCandidate,
  type FeatWaiting,
  type PrerequisiteCheck,
} from "@/lib/srd/legality/features";
import { builderCasting } from "./casting";
import type { PickerEntry } from "./useContentSearch";
import type { BackgroundOption, ClassOption, RaceOption } from "./useBuilderOptions";
import type { BuilderDerived } from "./useBuilderDerived";
import type { BuilderState } from "./useBuilderState";

// The feat pickers judge a feat's prerequisite the way the save does
// (src/lib/srd/legality/features.ts checkPrerequisite, which the server's
// judgeFeats reads too), against the character as built so far. A
// requirement on a pick not yet made waits instead of failing: a variant
// human picks a feat a step before the scores.
export type FeatJudge = {
  // A feat by the prerequisite it states. `forSlot` when the feat would
  // fill an open improvement, which then cannot also raise a score.
  check: (prerequisite: string, forSlot?: boolean) => PrerequisiteCheck;
  // A feat on the sheet by name; null while its text is still on its way.
  checkFeat: (name: string) => PrerequisiteCheck | null;
  // Whether the stored character held this feat before the edit. The save
  // does not judge such a feat again, so neither does its card nor a picker
  // row: one taken off can be put back.
  held: (name: string) => boolean;
};

export const FeatJudgeContext = createContext<FeatJudge | null>(null);

export function useFeatJudge(): FeatJudge | null {
  return useContext(FeatJudgeContext);
}

// A feat's prerequisite from where the save reads it: ODM's own table
// first, then the row's text.
export function entryPrerequisite(entry: Pick<PickerEntry, "name" | "data">): string {
  return authoredFeatPrerequisite(entry.name) ?? packFeatText(entry.data ?? {}).prerequisite;
}

// The check in words, one requirement after another.
export function prerequisiteNote(check: PrerequisiteCheck): string {
  return check.requirements.map((entry) => entry.note).join("; ");
}

// A picker row's verdict: a feat whose requirement is plainly unmet cannot
// be picked; one waiting on an unfinished choice can, with its note. A feat
// the character held before the edit is not judged.
export function judgeEntry(
  judge: FeatJudge | null,
  entry: Pick<PickerEntry, "name" | "data">,
  forSlot = false,
): { blocked: boolean; note: string } | null {
  if (!judge || judge.held(entry.name)) {
    return null;
  }
  const check = judge.check(entryPrerequisite(entry), forSlot);
  return check.state === "none" ? null : { blocked: check.state === "unmet", note: prerequisiteNote(check) };
}

type BuilderFacts = {
  state: BuilderState;
  derived: Pick<
    BuilderDerived,
    "abilities" | "racialBonus" | "effectiveLevel" | "training" | "kitTraining" | "toolGrants" | "activeAsiChoices" | "asiTakenInPlay"
  >;
  race: RaceOption | undefined;
  klass: ClassOption | undefined;
  background: BackgroundOption | undefined;
};

// The character as the save will see it (sheet-legality.ts builds the same
// candidate from the sheet it is sent), and what is still open.
export function builderFeatCandidate({ state, derived, race, klass, background }: BuilderFacts, forSlot = false): {
  who: FeatCandidate;
  waiting: FeatWaiting;
} {
  const scores = state.scores as Record<Ability, number | null>;
  const unset = ABILITIES.filter((ability) => !race || scores[ability] === null);
  const abilities =
    derived.abilities ??
    (Object.fromEntries(
      ABILITIES.map((ability) => [ability, (scores[ability] ?? 0) + (derived.racialBonus[ability] ?? 0)]),
    ) as AbilityScores);
  // Room a score still has: the race's bonus not yet placed, and each
  // improvement not yet resolved (+2 to one score).
  const openRacial = race?.asiChoice ? Math.max(0, race.asiChoice.count - state.racialAsi.filter(Boolean).length) : 0;
  const openSlots = Math.max(
    0,
    derived.activeAsiChoices.filter((choice, index) => choice === null && !derived.asiTakenInPlay[index]).length - (forSlot ? 1 : 0),
  );
  const abilityRoom = Object.fromEntries(
    ABILITIES.map((ability) => {
      const placed = state.racialAsi.includes(ability);
      const room = (openRacial && !placed ? race!.asiChoice!.amount : 0) + openSlots * 2;
      return [ability, Math.min(room, Math.max(0, ABILITY_SCORE_CAP - abilities[ability]))];
    }),
  ) as Record<Ability, number>;
  const subclassOpen = Boolean(
    klass && !state.subclass && derived.effectiveLevel >= (subclassLevelFor(klass.id) ?? Infinity),
  );
  const skillsOpen =
    !klass ||
    !background ||
    state.chosenSkills.length < klass.skillChoices.count ||
    state.backgroundSkills.filter(Boolean).length < (background.skillChoice?.count ?? 0) ||
    state.racialSkills.filter(Boolean).length < (race?.skillChoice?.count ?? 0);
  return {
    who: {
      abilities,
      armor: derived.kitTraining.armor,
      casts: Boolean(builderCasting(klass, state.subclass, derived.effectiveLevel).ability),
      raceId: race?.id ?? "",
      raceName: race?.name ?? "",
      skills: derived.training.skills,
      tools: derived.training.tools,
      weapons: [...new Set([...derived.training.weapons, ...derived.kitTraining.weapons])],
      level: derived.effectiveLevel,
    },
    waiting: {
      abilities: unset,
      abilityRoom,
      race: !race,
      armor: !klass || subclassOpen,
      casts: !klass || subclassOpen,
      weapons: !klass || subclassOpen,
      skills: skillsOpen,
      tools: !klass || !background || derived.toolGrants.left.some((left) => left > 0),
    },
  };
}

// The judge the builder hands its feat pickers. `prerequisites` holds a
// content pack feat's as fetched (useFeatTexts), by lower-case name. A feat
// the stored character already `held` before this edit is not judged
// again, as the server does not judge it (judgeFeats).
export function builderFeatJudge(facts: BuilderFacts, prerequisites: Record<string, string>, held: string[] = []): FeatJudge {
  const kept = new Set(held.map((name) => name.trim().toLowerCase()));
  const settled = builderFeatCandidate(facts);
  const filling = builderFeatCandidate(facts, true);
  const check = (prerequisite: string, forSlot = false) => {
    const { who, waiting } = forSlot ? filling : settled;
    return checkPrerequisite(prerequisite, who, waiting);
  };
  const isHeld = (name: string) => kept.has(name.trim().toLowerCase());
  return {
    check,
    held: isHeld,
    checkFeat: (name) => {
      if (isHeld(name)) {
        return null;
      }
      const prerequisite = authoredFeatPrerequisite(name) ?? prerequisites[name.trim().toLowerCase()];
      return prerequisite === undefined ? null : check(prerequisite);
    },
  };
}

// The first feat of these whose prerequisite a later choice has broken, in
// words for the Continue blocker. A feat is never dropped for it: the
// player chooses whether to change the feat or what it depends on.
export function unmetFeatMessage(judge: FeatJudge | undefined | null, feats: string[]): string | null {
  for (const feat of feats) {
    const check = judge?.checkFeat(feat);
    if (check?.state === "unmet") {
      const unmet = check.requirements.filter((entry) => entry.state === "unmet").map((entry) => entry.note);
      return `${feat}: ${unmet.join("; ")}. Pick another feat, or change what it depends on.`;
    }
  }
  return null;
}
