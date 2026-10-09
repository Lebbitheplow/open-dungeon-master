import { isValidExpression } from "@/lib/dice";
import type { OnHitRider, RoutineStep, TypedDice } from "@/lib/bestiary/attack-text";
import type { EnemyAttack, SaveAbility } from "@/lib/bestiary/statblock";
import type {
  MonsterAbility,
  MonsterSpell,
  MonsterSpellcasting,
  Regeneration,
} from "@/lib/dm/monster-abilities";

// The parts of a stat block the engine runs beyond the six numbers and the
// attack names: an attack's reach, range, rider dice and on-hit effect; the
// actions with a DC and dice (a breath weapon, a legendary action's cost);
// the spellcasting a block prints; Regeneration; and the Multiattack
// routine. parseMonster (statblock.ts) reads all of these out of a pack row,
// and a hand-built monster stored them too, but the draft boundary
// (monster-draft.ts) used to keep only name, bonus, dice and type, so a
// monster started from an owlbear lost its routine and one started from a
// dragon lost its breath. Each field here is checked the way the attack's
// own dice are: refused when the dice engine could not roll it, clamped when
// it is only a number out of range, and dropped when it says nothing.
//
// Pure: no DB and no I/O, so scripts/test-monster-draft.mjs and the
// workshop fidelity suite drive it directly.

type Raw = Record<string, unknown>;

export const BLOCK_LIMITS = {
  riders: 4,
  specials: 16,
  specialName: 120,
  conditionName: 40,
  spells: 40,
  spellName: 60,
  routines: 4,
  routineSteps: 6,
  stoppedBy: 13,
  damageType: 40,
} as const;

export const SAVE_ABILITY_IDS: readonly SaveAbility[] = ["str", "dex", "con", "int", "wis", "cha"];
const MODES = ["melee", "ranged", "both"] as const;
const SIZE_WORDS = ["Tiny", "Small", "Medium", "Large", "Huge", "Gargantuan"] as const;

function num(value: unknown): number | null {
  const number =
    typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isFinite(number) ? number : null;
}

function clamp(value: unknown, min: number, max: number): number | null {
  const number = num(value);
  return number === null ? null : Math.min(max, Math.max(min, Math.round(number)));
}

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function ability(value: unknown): SaveAbility | null {
  return SAVE_ABILITY_IDS.includes(value as SaveAbility) ? (value as SaveAbility) : null;
}

function dice(value: unknown): string | null {
  const expression = String(value ?? "").replace(/\s+/g, "");
  return expression && isValidExpression(expression) ? expression : null;
}

export type Checked<T> = { value: T } | { error: string };

// ---- an attack's printed extras ----

function checkRiders(raw: unknown, attack: string): Checked<TypedDice[]> {
  const out: TypedDice[] = [];
  for (const entry of Array.isArray(raw) ? raw.slice(0, BLOCK_LIMITS.riders) : []) {
    const source = (entry ?? {}) as Raw;
    const rolled = dice(source.dice);
    if (!rolled) {
      return { error: `${attack}: "${String(source.dice ?? "")}" is not rider dice the table can roll.` };
    }
    out.push({ dice: rolled, type: text(source.type, BLOCK_LIMITS.damageType).toLowerCase() || "untyped" });
  }
  return { value: out };
}

