// The authored subclass features whose hook is one of feature-effects.ts's
// own shapes (walking speed, an ability on initiative, a damage rider), as
// entries that table appends to its list (src/lib/srd/authored-effects.ts
// holds the data and the other readers). Kept apart so feature-effects.ts
// imports only what it reads.

import { authoredRows, resolveFormula, type Ability } from "@/lib/srd/authored-effects";

const lower = (value: string) => value.trim().toLowerCase();

// The passive effects the feature-effects table already has a shape for
// (walking speed, an ability on initiative, damage riders), as entries it
// appends to its own list. A choice-gated one answers the renamed feature
// ("transmuter's stone (speed)") only.
export function authoredFeatureDefs(): Array<{
  match: string[];
  effects: Array<
    | { kind: "speed_bonus"; amount: (level: number) => number }
    | { kind: "initiative_ability"; ability: Ability }
    | {
        kind: "weapon_damage_rider";
        dice: (level: number) => string;
        type: string;
        when: "weapon" | "melee" | "ranged";
        oncePerTurn?: boolean;
        requiresCondition?: string;
      }
  >;
  guidance: string;
}> {
  const out: ReturnType<typeof authoredFeatureDefs> = [];
  for (const row of authoredRows()) {
    for (const effect of row.entry.effects ?? []) {
      const term = lower(effect.gate?.choice ? `${row.feature} (${effect.gate.choice})` : row.feature);
      const guidance = `${row.feature}: ${effect.note ?? "the server applies it."}`;
      if (effect.kind === "speed") {
        const amount = effect.amount;
        out.push({ match: [term], effects: [{ kind: "speed_bonus", amount: () => amount }], guidance });
      } else if (effect.kind === "init_ability") {
        out.push({ match: [term], effects: [{ kind: "initiative_ability", ability: effect.ability }], guidance });
      } else if (effect.kind === "rider") {
        const dice = effect.dice;
        out.push({
          match: [term],
          effects: [
            {
              kind: "weapon_damage_rider",
              dice: (level) => resolveFormula(dice, level),
              type: effect.type,
              when: effect.when,
              ...(effect.oncePerTurn ? { oncePerTurn: true } : {}),
              ...(effect.requiresCondition ? { requiresCondition: effect.requiresCondition } : {}),
            },
          ],
          guidance,
        });
      }
    }
  }
  return out;
}

