// Weather the engine rolls and enforces (docs/vtt-parity-implementation-plan.md
// section 2.1). A climate table per genre preset, a season to lean on,
// persistence so a storm does not vanish between two travel legs, and the
// mechanical riders the rest of the engine asks about: what rain does to
// Perception, how far fog lets anyone see, what a gale does to an arrow,
// whether the cold is a hazard, and how snow slows a march.
//
// Pure by design: no imports from the database, no I/O, so
// scripts/test-weather.mjs drives it directly.

import type { Sky, Temperature, Weather, Wind } from "@/lib/scene/state";

export const CLIMATES = ["temperate", "arid", "boreal", "tropical", "blighted"] as const;
export type Climate = (typeof CLIMATES)[number];

export type WeatherSeason = "winter" | "spring" | "summer" | "autumn";

// Weighted sky odds per climate and season. Weights need not sum to one.
type SkyTable = Record<WeatherSeason, Array<[Sky, number]>>;

const TABLES: Record<Climate, SkyTable> = {
  temperate: {
    winter: [["clear", 3], ["overcast", 4], ["rain", 2], ["snow", 3], ["fog", 2], ["wind", 1], ["storm", 1]],
    spring: [["clear", 4], ["overcast", 3], ["rain", 4], ["fog", 2], ["wind", 2], ["storm", 1]],
    summer: [["clear", 6], ["overcast", 2], ["rain", 2], ["wind", 1], ["storm", 2]],
    autumn: [["clear", 3], ["overcast", 4], ["rain", 3], ["fog", 3], ["wind", 2], ["storm", 1]],
  },
  arid: {
    winter: [["clear", 7], ["overcast", 1], ["wind", 3], ["rain", 1]],
    spring: [["clear", 7], ["wind", 3], ["overcast", 1], ["storm", 1]],
    summer: [["clear", 9], ["wind", 3], ["storm", 1]],
    autumn: [["clear", 7], ["wind", 3], ["overcast", 1]],
  },
  boreal: {
    winter: [["snow", 5], ["overcast", 3], ["clear", 2], ["wind", 2], ["fog", 1], ["storm", 1]],
    spring: [["overcast", 3], ["snow", 2], ["rain", 3], ["fog", 2], ["clear", 2], ["wind", 1]],
    summer: [["clear", 4], ["overcast", 3], ["rain", 3], ["fog", 1], ["wind", 1]],
    autumn: [["overcast", 4], ["rain", 3], ["snow", 2], ["fog", 2], ["clear", 1], ["wind", 1]],
  },
  tropical: {
    winter: [["clear", 3], ["rain", 5], ["storm", 3], ["overcast", 2], ["fog", 1]],
    spring: [["clear", 4], ["rain", 4], ["storm", 2], ["overcast", 2]],
    summer: [["clear", 5], ["rain", 3], ["storm", 2], ["overcast", 1]],
    autumn: [["rain", 5], ["storm", 3], ["overcast", 2], ["clear", 2]],
  },
  blighted: {
    winter: [["overcast", 5], ["fog", 3], ["wind", 2], ["storm", 1], ["clear", 1]],
    spring: [["overcast", 5], ["fog", 3], ["wind", 2], ["rain", 1], ["clear", 1]],
    summer: [["overcast", 4], ["wind", 3], ["fog", 2], ["storm", 2], ["clear", 1]],
    autumn: [["overcast", 5], ["fog", 3], ["wind", 2], ["storm", 1], ["clear", 1]],
  },
};

const BASE_TEMPERATURE: Record<Climate, Record<WeatherSeason, Temperature>> = {
  temperate: { winter: "cold", spring: "mild", summer: "warm", autumn: "mild" },
  arid: { winter: "mild", spring: "warm", summer: "hot", autumn: "warm" },
  boreal: { winter: "frigid", spring: "cold", summer: "mild", autumn: "cold" },
  tropical: { winter: "warm", spring: "warm", summer: "hot", autumn: "warm" },
  blighted: { winter: "cold", spring: "cold", summer: "mild", autumn: "cold" },
};

