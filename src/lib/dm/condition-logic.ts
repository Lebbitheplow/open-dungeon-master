// Pure condition mechanics: what each SRD condition actually does to
// attacks, checks, saves, speed, and turns, plus round/save-ends duration
// bookkeeping and resistance damage math. Database-free like
// encounter-logic.ts so scripts/test-condition-logic.mjs can exercise every
// branch; both the PC and enemy sides of combat read from this one table.

import { RAGING } from "@/lib/srd/class-resources";
import { conditionIncomingAttackState, conditionSpeed } from "@/lib/srd/condition-effects";
import { conditionSeesInvisible } from "@/lib/srd/condition-effect-queries";
import { magicItemRiders, type Wearer } from "@/lib/srd/magic-items";

export {
  DAMAGE_TYPES,
  damageAdjust,
  rageApplies,
  resistsAllDamage,
  wearsHeavyArmor,
} from "@/lib/dm/damage-logic";
export { pcImmunities, pcResistances } from "@/lib/dm/pc-defenses";

export type AdvantageState = "none" | "advantage" | "disadvantage";
export type SaveAbilityId = "str" | "dex" | "con" | "int" | "wis" | "cha";

// Duration metadata keyed by condition name, stored NEXT TO the plain
// string conditions list (character_sheets.condition_meta_json /
// encounter_enemies.condition_meta_json) so every existing consumer of
// `conditions` keeps working on names alone.
export type ConditionMeta = {
  // Expires when the counter reaches 0 at a round wrap.
  rounds?: number;
  // Ends at the start of this combatant's next turn instead of by count.
  untilTurnOf?: string;
  // Ends at the END of this combatant's next turn (Stunning Strike, Guiding
  // Bolt): turnBegun is set as that turn starts, and the turn's end then
  // takes it (src/lib/dm/turn-end.ts).
  untilTurnEndOf?: string;
  turnBegun?: boolean;
  // Re-save at each round wrap; success ends the condition.
  saveEnds?: { ability: SaveAbilityId; dc: number };
  // Who or what put the condition there: the characterId or enemyId of the
  // charmer, the grappler or the source of the fear, or an engine word
  // ("stable" on the unconscious of a stabilized creature). Optional, and
  // absent on everything written before it existed.
  source?: string;
  // Rage only: the barbarian has taken damage since their last turn ended,
  // which keeps the rage going through a turn with no attack in it.
  stoked?: boolean;
  // Spell effects (src/lib/dm/spell-effects.ts): the spell that laid it
  // down and its slot, ending on damage, or a new save on damage.
  spell?: string;
  slotLevel?: number;
  endsOnDamage?: boolean;
  saveOnDamage?: { ability: SaveAbilityId; dc: number; advantage?: boolean };
  // Hunter's Mark and Hex: the enemyId of the marked creature, the only one
  // the extra die rides against.
  quarry?: string;
  // Flesh to Stone: the saves counted at the ends of the creature's turns
  // (src/lib/dm/spell-turn-end.ts).
  tally?: { passed: number; failed: number };
  // A Creation bard's inspiration die carries a mote (authored-mote.ts).
  mote?: boolean;
  // A monster's grapple: its printed escape DC (grapple.ts).
  escapeDc?: number;
};
export type ConditionMetaMap = Record<string, ConditionMeta>;

