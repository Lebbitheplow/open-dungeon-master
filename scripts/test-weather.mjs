// The weather engine: tables per climate, persistence between rolls, and
// every rider the rest of the engine asks about (docs/vtt-parity-
// implementation-plan.md section 2.1).
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const {
  CLIMATES,
  PERSISTENCE,
  climateForGenre,
  describeWeather,
  normalizeWeather,
  rollWeather,
  weatherBedCue,
  weatherExposure,
  weatherObscurementTiles,
  weatherPerceptionRider,
  weatherRangedRider,
  weatherTravelFactor,
} = await import("../src/lib/srd/weather.ts");
const { mulberry } = await import("../src/lib/particles.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

const SKIES = new Set(["clear", "overcast", "rain", "storm", "snow", "fog", "wind"]);

test("every climate and season rolls a well-formed weather", () => {
  const rng = mulberry(3);
  for (const climate of CLIMATES) {
    for (const season of ["winter", "spring", "summer", "autumn"]) {
      for (let i = 0; i < 20; i += 1) {
        const weather = rollWeather(climate, season, null, rng);
        assert.ok(SKIES.has(weather.sky), `${climate} ${season} sky ${weather.sky}`);
        assert.ok(["frigid", "cold", "mild", "warm", "hot"].includes(weather.temperature));
        assert.ok(["calm", "breeze", "gale"].includes(weather.wind));
        assert.ok(weather.precipitation >= 0 && weather.precipitation <= 3);
        if (weather.sky === "storm") {
          assert.equal(weather.precipitation, 3);
        }
        if (weather.sky === "clear" || weather.sky === "wind") {
          assert.equal(weather.precipitation, 0);
        }
      }
    }
  }
});

test("climates lean the way they should", () => {
  const rng = mulberry(11);
  const count = (climate, season, sky) => {
    let n = 0;
    for (let i = 0; i < 400; i += 1) {
      if (rollWeather(climate, season, null, rng).sky === sky) {
        n += 1;
      }
    }
    return n;
  };
  assert.ok(count("arid", "summer", "clear") > 200, "the desert is mostly clear");
  assert.ok(count("arid", "summer", "snow") === 0, "it does not snow in the desert in summer");
  assert.ok(count("boreal", "winter", "snow") > 100, "the north snows in winter");
  assert.ok(count("blighted", "spring", "clear") < 60, "the blight rarely clears");
  assert.ok(count("tropical", "autumn", "rain") + count("tropical", "autumn", "storm") > 200);
});

test("the sky persists sixty percent of the time", () => {
  const rng = mulberry(5);
  const previous = { sky: "fog", temperature: "cold", wind: "calm", precipitation: 0 };
  let kept = 0;
  const trials = 1000;
  for (let i = 0; i < trials; i += 1) {
    if (rollWeather("temperate", "summer", previous, rng).sky === "fog") {
      kept += 1;
    }
  }
  // Fog is rare in a temperate summer, so nearly every keep is persistence.
  assert.ok(kept / trials > PERSISTENCE - 0.08 && kept / trials < PERSISTENCE + 0.1, `kept ${kept}`);
});

test("temperature follows climate and season, and cold weather knocks it down", () => {
  const rng = mulberry(9);
  const temps = new Set();
  for (let i = 0; i < 200; i += 1) {
    temps.add(rollWeather("boreal", "winter", null, rng).temperature);
  }
  assert.ok(temps.has("frigid"), "a boreal winter is frigid");
  assert.ok(!temps.has("hot") && !temps.has("warm"), "and never warm");
  const desert = new Set();
  for (let i = 0; i < 200; i += 1) {
    desert.add(rollWeather("arid", "summer", null, rng).temperature);
  }
  assert.ok(desert.has("hot"));
});

test("rain and fog give disadvantage on Perception by sight", () => {
  const fog = { sky: "fog", temperature: "mild", wind: "calm", precipitation: 0 };
  const drizzle = { sky: "rain", temperature: "mild", wind: "calm", precipitation: 1 };
  const downpour = { sky: "rain", temperature: "mild", wind: "calm", precipitation: 2 };
  assert.equal(weatherPerceptionRider(fog).disadvantage, true);
  assert.equal(weatherPerceptionRider(fog).passiveMod, -5);
  assert.equal(weatherPerceptionRider(drizzle).disadvantage, false);
  assert.equal(weatherPerceptionRider(downpour).disadvantage, true);
  assert.equal(weatherPerceptionRider(null).passiveMod, 0);
});

test("obscurement: sixty feet in heavy rain, thirty in fog, none when clear", () => {
  assert.equal(weatherObscurementTiles({ sky: "fog", temperature: "mild", wind: "calm", precipitation: 0 }), 6);
  assert.equal(weatherObscurementTiles({ sky: "rain", temperature: "mild", wind: "calm", precipitation: 2 }), 12);
  assert.equal(weatherObscurementTiles({ sky: "rain", temperature: "mild", wind: "calm", precipitation: 1 }), Infinity);
  assert.equal(weatherObscurementTiles({ sky: "clear", temperature: "mild", wind: "gale", precipitation: 0 }), Infinity);
  assert.equal(weatherObscurementTiles(null), Infinity);
});

test("a gale gives disadvantage on ranged attacks past 30 ft only", () => {
  const gale = { sky: "wind", temperature: "mild", wind: "gale", precipitation: 0 };
  assert.equal(weatherRangedRider(gale, true, 7).disadvantage, true);
  assert.equal(weatherRangedRider(gale, true, 6).disadvantage, false, "30 ft is fine");
  assert.equal(weatherRangedRider(gale, false, 9).disadvantage, false, "melee is unaffected");
  const breeze = { ...gale, wind: "breeze" };
  assert.equal(weatherRangedRider(breeze, true, 9).disadvantage, false);
  assert.equal(weatherRangedRider(null, true, 9).disadvantage, false);
});

test("frigid and hot air are the exposure hazards; snow and storm slow a march", () => {
  assert.equal(weatherExposure({ sky: "clear", temperature: "frigid", wind: "calm", precipitation: 0 }), "extreme_cold");
  assert.equal(weatherExposure({ sky: "clear", temperature: "hot", wind: "calm", precipitation: 0 }), "extreme_heat");
  assert.equal(weatherExposure({ sky: "clear", temperature: "cold", wind: "calm", precipitation: 0 }), null);
  assert.equal(weatherTravelFactor({ sky: "snow", temperature: "cold", wind: "calm", precipitation: 2 }), 0.5);
  assert.equal(weatherTravelFactor({ sky: "storm", temperature: "cold", wind: "gale", precipitation: 3 }), 0.5);
  assert.equal(weatherTravelFactor({ sky: "rain", temperature: "cold", wind: "calm", precipitation: 1 }), 0.75);
  assert.equal(weatherTravelFactor({ sky: "clear", temperature: "mild", wind: "calm", precipitation: 0 }), 1);
});

test("the room follows the sky: storm, rain and gale beds", () => {
  assert.equal(weatherBedCue({ sky: "storm", temperature: "mild", wind: "gale", precipitation: 3 }), "storm");
  assert.equal(weatherBedCue({ sky: "rain", temperature: "mild", wind: "calm", precipitation: 1 }), "rain");
  assert.equal(weatherBedCue({ sky: "clear", temperature: "mild", wind: "gale", precipitation: 0 }), "wind");
  assert.equal(weatherBedCue({ sky: "clear", temperature: "mild", wind: "calm", precipitation: 0 }), null);
});

test("the sentence the prompt and the client share", () => {
  assert.equal(
    describeWeather({ sky: "rain", temperature: "cold", wind: "gale", precipitation: 2 }),
    "Weather: cold, driving rain, a gale blowing; visibility is poor.",
  );
  assert.equal(
    describeWeather({ sky: "fog", temperature: "mild", wind: "calm", precipitation: 0 }),
    "Weather: mild, thick fog; visibility is very poor.",
  );
  assert.equal(describeWeather(null), "");
});

test("stored weather normalises and garbage reads as none", () => {
  assert.deepEqual(normalizeWeather({ sky: "snow", temperature: "cold", wind: "breeze", precipitation: "2" }), {
    sky: "snow",
    temperature: "cold",
    wind: "breeze",
    precipitation: 2,
  });
  assert.equal(normalizeWeather({ sky: "lava" }), null);
  assert.equal(normalizeWeather(null), null);
  assert.deepEqual(normalizeWeather({ sky: "clear" }), { sky: "clear", temperature: "mild", wind: "calm", precipitation: 0 });
});

test("genres pick their climate", () => {
  assert.equal(climateForGenre("high_fantasy"), "temperate");
  assert.equal(climateForGenre("dark_fantasy"), "boreal");
  assert.equal(climateForGenre("post_apocalyptic"), "blighted");
  assert.equal(climateForGenre(undefined), "temperate");
});

console.log(`test-weather: ${passed} passed`);
