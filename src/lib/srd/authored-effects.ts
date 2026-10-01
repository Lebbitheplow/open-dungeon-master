// The authored subclass layer's mechanics, as rules the engines read.
//
// src/lib/srd/subclasses.json writes 533 subclass features in its own words;
// the audit found 166 of them stating a mechanical effect (resistance, an
// immunity, advantage, dice, a bonus action, a reaction, AC, speed, a save)
// that no engine held: the model was handed the text and nothing else. The
// tables in authored-effects-data.ts and authored-effects-data2.ts give each
// one the hook that fits, reusing the shapes the engines already read, and
// this module answers the readers:
//
//   - passive effects: pcResistances, the immunity lists, the save and
//     initiative advantages (trait-rules.ts), the derived saves, AC and speed
//     (srd/index.ts, feature-effects' speed and rider entries), the roll
//     resolver's check advantages and one-shot riders (rolls.ts), the
//     initiative refills (class-resources.ts), the bonus-action routes
//     (bonus-routes.ts, action-tools.ts) and the bonus-action attack gate
//     (pc-attack-options.ts), answered from authored-economy.ts;
//   - moments the combat engines report (src/lib/dm/authored-hooks.ts);
//   - use_resource spends (src/lib/dm/authored-spends.ts) and use_reaction
//     reactions (src/lib/dm/authored-reactions.ts).
//
// Pure and database-free, like the rest of src/lib/srd.

import { matchArmor } from "@/lib/srd/armor";
import { AUTHORED_DATA_A } from "@/lib/srd/authored-effects-data";
import { AUTHORED_DATA_A2 } from "@/lib/srd/authored-effects-data-b";
import { AUTHORED_DATA_B } from "@/lib/srd/authored-effects-data2";
import { AUTHORED_DATA_B2 } from "@/lib/srd/authored-effects-data3";
import type {
  Ability,
  AuthoredEffect,
  AuthoredEffectKind,
  AuthoredEntry,
  AuthoredReaction,
  AuthoredSpend,
  Formula,
  Gate,
} from "@/lib/srd/authored-effects-types";

export type { Ability, AuthoredEffect, AuthoredEntry, AuthoredReaction, AuthoredSpend, Formula, Gate };

export const AUTHORED_TABLE: Record<string, AuthoredEntry> = {
  ...AUTHORED_DATA_A,
  ...AUTHORED_DATA_A2,
  ...AUTHORED_DATA_B,
  ...AUTHORED_DATA_B2,
};

const lower = (value: string | undefined | null) => (value ?? "").trim().toLowerCase();

type Row = { key: string; classId: string; feature: string; entry: AuthoredEntry };
const BY_KEY = new Map<string, Row>(
  Object.entries(AUTHORED_TABLE).map(([key, entry]) => {
    const [classId, feature] = key.split("::");
    return [lower(key), { key, classId, feature, entry }];
  }),
);

export const DAMAGE_TYPES = [
  "acid", "bludgeoning", "cold", "fire", "force", "lightning", "necrotic",
  "piercing", "poison", "psychic", "radiant", "slashing", "thunder",
];

// What the readers need of a character. Every field is optional so a test
// double, the builder's preview and a full sheet all answer.
export type AuthoredSheet = {
  class?: string;
  level?: number;
  classes?: Array<{ id: string; level: number; subclass?: string }>;
  features?: Array<{ name: string; classId?: string; source?: string }>;
  conditions?: string[];
  conditionMeta?: unknown;
  equipment?: Array<{ name: string; equipped?: boolean; gear?: { armor?: { category?: string } } }>;
  concentratingOn?: string | null;
};

export type HeldAuthored = Row & { choice: string | null; level: number; name: string };

function classLevel(sheet: AuthoredSheet, classId: string): number {
  const entry = (sheet.classes ?? []).find((item) => lower(item.id) === classId);
  if (entry) {
    return entry.level;
  }
  return Math.max(1, sheet.level ?? 1);
}