const TEMPERATURES: Temperature[] = ["frigid", "cold", "mild", "warm", "hot"];

// Sixty percent of the time the sky holds; the rest it rolls fresh.
export const PERSISTENCE = 0.6;

function pick<T>(entries: Array<[T, number]>, rng: () => number): T {
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = rng() * total;
  for (const [value, weight] of entries) {
    roll -= weight;
    if (roll <= 0) {
      return value;
    }
  }
  return entries[entries.length - 1][0];
}

function shiftTemperature(base: Temperature, steps: number): Temperature {
  const index = Math.max(0, Math.min(TEMPERATURES.length - 1, TEMPERATURES.indexOf(base) + steps));
  return TEMPERATURES[index];
}

export function rollWeather(
  climate: Climate,
  season: WeatherSeason,
  previous: Weather | null,
  rng: () => number = Math.random,
): Weather {
  const table = TABLES[climate]?.[season] ?? TABLES.temperate.spring;
  const sky: Sky = previous && rng() < PERSISTENCE ? previous.sky : pick(table, rng);
  // Overcast and precipitation knock the temperature down a step; a clear
  // summer sky in the desert pushes it up.
  const base = BASE_TEMPERATURE[climate]?.[season] ?? "mild";
  const shift =
    sky === "snow" ? -1 : sky === "storm" || sky === "rain" || sky === "overcast" ? -1 : 0;
  const hotShift = sky === "clear" && (climate === "arid" || climate === "tropical") && season === "summer" ? 1 : 0;
  const drift = rng() < 0.25 ? (rng() < 0.5 ? -1 : 1) : 0;
  const temperature = shiftTemperature(base, shift + hotShift + drift);
  const wind: Wind =
    sky === "storm" || sky === "wind"
      ? rng() < 0.6
        ? "gale"
        : "breeze"
      : rng() < 0.3
        ? "breeze"
        : "calm";
  const precipitation: Weather["precipitation"] =
    sky === "storm" ? 3 : sky === "rain" ? (rng() < 0.4 ? 2 : 1) : sky === "snow" ? (rng() < 0.3 ? 3 : 2) : 0;
  return { sky, temperature, wind, precipitation };
}

export function normalizeWeather(raw: unknown): Weather | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const record = raw as Record<string, unknown>;
  const skies: Sky[] = ["clear", "overcast", "rain", "storm", "snow", "fog", "wind"];
  const winds: Wind[] = ["calm", "breeze", "gale"];
  const sky = skies.includes(record.sky as Sky) ? (record.sky as Sky) : null;
  if (!sky) {
    return null;
  }
  const temperature = TEMPERATURES.includes(record.temperature as Temperature)
    ? (record.temperature as Temperature)
    : "mild";
  const wind = winds.includes(record.wind as Wind) ? (record.wind as Wind) : "calm";
  const precipitationRaw = Number(record.precipitation);
  const precipitation = (
    Number.isFinite(precipitationRaw) ? Math.max(0, Math.min(3, Math.round(precipitationRaw))) : 0
  ) as Weather["precipitation"];
  return { sky, temperature, wind, precipitation };
}

// ---- riders the engine enforces ----

// Heavy rain and fog: disadvantage on Wisdom (Perception) checks that rely
// on sight, which for a passive score is minus five.
export function weatherPerceptionRider(weather: Weather | null): {
  disadvantage: boolean;
  passiveMod: number;
  note: string | null;
} {
  if (!weather) {
    return { disadvantage: false, passiveMod: 0, note: null };
  }
  if (weather.sky === "fog") {
    return { disadvantage: true, passiveMod: -5, note: "Fog: disadvantage on Perception by sight." };
  }
  if ((weather.sky === "rain" || weather.sky === "storm") && weather.precipitation >= 2) {
    return { disadvantage: true, passiveMod: -5, note: "Heavy rain: disadvantage on Perception by sight." };
  }
  if (weather.sky === "snow" && weather.precipitation >= 3) {
    return { disadvantage: true, passiveMod: -5, note: "Driving snow: disadvantage on Perception by sight." };
  }
  return { disadvantage: false, passiveMod: 0, note: null };
}

