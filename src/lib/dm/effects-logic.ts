// Active effects: one place for every modifier currently riding on a
// combatant, whatever put it there.
//
// SCOPE, said plainly. The plan asked for one `active_effects` table that
// `srd/condition-effects.ts` and `srd/feature-effects.ts` both resolve
// through, and called it the largest item in the phase. Those two modules are
// not duplicated logic that has drifted: they are two static CATALOGS, one of
// the 5e conditions and one of class and racial features, each about a
// thousand lines and each covered by its own tests. Rewiring them to read
// their own contents out of a runtime table would be a demolition with no
// user-visible gain, so it is not what this does, and the plan's own note to
// scope it separately still stands.
//
// What was actually missing is the INSTANCE layer, which is where all three
// of the plan's stated benefits live: a DM had no way to say "-2 to their
// saves until dawn" without inventing a fake condition, the AI had nowhere to
// reason about stacking, and nothing could express a modifier with a duration
// that was not a condition. That is what this is. The two catalogs keep
// resolving exactly as they do; an active effect is a third source of
// modifiers that the same resolvers add in, and it is the only one a person
// can create at the table.
//
// Pure by design: no imports beyond types, so scripts/test-active-effects.mjs can
// load it and the console can preview a stack before applying it.

import type { ToolError } from "@/lib/dm/tool-errors";

// What an effect can modify. Every one of these corresponds to a number the
// engine already computes, so an effect can never claim to change something
// nothing reads.
export const EFFECT_FIELDS = [
  "ac",
  "attack",
  "damage",
  "save",
  "check",
  "initiative",
  "speed",
  "maxHp",
] as const;
export type EffectField = (typeof EFFECT_FIELDS)[number];

export const EFFECT_FIELD_LABELS: Record<EffectField, string> = {
  ac: "Armor Class",
  attack: "Attack rolls",
  damage: "Damage rolls",
  save: "Saving throws",
  check: "Ability checks",
  initiative: "Initiative",
  speed: "Speed",
  maxHp: "Maximum hit points",
};

// How a modifier combines with the others on the same field.
//
// "add" sums, because two separate bonuses to the same roll are two bonuses.
// "override" wins outright and the largest override wins among themselves,
// which is how 5e handles a set-to value like Barkskin's AC 16.
// "advantage" and "disadvantage" do not stack at all in 5e: any number of
// each collapses to one, and one of each cancels. That rule is why they are
// modes here rather than numbers.
export const EFFECT_MODES = ["add", "override", "advantage", "disadvantage"] as const;
export type EffectMode = (typeof EFFECT_MODES)[number];

// What each field's engine reads, so the editor offers nothing that does
// nothing: a set-to value is Armor Class's and speed's; advantage belongs to
// the d20 rolls; damage and the maximum move by an amount. A creature rolls
// no initiative once the fight it is in has begun.
export const FIELD_MODES: Record<EffectField, readonly EffectMode[]> = {
  ac: ["add", "override"],
  attack: ["add", "advantage", "disadvantage"],
  damage: ["add"],
  save: ["add", "advantage", "disadvantage"],
  check: ["add", "advantage", "disadvantage"],
  initiative: ["add", "advantage", "disadvantage"],
  speed: ["add", "override"],
  maxHp: ["add"],
};
const MODE_WORDS: Record<EffectMode, string> = { add: "an amount", override: "a set-to value", advantage: "advantage", disadvantage: "disadvantage" };

export type EffectModifier = {
  field: EffectField;
  mode: EffectMode;
  // Only read for "add" and "override".
  value: number;
};

// When an effect ends.
//
// "rounds" and "minutes" are one lifetime counted in two units, on one clock
// at a time, as timed conditions are: in a fight the round wrap counts it (a
// round off a "rounds" effect each wrap, a minute off a "minutes" one every
// tenth), and outside one the in-world clock does (src/lib/dm/calendar.ts),
// ten rounds to the minute. A "rounds" effect that outlasts the fight wears
// off on the road, and "for an hour" ends mid-fight when the hour is up.
// "encounter" ends when the fight does. "manual" never expires on its own,
// for a curse that needs lifting.
export const EFFECT_DURATIONS = ["rounds", "minutes", "encounter", "manual"] as const;
export type EffectDuration = (typeof EFFECT_DURATIONS)[number];

