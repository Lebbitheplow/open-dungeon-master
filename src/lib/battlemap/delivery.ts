// The damage delivery table (docs/visual-overhaul-plan.md section 5.5).
// damage-palette.ts says what a damage type looks like; this says how it
// arrives: whether anything crosses the gap, how long that takes, how hard
// the stage shakes, and what is left behind. BoardFx reads one row per
// effect and draws nothing the row does not name, so a new damage type is a
// data row here and a colour there, never new drawing code.
//
// Pure: no DOM, no React. scripts/test-delivery.mjs drives it directly.

import {
  DAMAGE_PALETTE,
  HEAL_TONE,
  NEUTRAL_TONE,
  TELEPORT_TONE,
  type DamageTone,
} from "@/lib/battlemap/damage-palette";
import { flipbookFor } from "@/lib/battlemap/flipbooks";
import type { FxKind, FxOutcome } from "@/lib/battlemap/fx-plan";

export type DeliveryMode = "lob" | "straight" | "bolt" | "beam" | "swing" | "none";
export type BurstFamily = DamageTone["burst"];

export type DeliveryRow = {
  mode: DeliveryMode;
  // Milliseconds from the start of the effect to the impact.
  delay: number;
  // Shake intensity, 0 to 9. Zero means the stage holds still.
  shake: number;
  // Cold leaves the target tinted at 0.28 until the effect clears.
  freeze?: boolean;
  // Poison's mist keeps expanding after the hit.
  lingers?: boolean;
  // Necrotic mist and a teleport's mist are drawn inward, not thrown out.
  inward?: boolean;
  extra: string;
};

export const DELIVERY: Record<string, DeliveryRow> = {
  fire: { mode: "lob", delay: 420, shake: 7, extra: "ember streak, spark burst" },
  cold: { mode: "straight", delay: 200, shake: 4, freeze: true, extra: "shard burst, frost tint stays at 0.28" },
  lightning: { mode: "bolt", delay: 90, shake: 6, extra: "jagged double strike, white core" },
  acid: { mode: "lob", delay: 380, shake: 3, extra: "drips run down" },
  poison: { mode: "lob", delay: 380, shake: 2, lingers: true, extra: "mist keeps expanding" },
  necrotic: { mode: "none", delay: 90, shake: 3, inward: true, extra: "dark mist drawn inward" },
  radiant: { mode: "beam", delay: 120, shake: 4, extra: "column drops, bloom at the feet, motes rise" },
  force: { mode: "none", delay: 90, shake: 5, extra: "clean violet ring" },
  psychic: { mode: "none", delay: 90, shake: 4, extra: "concentric pink rings" },
  thunder: { mode: "none", delay: 90, shake: 9, extra: "one wide ring, heaviest shake" },
  bludgeoning: { mode: "swing", delay: 150, shake: 5, extra: "bone crescent, dust" },
  piercing: { mode: "swing", delay: 150, shake: 4, extra: "bone crescent, thinner debris" },
  slashing: { mode: "swing", delay: 150, shake: 4, extra: "bone crescent, thinner debris" },
  heal: { mode: "none", delay: 90, shake: 0, extra: "bloom rising, green" },
  teleport: { mode: "none", delay: 90, shake: 0, inward: true, extra: "mist collapsing, violet" },
};

// An effect with no damage type at all (an untyped spell, a trap): it opens
// at the target with a modest jolt and the neutral tone.
export const NEUTRAL_DELIVERY: DeliveryRow = { mode: "none", delay: 90, shake: 3, extra: "bone burst" };

// Particles per burst family. A ring family throws no particles: it draws
// RING_COUNT rings instead.
export const BURST_COUNT: Record<BurstFamily, number> = {
  spark: 14,
  shard: 13,
  mist: 9,
  drip: 11,
  bloom: 10,
  ring: 0,
};
export const RING_COUNT = 3;

const PHYSICAL = new Set(["bludgeoning", "piercing", "slashing"]);

// The low tier halves every count (rounded up, so a burst never vanishes).
export function burstCount(family: BurstFamily, low: boolean): number {
  const full = BURST_COUNT[family] ?? 0;
  return low ? Math.ceil(full / 2) : full;
}

export function ringCount(family: BurstFamily, low: boolean): number {
  if (family !== "ring") {
    return 0;
  }
  return low ? Math.ceil(RING_COUNT / 2) : RING_COUNT;
}

export type DeliveryInput = {
  kind: FxKind;
  damageType?: string | null;
  outcome?: FxOutcome | null;
  ranged?: boolean;
  amount?: number;
};

export function deliveryKey(input: Pick<DeliveryInput, "kind" | "damageType">): string | null {
  if (input.kind === "heal") {
    return "heal";
  }
  if (input.kind === "teleport") {
    return "teleport";
  }
  const type = (input.damageType ?? "").toLowerCase();
  return type in DELIVERY ? type : null;
}

