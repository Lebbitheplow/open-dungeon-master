// Pure condition mechanics: what each SRD condition actually does to
// attacks, checks, saves, speed, and turns, plus round/save-ends duration
// bookkeeping and resistance damage math. Database-free like
// encounter-logic.ts so scripts/test-condition-logic.mjs can exercise every
// branch; both the PC and enemy sides of combat read from this one table.

import { RAGING } from "@/lib/srd/class-resources";
import {
  conditionIncomingAttackState,
  conditionResistances,
  conditionSpeed,
} from "@/lib/srd/condition-effects";
import { defenseRiders } from "@/lib/srd/feature-effects";
import { magicItemRiders } from "@/lib/srd/magic-items";

export type AdvantageState = "none" | "advantage" | "disadvantage";
export type SaveAbilityId = "str" | "dex" | "con" | "int" | "wis" | "cha";

// Duration metadata keyed by condition name, stored NEXT TO the plain
// string conditions list (character_sheets.condition_meta_json /
// encounter_enemies.condition_meta_json) so every existing consumer of
// `conditions` keeps working on names alone.
export type ConditionMeta = {
  // Expires when the counter reaches 0 at a round wrap.
  rounds?: number;
  // Re-save at each round wrap; success ends the condition.
  saveEnds?: { ability: SaveAbilityId; dc: number };
};
export type ConditionMetaMap = Record<string, ConditionMeta>;

const INCAPACITATING = ["incapacitated", "paralyzed", "stunned", "unconscious", "petrified"];
const SPEED_ZERO = ["grappled", "restrained", ...INCAPACITATING];
const AUTO_FAIL_STR_DEX = ["paralyzed", "stunned", "unconscious", "petrified"];
// Attacks against these have advantage.
const TARGET_GRANTS_ADVANTAGE = ["restrained", "blinded", ...INCAPACITATING];
// Melee hits within 5 ft of these are automatic critical hits.
const AUTO_CRIT_TARGETS = ["paralyzed", "unconscious"];
// The attacker's own attack rolls suffer disadvantage.
const ATTACKER_DISADVANTAGE = ["prone", "restrained", "poisoned", "blinded", "frightened"];
// The Dodge action's condition: attacks against them roll at disadvantage
// and they get advantage on DEX saves. Applied by take_action
// (src/lib/dm/action-tools.ts); named here because the mechanics are here.
export const DODGING = "dodging";
// Ability checks suffer disadvantage.
const CHECK_DISADVANTAGE = ["poisoned", "frightened"];

function has(conditions: string[], names: string[]): string | null {
  const lowered = conditions.map((entry) => entry.toLowerCase());
  return names.find((name) => lowered.includes(name)) ?? null;
}

export function isIncapacitated(conditions: string[]): boolean {
  return has(conditions, INCAPACITATING) !== null;
}

// The condition that stops this combatant acting, for refusal messages.
export function incapacitatedBy(conditions: string[]): string | null {
  return has(conditions, INCAPACITATING);
}

export function effectiveSpeed(conditions: string[], baseSpeed: number): number {
  // Effect conditions adjust the speed (haste x2, longstrider +10) before
  // the hard zeroes (grappled, restrained, incapacitated) override.
  return has(conditions, SPEED_ZERO) ? 0 : conditionSpeed(conditions, baseSpeed);
}

// Merges advantage sources 5e-style: any advantage plus any disadvantage
// cancels to a straight roll, no matter how many of each.
export function mergeAdvantage(sources: AdvantageState[]): AdvantageState {
  const advantage = sources.includes("advantage");
  const disadvantage = sources.includes("disadvantage");
  if (advantage && disadvantage) {
    return "none";
  }
  return advantage ? "advantage" : disadvantage ? "disadvantage" : "none";
}

