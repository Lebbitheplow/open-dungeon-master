import { easeOrdeal } from "@/lib/dm/ordeal";
import { effectiveMaxHp, pruneMeta, removeConditions } from "@/lib/dm/condition-logic";
import type { RollResult } from "@/lib/dice";
import { RAGING } from "@/lib/srd/class-resources";
import { TENDED } from "@/lib/dm/stabilize";
import { refillResources } from "@/lib/srd/resource-refills";
import { findClass, spellSlotsFor } from "@/lib/srd";
import { isMulticlass, slotTableFor } from "@/lib/srd/multiclass";
import { settlePreparation } from "@/lib/srd/spell-prep";
import { attunementProblem } from "@/lib/srd/magic-items";
import type { CharacterSheet, FullPatchSheetInput, HitDicePool } from "@/lib/schemas/sheet";

// Pure 5e rest math, database-free so scripts/test-rest-logic.mjs can
// exercise it directly.

// Recover `count` spent dice into per-class pools, biggest die first (the
// kindest deterministic order). Returns fresh pool objects.
function recoverPools(pools: HitDicePool[], count: number): HitDicePool[] {
  const next = pools.map((pool) => ({ ...pool }));
  const byDie = [...next].sort((a, b) => Number(b.die.slice(1)) - Number(a.die.slice(1)));
  let remaining = count;
  while (remaining > 0) {
    const pool = byDie.find((candidate) => candidate.spent > 0);
    if (!pool) {
      break;
    }
    pool.spent -= 1;
    remaining -= 1;
  }
  return next;
}

