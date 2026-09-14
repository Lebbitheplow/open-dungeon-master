// The effect planner. Every visual the board plays is planned here, on the
// server, from an outcome the engine has already resolved, and sent to the
// table as one ephemeral `fx` event (docs/vtt-parity-implementation-plan.md
// section 1.3). The client never guesses: a hit flashes because pc_attack
// said hit, a fireball is orange because the spell's damage type is fire,
// and a blind roll plans nothing at all because the table may not see it.
//
// Pure by design: no imports from the database, no I/O, so
// scripts/test-fx-plan.mjs drives it directly. src/lib/dm/fx.ts is the
// thin publisher that hands a plan to the event bus.

import { damageTone } from "@/lib/battlemap/damage-palette";
import type { XY } from "@/lib/battlemap/types";

export type FxKind =
  | "attack"
  | "spell"
  | "heal"
  | "condition"
  | "death"
  | "door"
  | "hazard"
  | "template"
  | "teleport"
  | "ping"
  // A carried light burning out (docs/vtt-parity-implementation-plan.md 7.3).
  | "gutter";

export type FxOutcome = "hit" | "miss" | "crit" | "fumble" | "save" | "fail" | "half";

export type FxShape = {
  kind: "sphere" | "cone" | "line" | "cube";
  sizeFeet: number;
  tiles: XY[];
};

export type FxEvent = {
  id: string;
  kind: FxKind;
  // Tile coordinates. `to` is a list for area effects with several targets.
  from?: XY;
  to?: XY | XY[];
  // Token ids, so the renderer can jolt the right figure without a lookup.
  fromTokenId?: string;
  toTokenId?: string | string[];
  outcome?: FxOutcome;
  // Per-target outcomes for an area, parallel to `to` when it is a list.
  outcomes?: FxOutcome[];
  damageType?: string;
  // Melee or ranged decides arc versus bolt.
  ranged?: boolean;
  // Shown as a floating number. Omitted when the viewer may not see real
  // numbers; the projection decides that, not the planner (see visibleTo).
  amount?: number;
  shape?: FxShape;
  // Condition or door effects carry a word for the caption.
  label?: string;
  // Door effects: what the door became.
  state?: "open" | "closed" | "locked" | "secret" | "found";
  // A sting cue id from src/lib/ambience/catalog.ts, played once.
  sting?: string;
  // Who may see the numbers on this effect. "all" for a public roll,
  // "dm" when the roll was hidden from the table. Redacted by the
  // projection before it reaches a player (src/lib/dm/fx.ts).
  numbers: "all" | "dm";
  at: number;
};

export type RollVisibility = "public" | "dm" | "blind" | "self";

// Whether an effect may be planned at all for a roll with this visibility.
// A blind roll is one the table sees happen but not the result of, and an
// effect IS the result, so it plans nothing. A DM-only roll likewise.
export function fxAllowedFor(visibility: RollVisibility | undefined): boolean {
  return visibility === undefined || visibility === "public" || visibility === "self";
}

let counter = 0;
function fxId(prefix: string): string {
  counter = (counter + 1) % 1_000_000;
  return `${prefix}-${Date.now().toString(36)}-${counter.toString(36)}`;
}

// Attack stings by outcome and reach. All are cue ids the catalog defines.
function attackSting(outcome: FxOutcome, ranged: boolean): string {
  if (outcome === "crit") {
    return "hit_crit";
  }
  if (outcome === "miss" || outcome === "fumble") {
    return "swing_miss";
  }
  return ranged ? "hit_ranged" : "hit_melee";
}

function spellSting(damageType: string | undefined): string {
  switch (damageType) {
    case "fire":
      return "spell_fire";
    case "cold":
      return "spell_cold";
    case "lightning":
    case "thunder":
      return "spell_thunder";
    case "radiant":
      return "spell_radiant";
    case "necrotic":
    case "poison":
    case "acid":
      return "spell_dark";
    default:
      return "magic_cast";
  }
}