// Advantage, auto-crit, and the explanations for one attack, derived from
// both combatants' conditions plus whatever the model claimed situationally.
export function attackContext(input: {
  attackerConditions: string[];
  targetConditions: string[];
  melee: boolean;
  // Attacker within 5 ft of the target (true for resolved melee attacks).
  adjacent: boolean;
  requested: AdvantageState;
}): { advantage: AdvantageState; autoCrit: boolean; notes: string[] } {
  const sources: AdvantageState[] = [input.requested];
  const notes: string[] = [];

  const attackerDown = has(input.attackerConditions, ATTACKER_DISADVANTAGE);
  if (attackerDown) {
    sources.push("disadvantage");
    notes.push(`attacker is ${attackerDown}: disadvantage`);
  }
  if (has(input.attackerConditions, ["invisible"])) {
    sources.push("advantage");
    notes.push("attacker is invisible: advantage");
  }
  // Attacking from hiding: advantage, and the attack gives the position
  // away (the caller clears the condition).
  if (has(input.attackerConditions, ["hidden"])) {
    sources.push("advantage");
    notes.push("attacker is hidden: advantage, and the attack reveals them");
  }

  if (has(input.targetConditions, ["prone"])) {
    sources.push(input.adjacent ? "advantage" : "disadvantage");
    notes.push(
      input.adjacent ? "target is prone: advantage up close" : "target is prone: disadvantage at range",
    );
  }
  const targetOpen = has(input.targetConditions, TARGET_GRANTS_ADVANTAGE);
  if (targetOpen) {
    sources.push("advantage");
    notes.push(`target is ${targetOpen}: advantage`);
  }
  if (has(input.targetConditions, ["invisible"])) {
    sources.push("disadvantage");
    notes.push("target is invisible: disadvantage");
  }
  // Dodge only helps a target who can actually see it coming: an
  // incapacitated dodger gets nothing, per the SRD.
  if (has(input.targetConditions, [DODGING]) && !isIncapacitated(input.targetConditions)) {
    sources.push("disadvantage");
    notes.push("target is dodging: disadvantage");
  }
  // Effect conditions on the target (blur, faerie fire, protected).
  const incoming = conditionIncomingAttackState(input.targetConditions);
  sources.push(...incoming.sources);
  notes.push(...incoming.notes);

  const critName = has(input.targetConditions, AUTO_CRIT_TARGETS);
  const autoCrit = Boolean(critName && input.adjacent);
  if (autoCrit) {
    notes.push(`target is ${critName}: any hit within 5 ft is a critical hit`);
  }
  return { advantage: mergeAdvantage(sources), autoCrit, notes };
}

// Condition effects on a requested d20 roll (skill/ability checks, saves,
// initiative). autoFail covers paralyzed/stunned/unconscious STR and DEX
// saves; no dice are rolled for those.
export function rollDerivation(
  conditions: string[],
  kind: "skill_check" | "ability_check" | "saving_throw" | "initiative",
  ability?: SaveAbilityId,
): { advantage: AdvantageState; autoFail: boolean; notes: string[] } {
  const sources: AdvantageState[] = [];
  const notes: string[] = [];
  if (kind === "saving_throw") {
    if ((ability === "str" || ability === "dex") && has(conditions, AUTO_FAIL_STR_DEX)) {
      const name = has(conditions, AUTO_FAIL_STR_DEX);
      return {
        advantage: "none",
        autoFail: true,
        notes: [`${name}: automatically fails ${ability?.toUpperCase()} saves`],
      };
    }
    if (ability === "dex" && has(conditions, ["restrained"])) {
      sources.push("disadvantage");
      notes.push("restrained: disadvantage on DEX saves");
    }
    // The other half of the Dodge action.
    if (ability === "dex" && has(conditions, [DODGING]) && !isIncapacitated(conditions)) {
      sources.push("advantage");
      notes.push("dodging: advantage on DEX saves");
    }
  } else {
    const down = has(conditions, CHECK_DISADVANTAGE);
    if (down) {
      sources.push("disadvantage");
      notes.push(`${down}: disadvantage on ability checks`);
    }
  }
  // Rage: advantage on Strength checks and Strength saves (not attacks;
  // those get the damage bonus instead).
  if (ability === "str" && kind !== "initiative" && has(conditions, [RAGING])) {
    sources.push("advantage");
    notes.push("raging: advantage on Strength checks and saves");
  }
  return { advantage: mergeAdvantage(sources), autoFail: false, notes };
}

