import {
  MAP_SIZE,
  defaultAmbient,
  generateBattleMap,
  sceneRough,
  sceneTheme,
  type GeneratedMap,
  type MapTheme,
} from "@/lib/battlemap/generate";
import type { AmbientLight } from "@/lib/battlemap/types";

// The pure half of the Map Forge (docs/visual-overhaul-plan.md 4.1): what a
// roll is, what the history strip remembers, how the reveal floods, and what
// the kind of place decides. No React and no DOM, so scripts/test-map-forge.mjs
// drives it under Node.
//
// The forge previews with the very generator the server saves with. The two
// agree because they are one function called with one set of arguments, which
// is what `forgeGenerate` pins down: the library asks for a party of four and
// four foes (src/lib/dm/map-library.ts createLibraryMap), so the preview does.

export type ForgeSettings = {
  width: number;
  height: number;
  // "" leaves it to the kind of place.
  theme: MapTheme | "";
  ambient: AmbientLight | "";
  // The kind of place (an ambience bed id, the same list a place in play
  // takes), or "" for none: open ground.
  scene: string;
};

// One roll the history strip can bring back: the seed is all it takes.
export type ForgeRoll = ForgeSettings & { seed: number };

export const FORGE_START: ForgeSettings = { width: 20, height: 15, theme: "", ambient: "", scene: "" };
export const HISTORY_LIMIT = 7;
// How long a restored roll takes to draw itself back in.
export const RESTORE_MS = 900;

export function clampSize(width: number, height: number): { width: number; height: number } {
  const side = (value: number, min: number, max: number, fallback: number) =>
    Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback;
  return {
    width: side(width, MAP_SIZE.minWidth, MAP_SIZE.maxWidth, 20),
    height: side(height, MAP_SIZE.minHeight, MAP_SIZE.maxHeight, 15),
  };
}

export function freshSeed(random: () => number = Math.random): number {
  return Math.floor(random() * 0xffffffff) >>> 0;
}

export function forgeGenerate(roll: ForgeRoll): GeneratedMap {
  return generateBattleMap({
    seed: roll.seed >>> 0,
    width: roll.width,
    height: roll.height,
    scene: roll.scene || null,
    theme: roll.theme || undefined,
    ambient: roll.ambient || undefined,
    pcCount: 4,
    enemyCount: 4,
  });
}

// The body the library's create route takes for this roll, so keeping a map
// saves exactly what was previewed.
export function createBodyFor(roll: ForgeRoll): Record<string, unknown> {
  return {
    do: "create",
    seed: roll.seed >>> 0,
    width: roll.width,
    height: roll.height,
    ...(roll.scene ? { scene: roll.scene } : {}),
    ...(roll.theme ? { theme: roll.theme } : {}),
    ...(roll.ambient ? { ambient: roll.ambient } : {}),
  };
}

function sameRoll(a: ForgeRoll, b: ForgeRoll): boolean {
  return (
    a.seed === b.seed &&
    a.width === b.width &&
    a.height === b.height &&
    a.theme === b.theme &&
    a.ambient === b.ambient &&
    a.scene === b.scene
  );
}

// Newest first, seven deep. Bringing an old roll back moves it to the front
// instead of listing it twice.
export function pushHistory(history: readonly ForgeRoll[], roll: ForgeRoll): ForgeRoll[] {
  return [roll, ...history.filter((entry) => !sameRoll(entry, roll))].slice(0, HISTORY_LIMIT);
}

// ---- the reveal ----

export const FLOOD = { ringMs: 26, tileMs: 380 } as const;

// The gold sweep's length, and so the whole reveal's: bigger maps take longer.
export function sweepMs(width: number, height: number): number {
  return 520 + (width + height) * 16;
}

// The die turns once every 700ms (maps.css). This is how many whole turns
// cover the reveal, so it comes to rest upright as the map finishes.
export const DIE_TURN_MS = 700;
export function dieSpins(width: number, height: number, stretch = 1): number {
  return Math.max(1, Math.round((sweepMs(width, height) * stretch) / DIE_TURN_MS));
}

// Chebyshev distance of every tile from the centre, row-major: the ring it
// floods in on.
export function floodRings(width: number, height: number): { rings: number[]; last: number } {
  const cx = (width - 1) / 2;
  const cy = (height - 1) / 2;
  const rings: number[] = new Array(width * height);
  let last = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const ring = Math.floor(Math.max(Math.abs(x - cx), Math.abs(y - cy)));
      rings[y * width + x] = ring;
      last = Math.max(last, ring);
    }
  }
  return { rings, last };
}

// How far in a tile is, 0 to 1, `elapsed` ms after the roll.
export function floodProgress(ring: number, elapsed: number): number {
  const local = (elapsed - ring * FLOOD.ringMs) / FLOOD.tileMs;
  return local <= 0 ? 0 : local >= 1 ? 1 : local;
}

export function floodTotalMs(width: number, height: number): number {
  return floodRings(width, height).last * FLOOD.ringMs + FLOOD.tileMs;
}

// ---- what decided the map ----

// The ground and light a roll comes out with, before it is rolled.
export function forgeOutcome(settings: Pick<ForgeSettings, "theme" | "ambient" | "scene">): {
  theme: MapTheme;
  ambient: AmbientLight;
} {
  const theme = settings.theme || sceneTheme(settings.scene || null);
  return { theme, ambient: settings.ambient || defaultAmbient(theme) };
}

export const AMBIENT_LABELS: Record<AmbientLight, string> = { bright: "Daylight", dim: "Dim", dark: "Dark" };

// The sentences under the chips: what the kind of place decided, or that
// the DM did instead.
export function explainForge(
  settings: Pick<ForgeSettings, "theme" | "ambient" | "scene">,
  themeLabel: (theme: MapTheme) => string,
  sceneLabel: (scene: string) => string,
): string[] {
  const out: string[] = [];
  const { theme } = forgeOutcome(settings);
  if (settings.theme) {
    out.push(`You said ${themeLabel(settings.theme).toLowerCase()} outright, so the kind of place does not pick the ground.`);
  } else if (settings.scene) {
    out.push(`${sceneLabel(settings.scene)} is fought on ${themeLabel(theme).toLowerCase()}.`);
  } else {
    out.push("No kind of place is set, so it is open ground.");
  }
  if (settings.ambient) {
    out.push(`You set the light to ${AMBIENT_LABELS[settings.ambient].toLowerCase()}.`);
  } else {
    out.push(`The light is what ${themeLabel(theme).toLowerCase()} usually has.`);
  }
  if (sceneRough(settings.scene || null)) {
    out.push(`${sceneLabel(settings.scene)} scatters rough ground.`);
  }
  return out;
}
