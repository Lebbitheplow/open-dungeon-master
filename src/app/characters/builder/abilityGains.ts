import type { Ability, AsiChoice } from "@/lib/schemas/sheet";
import { ABILITY_SCORE_CAP } from "@/lib/srd/asi";
import { featAbilityIncrease } from "@/lib/srd/feat-effects";
import type { HalfFeatPick } from "@/lib/srd/legality/half-feats";
import { PRIMAL_CHAMPION_CAP } from "@/lib/srd/trait-rules";

// One step a score takes beyond the number assigned to it and the race's
// bonus (issue #149): an improvement's +2 or +1, a half-feat's point,
// Primal Champion's +4. `amount` is what it adds after the cap, and
// `capped` says the cap took some of it.
export type AbilityGain = { source: string; amount: number; capped: boolean };

export type AbilityGainsInput = {
  // The assigned score plus the race's bonus; null until one is assigned.
  start: Record<Ability, number | null>;
  // The level each improvement slot was earned at, beside its choice.
  slotLevels: readonly number[];
  choices: ReadonlyArray<AsiChoice | null>;
  // Every half-feat with its score settled (settledHalfFeats): the
  // improvements' feats first, then the race's.
  halfFeats: HalfFeatPick[];
  primalChampion: boolean;
};

const ABILITIES: Ability[] = ["str", "dex", "con", "int", "wis", "cha"];

// Each score's gains, walked in the order the server applies them
// (src/lib/srd/sheet-legality.ts): the improvements slot by slot, then the
// half-feats, then Primal Champion. `final` is then the score the sheet will
// store. A score not yet assigned still lists what it will gain, so a
// Linguist's "+1" shows before the Intelligence does.
export function abilityGains(input: AbilityGainsInput): {
  gains: Record<Ability, AbilityGain[]>;
  final: Record<Ability, number | null>;
} {
  const final = { ...input.start };
  const gains = Object.fromEntries(ABILITIES.map((ability) => [ability, [] as AbilityGain[]])) as Record<
    Ability,
    AbilityGain[]
  >;
  const add = (ability: Ability, amount: number, source: string, cap: number) => {
    const now = final[ability];
    if (now === null) {
      gains[ability].push({ source, amount, capped: false });
      return;
    }
    const next = Math.min(cap, now + amount);
    final[ability] = next;
    gains[ability].push({ source, amount: next - now, capped: next - now < amount });
  };
  input.choices.forEach((choice, index) => {
    const source = `at level ${input.slotLevels[index]}`;
    if (choice?.mode === "plus2") {
      add(choice.ability, 2, source, ABILITY_SCORE_CAP);
    } else if (choice?.mode === "plus1x2") {
      for (const ability of choice.abilities) {
        add(ability, 1, source, ABILITY_SCORE_CAP);
      }
    }
  });
  for (const pick of input.halfFeats) {
    if (pick.ability) {
      add(pick.ability, featAbilityIncrease(pick.feat)?.amount ?? 1, pick.feat, ABILITY_SCORE_CAP);
    }
  }
  if (input.primalChampion) {
    add("str", 4, "Primal Champion", PRIMAL_CHAMPION_CAP);
    add("con", 4, "Primal Champion", PRIMAL_CHAMPION_CAP);
  }
  return { gains, final };
}

// "+1 Linguist", "+2 at level 4", "+0 at level 8 (at its cap)".
export function gainLabel(gain: AbilityGain): string {
  return `+${gain.amount} ${gain.source}${gain.capped ? " (at its cap)" : ""}`;
}