// One round-wrap tick: decrements timed conditions (0 = expired and
// removed) and lists the save-ends conditions due a new save. The caller
// rolls those saves and removes successes via removeConditions.
export function tickConditions(
  conditions: string[],
  meta: ConditionMetaMap | undefined,
): {
  conditions: string[];
  meta: ConditionMetaMap;
  expired: string[];
  savesDue: Array<{ name: string; ability: SaveAbilityId; dc: number }>;
} {
  const nextMeta: ConditionMetaMap = {};
  const expired: string[] = [];
  const savesDue: Array<{ name: string; ability: SaveAbilityId; dc: number }> = [];
  for (const name of conditions) {
    const entry = meta?.[name];
    if (!entry) {
      continue;
    }
    if (typeof entry.rounds === "number") {
      const left = entry.rounds - 1;
      if (left <= 0) {
        expired.push(name);
        continue;
      }
      nextMeta[name] = { ...entry, rounds: left };
    } else {
      nextMeta[name] = entry;
    }
    if (entry.saveEnds) {
      savesDue.push({ name, ability: entry.saveEnds.ability, dc: entry.saveEnds.dc });
    }
  }
  return {
    conditions: conditions.filter((name) => !expired.includes(name)),
    meta: nextMeta,
    expired,
    savesDue,
  };
}

// Removes named conditions and their metadata together.
export function removeConditions(
  conditions: string[],
  meta: ConditionMetaMap | undefined,
  names: string[],
): { conditions: string[]; meta: ConditionMetaMap } {
  const drop = new Set(names.map((name) => name.toLowerCase()));
  const nextMeta: ConditionMetaMap = {};
  for (const [key, value] of Object.entries(meta ?? {})) {
    if (!drop.has(key.toLowerCase())) {
      nextMeta[key] = value;
    }
  }
  return {
    conditions: conditions.filter((name) => !drop.has(name.toLowerCase())),
    meta: nextMeta,
  };
}

// Prunes metadata entries whose condition no longer exists (update_sheet
// full replacements, clear_condition fuzzy removals).
export function pruneMeta(
  conditions: string[],
  meta: ConditionMetaMap | undefined,
): ConditionMetaMap {
  const keep = new Set(conditions.map((name) => name.toLowerCase()));
  const next: ConditionMetaMap = {};
  for (const [key, value] of Object.entries(meta ?? {})) {
    if (keep.has(key.toLowerCase())) {
      next[key] = value;
    }
  }
  return next;
}

// 5e exhaustion table, as pure helpers keyed by level (0-6). Level 6 is
// death, handled by the caller through the death engine.
export function exhaustionSpeed(level: number, baseSpeed: number): number {
  if (level >= 5) {
    return 0;
  }
  if (level >= 2) {
    return Math.floor(baseSpeed / 2);
  }
  return baseSpeed;
}

export function exhaustionMaxHp(level: number, maxHp: number): number {
  return level >= 4 ? Math.max(1, Math.floor(maxHp / 2)) : maxHp;
}

// Advantage effect of exhaustion on a d20 roll: level 1+ = disadvantage on
// ability checks (and skill checks); level 3+ = disadvantage on attacks and
// saves too.
export function exhaustionRollState(
  level: number,
  kind: "skill_check" | "ability_check" | "saving_throw" | "initiative" | "attack",
): { advantage: AdvantageState; note: string | null } {
  if (level >= 3 && (kind === "saving_throw" || kind === "attack")) {
    return {
      advantage: "disadvantage",
      note: `exhaustion ${level}: disadvantage on ${kind === "attack" ? "attack rolls" : "saving throws"}`,
    };
  }
  if (level >= 1 && (kind === "skill_check" || kind === "ability_check" || kind === "initiative")) {
    return { advantage: "disadvantage", note: `exhaustion ${level}: disadvantage on ability checks` };
  }
  return { advantage: "none", note: null };
}

