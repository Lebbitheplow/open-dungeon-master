// A place's kind of scene (one of the ambience beds) is what the game reads
// about it: move_party and update_location store it on the place, the bed
// follows it, and the battle map drawn there takes its terrain and light
// from it. Nothing reads the place's name or description, so a place named
// in any language plays the same.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";

const { test, finish } = suite("test-scene-kind");
const world = await openWorld({ gameSettings: { ttsEnabled: false } });
const { getCurrentLocation } = await import("../src/lib/db/locations.ts");
const { getAmbience } = await import("../src/lib/db/ambience.ts");
const { getBattleMapForEncounter } = await import("../src/lib/db/battle-maps.ts");

world.addHero({ name: "Kara" });

await test("move_party stores the scene on the place and the bed follows it.", async () => {
  const moved = await world.invoke("move_party", { name: "La Cripta di Vael", layoutDescription: "Una cripta allagata.", scene: "crypt" });
  assert.ok(moved.ok, moved.error);
  assert.equal(getCurrentLocation(world.campaignId)?.ambience?.bed, "crypt");
  assert.equal(getAmbience(world.campaignId).bed, "crypt");
});

await test("A scene that is not a bed is refused with the list of beds.", async () => {
  const refused = await world.invoke("move_party", { name: "Il Bosco", scene: "bosco" });
  const error = refused.ok ? String(refused.result?.error ?? "") : refused.error;
  assert.match(error, /one of: .*forest/);
});

await test("The sky and the clock are not kinds of place: they stay sounds, the weather's own.", async () => {
  const { cueIds, sceneIds } = await import("../src/lib/ambience/catalog.ts");
  for (const bed of ["rain", "storm", "wind", "night"]) {
    assert.ok(cueIds("bed").includes(bed), `${bed} is still a bed`);
    assert.ok(!sceneIds().includes(bed), `${bed} is not a scene`);
  }
  const refused = await world.invoke("update_location", { name: "La Cripta di Vael", layoutDescription: "Piove dentro.", visionClear: true, scene: "rain" });
  const error = refused.ok ? String(refused.result?.error ?? "") : refused.error;
  const offered = error.split("one of:")[1] ?? "";
  assert.match(offered, /crypt/, error);
  assert.doesNotMatch(offered, /\brain\b/, "the refusal lists only kinds of place");
  assert.equal(getCurrentLocation(world.campaignId)?.ambience?.bed, "crypt");
});

await test("update_location without a scene keeps the place's own.", async () => {
  const updated = await world.invoke("update_location", { name: "La Cripta di Vael", layoutDescription: "Acqua alle ginocchia." });
  assert.ok(updated.ok, updated.error);
  assert.equal(getCurrentLocation(world.campaignId)?.ambience?.bed, "crypt");
});

await test("A fight in the crypt is drawn underground, in the dark.", async () => {
  const encounter = await world.beginFight([{ monster: "goblin", count: 1 }]);
  const map = getBattleMapForEncounter(encounter.id);
  assert.equal(map?.theme, "cave");
  assert.equal(map?.ambient, "dark");
});

world.close();
finish();