// The authored features a sheet holds, each with the option chosen for it
// ("Totem Spirit (Bear)") and the level of the class that granted it.
export function heldAuthored(sheet: AuthoredSheet): HeldAuthored[] {
  const out: HeldAuthored[] = [];
  const classIds = [lower(sheet.class), ...(sheet.classes ?? []).map((entry) => lower(entry.id))].filter(Boolean);
  for (const feature of sheet.features ?? []) {
    const full = lower(feature.name);
    const chosen = /^(.*?)\s*\(([^)]+)\)\s*$/.exec(full);
    const candidates = feature.classId ? [lower(feature.classId)] : classIds;
    for (const classId of candidates) {
      const exact = BY_KEY.get(`${classId}::${full}`);
      const bare = chosen ? BY_KEY.get(`${classId}::${chosen[1]}`) : undefined;
      const row = exact ?? bare;
      if (row) {
        out.push({
          ...row,
          name: feature.name,
          choice: !exact && chosen ? chosen[2].trim().toLowerCase() : null,
          level: classLevel(sheet, classId),
        });
        break;
      }
    }
  }
  return out;
}

export function hasCondition(sheet: AuthoredSheet, name: string): boolean {
  const wanted = lower(name);
  return (sheet.conditions ?? []).some((entry) => {
    const held = lower(entry);
    return held === wanted || held.startsWith(`${wanted} (`) || held.startsWith(`${wanted}:`);
  });
}

// Heavy armor on the body, read the way the rage rule reads it: the items
// marked worn when any are, otherwise everything carried.
export function wearsHeavy(sheet: AuthoredSheet): boolean {
  const items = sheet.equipment ?? [];
  const anyExplicit = items.some((item) => item.equipped);
  return items.some((item) => {
    if (anyExplicit && !item.equipped) {
      return false;
    }
    return (item.gear?.armor?.category ?? matchArmor(item.name)?.category) === "heavy";
  });
}

export function gateHolds(gate: Gate | undefined, sheet: AuthoredSheet, held: HeldAuthored): boolean {
  if (!gate) {
    return true;
  }
  if (gate.raging && !(hasCondition(sheet, "raging") && !wearsHeavy(sheet))) {
    return false;
  }
  if (gate.heavyArmor && !wearsHeavy(sheet)) {
    return false;
  }
  if (gate.concentrating && !sheet.concentratingOn) {
    return false;
  }
  if (gate.condition && !hasCondition(sheet, gate.condition)) {
    return false;
  }
  if (gate.notCondition && hasCondition(sheet, gate.notCondition)) {
    return false;
  }
  if (gate.choice && held.choice !== lower(gate.choice)) {
    return false;
  }
  if (gate.choiceOf) {
    const other = heldAuthored(sheet).find((entry) => lower(entry.feature) === lower(gate.choiceOf!.feature));
    if (!other || other.choice !== lower(gate.choiceOf.value)) {
      return false;
    }
  }
  return true;
}

// A formula at a class level: a ladder's last row reached, a function, or an
// expression whose words ("level", "half", "prof", "wis") become numbers.
export function resolveFormula(formula: Formula, level: number, mods: Record<string, number> = {}): string {
  if (typeof formula === "function") {
    return String(formula(level, mods));
  }
  let text: string;
  if (Array.isArray(formula)) {
    text = formula[0]?.[1] ?? "0";
    for (const [atLevel, value] of formula) {
      if (level >= atLevel) {
        text = value;
      }
    }
  } else {
    text = formula;
  }
  const prof = 2 + Math.floor((Math.max(1, Math.min(20, level)) - 1) / 4);
  return text
    .replace(/\b(level|half|prof|str|dex|con|int|wis|cha)\b/g, (token) => {
      if (token === "level") return String(level);
      if (token === "half") return String(Math.floor(level / 2));
      if (token === "prof") return String(prof);
      return String(mods[token] ?? 0);
    })
    .replace(/\+\s*-/g, "-");
}

// Every passive effect of one kind that holds for the sheet now.
export function activeAuthored<K extends AuthoredEffectKind>(
  sheet: AuthoredSheet,
  kind: K,
): Array<{ effect: Extract<AuthoredEffect, { kind: K }>; held: HeldAuthored }> {
  const out: Array<{ effect: Extract<AuthoredEffect, { kind: K }>; held: HeldAuthored }> = [];
  for (const held of heldAuthored(sheet)) {
    for (const effect of held.entry.effects ?? []) {
      if (effect.kind === kind && gateHolds(effect.gate, sheet, held)) {
        out.push({ effect: effect as Extract<AuthoredEffect, { kind: K }>, held });
      }
    }
  }
  return out;
}

// ---- defenses ----

export function authoredResistances(sheet: AuthoredSheet, options: { magical?: boolean; spell?: boolean } = {}): string[] {
  const out: string[] = [];
  for (const { effect } of activeAuthored(sheet, "resist")) {
    if (effect.spells && !options.spell) {
      continue;
    }
    if (effect.nonmagical && options.magical) {
      continue;
    }
    const types = effect.types === "all" ? DAMAGE_TYPES : effect.types;
    out.push(...types.filter((type) => !(effect.except ?? []).includes(type)));
  }
  return [...new Set(out)];
}