// Long rest: full HP, temp HP gone, dying/concentration cleared, all spell
// slots back to the class table, spells chosen for preparation now prepared,
// half the total hit dice (minimum 1) recovered, and one level of exhaustion
// removed. Who may take one (alive, at least 1 hit point, none in the last
// 24 hours) is the caller's to decide (rest-tools.ts).
// `keepExhaustion`: a character going without food or water under the
// supplies variant sleeps without losing a level (src/lib/dm/supplies.ts).
export function longRestPatch(
  sheet: CharacterSheet,
  options: { keepExhaustion?: boolean } = {},
): FullPatchSheetInput {
  const recovered = Math.max(1, Math.floor(sheet.hitDice.total / 2));
  // 5e: a long rest reduces exhaustion by ONE level, not to zero. Legacy
  // string entries convert into the leveled field on the way through. The
  // level the character wakes with decides the maximum they wake at: level
  // 4 still halves it, level 3 no longer does.
  const legacyExhaustion = sheet.conditions.some((condition) =>
    condition.startsWith("exhaustion"),
  );
  const effectiveExhaustion = Math.max(sheet.exhaustion ?? 0, legacyExhaustion ? 1 : 0);
  const exhaustionAfter = options.keepExhaustion
    ? effectiveExhaustion
    : Math.max(0, effectiveExhaustion - 1);
  const patch: FullPatchSheetInput = {
    currentHp: effectiveMaxHp({ ...sheet, exhaustion: exhaustionAfter }),
    tempHp: 0,
    deathSaves: null,
    concentratingOn: null,
    // Nobody sleeps through a night still shaped or still raging.
    wildShape: null,
    // Every limited-use class resource refills on a long rest.
    resources: refillResources(sheet.resources, "long", sheet),
  };
  // Multiclass sheets recover into their per-class pools (patchSheet keeps
  // the summed hitDice mirror in sync); single-class sheets patch the
  // single field exactly as before.
  if (sheet.hitDicePools?.length) {
    patch.hitDicePools = recoverPools(sheet.hitDicePools, recovered);
  } else {
    patch.hitDice = {
      ...sheet.hitDice,
      spent: Math.max(0, sheet.hitDice.spent - recovered),
    };
  }
  // Bound creatures rest with their owner: a night restores a downed
  // companion or drake to full (a vanished familiar is already gone).
  if ((sheet.pets ?? []).some((pet) => pet.hp < pet.maxHp)) {
    patch.pets = sheet.pets.map((pet) => ({ ...pet, hp: pet.maxHp }));
  }
  if (sheet.spellcasting) {
    // Slots created by Font of Magic vanish at the end of a long rest: for
    // classes with a known slot table, any max above the table's value (or a
    // whole level the table lacks) is a created slot and is clawed back.
    // Classes without a table (custom casters) keep their maxes untouched.
    // Multiclass sheets clamp against the SHARED multiclass table instead.
    const table = isMulticlass(sheet)
      ? slotTableFor(sheet)
      : spellSlotsFor(sheet.class, sheet.level);
    const hasTable = Object.keys(table).length > 0;
    // With a table the character wakes with exactly its slots: a sheet that
    // arrived short (an older client, a level-up that sent none) is made
    // whole, and a slot the table does not give is taken back.
    const rested = hasTable
      ? Object.entries(table).map(([level, max]): [string, { max: number; used: number }] => [
          level,
          { max, used: 0 },
        ])
      : Object.entries(sheet.spellcasting.slots).map(
          ([level, slot]): [string, { max: number; used: number }] => [
            level,
            { max: slot.max, used: 0 },
          ],
        );
    // The night is also when a prepared caster's new choices take hold:
    // spells waiting in `pending` become prepared (spell-prep.ts).
    patch.spellcasting = {
      ...settlePreparation(sheet.spellcasting),
      slots: Object.fromEntries(rested.filter(([, slot]) => slot.max > 0)),
      // Pact Magic comes back with the night too.
      ...(sheet.spellcasting.pact
        ? { pact: { ...sheet.spellcasting.pact, used: 0 } }
        : {}),
    };
  }
  if (effectiveExhaustion > 0 || legacyExhaustion) {
    patch.exhaustion = exhaustionAfter;
    if (legacyExhaustion) {
      patch.conditions = sheet.conditions.filter(
        (condition) => !condition.startsWith("exhaustion"),
      );
      patch.conditionMeta = pruneMeta(patch.conditions, sheet.conditionMeta);
    }
  }
  // A Healer's kit may tend a creature again after a rest (stabilize.ts).
  {
    const tendedBefore = patch.conditions ?? sheet.conditions;
    if (tendedBefore.some((condition) => condition.toLowerCase() === TENDED)) {
      const cleared = removeConditions(tendedBefore, patch.conditionMeta ?? sheet.conditionMeta, [TENDED]);
      patch.conditions = cleared.conditions;
      patch.conditionMeta = cleared.meta;
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
  // Coming back from the dead eases by one a night (src/lib/dm/ordeal.ts).
  const eased = easeOrdeal(patch.conditions ?? sheet.conditions);
  if (eased.join("|") !== (patch.conditions ?? sheet.conditions).join("|")) {
    patch.conditions = eased;
    patch.conditionMeta = pruneMeta(eased, patch.conditionMeta ?? sheet.conditionMeta);
  }
  return patch;
}

// Whether this character's spell slots come back on a SHORT rest. Warlock
// Pact Magic does; every other caster waits for the night. Missing this is
// why a warlock played at roughly half their intended power: longRestPatch
// refilled their slots and nothing else ever did.
// A single-class warlock stores pact slots in `slots`, so the whole field
// refills; a multiclass sheet tracks pact apart (spellcasting.pact) and
// only that refills, never the shared pool.
export function slotsRefillOnShortRest(
  sheet: Pick<CharacterSheet, "class"> & { classes?: CharacterSheet["classes"] },
): boolean {
  if (sheet.classes && sheet.classes.length > 1) {
    return false;
  }
  return findClass(sheet.class)?.casterType === "pact";
}

// Short rest: short-recharge resources (Ki, Second Wind, Action Surge,
// Channel Divinity, Wild Shape...) refill, and a pact caster's slots come
// back with them. Returns null when nothing changes so callers can skip the
// write.
export function shortRestResourcePatch(sheet: CharacterSheet): FullPatchSheetInput | null {
  // With the sheet, a counter's refill reads its level (Font of Inspiration).
  const next = refillResources(sheet.resources, "short", sheet);
  const changed = Object.entries(next).some(
    ([id, state]) => state.used !== sheet.resources?.[id]?.used,
  );
  const patch: FullPatchSheetInput = {};
  if (changed) {
    patch.resources = next;
  }
  if (sheet.spellcasting?.pact && sheet.spellcasting.pact.used > 0) {
    // Multiclass warlock: the pact slots refill, the shared pool does not.
    patch.spellcasting = {
      ...sheet.spellcasting,
      pact: { ...sheet.spellcasting.pact, used: 0 },
    };
  } else if (sheet.spellcasting && slotsRefillOnShortRest(sheet)) {
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
  const ceiling = effectiveMaxHp(sheet);
  if (!available || sheet.currentHp <= 0 || sheet.currentHp >= Math.ceil(ceiling / 2)) {
    return 0;
  }
  const dieAverage = (Number(sheet.hitDice.die.slice(1)) + 1) / 2;
  const perDie = Math.max(1, dieAverage + conMod);
  const missing = Math.ceil(ceiling / 2) - sheet.currentHp;
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

// Which dice a short-rest spend actually draws: biggest die first from the
// per-class pools on a multiclass sheet (matching how patchSheet reconciles
// the spent counter), the single die type otherwise.
export function shortRestDicePlan(
  sheet: Pick<CharacterSheet, "hitDice"> & { hitDicePools?: CharacterSheet["hitDicePools"] },
  count: number,
): Array<{ die: string; count: number }> {
  if (count < 1) {
    return [];
  }
  if (!sheet.hitDicePools?.length) {
    return [{ die: sheet.hitDice.die, count }];
  }
  const byDie = [...sheet.hitDicePools].sort(
    (a, b) => Number(b.die.slice(1)) - Number(a.die.slice(1)),
  );
  const plan: Array<{ die: string; count: number }> = [];
  let remaining = count;
  for (const pool of byDie) {
    const take = Math.min(Math.max(0, pool.total - pool.spent), remaining);
    if (take > 0) {
      const existing = plan.find((entry) => entry.die === pool.die);
      if (existing) {
        existing.count += take;
      } else {
        plan.push({ die: pool.die, count: take });
      }
      remaining -= take;
    }
    if (!remaining) {
      break;
    }
  }
  return plan;
}

// Dice expression for a mixed-die plan: every die still adds the CON mod.
export function hitDicePlanExpression(
  plan: Array<{ die: string; count: number }>,
  conMod: number,
): string {
  const dice = plan.map((entry) => `${entry.count}${entry.die}`).join("+");
  const total = plan.reduce((sum, entry) => sum + entry.count, 0);
  const flat = conMod * total;
  if (flat > 0) {
    return `${dice}+${flat}`;
  }
  if (flat < 0) {
    return `${dice}-${Math.abs(flat)}`;
  }
  return dice;
}

// What a rolled short rest heals. Each hit die heals its face plus the
// Constitution modifier, and never less than 0 for that die (SRD 5.1, Short
// Rest), so a low die cannot eat into a high one. The Song of Rest die, when
// the roll carries one, is the last dice term and lands whole: it adds no
// Constitution and nothing is taken from it.
export function hitDiceHealing(
  outcome: Pick<RollResult, "terms">,
  conMod: number,
  // How many extra dice ride at the end of the expression, outside the
  // Constitution modifier: Song of Rest's, Chef's.
  extraDice: boolean | number,
): number {
  const diceTerms = outcome.terms.filter((term) => term.kind === "dice");
  const count = typeof extraDice === "number" ? extraDice : extraDice ? 1 : 0;
  let extra = 0;
  for (let index = 0; index < count; index += 1) {
    const term = diceTerms.pop();
    extra += term && term.kind === "dice" ? term.subtotal : 0;
  }
  const fromDice = diceTerms
    .flatMap((term) => (term.kind === "dice" ? term.dice : []))
    .filter((die) => die.kept)
    .reduce((sum, die) => sum + Math.max(0, die.value + conMod), 0);
  return fromDice + extra;
}

// Attuning takes a short rest spent with the item (SRD 5.1, Attunement), so
// a rest turns each item waiting as `attuning` into an attuned one, in pack
// order, while the rules still allow it (three at most, one copy, who the
// item names). One the rules no longer allow simply stops waiting. Null when
// nothing waits.
export function settleAttuning(sheet: CharacterSheet): FullPatchSheetInput | null {
  if (!sheet.equipment.some((item) => item.attuning)) {
    return null;
  }
  let pack = sheet.equipment.map((item) => ({ ...item }));
  for (let index = 0; index < pack.length; index += 1) {
    const item = pack[index];
    if (!item.attuning) {
      continue;
    }
    const others = pack.map((entry, at) => (at === index ? entry : { ...entry, attuning: false }));
    const allowed = attunementProblem(item, others.filter((entry) => entry.attuned || entry === item), sheet) === null;
    const { attuning: _pending, ...rest } = item;
    void _pending;
    pack = pack.map((entry, at) => (at === index ? (allowed ? { ...rest, attuned: true } : rest) : entry));
  }
  return { equipment: pack };
}