function checkOnHit(raw: unknown, attack: string): Checked<OnHitRider | null> {
  if (!raw || typeof raw !== "object") {
    return { value: null };
  }
  const source = raw as Raw;
  const rider: OnHitRider = {};
  const save = ability(source.save);
  if (save) {
    rider.save = save;
    rider.dc = clamp(source.dc, 1, 30) ?? 10;
  }
  const condition = text(source.condition, BLOCK_LIMITS.conditionName).toLowerCase();
  if (condition) {
    rider.condition = condition;
  }
  const also = text(source.alsoCondition, BLOCK_LIMITS.conditionName).toLowerCase();
  if (also) {
    rider.alsoCondition = also;
  }
  if (source.damage !== undefined && source.damage !== "") {
    const rolled = dice(source.damage);
    if (!rolled) {
      return { error: `${attack}: "${String(source.damage)}" is not on-hit damage the table can roll.` };
    }
    rider.damage = rolled;
    rider.damageType = text(source.damageType, BLOCK_LIMITS.damageType).toLowerCase() || "untyped";
    if (source.halfOnSave === true) {
      rider.halfOnSave = true;
    }
  }
  const escape = clamp(source.escapeDc, 1, 30);
  if (escape !== null) {
    rider.escapeDc = escape;
  }
  const rounds = clamp(source.rounds, 1, 14_400);
  if (rounds !== null) {
    rider.rounds = rounds;
  }
  if (source.repeatSave === true) {
    rider.repeatSave = true;
  }
  const sizeWord = text(source.maxSize, 20).toLowerCase();
  const maxSize = SIZE_WORDS.find((size) => size.toLowerCase() === sizeWord);
  if (maxSize) {
    rider.maxSize = maxSize;
  }
  return { value: Object.keys(rider).length ? rider : null };
}

// The printed half of an attack line, kept beside the four fields
// checkAttack already holds. Reach and range are in feet; a reach is a
// multiple of five, a long range never shorter than the normal one.
export function checkAttackExtras(raw: Raw, attack: string): Checked<Partial<EnemyAttack>> {
  const out: Partial<EnemyAttack> = {};
  const mode = MODES.find((entry) => entry === raw.mode);
  if (mode) {
    out.mode = mode;
  }
  if (raw.spellAttack === true) {
    out.spellAttack = true;
  }
  const reach = clamp(raw.reach, 5, 60);
  if (reach !== null) {
    out.reach = Math.max(5, Math.round(reach / 5) * 5);
  }
  const range = (raw.range ?? null) as Raw | null;
  if (range && typeof range === "object") {
    const normal = clamp(range.normal, 5, 1_000);
    if (normal !== null) {
      out.range = { normal, long: Math.max(normal, clamp(range.long, 5, 2_000) ?? normal) };
    }
  }
  const riders = checkRiders(raw.riders, attack);
  if ("error" in riders) {
    return riders;
  }
  if (riders.value.length) {
    out.riders = riders.value;
  }
  const onHit = checkOnHit(raw.onHit, attack);
  if ("error" in onHit) {
    return onHit;
  }
  if (onHit.value) {
    out.onHit = onHit.value;
  }
  return { value: out };
}

// ---- actions and traits with numbers ----

export function checkSpecials(raw: unknown): Checked<MonsterAbility[]> {
  const out: MonsterAbility[] = [];
  for (const entry of Array.isArray(raw) ? raw.slice(0, BLOCK_LIMITS.specials) : []) {
    const source = (entry ?? {}) as Raw;
    const name = text(source.name, BLOCK_LIMITS.specialName);
    if (!name) {
      continue;
    }
    const ability: MonsterAbility = { name };
    const recharge = clamp(source.recharge, 2, 6);
    if (recharge !== null) {
      ability.recharge = recharge;
    }
    const perDay = clamp(source.perDay, 1, 9);
    if (perDay !== null) {
      ability.perDay = perDay;
    }
    if (source.perRest === true) {
      ability.perRest = true;
    }
    const cost = clamp(source.legendaryCost, 1, 3);
    if (cost !== null) {
      ability.legendaryCost = cost;
    }
    const save = SAVE_ABILITY_IDS.includes(source.save as SaveAbility) ? (source.save as SaveAbility) : null;
    if (save) {
      ability.save = save;
    }
    const dc = clamp(source.dc, 1, 30);
    if (dc !== null) {
      ability.dc = dc;
    }
    if (source.damage !== undefined && source.damage !== "") {
      const rolled = dice(source.damage);
      if (!rolled) {
        return { error: `${name}: "${String(source.damage)}" is not damage the table can roll.` };
      }
      ability.damage = rolled;
      ability.damageType = text(source.damageType, BLOCK_LIMITS.damageType).toLowerCase() || "untyped";
    }
    if (source.halfOnSave === true) {
      ability.halfOnSave = true;
    }
    const condition = text(source.condition, BLOCK_LIMITS.conditionName).toLowerCase();
    if (condition) {
      ability.condition = condition;
    }
    const rounds = clamp(source.rounds, 1, 14_400);
    if (rounds !== null) {
      ability.rounds = rounds;
    }
    if (source.repeatSave === true) {
      ability.repeatSave = true;
    }
    if (source.magical === true) {
      ability.magical = true;
    }
    out.push(ability);
  }
  return { value: out };
}

