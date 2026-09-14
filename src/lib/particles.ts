// A small particle system on one <canvas>, shared by the board's effect
// bursts and the sky's weather. Pure state and stepping here; the React
// wrapper in src/components/ParticleCanvas.tsx owns the element and the
// single requestAnimationFrame loop. Capped at MAX_SPRITES so a storm over
// a fireball cannot bring a phone to its knees; low effects halves the cap
// and drops depth.

export const MAX_SPRITES = 400;
export const LOW_SPRITES = 80;

export type Sprite = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  // Milliseconds of life left and total, for fading.
  life: number;
  total: number;
  size: number;
  color: string;
  // "spark" and "shard" are drawn as short lines along their velocity,
  // "dot" as a disc, "streak" as a long thin line (rain), "blob" as a
  // large soft disc (fog).
  shape: "spark" | "shard" | "dot" | "streak" | "blob";
  // 0..1 depth for parallax: near sprites are larger and faster.
  depth: number;
  gravity: number;
  drag: number;
};

export type ParticleField = {
  sprites: Sprite[];
  cap: number;
  width: number;
  height: number;
};

export function createField(width: number, height: number, cap = MAX_SPRITES): ParticleField {
  return { sprites: [], cap, width, height };
}

// A seeded generator so the tests are deterministic and the weather does
// not restart identically on every mount.
export function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function emit(field: ParticleField, sprites: Sprite[]) {
  const room = field.cap - field.sprites.length;
  if (room <= 0) {
    // Newest first: the effect that just happened is the one that matters.
    field.sprites.splice(0, Math.min(field.sprites.length, sprites.length));
  }
  const take = sprites.slice(0, Math.max(0, field.cap - field.sprites.length));
  field.sprites.push(...take);
}

// A burst at a point: the shape decides the spread and the lifetime.
export function burst(
  field: ParticleField,
  x: number,
  y: number,
  color: string,
  kind: "spark" | "shard" | "mist" | "ring" | "drip" | "bloom",
  count: number,
  rng: () => number = Math.random,
) {
  const out: Sprite[] = [];
  for (let i = 0; i < count; i += 1) {
    const angle = kind === "ring" ? (i / count) * Math.PI * 2 : rng() * Math.PI * 2;
    const speed =
      kind === "ring"
        ? 0.14
        : kind === "mist"
          ? 0.02 + rng() * 0.03
          : kind === "bloom"
            ? 0.03 + rng() * 0.04
            : 0.08 + rng() * 0.16;
    const total =
      kind === "mist" || kind === "bloom" ? 700 + rng() * 300 : 260 + rng() * 220;
    out.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: (kind === "bloom" ? -Math.abs(Math.sin(angle)) : Math.sin(angle)) * speed,
      life: total,
      total,
      size:
        kind === "mist" ? 6 + rng() * 6 : kind === "bloom" ? 3 + rng() * 3 : 1.5 + rng() * 2,
      color,
      shape:
        kind === "spark"
          ? "spark"
          : kind === "shard"
            ? "shard"
            : kind === "mist" || kind === "bloom"
              ? "blob"
              : "dot",
      depth: 1,
      gravity: kind === "drip" ? 0.0006 : kind === "spark" ? 0.0002 : 0,
      drag: kind === "ring" ? 0.995 : 0.985,
    });
  }
  emit(field, out);
}

export type WeatherSky = "clear" | "overcast" | "rain" | "storm" | "snow" | "fog" | "wind";