// One-line summary for prompts and panels.
export function describeExhaustion(level: number): string {
  const effects = [
    level >= 1 ? "disadvantage on ability checks" : null,
    level >= 2 ? "speed halved" : null,
    level >= 3 ? "disadvantage on attacks and saves" : null,
    level >= 4 ? "hit point maximum halved" : null,
    level >= 5 ? "speed 0" : null,
  ].filter(Boolean);
  return `exhaustion level ${level}${effects.length ? ` (${effects.join("; ")})` : ""}`;
}

// "fire" vs "fire; cold" / "bludgeoning, piercing, and slashing from
// nonmagical attacks": substring match on the stat-block strings. Immunity
// zeroes, resistance halves, vulnerability doubles (both = cancel).
export function damageAdjust(
  amount: number,
  type: string | undefined,
  resist: string,
  immune: string,
  vulnerable: string,
): { amount: number; note: string | null } {
  const wanted = (type ?? "").trim().toLowerCase();
  if (!wanted) {
    return { amount, note: null };
  }
  const listed = (block: string) => block.toLowerCase().includes(wanted);
  if (listed(immune)) {
    return { amount: 0, note: `immune to ${wanted} damage: no damage` };
  }
  const resisted = listed(resist);
  const vulnerableTo = listed(vulnerable);
  if (resisted && vulnerableTo) {
    return { amount, note: null };
  }
  if (resisted) {
    return { amount: Math.max(1, Math.floor(amount / 2)), note: `resistant to ${wanted} damage: halved` };
  }
  if (vulnerableTo) {
    return { amount: amount * 2, note: `vulnerable to ${wanted} damage: doubled` };
  }
  return { amount, note: null };
}

// Racial, feature, and condition-derived damage resistances a sheet
// carries, as a keyword string damageAdjust can match against.
// Conservative: only unambiguous SRD grants are recognized.
export function pcResistances(sheet: {
  race: string;
  features: Array<{ name: string }>;
  conditions?: string[];
  equipment?: Array<{ name: string; attuned?: boolean }>;
  class?: string;
  level?: number;
}): string {
  const out: string[] = [];
  const race = sheet.race.toLowerCase();
  // Typed feature effects (parsed subclass features, Heart of the Storm).
  if (sheet.class) {
    out.push(
      ...defenseRiders({
        class: sheet.class,
        level: sheet.level ?? 1,
        features: sheet.features,
      }).resistances,
    );
  }
  // Lineage traits name their resistance directly: "Fire Resistance",
  // "Celestial Resistance (necrotic and radiant)".
  const TYPES = [
    "acid", "bludgeoning", "cold", "fire", "force", "lightning", "necrotic",
    "piercing", "poison", "psychic", "radiant", "slashing", "thunder",
  ];
  for (const feature of sheet.features) {
    const name = feature.name.toLowerCase();
    if (name.includes("resistance")) {
      out.push(...TYPES.filter((type) => name.includes(type)));
    }
  }
  // Rage: resistance to the three physical damage types, for its duration.
  if (has(sheet.conditions ?? [], [RAGING])) {
    out.push("bludgeoning", "piercing", "slashing");
  }
  const featureNames = sheet.features.map((feature) => feature.name.toLowerCase());
  const hasFeature = (fragment: string) =>
    featureNames.some((name) => name.includes(fragment));
  if (race.includes("dwarf") || hasFeature("dwarven resilience")) {
    out.push("poison");
  }
  if (race.includes("stout") || hasFeature("stout resilience")) {
    out.push("poison");
  }
  if (race.includes("tiefling") || hasFeature("hellish resistance")) {
    out.push("fire");
  }
  // Effect conditions (blade ward, stoneskin) grant theirs for a duration.
  out.push(...conditionResistances(sheet.conditions ?? []));
  // Worn magic items (Ring of Resistance, resistant armor) add their types.
  if (sheet.equipment) {
    out.push(...magicItemRiders(sheet.equipment).resistances);
  }
  return [...new Set(out)].join(", ");
}