export function toneFor(input: Pick<DeliveryInput, "kind" | "damageType">): DamageTone {
  if (input.kind === "heal") {
    return HEAL_TONE;
  }
  if (input.kind === "teleport") {
    return TELEPORT_TONE;
  }
  return DAMAGE_PALETTE[(input.damageType ?? "").toLowerCase()] ?? NEUTRAL_TONE;
}

// The row an effect arrives by. A weapon swung from range is thrown flat
// rather than swept, and a melee blow with an energy type (a flame tongue)
// still swings: nothing is lobbed from a sword's length away.
export function deliveryFor(input: DeliveryInput): DeliveryRow {
  const key = deliveryKey(input);
  const row = key ? DELIVERY[key] : NEUTRAL_DELIVERY;
  if (input.kind !== "attack") {
    return row;
  }
  if (input.ranged && row.mode === "swing") {
    return { ...row, mode: "straight", delay: 200 };
  }
  if (!input.ranged && (row.mode === "lob" || row.mode === "straight" || key === null)) {
    return { ...row, mode: "swing", delay: 150 };
  }
  return row;
}

export type Landing = "full" | "half" | "none";

// Whether the blow landed, by the outcome the engine resolved. A save that
// still hurts lands at half weight; a miss, a fumble and a clean save do not
// land at all and play no impact.
export function landingOf(input: Pick<DeliveryInput, "kind" | "outcome">): Landing {
  const outcome = input.outcome ?? "";
  if (input.kind === "heal" || input.kind === "teleport") {
    return "full";
  }
  if (outcome === "half") {
    return "half";
  }
  if (outcome === "miss" || outcome === "fumble" || outcome === "save") {
    return "none";
  }
  return "full";
}

export type Shake = { px: number; ms: number };

// Stage shake, translate only: a hit is 420 ms and about three pixels at the
// table's middle intensity, a crit 620 ms and seven, capped at nine.
export function shakeFor(intensity: number, outcome: string | null | undefined, landing: Landing): Shake | null {
  if (intensity <= 0 || landing === "none") {
    return null;
  }
  const weight = landing === "half" ? 0.5 : 1;
  if (outcome === "crit") {
    return { px: round1(Math.min(9, intensity * 1.4) * weight), ms: 620 };
  }
  return { px: round1(intensity * 0.6 * weight), ms: 420 };
}

export type Recoil = { dx: number; dy: number; deg: number; ms: number };

// The struck figure kicks away from the blow and settles over the impact
// beat. The mockup's card gives a sixth of its width and four degrees; a blow
// with no origin (a trap, a hazard) kicks the way the mockup does, to the
// right. Whatever does not shake the stage does not move the figure either.
export function recoilFor(
  from: { x: number; y: number } | null | undefined,
  to: { x: number; y: number },
  shake: Shake | null,
  tile = 32,
): Recoil | null {
  if (!shake) {
    return null;
  }
  const dx = from ? to.x - from.x : 1;
  const dy = from ? to.y - from.y : 0;
  const length = Math.hypot(dx, dy);
  const ux = length ? dx / length : 1;
  const uy = length ? dy / length : 0;
  const reach = tile / 6;
  return { dx: round1(ux * reach), dy: round1(uy * reach), deg: ux < 0 ? -4 : 4, ms: 420 };
}

export type NumberStyle = {
  color: string;
  size: number;
  variant: "damage" | "crit" | "heal" | "half";
};

export function numberStyleFor(input: DeliveryInput): NumberStyle {
  if (input.kind === "heal") {
    return { color: HEAL_TONE.color, size: 13, variant: "heal" };
  }
  if (input.outcome === "crit") {
    return { color: "#d4ab3a", size: 18, variant: "crit" };
  }
  const type = (input.damageType ?? "").toLowerCase();
  // Weapon damage keeps the ember number so a sword never reads as a spell.
  const color = type in DAMAGE_PALETTE && !PHYSICAL.has(type) ? DAMAGE_PALETTE[type].color : "#ff9d5c";
  return input.outcome === "half"
    ? { color, size: 11, variant: "half" }
    : { color, size: 13, variant: "damage" };
}

export type Presentation = {
  key: string | null;
  row: DeliveryRow;
  tone: DamageTone;
  landing: Landing;
  // The rim flash on impact, or null when nothing landed.
  flash: { color: string; at: number } | null;
  shake: Shake | null;
  number: NumberStyle | null;
  flipbook: string | null;
  particles: { family: BurstFamily; count: number; color: string; at: number } | null;
  rings: number;
  freeze: boolean;
};