export const TARGET_KINDS = ["character", "enemy"] as const;
export type EffectTargetKind = (typeof TARGET_KINDS)[number];

export const EFFECT_NAME_MAX = 60;
export const MAX_MODIFIERS = 6;
export const MAX_EFFECT_VALUE = 30;
export const MAX_EFFECT_ROUNDS = 1000;

export const AURA_TONES = ["ward", "harm", "bless", "neutral"] as const;
export type AuraTone = (typeof AURA_TONES)[number];
export type EffectAura = { radiusFeet: number; tone: AuraTone };

export function normalizeAura(raw: unknown): EffectAura | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const record = raw as Record<string, unknown>;
  const radius = Number(record.radiusFeet);
  if (!Number.isFinite(radius) || radius <= 0) {
    return undefined;
  }
  const tone = AURA_TONES.includes(record.tone as AuraTone) ? (record.tone as AuraTone) : "neutral";
  return { radiusFeet: Math.min(120, Math.round(radius / 5) * 5 || 5), tone };
}

export type ActiveEffect = {
  id: string;
  campaignId: string;
  targetKind: EffectTargetKind;
  targetId: string;
  name: string;
  // Where it came from, in words: "Bless (Aldric)", "the cursed ring", "the
  // DM". Shown to whoever can see the effect, so it is never a mystery why a
  // number moved.
  source: string;
  modifiers: EffectModifier[];
  // An effect that reaches around its target, drawn as a ring on the board
  // (docs/vtt-parity-implementation-plan.md section 1.1). Absent for the
  // ordinary effect that touches one creature.
  aura?: EffectAura;
  duration: EffectDuration;
  // Rounds left, for "rounds". Minutes left, for "minutes". Ignored
  // otherwise.
  remaining: number;
  // Optional save to shake it off, rolled at the end of each of the target's
  // turns exactly as a save-ends condition is (src/lib/dm/effect-saves.ts),
  // and once per stretch of in-world time outside a fight.
  saveAbility: string;
  saveDc: number;
  // Shown to the players. Off means only the DM and the AI see it, which is
  // the right default for a curse nobody has noticed yet.
  visible: boolean;
  createdAt: string;
};

export type EffectInput = {
  name: string;
  source?: string;
  modifiers: Array<{ field: unknown; mode?: unknown; value?: unknown }>;
  duration?: unknown;
  remaining?: unknown;
  saveAbility?: unknown;
  saveDc?: unknown;
  visible?: unknown;
  // Who it lands on: an enemy's initiative is already rolled.
  targetKind?: EffectTargetKind;
};

const ABILITIES = ["str", "dex", "con", "int", "wis", "cha"];