export type AttackPlan = {
  from: XY;
  to: XY;
  fromTokenId?: string;
  toTokenId?: string;
  hit: boolean;
  crit: boolean;
  fumble?: boolean;
  ranged?: boolean;
  damage?: number;
  damageType?: string;
  visibility?: RollVisibility;
  // True when the number is a DM secret (the target is an enemy); the
  // client strips it for seats without real enemy numbers.
  secretNumbers?: boolean;
};

// A weapon attack, PC or enemy. One effect per swing, so a multiattack
// plans three and the renderer queues them.
export function planAttackFx(input: AttackPlan): FxEvent | null {
  if (!fxAllowedFor(input.visibility)) {
    return null;
  }
  const outcome: FxOutcome = input.crit
    ? "crit"
    : input.hit
      ? "hit"
      : input.fumble
        ? "fumble"
        : "miss";
  const ranged = Boolean(input.ranged);
  return {
    id: fxId("atk"),
    kind: "attack",
    from: input.from,
    to: input.to,
    ...(input.fromTokenId ? { fromTokenId: input.fromTokenId } : {}),
    ...(input.toTokenId ? { toTokenId: input.toTokenId } : {}),
    outcome,
    ranged,
    ...(input.hit && input.damage ? { amount: input.damage } : {}),
    ...(input.damageType ? { damageType: input.damageType } : {}),
    sting: attackSting(outcome, ranged),
    numbers: input.secretNumbers ? "dm" : "all",
    at: Date.now(),
  };
}

export type SpellPlan = {
  from?: XY;
  to: XY;
  fromTokenId?: string;
  toTokenId?: string;
  // A spell attack resolves like a weapon; a save resolves save/fail/half.
  resolution: "attack" | "save" | "auto";
  hit?: boolean;
  crit?: boolean;
  saved?: boolean;
  halfOnSave?: boolean;
  damage?: number;
  damageType?: string;
  visibility?: RollVisibility;
  secretNumbers?: boolean;
};

// A single-target spell: beam in the damage colour, burst at the target.
export function planSpellFx(input: SpellPlan): FxEvent | null {
  if (!fxAllowedFor(input.visibility)) {
    return null;
  }
  let outcome: FxOutcome;
  if (input.resolution === "attack") {
    outcome = input.crit ? "crit" : input.hit ? "hit" : "miss";
  } else if (input.resolution === "save") {
    outcome = input.saved ? (input.halfOnSave && input.damage ? "half" : "save") : "fail";
  } else {
    outcome = "hit";
  }
  const landed = outcome !== "miss" && outcome !== "save";
  return {
    id: fxId("spl"),
    kind: "spell",
    ...(input.from ? { from: input.from } : {}),
    to: input.to,
    ...(input.fromTokenId ? { fromTokenId: input.fromTokenId } : {}),
    ...(input.toTokenId ? { toTokenId: input.toTokenId } : {}),
    outcome,
    ranged: true,
    ...(landed && input.damage ? { amount: input.damage } : {}),
    ...(input.damageType ? { damageType: input.damageType } : {}),
    sting: spellSting(input.damageType),
    numbers: input.secretNumbers ? "dm" : "all",
    at: Date.now(),
  };
}

export type AreaTarget = {
  at: XY;
  tokenId?: string;
  saved: boolean;
  damage?: number;
};

export type AreaPlan = {
  origin: XY;
  shape: FxShape;
  targets: AreaTarget[];
  halfOnSave: boolean;
  damageType?: string;
  visibility?: RollVisibility;
  secretNumbers?: boolean;
};

// An area spell: the template flashes outward from the origin, then each
// target shows what its save did. "half" only when the spell deals half on
// a save; a save against a no-damage-on-save spell is plain "save".
export function planAreaFx(input: AreaPlan): FxEvent | null {
  if (!fxAllowedFor(input.visibility)) {
    return null;
  }
  const outcomes: FxOutcome[] = input.targets.map((target) =>
    target.saved ? (input.halfOnSave && target.damage ? "half" : "save") : "fail",
  );
  return {
    id: fxId("area"),
    kind: "template",
    from: input.origin,
    to: input.targets.map((target) => target.at),
    toTokenId: input.targets.map((target) => target.tokenId ?? ""),
    outcomes,
    shape: input.shape,
    ...(input.damageType ? { damageType: input.damageType } : {}),
    sting: spellSting(input.damageType),
    numbers: input.secretNumbers ? "dm" : "all",
    at: Date.now(),
  };
}