const INCAPACITATING = ["incapacitated", "paralyzed", "stunned", "unconscious", "petrified"];
// Each of these says "can't move" (or speed 0) in its own text (SRD 5.1,
// Conditions); bare "incapacitated" takes actions and reactions only.
const SPEED_ZERO = ["grappled", "restrained", "paralyzed", "stunned", "unconscious", "petrified"];
const AUTO_FAIL_STR_DEX = ["paralyzed", "stunned", "unconscious", "petrified"];
// Attacks against these have advantage. Each of them says so in its own
// text; bare "incapacitated" only takes away actions and reactions.
const TARGET_GRANTS_ADVANTAGE = [
  "restrained",
  "blinded",
  "paralyzed",
  "stunned",
  "unconscious",
  "petrified",
];
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
  // An enemy attacker's creature type (Protection from Evil and Good).
  attackerType?: string;
}): { advantage: AdvantageState; autoCrit: boolean; notes: string[] } {
  const sources: AdvantageState[] = [input.requested];
  const notes: string[] = [];

  const attackerDown = has(input.attackerConditions, ATTACKER_DISADVANTAGE);
  if (attackerDown) {
    sources.push("disadvantage");
    notes.push(`attacker is ${attackerDown}: disadvantage`);
  }
  // See Invisibility and True Seeing see the invisible (condition-effects-last.ts).
  if (has(input.attackerConditions, ["invisible"]) && !conditionSeesInvisible(input.targetConditions)) {
    sources.push("advantage");
    notes.push("attacker is invisible: advantage");
  }
  // Attacking from hiding: advantage, and the attack gives the position
  // away (the caller clears the condition).
  if (has(input.attackerConditions, ["hidden"])) {
    sources.push("advantage");
    notes.push("attacker is hidden: advantage, and the attack reveals them");
  }

  // An unconscious creature has fallen prone, whether or not anything wrote
  // the second word down.
  if (has(input.targetConditions, ["prone", "unconscious"])) {
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
  if (has(input.targetConditions, ["invisible"]) && !conditionSeesInvisible(input.attackerConditions)) {
    sources.push("disadvantage");
    notes.push("target is invisible: disadvantage");
  }
  // A hidden creature is an unseen target (SRD 5.1, Unseen Attackers and
  // Targets): the attacker is guessing where it is.
  if (has(input.targetConditions, ["hidden"])) {
    sources.push("disadvantage");
    notes.push("target is hidden: disadvantage");
  }
  // Dodge only helps a target who can actually see it coming: an
  // incapacitated dodger gets nothing, per the SRD.
  if (has(input.targetConditions, [DODGING]) && !isIncapacitated(input.targetConditions)) {
    sources.push("disadvantage");
    notes.push("target is dodging: disadvantage");
  }
  // Effect conditions on the target (blur, faerie fire, protected).
  const incoming = conditionIncomingAttackState(input.targetConditions, input.attackerType);
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
  // What the conditions alone cannot say: a raging barbarian in heavy armor
  // gets none of the rage's benefits (the caller knows what is worn).
  options?: { rageSuppressed?: boolean },
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
  if (
    ability === "str" &&
    kind !== "initiative" &&
    has(conditions, [RAGING]) &&
    !options?.rageSuppressed
  ) {
    sources.push("advantage");
    notes.push("raging: advantage on Strength checks and saves");
  }
  return { advantage: mergeAdvantage(sources), autoFail: false, notes };
}

// A round is six seconds, so in-world minutes convert to the one duration
// unit conditions are stored in. Combat ticks one round at a time; the
// clock outside combat ticks minutes * 10 (issue #30).
export const ROUNDS_PER_MINUTE = 10;
export const MAX_CONDITION_ROUNDS = 24 * 60 * ROUNDS_PER_MINUTE;

export function conditionRoundsFrom(input: {
  rounds?: number;
  minutes?: number;
  hours?: number;
}): number | undefined {
  const total =
    (input.rounds ?? 0) +
    (input.minutes ?? 0) * ROUNDS_PER_MINUTE +
    (input.hours ?? 0) * 60 * ROUNDS_PER_MINUTE;
  return total > 0 ? Math.min(MAX_CONDITION_ROUNDS, Math.round(total)) : undefined;
}

// Rounds left as people say them: "3 rounds", "45 min", "2 h 30 min".
export function describeConditionDuration(rounds: number): string {
  if (rounds < ROUNDS_PER_MINUTE) {
    return `${rounds} round${rounds === 1 ? "" : "s"}`;
  }
  const minutes = Math.ceil(rounds / ROUNDS_PER_MINUTE);
  if (minutes < 60) {
    return `${minutes} min`;
  }
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

// One tick of `by` rounds (a round wrap in combat, or the in-world clock
// moving outside it): decrements timed conditions (0 = expired and removed)
// and lists the save-ends conditions due a new save. The caller rolls those
// saves and removes successes via removeConditions.
//
// A condition bound to a turn (untilTurnOf) is not counted in rounds: in a
// fight the pointer ends it (turnBoundConditionsEnding). Time passing with no
// fight running has no turns left to wait for, so the clock passes
// endTurnBound and they end with it.
export function tickConditions(
  conditions: string[],
  meta: ConditionMetaMap | undefined,
  by = 1,
  options?: { endTurnBound?: boolean },
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
    if (entry.untilTurnOf || entry.untilTurnEndOf) {
      if (options?.endTurnBound) {
        expired.push(name);
      } else {
        nextMeta[name] = entry;
      }
      continue;
    }
    if (typeof entry.rounds === "number") {
      const left = entry.rounds - by;
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

// The conditions that end because these combatants' turns are starting:
// Dodge and Shield on the combatant itself, Protection on the ally a
// protector covered.
export function turnBoundConditionsEnding(
  conditions: string[],
  meta: ConditionMetaMap | undefined,
  combatantIds: string[],
): string[] {
  const starting = new Set(combatantIds);
  return conditions.filter((name) => {
    const bound = meta?.[name]?.untilTurnOf;
    return bound !== undefined && starting.has(bound);
  });
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

// The hit point maximum a character really has right now. The stored maxHp
// is the sheet's own number; exhaustion level 4 halves it for as long as it
// lasts. Healing, both rests and the massive damage rule all ask this, so the
// halving is decided in one place.
//
// An item that sets Constitution (an Amulet of Health) raises the maximum by
// the change in the modifier for every level, as a higher score would: the
// stored maxHp is the character's own, and the item's share is added here
// while it is worn and attuned. A caller without the scores or the gear to
// hand gets the stored number.
export function effectiveMaxHp(sheet: {
  maxHp: number;
  exhaustion?: number | null;
  level?: number;
  abilities?: Record<"str" | "dex" | "con" | "int" | "wis" | "cha", number>;
  equipment?: Array<{ name: string; equipped?: boolean; attuned?: boolean }>;
}): number {
  let max = sheet.maxHp;
  if (sheet.abilities && sheet.equipment?.length && sheet.level) {
    const set = magicItemRiders(sheet.equipment, sheet as Wearer).abilitySet.con;
    if (set && set > sheet.abilities.con) {
      const modOf = (score: number) => Math.floor((score - 10) / 2);
      max += (modOf(set) - modOf(sheet.abilities.con)) * sheet.level;
    }
  }
  return exhaustionMaxHp(sheet.exhaustion ?? 0, max);
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