// Validating what a form or a tool call sent. Returns an error string rather
// than throwing, because every caller is a route or a tool handler that has
// to say what went wrong.
export function checkEffect(input: EffectInput): { effect: Omit<ActiveEffect, "id" | "campaignId" | "targetKind" | "targetId" | "createdAt"> } | ToolError {
  const name = String(input.name ?? "").trim().slice(0, EFFECT_NAME_MAX);
  if (!name) {
    return { error: "Name the effect.", retry: true };
  }
  if (!Array.isArray(input.modifiers) || !input.modifiers.length) {
    return { error: "An effect has to change at least one thing.", retry: true };
  }
  if (input.modifiers.length > MAX_MODIFIERS) {
    return { error: `An effect changes at most ${MAX_MODIFIERS} things; split it in two.`, retry: true };
  }

  const modifiers: EffectModifier[] = [];
  for (const raw of input.modifiers) {
    const field = String(raw?.field ?? "") as EffectField;
    if (!EFFECT_FIELDS.includes(field)) {
      return { error: `"${raw?.field}" is not something an effect can change.`, retry: true };
    }
    const mode = (String(raw?.mode ?? "add") as EffectMode) || "add";
    if (!EFFECT_MODES.includes(mode)) {
      return { error: `"${raw?.mode}" is not add, override, advantage or disadvantage.`, retry: true };
    }
    if (!FIELD_MODES[field].includes(mode)) {
      return { error: `${EFFECT_FIELD_LABELS[field]} takes ${FIELD_MODES[field].map((entry) => MODE_WORDS[entry]).join(" or ")}, not ${MODE_WORDS[mode]}.`, retry: true };
    }
    if (field === "initiative" && input.targetKind === "enemy") {
      return { error: "An enemy's initiative is rolled as the fight begins; an effect cannot move it now.", retry: true };
    }
    let value = 0;
    if (mode === "add" || mode === "override") {
      value = Math.round(Number(raw?.value));
      if (!Number.isFinite(value) || value === 0) {
        return { error: `${EFFECT_FIELD_LABELS[field]} needs a nonzero amount.`, retry: true };
      }
      if (Math.abs(value) > MAX_EFFECT_VALUE) {
        return { error: `${MAX_EFFECT_VALUE} is as far as one effect moves a number.`, retry: true };
      }
    }
    modifiers.push({ field, mode, value });
  }

  const duration = (String(input.duration ?? "manual") as EffectDuration) || "manual";
  if (!EFFECT_DURATIONS.includes(duration)) {
    return { error: `"${input.duration}" is not rounds, minutes, encounter or manual.`, retry: true };
  }
  let remaining = 0;
  if (duration === "rounds" || duration === "minutes") {
    remaining = Math.round(Number(input.remaining));
    if (!Number.isFinite(remaining) || remaining <= 0) {
      return { error: `Say how many ${duration} it lasts.`, retry: true };
    }
    remaining = Math.min(duration === "rounds" ? MAX_EFFECT_ROUNDS : 60 * 24 * 30, remaining);
  }

  const saveAbility = String(input.saveAbility ?? "").trim().toLowerCase().slice(0, 3);
  const saveDc = Math.round(Number(input.saveDc));
  if (saveAbility && !ABILITIES.includes(saveAbility)) {
    return { error: `"${saveAbility}" is not an ability.`, retry: true };
  }
  if (saveAbility && (!Number.isFinite(saveDc) || saveDc < 1 || saveDc > 30)) {
    return { error: "A save to end needs a DC between 1 and 30.", retry: true };
  }

  return {
    effect: {
      name,
      source: String(input.source ?? "").trim().slice(0, EFFECT_NAME_MAX),
      modifiers,
      duration,
      remaining,
      saveAbility: saveAbility && Number.isFinite(saveDc) ? saveAbility : "",
      saveDc: saveAbility && Number.isFinite(saveDc) ? saveDc : 0,
      visible: input.visible === true,
    },
  };
}

// ---- resolving a stack ----

export type FieldOutcome = {
  // The summed "add" modifiers.
  bonus: number;
  // The winning "override", or null when nothing set one.
  override: number | null;
  // Net advantage state after 5e's cancellation rule.
  advantage: boolean;
  disadvantage: boolean;
  // What produced it, for the "why" the console shows next to the number.
  sources: string[];
};

export function emptyOutcome(): FieldOutcome {
  return { bonus: 0, override: null, advantage: false, disadvantage: false, sources: [] };
}

// The whole point of the instance layer: one function that answers "what is
// this creature's AC bonus right now, and why", so no caller has to walk a
// list and reimplement stacking.
export function resolveField(effects: ActiveEffect[], field: EffectField): FieldOutcome {
  const out = emptyOutcome();
  let anyAdvantage = false;
  let anyDisadvantage = false;
  for (const effect of effects) {
    for (const modifier of effect.modifiers) {
      if (modifier.field !== field) {
        continue;
      }
      const label = effect.source ? `${effect.name} (${effect.source})` : effect.name;
      if (modifier.mode === "add") {
        out.bonus += modifier.value;
        out.sources.push(`${label} ${modifier.value >= 0 ? "+" : ""}${modifier.value}`);
      } else if (modifier.mode === "override") {
        // The largest override wins, matching how 5e resolves two set-to
        // effects (Barkskin and a Mage Armor both claiming AC).
        if (out.override === null || modifier.value > out.override) {
          out.override = modifier.value;
        }
        out.sources.push(`${label} sets ${modifier.value}`);
      } else if (modifier.mode === "advantage") {
        anyAdvantage = true;
        out.sources.push(`${label} advantage`);
      } else {
        anyDisadvantage = true;
        out.sources.push(`${label} disadvantage`);
      }
    }
  }
  // 5e: any number of advantages is one advantage, any number of
  // disadvantages is one disadvantage, and one of each cancels to neither.
  out.advantage = anyAdvantage && !anyDisadvantage;
  out.disadvantage = anyDisadvantage && !anyAdvantage;
  return out;
}