// ---- spellcasting ----

export function checkSpellcasting(raw: unknown): MonsterSpellcasting | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const source = raw as Raw;
  const slots: Record<string, number> = {};
  for (const [level, count] of Object.entries((source.slots ?? {}) as Raw)) {
    const at = clamp(level, 1, 9);
    const many = clamp(count, 0, 9);
    if (at !== null && many) {
      slots[String(at)] = many;
    }
  }
  const spells: MonsterSpell[] = [];
  const seen = new Set<string>();
  for (const entry of Array.isArray(source.spells) ? source.spells.slice(0, BLOCK_LIMITS.spells) : []) {
    const row = (entry ?? {}) as Raw;
    const name = text(row.name, BLOCK_LIMITS.spellName);
    const key = name.toLowerCase();
    if (!name || seen.has(key)) {
      continue;
    }
    seen.add(key);
    const level = row.level === null ? null : (clamp(row.level, 0, 9) ?? null);
    const perDay = clamp(row.perDay, 1, 9);
    spells.push({ name, level, ...(perDay !== null ? { perDay } : {}) });
  }
  const dc = clamp(source.dc, 1, 30);
  const attack = clamp(source.attack, -5, 20);
  // A trait that prints its DC but no list ("can innately cast heat metal")
  // still gives the save its number.
  if (!spells.length && !Object.keys(slots).length && dc === null && attack === null) {
    return null;
  }
  const casting: MonsterSpellcasting = { slots, spells };
  if (dc !== null) {
    casting.dc = dc;
  }
  if (attack !== null) {
    casting.attack = attack;
  }
  const castWith = ability(source.ability);
  if (castWith) {
    casting.ability = castWith;
  }
  const casterLevel = clamp(source.casterLevel, 1, 20);
  if (casterLevel !== null) {
    casting.casterLevel = casterLevel;
  }
  return casting;
}

// ---- regeneration ----

export function checkRegeneration(raw: unknown): Regeneration | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const source = raw as Raw;
  const amount = clamp(source.amount, 1, 100);
  if (amount === null) {
    return null;
  }
  const stoppedBy = Array.isArray(source.stoppedBy)
    ? [...new Set(source.stoppedBy.map((type) => text(type, BLOCK_LIMITS.damageType).toLowerCase()).filter(Boolean))].slice(
        0,
        BLOCK_LIMITS.stoppedBy,
      )
    : [];
  return { amount, stoppedBy, ...(source.diesOnlyAtTurnStart === true ? { diesOnlyAtTurnStart: true } : {}) };
}

// ---- the multiattack routine ----

// Each step names one of the block's own attacks; a step naming none is
// dropped, because the engine would have nothing to swing.
export function checkRoutines(raw: unknown, attacks: EnemyAttack[]): RoutineStep[][] {
  const names = new Set(attacks.map((attack) => attack.name.toLowerCase()));
  const out: RoutineStep[][] = [];
  for (const routine of Array.isArray(raw) ? raw.slice(0, BLOCK_LIMITS.routines) : []) {
    const steps: RoutineStep[] = [];
    for (const entry of Array.isArray(routine) ? routine.slice(0, BLOCK_LIMITS.routineSteps) : []) {
      const source = (entry ?? {}) as Raw;
      const attack = text(source.attack, 60);
      if (!attack || !names.has(attack.toLowerCase())) {
        continue;
      }
      steps.push({ attack, count: clamp(source.count, 1, 10) ?? 1, ...(source.ifHit === true ? { ifHit: true } : {}) });
    }
    if (steps.length) {
      out.push(steps);
    }
  }
  return out;
}