export function authoredDamageImmunities(sheet: AuthoredSheet): string[] {
  return [...new Set(activeAuthored(sheet, "immune_damage").flatMap(({ effect }) => effect.types))];
}

export function authoredConditionImmunities(sheet: AuthoredSheet): Array<{ condition: string; because: string }> {
  return activeAuthored(sheet, "immune_condition").flatMap(({ effect, held }) =>
    effect.conditions.map((condition) => ({ condition, because: held.feature })),
  );
}

export function authoredCritImmune(sheet: AuthoredSheet): string | null {
  return activeAuthored(sheet, "crit_immune")[0]?.held.feature ?? null;
}

// ---- saves ----

export function authoredSaveAdvantages(sheet: AuthoredSheet, ability: string | undefined, against: string | undefined): string[] {
  const text = lower(against);
  const notes: string[] = [];
  for (const { effect, held } of activeAuthored(sheet, "save_adv")) {
    if (effect.ability && effect.ability !== ability) {
      continue;
    }
    if (effect.against && !(text && new RegExp(effect.against, "i").test(text))) {
      continue;
    }
    notes.push(`${held.feature}: advantage on this save`);
  }
  return notes;
}

export function authoredSaveProficiencies(sheet: AuthoredSheet): Ability[] {
  return [...new Set(activeAuthored(sheet, "save_prof").flatMap(({ effect }) => effect.abilities))];
}

// What the authored features add to one save's modifier: a flat bonus to
// every save (Durable Magic) and a swapped ability modifier when it is higher
// (Elegant Courtier).
export function authoredSaveModifier(sheet: AuthoredSheet, ability: Ability, mods: Record<string, number>): number {
  let total = 0;
  for (const { effect } of activeAuthored(sheet, "save_bonus")) {
    total += effect.amount;
  }
  for (const { effect } of activeAuthored(sheet, "save_swap")) {
    if (effect.save === ability) {
      total += Math.max(0, (mods[effect.use] ?? 0) - (mods[effect.save] ?? 0));
    }
  }
  return total;
}

// ---- AC, speed, movement ----

export function authoredAcBonus(sheet: AuthoredSheet): { bonus: number; parts: string[] } {
  let bonus = 0;
  const parts: string[] = [];
  for (const { effect, held } of activeAuthored(sheet, "ac")) {
    bonus += effect.amount;
    parts.push(`${held.feature} +${effect.amount}`);
  }
  return { bonus, parts };
}

export function authoredSpeeds(sheet: AuthoredSheet, walking: number): { fly?: number; swim?: number } {
  const out: { fly?: number; swim?: number } = {};
  for (const { effect } of activeAuthored(sheet, "move")) {
    for (const mode of ["fly", "swim"] as const) {
      const value = effect[mode];
      if (value !== undefined) {
        out[mode] = Math.max(out[mode] ?? 0, value === "walk" ? walking : value);
      }
    }
  }
  return out;
}

// ---- rolls ----

export function authoredInitiativeAdvantage(sheet: AuthoredSheet): string | null {
  const held = activeAuthored(sheet, "init_adv")[0];
  return held ? `${held.held.feature}: advantage on initiative` : null;
}

// One-shot carriers a spend left on the roller, and the features that give
// advantage on a check: what one roll of this kind gains and spends.
const ONE_SHOT_ROLLS: Array<{ condition: string; kind: "check" | "save" | "initiative"; skills?: string[]; label: string }> = [
  { condition: "vigilant blessing", kind: "initiative", label: "Vigilant Blessing" },
  { condition: "elegant maneuver", kind: "check", skills: ["acrobatics", "athletics"], label: "Elegant Maneuver" },
  { condition: "drunkard's luck (check)", kind: "check", label: "Drunkard's Luck" },
  { condition: "drunkard's luck (save)", kind: "save", label: "Drunkard's Luck" },
];
const HELD_CHECKS: Array<{ condition: string; skills: string[]; label: string }> = [
  { condition: "blessing of the trickster", skills: ["stealth"], label: "Blessing of the Trickster" },
  { condition: "visage of the astral self", skills: ["insight", "intimidation"], label: "Visage of the Astral Self" },
];