// The final number for a field, given the engine's own base. An override
// replaces the base and the bonuses still apply on top, which is what a
// "+1 to your AC" ring does over a Barkskin.
export function applyField(base: number, outcome: FieldOutcome): number {
  return (outcome.override ?? base) + outcome.bonus;
}

// ---- expiry ----

export type TickResult = {
  kept: ActiveEffect[];
  // Named so the table can be told what wore off, which is the difference
  // between a number changing and a number changing for a reason.
  expired: ActiveEffect[];
};

// One round of a fight passing: a round off every "rounds" effect, and a
// minute off every "minutes" one when this round completes a minute.
// "encounter" ones end with the fight.
export function tickRound(effects: ActiveEffect[], minutePassed = false): TickResult {
  const kept: ActiveEffect[] = [];
  const expired: ActiveEffect[] = [];
  for (const effect of effects) {
    const spent = effect.duration === "rounds" ? 1 : effect.duration === "minutes" && minutePassed ? 1 : 0;
    if (!spent) {
      kept.push(effect);
      continue;
    }
    const remaining = effect.remaining - spent;
    if (remaining <= 0) {
      expired.push(effect);
    } else {
      kept.push({ ...effect, remaining });
    }
  }
  return { kept, expired };
}

// In-world minutes passing outside a fight, from travel, a rest, or
// pass_time: the minutes off a "minutes" effect, and as many rounds as they
// hold off a "rounds" one. This is what the calendar bought: before the
// clock existed, "for an hour" had nothing to count against.
export function tickMinutes(effects: ActiveEffect[], minutes: number, roundsPerMinute: number): TickResult {
  const passed = Math.max(0, Math.round(minutes));
  const kept: ActiveEffect[] = [];
  const expired: ActiveEffect[] = [];
  for (const effect of effects) {
    const spent = effect.duration === "minutes" ? passed : effect.duration === "rounds" ? passed * roundsPerMinute : 0;
    if (!spent) {
      kept.push(effect);
      continue;
    }
    const remaining = effect.remaining - spent;
    if (remaining <= 0) {
      expired.push(effect);
    } else {
      kept.push({ ...effect, remaining });
    }
  }
  return { kept, expired };
}

export function endEncounterEffects(effects: ActiveEffect[]): TickResult {
  return {
    kept: effects.filter((effect) => effect.duration !== "encounter"),
    expired: effects.filter((effect) => effect.duration === "encounter"),
  };
}

// ---- describing ----

export function describeModifier(modifier: EffectModifier): string {
  const label = EFFECT_FIELD_LABELS[modifier.field];
  if (modifier.mode === "advantage") {
    return `advantage on ${label.toLowerCase()}`;
  }
  if (modifier.mode === "disadvantage") {
    return `disadvantage on ${label.toLowerCase()}`;
  }
  if (modifier.mode === "override") {
    return `${label} becomes ${modifier.value}`;
  }
  return `${modifier.value >= 0 ? "+" : ""}${modifier.value} ${label}`;
}

export function describeDurationLeft(effect: ActiveEffect): string {
  if (effect.duration === "rounds") {
    return `${effect.remaining} ${effect.remaining === 1 ? "round" : "rounds"} left`;
  }
  if (effect.duration === "minutes") {
    return `${effect.remaining} ${effect.remaining === 1 ? "minute" : "minutes"} left`;
  }
  if (effect.duration === "encounter") {
    return "until the fight ends";
  }
  return "until removed";
}

export function describeEffect(effect: ActiveEffect): string {
  const parts = effect.modifiers.map(describeModifier).join(", ");
  const save = effect.saveAbility
    ? `, ${effect.saveAbility.toUpperCase()} DC ${effect.saveDc} to end`
    : "";
  return `${effect.name}: ${parts} (${describeDurationLeft(effect)}${save})`;
}

// What one seat may see. Same rule as everywhere else in ODM: the projection
// asks rather than the call site branching on isDm.
export function visibleEffects(effects: ActiveEffect[], secretsAllowed: boolean): ActiveEffect[] {
  return secretsAllowed ? effects : effects.filter((effect) => effect.visible);
}
