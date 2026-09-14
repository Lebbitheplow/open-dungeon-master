// The hour lights the map (docs/vtt-parity-implementation-plan.md section
// 2.2). An outdoor board's ambient light is derived from the campaign clock
// and the sky rather than authored: night is dark, dawn and dusk dim, day
// bright, an overcast or a storm caps it at dim. Indoor maps keep what the
// author set. Pure so scripts/test-ambient-by-hour.mjs drives it directly.

import type { AmbientLight } from "@/lib/battlemap/types";
import type { MapTheme } from "@/lib/battlemap/generate";
import { dayPartOf, type Weather } from "@/lib/scene/state";

// Caves and interiors are under a roof; every other theme is under the sky.
export function outdoorsForTheme(theme: MapTheme | string | undefined | null): boolean {
  return theme !== "cave" && theme !== "interior";
}

// The authored flag when the author set one, otherwise the theme's answer.
export function resolveOutdoors(
  stored: number | boolean | null | undefined,
  theme: MapTheme | string | undefined | null,
): boolean {
  if (stored === null || stored === undefined) {
    return outdoorsForTheme(theme);
  }
  return stored === true || stored === 1;
}

const LEVEL: Record<AmbientLight, number> = { dark: 0, dim: 1, bright: 2 };
const BY_LEVEL: AmbientLight[] = ["dark", "dim", "bright"];

function dimmer(a: AmbientLight, b: AmbientLight): AmbientLight {
  return BY_LEVEL[Math.min(LEVEL[a], LEVEL[b])];
}

export function skyLight(hour: number, weather: Weather | null): AmbientLight {
  const part = dayPartOf(hour);
  const base: AmbientLight =
    part === "night" ? "dark" : part === "dawn" || part === "dusk" || part === "evening" ? "dim" : "bright";
  if (!weather) {
    return base;
  }
  if (weather.sky === "storm" || weather.sky === "overcast" || weather.sky === "fog") {
    return dimmer(base, "dim");
  }
  if ((weather.sky === "rain" || weather.sky === "snow") && weather.precipitation >= 2) {
    return dimmer(base, "dim");
  }
  return base;
}

// What the vision engine should use for this board right now.
export function effectiveAmbient(
  authored: AmbientLight,
  outdoors: boolean,
  hour: number,
  weather: Weather | null,
): AmbientLight {
  return outdoors ? skyLight(hour, weather) : authored;
}
