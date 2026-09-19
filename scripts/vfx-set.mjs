// The catalogue of VFX flipbooks: every painted effect the board plays in
// place of the SVG primitives in BoardFx (docs/visual-overhaul-plan.md 8b.3).
//
// Each entry is a short clip rendered by LTX Video on a pure black
// background. Black keys out (the board draws the sheet additively), so no
// matte is needed. The clip is cut to a fixed frame count on a sheet the
// board steps through at the beat sheet's timing; `loop` marks the ambient
// ones that cycle.
//
// Consumed by scripts/generate-vfx.mjs. Pure data plus prompt assembly.

const STYLE =
  "VFX element on a pure black background, centred in frame, nothing else in frame, no scenery, no ground, no character, " +
  "game spell effect flipbook, hand painted stylised magical effect, vivid glowing colour on black, large and bright, the effect fills at least half the frame, smooth motion";

// Burst effects begin at the centre and expand outward, then dissipate.
const BURST = "beginning as a small point at the centre and expanding outward, then dissipating to nothing by the end";
// Projectiles fly left to right across the frame.
const FLY = "flying from the left edge to the right edge of the frame in a straight line with a trailing streak";
// Loops keep going.
const LOOP = "continuous, steady, looping motion, the effect stays centred";

// [id, family, what happens, tone, options]
//   family: burst | projectile | beam | state | ambient
//   options: { loop, frames, seconds }
// Not in this set, by decision on 2026-09-18: the physical hits (bludgeoning,
// piercing, slashing, blood spray), the door dust puff and the shock ring.
// The video model drifts to red fire for anything mundane (two rounds of
// prompts gave orange fireworks, a red dot and black), so the board keeps its
// drawn effects for those; flipbooks cover magical energy, which it does well.
const CLIPS = [
  // impact bursts, one per damage type (damage-palette.ts)
  ["burst-fire", "burst", "an explosion of orange and yellow fire with embers and dark smoke", "fire", {}],
  ["burst-cold", "burst", "a shatter of pale blue ice crystals and frost mist", "ice", {}],
  ["burst-lightning", "burst", "a crackling flash of white blue lightning arcs radiating outward", "lightning", {}],
  ["burst-acid", "burst", "a splash of bright green acid droplets that run downward and sizzle", "acid", {}],
  ["burst-poison", "burst", "a cloud of sickly yellow green poison mist swirling and spreading", "poison", {}],
  ["burst-necrotic", "burst", "dark violet and black smoke tendrils drawn inward with a dim purple glow", "necrotic", {}],
  ["burst-radiant", "burst", "a bloom of warm golden white holy light with rising sparkles", "radiant", {}],
  ["burst-force", "burst", "a clean expanding ring of pale violet magical force with a soft shockwave", "force", {}],
  ["burst-psychic", "burst", "concentric expanding rings of magenta pink psychic energy with a ripple distortion", "psychic", {}],
  ["burst-thunder", "burst", "one wide grey white shockwave ring with dust rushing outward", "thunder", {}],
  // projectiles
  ["proj-fire", "projectile", "a glowing orange fireball with a long ember trail", "fire", {}],
  ["proj-cold", "projectile", "a spinning pale blue ice shard with a frost trail", "ice", {}],
  ["proj-acid", "projectile", "a wobbling glob of bright green acid dripping as it flies", "acid", {}],
  ["proj-poison", "projectile", "a lobbed ball of yellow green poison mist", "poison", {}],
  ["proj-arrow", "projectile", "a wooden arrow with a pale motion streak", "bone", {}],
  ["proj-magic", "projectile", "a large bright glowing violet magic missile orb with a long sparkling trail", "force", {}],
  // beams and columns
  ["beam-radiant", "beam", "a vertical column of golden white light descending from the top of the frame and blooming at the bottom with rising motes", "radiant", {}],
  ["beam-necrotic", "beam", "a vertical column of dark violet energy rising upward from the bottom with black wisps", "necrotic", {}],
  // states and moments
  ["heal-bloom", "burst", "a soft green and gold bloom of healing light with rising sparkles and small leaves", "heal", {}],
  ["teleport-out", "burst", "a large bright swirl of glowing violet and white mist collapsing inward to a bright point and vanishing", "teleport", {}],
  ["teleport-in", "burst", "a point of violet light expanding into a swirl of mist that fades away", "teleport", {}],
  ["death-collapse", "burst", "a large bright ring of pale glowing dust collapsing inward with a vivid red pulse that fades out", "death", {}],
  ["door-locked", "burst", "a brief red flash of a lock symbol shape with small sparks", "warn", {}],
  ["secret-found", "burst", "a shimmer of gold sparkles revealing and fading", "gold", {}],
  ["crit-flare", "burst", "a brilliant gold white flare exploding outward with radial rays and sparks", "gold", {}],
  ["sparks", "burst", "a shower of gold sparks flying outward and falling", "gold", {}],
  ["dust-burst", "burst", "a soft grey brown dust cloud puffing outward and settling", "dust", {}],
  // ambient loops. Rain, snow, motes, embers, fireflies and fog are not here: a video model returns
  // black for sparse particles on black, and the board's particle canvas already draws them.
  ["loop-torch", "ambient", "a single torch flame flickering, orange and yellow", "fire", { loop: true }],
  ["loop-brazier", "ambient", "glowing orange coals with small flames and rising embers", "fire", { loop: true }],
  ["loop-candle", "ambient", "a single small candle flame, steady with a gentle sway", "fire", { loop: true }],
  ["loop-campfire", "ambient", "a small campfire of orange flames over dark logs with rising sparks", "fire", { loop: true }],
  ["loop-lantern", "ambient", "a warm lantern glow pulsing softly with a few drifting motes", "gold", { loop: true }],
  ["loop-sigil", "ambient", "a ring of small gold arcane runes slowly rotating with a soft glow", "gold", { loop: true }],
  ["loop-caustics", "ambient", "soft rippling pale blue light caustics as under shallow water", "ice", { loop: true }],
];

const MOTION = { burst: BURST, projectile: FLY, beam: "the beam appears, holds, then fades", ambient: LOOP };

export const VFX_LIST = CLIPS.map(([id, family, detail, tone, options]) => ({
  id,
  family,
  detail,
  tone,
  loop: Boolean(options.loop),
  // 41 frames at 24 fps is 1.7 s, the longest beat the board plays; ambient
  // loops render 65 so the cycle is not obvious.
  frames: options.frames || (options.loop ? 65 : 41),
  width: 512,
  height: 512,
  prompt: `${detail}, ${MOTION[family]}, ${STYLE}`,
  negative: "text, watermark, logo, blurry, static, still image, low quality, background scenery, ground, floor, people, faces, hands, grey background, white background, frame, border, photograph",
}));

// The sheet layout the board reads: 8 frames across, 128 px each.
export const SHEET = { columns: 8, frame: 128 };