// Beyond this many tiles the light reads as dim: sixty feet in heavy rain
// or snow, thirty in fog. Infinity when the sky is clear enough.
export function weatherObscurementTiles(weather: Weather | null): number {
  if (!weather) {
    return Infinity;
  }
  if (weather.sky === "fog") {
    return 6;
  }
  if ((weather.sky === "rain" || weather.sky === "storm" || weather.sky === "snow") && weather.precipitation >= 2) {
    return 12;
  }
  return Infinity;
}

// A gale gives disadvantage on ranged weapon attacks past thirty feet.
export function weatherRangedRider(
  weather: Weather | null,
  ranged: boolean,
  distanceTiles: number,
): { disadvantage: boolean; note: string | null } {
  if (!weather || !ranged || weather.wind !== "gale" || distanceTiles <= 6) {
    return { disadvantage: false, note: null };
  }
  return { disadvantage: true, note: "A gale: disadvantage on ranged attacks past 30 ft." };
}

// Frigid and hot air are the extreme cold and heat hazards on a long leg.
export function weatherExposure(weather: Weather | null): "extreme_cold" | "extreme_heat" | null {
  if (!weather) {
    return null;
  }
  if (weather.temperature === "frigid") {
    return "extreme_cold";
  }
  if (weather.temperature === "hot") {
    return "extreme_heat";
  }
  return null;
}

// Snow underfoot and a storm overhead halve the ground a march covers.
export function weatherTravelFactor(weather: Weather | null): number {
  if (!weather) {
    return 1;
  }
  if (weather.sky === "snow" && weather.precipitation >= 2) {
    return 0.5;
  }
  if (weather.sky === "storm") {
    return 0.5;
  }
  if (weather.sky === "snow" || weather.sky === "rain") {
    return 0.75;
  }
  return 1;
}

// The bed the room should play when the sky changes, or null to leave it.
export function weatherBedCue(weather: Weather | null): "storm" | "rain" | "wind" | null {
  if (!weather) {
    return null;
  }
  if (weather.sky === "storm") {
    return "storm";
  }
  if (weather.sky === "rain" && weather.precipitation >= 1) {
    return "rain";
  }
  if (weather.wind === "gale") {
    return "wind";
  }
  return null;
}

const SKY_WORDS: Record<Sky, string> = {
  clear: "a clear sky",
  overcast: "a low grey overcast",
  rain: "rain",
  storm: "a storm",
  snow: "snow",
  fog: "thick fog",
  wind: "a hard wind under a clear sky",
};

const TEMPERATURE_WORDS: Record<Temperature, string> = {
  frigid: "bitterly cold",
  cold: "cold",
  mild: "mild",
  warm: "warm",
  hot: "hot",
};

// One sentence for the prompt and the client, so both say the same thing.
export function describeWeather(weather: Weather | null): string {
  if (!weather) {
    return "";
  }
  const sky =
    weather.sky === "rain"
      ? weather.precipitation >= 2
        ? "driving rain"
        : "light rain"
      : weather.sky === "snow"
        ? weather.precipitation >= 3
          ? "heavy snow"
          : "falling snow"
        : SKY_WORDS[weather.sky];
  const wind =
    weather.wind === "gale" ? ", a gale blowing" : weather.wind === "breeze" ? ", a breeze" : "";
  const visibility =
    weatherObscurementTiles(weather) === 6
      ? "; visibility is very poor"
      : weatherObscurementTiles(weather) === 12
        ? "; visibility is poor"
        : "";
  return `Weather: ${TEMPERATURE_WORDS[weather.temperature]}, ${sky}${wind}${visibility}.`;
}

// Which climate a genre preset plays under, when the pack does not say.
export function climateForGenre(genre: string | undefined | null): Climate {
  switch (genre) {
    case "dark_fantasy":
    case "horror":
      return "boreal";
    case "post_apocalyptic":
      return "blighted";
    default:
      return "temperate";
  }
}
