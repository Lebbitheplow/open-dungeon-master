import { pruneMeta, removeConditions } from "@/lib/dm/condition-logic";
import { RAGING, refillResources } from "@/lib/srd/class-resources";
import { findClass } from "@/lib/srd";
import type { CharacterSheet, FullPatchSheetInput } from "@/lib/schemas/sheet";

// Pure 5e rest math, database-free so scripts/test-rest-logic.mjs can
// exercise it directly.

// Long rest: full HP, temp HP gone, dying/concentration cleared, all spell
// slots back, half the total hit dice (minimum 1) recovered, and the
// exhaustion condition removed. Dead characters get nothing.
export function longRestPatch(sheet: CharacterSheet): FullPatchSheetInput {
  const recovered = Math.max(1, Math.floor(sheet.hitDice.total / 2));
  const patch: FullPatchSheetInput = {
    currentHp: sheet.maxHp,
    tempHp: 0,
    deathSaves: null,
    concentratingOn: null,
    // Nobody sleeps through a night still shaped or still raging.
    wildShape: null,
    hitDice: {
      ...sheet.hitDice,
      spent: Math.max(0, sheet.hitDice.spent - recovered),
    },
    // Every limited-use class resource refills on a long rest.
    resources: refillResources(sheet.resources, "long"),
  };
  if (sheet.spellcasting) {
    patch.spellcasting = {
      ...sheet.spellcasting,
      slots: Object.fromEntries(
        Object.entries(sheet.spellcasting.slots).map(([level, slot]) => [
          level,
          { max: slot.max, used: 0 },
        ]),
      ),
    };
  }
  // 5e: a long rest reduces exhaustion by ONE level, not to zero. Legacy
  // string entries convert into the leveled field on the way through.
  const legacyExhaustion = sheet.conditions.some((condition) =>
    condition.startsWith("exhaustion"),
  );
  const effectiveExhaustion = Math.max(sheet.exhaustion ?? 0, legacyExhaustion ? 1 : 0);
  if (effectiveExhaustion > 0 || legacyExhaustion) {
    patch.exhaustion = Math.max(0, effectiveExhaustion - 1);
    if (legacyExhaustion) {
      patch.conditions = sheet.conditions.filter(
        (condition) => !condition.startsWith("exhaustion"),
      );
      patch.conditionMeta = pruneMeta(patch.conditions, sheet.conditionMeta);
    }
  }
  // A rage never survives the night, whatever its remaining rounds said.
  const conditions = patch.conditions ?? sheet.conditions;
  if (conditions.some((condition) => condition.toLowerCase() === RAGING)) {
    const cleared = removeConditions(conditions, patch.conditionMeta ?? sheet.conditionMeta, [
      RAGING,
    ]);
    patch.conditions = cleared.conditions;
    patch.conditionMeta = cleared.meta;
  }
  return patch;
}

// Whether this character's spell slots come back on a SHORT rest. Warlock
// Pact Magic does; every other caster waits for the night. Missing this is
// why a warlock played at roughly half their intended power: longRestPatch
// refilled their slots and nothing else ever did.
export function slotsRefillOnShortRest(sheet: Pick<CharacterSheet, "class">): boolean {
  return findClass(sheet.class)?.casterType === "pact";
}

// Short rest: short-recharge resources (Ki, Second Wind, Action Surge,
// Channel Divinity, Wild Shape...) refill, and a pact caster's slots come
// back with them. Returns null when nothing changes so callers can skip the
// write.
export function shortRestResourcePatch(sheet: CharacterSheet): FullPatchSheetInput | null {
  const next = refillResources(sheet.resources, "short");
  const changed = Object.entries(next).some(
    ([id, state]) => state.used !== sheet.resources?.[id]?.used,
  );
  const patch: FullPatchSheetInput = {};
  if (changed) {
    patch.resources = next;
  }
  if (sheet.spellcasting && slotsRefillOnShortRest(sheet)) {
    const slots = Object.fromEntries(
      Object.entries(sheet.spellcasting.slots).map(([level, slot]) => [
        level,
        { max: slot.max, used: 0 },
      ]),
    );
    const slotsChanged = Object.entries(sheet.spellcasting.slots).some(
      ([, slot]) => slot.used > 0,
    );
    if (slotsChanged) {
      patch.spellcasting = { ...sheet.spellcasting, slots };
    }
  }
  return Object.keys(patch).length ? patch : null;
}

// How many hit dice a short rest should spend for a character when the
// model does not specify: enough (by average die + CON) to climb above
// half HP, bounded by what they have left.
export function defaultShortRestDice(sheet: CharacterSheet, conMod: number): number {
  const available = Math.max(0, sheet.hitDice.total - sheet.hitDice.spent);
  if (!available || sheet.currentHp <= 0 || sheet.currentHp >= Math.ceil(sheet.maxHp / 2)) {
    return 0;
  }
  const dieAverage = (Number(sheet.hitDice.die.slice(1)) + 1) / 2;
  const perDie = Math.max(1, dieAverage + conMod);
  const missing = Math.ceil(sheet.maxHp / 2) - sheet.currentHp;
  return Math.min(available, Math.max(1, Math.ceil(missing / perDie)));
}

// Dice expression for spending n hit dice: each die adds the CON modifier.
export function hitDiceExpression(die: string, count: number, conMod: number): string {
  const flat = conMod * count;
  const dice = `${count}${die}`;
  if (flat > 0) {
    return `${dice}+${flat}`;
  }
  if (flat < 0) {
    return `${dice}-${Math.abs(flat)}`;
  }
  return dice;
}