// Everything the board plays for one effect, from the type and the outcome.
export function presentationFor(input: DeliveryInput, options: { low?: boolean } = {}): Presentation {
  const low = Boolean(options.low);
  const row = deliveryFor(input);
  const tone = toneFor(input);
  const landing = landingOf(input);
  const landed = landing !== "none";
  const crit = input.outcome === "crit";
  const weight = landing === "half" ? 0.5 : 1;
  const count = Math.ceil(burstCount(tone.burst, low) * weight);
  return {
    key: deliveryKey(input),
    row,
    tone,
    landing,
    flash: landed ? { color: crit ? "#d4ab3a" : tone.edge, at: row.delay } : null,
    shake: shakeFor(row.shake, input.outcome, landing),
    number: typeof input.amount === "number" ? numberStyleFor(input) : null,
    flipbook: landed
      ? flipbookFor({
          kind: input.kind,
          outcome: input.outcome ?? undefined,
          damageType: input.damageType ?? undefined,
        })
      : null,
    particles: landed && count > 0 ? { family: tone.burst, count, color: crit ? "#d4ab3a" : tone.color, at: row.delay } : null,
    rings: landed ? ringCount(tone.burst, low) : 0,
    freeze: landed && Boolean(row.freeze),
  };
}

// ---- determinism: the same hit replays the same way ----

// FNV-1a over the effect id, folded to a small positive number.
export function seedOf(id: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < id.length; i += 1) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) % 100000;
}

// The mockup's own generator: a value in [0, 1) from the particle's index,
// a salt and the seed.
export function seededUnit(seed: number, index: number, salt: number): number {
  const n = Math.sin((index + 1) * 12.9898 + salt * 78.233 + seed * 3.17) * 43758.5453;
  return n - Math.floor(n);
}

export type ParticleSpec = {
  angle: number;
  distance: number;
  size: number;
  life: number;
  delay: number;
  spin: number;
  edge: boolean;
};

// One particle set per burst family, shaped by the family's own geometry:
// sparks fly out all round, shards tumble and fall, mist and blooms rise,
// drips start above and run down.
export function particleSpecs(family: BurstFamily, seed: number, count: number): ParticleSpec[] {
  const out: ParticleSpec[] = [];
  for (let i = 0; i < count; i += 1) {
    const rand = (salt: number) => seededUnit(seed, i, salt);
    let angle = (i / count) * Math.PI * 2 + rand(1) * 0.5;
    let distance = 34 + rand(2) * 44;
    let size = 3 + rand(3) * 4;
    let life = 420 + rand(4) * 260;
    if (family === "shard") {
      distance = 26 + rand(2) * 40;
      size = 3 + rand(3) * 5;
      life = 480 + rand(4) * 400;
    } else if (family === "mist") {
      angle = -Math.PI / 2 + (rand(1) - 0.5) * 2.4;
      distance = 18 + rand(2) * 30;
      size = 12 + rand(3) * 14;
      life = 900 + rand(4) * 700;
    } else if (family === "drip") {
      angle = -Math.PI / 2 + (rand(1) - 0.5) * 1.9;
      distance = 12 + rand(2) * 26;
      size = 3 + rand(3) * 3;
      life = 700 + rand(4) * 420;
    } else if (family === "bloom") {
      angle = -Math.PI / 2 + (rand(1) - 0.5) * 1.6;
      distance = 22 + rand(2) * 38;
      size = 4 + rand(3) * 6;
      life = 700 + rand(4) * 500;
    }
    out.push({
      angle,
      distance,
      size,
      life: Math.round(life),
      delay: Math.round(rand(6) * 90),
      spin: Math.round(rand(5) * 540 - 270),
      edge: i % 3 === 0,
    });
  }
  return out;
}

export type RingSpec = { scale: number; life: number; delay: number; edge: boolean };

// The ring family: concentric rings a beat apart, the middle one in the
// type's edge colour. `scale` is in tiles.
export function ringSpecs(count: number): RingSpec[] {
  return Array.from({ length: count }, (_, i) => ({
    scale: 0.8 + i * 0.5,
    life: 620 + i * 120,
    delay: i * 110,
    edge: i === 1,
  }));
}

// A jagged bolt between two points: seven joints, alternating sides, the
// offsets seeded so the same strike draws the same fork.
export function boltPoints(
  seed: number,
  from: { x: number; y: number },
  to: { x: number; y: number },
  joints = 7,
): Array<{ x: number; y: number }> {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy) || 1;
  const nx = -dy / length;
  const ny = dx / length;
  const points = [{ x: from.x, y: from.y }];
  for (let i = 1; i < joints; i += 1) {
    const t = i / joints;
    const side = i % 2 === 0 ? -1 : 1;
    const offset = side * (length * 0.04 + seededUnit(seed, i, 7) * length * 0.06);
    points.push({ x: round1(from.x + dx * t + nx * offset), y: round1(from.y + dy * t + ny * offset) });
  }
  points.push({ x: to.x, y: to.y });
  return points;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
