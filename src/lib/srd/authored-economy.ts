// The authored subclass features that change the action economy: an action
// made a bonus action, a bonus-action weapon attack and when it opens, a
// Flurry of Blows with more strikes, a healing spell that heals the maximum.
// Split from authored-effects.ts, whose tables and lookups this reads. Pure
// and database-free, like the rest of src/lib/srd.

import { activeAuthored, type AuthoredSheet } from "@/lib/srd/authored-effects";

// A feature that makes this action a bonus action.
export function authoredBonusRoute(sheet: AuthoredSheet, action: string): { feature: string; ki: number } | null {
  const held = activeAuthored(sheet, "bonus_route").find(({ effect }) => effect.action === action);
  return held ? { feature: held.held.feature, ki: 0 } : null;
}

// Whether a feature grants a bonus-action weapon attack now, from what the
// turn has held: null when it may be made, else the sentence that refuses.
export function authoredBonusAttackProblem(
  sheet: AuthoredSheet,
  budget: { attacksMade: number; castThisAction?: boolean; oncePerTurn?: string[] } | null,
): { feature: string } | { refused: string } {
  const offers = activeAuthored(sheet, "bonus_attack");
  if (!offers.length) {
    return { refused: "No feature of theirs grants a bonus-action weapon attack." };
  }
  // A spell cast with the action marks the budget (cast-rules.ts turnCharge);
  // a levelled one leaves its own mark, so a cantrip is a cast without it.
  const castWithAction = Boolean(budget?.castThisAction);
  const levelled = (budget?.oncePerTurn ?? []).includes("spell:levelled");
  for (const { effect, held } of offers) {
    const ready =
      effect.after === "attack"
        ? (budget?.attacksMade ?? 0) > 0 && !castWithAction
        : effect.after === "telekinesis"
          ? /telekinesis/i.test(sheet.concentratingOn ?? "")
          : effect.after === "cantrip"
            ? castWithAction && !levelled
            : castWithAction;
    if (ready) {
      return { feature: held.feature };
    }
  }
  const first = offers[0];
  const when =
    first.effect.after === "attack"
      ? "after they take the Attack action"
      : first.effect.after === "telekinesis"
        ? "while they concentrate on telekinesis"
        : first.effect.after === "cantrip"
          ? "after they cast a cantrip with their action"
          : "after they cast a spell with their action";
  return { refused: `${first.held.feature}'s bonus-action weapon attack comes ${when}, and that has not happened this turn.` };
}

// Circle of Mortality: a healing spell this caster casts on a creature at 0
// hit points heals the maximum.
export function authoredHealMax(caster: AuthoredSheet, target: { currentHp: number }): string | null {
  const held = activeAuthored(caster, "heal_max")[0];
  return held && target.currentHp <= 0 ? held.held.feature : null;
}

export function authoredFlurryStrikes(sheet: AuthoredSheet): number | null {
  const held = activeAuthored(sheet, "flurry")[0];
  return held ? held.effect.strikes : null;
}