export function authoredRollRiders(
  sheet: AuthoredSheet,
  input: { kind: "check" | "save" | "initiative"; ability?: string; skill?: string; reason?: string },
): { advantage: string[]; spent: string[] } {
  const advantage: string[] = [];
  const spent: string[] = [];
  const skill = lower(input.skill);
  for (const carrier of ONE_SHOT_ROLLS) {
    if (carrier.kind !== input.kind || (carrier.skills && !carrier.skills.includes(skill))) {
      continue;
    }
    const condition = (sheet.conditions ?? []).find((entry) => lower(entry) === carrier.condition);
    if (condition) {
      advantage.push(`${carrier.label}: advantage, spent by this roll`);
      spent.push(condition);
    }
  }
  if (input.kind === "check") {
    for (const held of HELD_CHECKS) {
      if (skill && held.skills.includes(skill) && hasCondition(sheet, held.condition)) {
        advantage.push(`${held.label}: advantage`);
      }
    }
    for (const { effect, held } of activeAuthored(sheet, "check_adv")) {
      const bySkill = skill && effect.skills?.includes(skill);
      const byAbility =
        input.ability &&
        effect.abilities?.includes(input.ability as Ability) &&
        (!effect.reason || new RegExp(effect.reason, "i").test(input.reason ?? ""));
      if (bySkill || byAbility) {
        advantage.push(`${held.feature}: advantage`);
      }
    }
  }
  return { advantage, spent };
}

// ---- moments ----

// Rolling initiative gives a use back to a counter that is empty.
export function authoredInitiativeRefills(
  resources: Record<string, { max: number; used: number }> | undefined,
  sheet: AuthoredSheet,
): { resources: Record<string, { max: number; used: number }>; notes: string[] } | null {
  const next = { ...(resources ?? {}) };
  const notes: string[] = [];
  for (const { effect, held } of activeAuthored(sheet, "init_refill")) {
    const state = next[effect.resource];
    if (state && state.used >= state.max && state.max > 0) {
      next[effect.resource] = { max: state.max, used: state.max - 1 };
      notes.push(`${held.feature}: one use comes back`);
    }
  }
  return notes.length ? { resources: next, notes } : null;
}

// ---- spends and reactions ----

// The authored spend a use_resource call names, for a sheet that holds it.
// Later features win a shared name (Runic Juggernaut's Giant's Might over
// Great Stature's).
export function authoredSpendFor(sheet: AuthoredSheet, resourceName: string): { spend: AuthoredSpend; held: HeldAuthored } | null {
  const wanted = lower(resourceName);
  let found: { spend: AuthoredSpend; held: HeldAuthored } | null = null;
  for (const held of heldAuthored(sheet)) {
    for (const spend of held.entry.spends ?? []) {
      const names = [spend.name, ...(spend.aliases ?? [])].map(lower);
      if (names.includes(wanted)) {
        found = { spend, held };
      }
    }
  }
  return found;
}

export function authoredReactionNamed(name: string): { reaction: AuthoredReaction; row: Row } | null {
  const wanted = lower(name);
  for (const row of BY_KEY.values()) {
    for (const reaction of row.entry.reactions ?? []) {
      if ([reaction.name, ...(reaction.aliases ?? [])].map(lower).includes(wanted)) {
        return { reaction, row };
      }
    }
  }
  return null;
}

export function heldReaction(sheet: AuthoredSheet, name: string): { reaction: AuthoredReaction; held: HeldAuthored } | null {
  const wanted = lower(name);
  for (const held of heldAuthored(sheet)) {
    for (const reaction of held.entry.reactions ?? []) {
      if ([reaction.name, ...(reaction.aliases ?? [])].map(lower).includes(wanted)) {
        return { reaction, held };
      }
    }
  }
  return null;
}

export function authoredRows(): Row[] {
  return [...BY_KEY.values()];
}

// How GAME STATE marks a subclass feature the engine holds, so the model
// narrates its numbers from the tool results and never adds them by hand:
// "server" when a passive effect is applied, and the tool that spends it.
export function authoredFeatureTags(sheet: AuthoredSheet): Map<string, string> {
  const out = new Map<string, string>();
  for (const held of heldAuthored(sheet)) {
    const tags = [
      held.entry.effects?.length ? "server" : "",
      held.entry.spends?.length ? "use_resource" : "",
      held.entry.reactions?.length ? "use_reaction" : "",
    ].filter(Boolean);
    if (tags.length) {
      out.set(held.name, `[${tags.join(", ")}]`);
    }
  }
  return out;
}