// Weather spawns continuously: called each frame with the sky and how
// many sprites to keep alive, it tops the field up to that number.
export function spawnWeather(
  field: ParticleField,
  sky: WeatherSky,
  target: number,
  windX: number,
  rng: () => number = Math.random,
  options: { lowEffects?: boolean; embers?: boolean; motes?: boolean } = {},
) {
  const alive = field.sprites.filter((sprite) => sprite.total > 2000).length;
  const need = Math.min(target, field.cap) - alive;
  if (need <= 0) {
    return;
  }
  const out: Sprite[] = [];
  for (let i = 0; i < need; i += 1) {
    const depth = options.lowEffects ? 1 : 0.4 + rng() * 0.6;
    const total = 100_000;
    if (sky === "rain" || sky === "storm") {
      out.push({
        x: rng() * field.width,
        y: -10 - rng() * field.height,
        vx: windX * 0.3 * depth,
        vy: (sky === "storm" ? 0.9 : 0.6) * depth,
        life: total,
        total,
        size: 6 + 8 * depth,
        color: sky === "storm" ? "rgba(190,205,230,0.55)" : "rgba(170,190,220,0.4)",
        shape: "streak",
        depth,
        gravity: 0,
        drag: 1,
      });
    } else if (sky === "snow") {
      out.push({
        x: rng() * field.width,
        y: -10 - rng() * field.height,
        vx: windX * 0.08 * depth + (rng() - 0.5) * 0.02,
        vy: 0.04 + 0.05 * depth,
        life: total,
        total,
        size: 1 + 2 * depth,
        color: "rgba(240,245,255,0.8)",
        shape: "dot",
        depth,
        gravity: 0,
        drag: 1,
      });
    } else if (sky === "fog") {
      out.push({
        x: rng() * field.width,
        y: rng() * field.height,
        vx: 0.005 + windX * 0.01,
        vy: (rng() - 0.5) * 0.002,
        life: total,
        total,
        size: 60 + rng() * 90,
        color: "rgba(200,205,215,0.05)",
        shape: "blob",
        depth,
        gravity: 0,
        drag: 1,
      });
    } else if (options.embers) {
      out.push({
        x: rng() * field.width,
        y: field.height + 10,
        vx: (rng() - 0.5) * 0.02 + windX * 0.02,
        vy: -(0.02 + rng() * 0.04),
        life: total,
        total,
        size: 1 + rng() * 1.5,
        color: "rgba(255,157,92,0.8)",
        shape: "dot",
        depth,
        gravity: 0,
        drag: 1,
      });
    } else if (options.motes) {
      out.push({
        x: rng() * field.width,
        y: rng() * field.height,
        vx: (rng() - 0.5) * 0.01 + windX * 0.01,
        vy: (rng() - 0.5) * 0.01,
        life: total,
        total,
        size: 0.8 + rng() * 1.2,
        color: "rgba(244,212,122,0.55)",
        shape: "dot",
        depth,
        gravity: 0,
        drag: 1,
      });
    }
  }
  emit(field, out);
}

// Advance every sprite by dt milliseconds; drop the dead and the ones that
// left the frame (weather wraps instead of dying).
export function step(field: ParticleField, dt: number) {
  const { width, height } = field;
  const keep: Sprite[] = [];
  for (const sprite of field.sprites) {
    sprite.life -= dt;
    if (sprite.life <= 0) {
      continue;
    }
    sprite.vy += sprite.gravity * dt;
    sprite.vx *= sprite.drag;
    sprite.vy *= sprite.drag;
    sprite.x += sprite.vx * dt;
    sprite.y += sprite.vy * dt;
    if (sprite.total > 2000) {
      // Weather: wrap around the frame so it never runs out.
      if (sprite.y > height + 20) {
        sprite.y = -20;
        sprite.x = Math.random() * width;
      } else if (sprite.y < -30) {
        sprite.y = height + 10;
      }
      if (sprite.x > width + 20) {
        sprite.x = -20;
      } else if (sprite.x < -100) {
        sprite.x = width + 20;
      }
    }
    keep.push(sprite);
  }
  field.sprites = keep;
}

export function draw(ctx: CanvasRenderingContext2D, field: ParticleField) {
  ctx.clearRect(0, 0, field.width, field.height);
  for (const sprite of field.sprites) {
    const alpha = sprite.total > 2000 ? 1 : Math.max(0, sprite.life / sprite.total);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = sprite.color;
    ctx.strokeStyle = sprite.color;
    if (sprite.shape === "dot") {
      ctx.beginPath();
      ctx.arc(sprite.x, sprite.y, sprite.size, 0, Math.PI * 2);
      ctx.fill();
    } else if (sprite.shape === "blob") {
      const gradient = ctx.createRadialGradient(
        sprite.x,
        sprite.y,
        0,
        sprite.x,
        sprite.y,
        sprite.size,
      );
      gradient.addColorStop(0, sprite.color);
      gradient.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(sprite.x, sprite.y, sprite.size, 0, Math.PI * 2);
      ctx.fill();
    } else {
      const length = sprite.shape === "streak" ? sprite.size : sprite.size * 2.5;
      const speed = Math.hypot(sprite.vx, sprite.vy) || 1;
      ctx.lineWidth = sprite.shape === "streak" ? 1 : sprite.shape === "shard" ? 2 : 1.5;
      ctx.beginPath();
      ctx.moveTo(sprite.x, sprite.y);
      ctx.lineTo(
        sprite.x - (sprite.vx / speed) * length,
        sprite.y - (sprite.vy / speed) * length,
      );
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
}
