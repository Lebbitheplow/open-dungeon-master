// What a spell's condition stops or grants, asked of the registry
// (src/lib/srd/condition-effects.ts): a lost action, a condition or damage
// type kept off, advantage on death saves, magical strikes, no casting or
// attacks, sight of the invisible, a jump multiplier, a creature beyond
// reach, and what the next attack against a target spends. Split from the
// registry file so it does not grow past reading. Pure and database-free.

import { activeConditionEffects } from "@/lib/srd/condition-effects";

// The conditions on a TARGET that the next attack against it spends
// (Guiding Bolt's advantage).
export function conditionsSpentAgainst(targetConditions: string[]): string[] {
  return activeConditionEffects(targetConditions)
    .filter(({ row }) => row.consumedAgainst)
    .map(({ condition }) => condition);
}

// The condition that costs the holder its action, or null.
export function conditionStopsAction(conditions: string[]): string | null {
  return activeConditionEffects(conditions).find(({ row }) => row.noAction)?.condition ?? null;
}

// The conditions the holder's effects keep off it, each with the effect that
// does it. `sourceType` is the creature type of whatever lays the condition
// (Protection from Evil and Good answers only some).
export function conditionGrantedImmunity(
  conditions: string[],
  wanted: string,
  sourceType?: string,
): string | null {
  const name = wanted.trim().toLowerCase().replace(/\s+/g, " ");
  const type = (sourceType ?? "").toLowerCase();
  for (const { row, condition } of activeConditionEffects(conditions)) {
    if (row.conditionImmunities?.includes(name)) {
      return condition;
    }
    const from = row.conditionImmunitiesFrom;
    if (from && type && from.conditions.includes(name) && from.types.some((entry) => type.includes(entry))) {
      return condition;
    }
  }
  return null;
}

// Damage types the holder's effects make it immune to (Heroes' Feast: poison).
export function conditionDamageImmunities(conditions: string[]): string[] {
  return [...new Set(activeConditionEffects(conditions).flatMap(({ row }) => row.damageImmunities ?? []))];
}

// The effect giving the holder advantage on death saves, or null.
export function conditionDeathSaveAdvantage(conditions: string[]): string | null {
  return activeConditionEffects(conditions).find(({ row }) => row.deathSaveAdvantage)?.condition ?? null;
}

// Whether the holder's weapon strikes are magical (Magic Weapon, Shillelagh).
export function conditionStrikesMagical(conditions: string[]): boolean {
  return activeConditionEffects(conditions).some(({ row }) => row.magicalStrikes);
}

// The effect stopping the holder from casting, or from attacking, or null.
export function conditionBlocksCasting(conditions: string[]): string | null {
  return activeConditionEffects(conditions).find(({ row }) => row.noCasting)?.condition ?? null;
}

export function conditionBlocksAttacks(conditions: string[]): string | null {
  return activeConditionEffects(conditions).find(({ row }) => row.noAttacks)?.condition ?? null;
}

// The effect that lets the holder see invisible creatures, or null; the
// truesight in feet the holder's effects give (0 for none).
export function conditionSeesInvisible(conditions: string[]): string | null {
  return activeConditionEffects(conditions).find(({ row }) => row.seesInvisible)?.condition ?? null;
}

export function conditionTruesightFeet(conditions: string[]): number {
  return activeConditionEffects(conditions).reduce((most, { row }) => Math.max(most, row.truesightFeet ?? 0), 0);
}

// What the holder's effects multiply its jump distances by (1 for none).
export function conditionJumpMultiplier(conditions: string[]): number {
  return activeConditionEffects(conditions).reduce((most, { row }) => Math.max(most, row.jumpMultiplier ?? 1), 1);
}

// The effect that puts the holder beyond reach of attacks and spells, or null.
export function conditionUntargetable(conditions: string[]): string | null {
  return activeConditionEffects(conditions).find(({ row }) => row.untargetable)?.condition ?? null;
}

// The effect that stops this kind of act this turn, or null: a lost action
// (Stinking Cloud's retching, Command's Halt) stops actions, attacks and
// casting; Gaseous Form stops attacks and casting.
export function spellTurnHold(conditions: string[], kind: string): string | null {
  const acting = kind === "action" || kind === "attack" || kind === "cast";
  for (const { row, condition } of activeConditionEffects(conditions)) {
    if ((row.noAction && acting) || (row.noAttacks && kind === "attack") || (row.noCasting && kind === "cast")) {
      return condition;
    }
  }
  return null;
}