export function planHealFx(input: { to: XY; toTokenId?: string; amount: number }): FxEvent {
  return {
    id: fxId("heal"),
    kind: "heal",
    to: input.to,
    ...(input.toTokenId ? { toTokenId: input.toTokenId } : {}),
    outcome: "hit",
    amount: input.amount,
    sting: "heal",
    numbers: "all",
    at: Date.now(),
  };
}

export function planConditionFx(input: {
  to: XY;
  toTokenId?: string;
  condition: string;
  applied: boolean;
}): FxEvent {
  return {
    id: fxId("cond"),
    kind: "condition",
    to: input.to,
    ...(input.toTokenId ? { toTokenId: input.toTokenId } : {}),
    outcome: input.applied ? "fail" : "save",
    label: input.condition,
    numbers: "all",
    at: Date.now(),
  };
}

export function planDeathFx(input: { to: XY; toTokenId?: string; name: string }): FxEvent {
  return {
    id: fxId("death"),
    kind: "death",
    to: input.to,
    ...(input.toTokenId ? { toTokenId: input.toTokenId } : {}),
    label: input.name,
    sting: "death",
    numbers: "all",
    at: Date.now(),
  };
}

export function planDoorFx(input: {
  at: XY;
  state: "open" | "closed" | "locked" | "secret" | "found";
}): FxEvent {
  const sting =
    input.state === "open"
      ? "door_creak"
      : input.state === "closed"
        ? "door_slam"
        : input.state === "locked"
          ? "door_locked"
          : "door_secret";
  return {
    id: fxId("door"),
    kind: "door",
    to: input.at,
    state: input.state,
    sting,
    numbers: "all",
    at: Date.now(),
  };
}

export function planHazardFx(input: {
  to: XY;
  toTokenId?: string;
  hazard: string;
  damageType?: string;
  amount?: number;
  saved?: boolean;
}): FxEvent {
  return {
    id: fxId("haz"),
    kind: "hazard",
    to: input.to,
    ...(input.toTokenId ? { toTokenId: input.toTokenId } : {}),
    outcome: input.saved === undefined ? "hit" : input.saved ? "half" : "fail",
    label: input.hazard,
    ...(input.damageType ? { damageType: input.damageType } : {}),
    ...(input.amount ? { amount: input.amount } : {}),
    sting: input.hazard === "falling" ? "thud" : spellSting(input.damageType),
    numbers: "all",
    at: Date.now(),
  };
}

export function planTeleportFx(input: { from: XY; to: XY; tokenId?: string }): FxEvent {
  return {
    id: fxId("tp"),
    kind: "teleport",
    from: input.from,
    to: input.to,
    ...(input.tokenId ? { fromTokenId: input.tokenId, toTokenId: input.tokenId } : {}),
    outcome: "hit",
    sting: "magic_cast",
    numbers: "all",
    at: Date.now(),
  };
}

// The tone the renderer should paint an effect in. Attacks are bone unless
// the weapon carries an elemental type; spells are their damage type; heals
// and teleports have their own tones.
export function fxTone(fx: FxEvent): string {
  if (fx.kind === "heal") {
    return "#7ed6a4";
  }
  if (fx.kind === "teleport") {
    return "#8b6fd6";
  }
  if (fx.outcome === "crit") {
    return "#d4ab3a";
  }
  return damageTone(fx.damageType).color;
}

// What a player who may not see real enemy numbers receives: the same
// effect with the number removed. The ring and health word still change,
// because those are what the projection gives them anyway.
export function redactFx(fx: FxEvent): FxEvent {
  if (fx.amount === undefined) {
    return fx;
  }
  const rest: FxEvent = { ...fx };
  delete rest.amount;
  return rest;
}
