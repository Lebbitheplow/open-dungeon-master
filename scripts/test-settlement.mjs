// The settlement generator (docs/vtt-parity-implementation-plan.md 12.1):
// seeded and pure, it writes the same place for the same seed, sizes its
// cast and market to the settlement, and never hands two people one name.
// Then the applier writes it into a campaign once and refuses a second time.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";
import { removeTempDir } from "./lib/remove-temp-dir.mjs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "odm-settlement-"));
process.env.SQLITE_DB_PATH = path.join(dir, "test.sqlite");
process.env.DB_ENCRYPTION_KEY = randomBytes(32).toString("hex");

register("./lib/register-alias.mjs", import.meta.url);

const { generateSettlement, seededRandom, seedFromText, placeName, personName, SETTLEMENT_SIZES } = await import("../src/lib/overworld/settlement.ts");
const { createUser } = await import("../src/lib/db/users.ts");
const { createCampaign } = await import("../src/lib/db/campaigns.ts");
const { insertKnownLocation, getLocation } = await import("../src/lib/db/locations.ts");
const { listNpcs } = await import("../src/lib/db/npcs.ts");
const { listShops } = await import("../src/lib/db/shops.ts");
const { listRollTables } = await import("../src/lib/db/roll-tables.ts");
const { listLoreEntries } = await import("../src/lib/db/lore.ts");
const { populateSettlement, placeIsWritten } = await import("../src/lib/dm/settlement.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

test("the same seed writes the same place, another seed another", () => {
  const first = generateSettlement({ size: "village", terrain: "river", genre: "high_fantasy", seed: 7 });
  const again = generateSettlement({ size: "village", terrain: "river", genre: "high_fantasy", seed: 7 });
  assert.deepEqual(first, again);
  const other = generateSettlement({ size: "village", terrain: "river", genre: "high_fantasy", seed: 8 });
  assert.notEqual(first.name, other.name);
  assert.equal(seedFromText("Thornhollow"), seedFromText("Thornhollow"));
  const random = seededRandom(3);
  const draws = [random(), random(), random()];
  assert.ok(draws.every((value) => value >= 0 && value < 1));
});

test("the cast and the market grow with the settlement", () => {
  const thorp = generateSettlement({ size: "thorp", seed: 1 });
  const city = generateSettlement({ size: "city", seed: 1 });
  assert.equal(thorp.npcs.length, 3);
  assert.equal(city.npcs.length, 8);
  assert.equal(thorp.shops.length, 1);
  assert.equal(city.shops.length, 5);
  assert.equal(thorp.shops[0].size, "hamlet");
  assert.equal(city.shops[0].size, "city");
  assert.equal(thorp.rumours.length, 2);
  assert.ok(thorp.hook.title && thorp.hook.body);
  for (const size of SETTLEMENT_SIZES) {
    assert.ok(generateSettlement({ size, seed: 2 }).layoutDescription.length > 20);
  }
});

test("everyone has their own name and lives at the place", () => {
  for (let seed = 1; seed < 40; seed += 1) {
    const place = generateSettlement({ size: "city", seed });
    const names = place.npcs.map((npc) => npc.name);
    assert.equal(new Set(names).size, names.length, `seed ${seed} repeated a name`);
    assert.ok(place.npcs.every((npc) => npc.location === place.name));
    assert.equal(place.npcs[0].role, "innkeeper");
  }
});

test("names follow the genre's feel", () => {
  const random = seededRandom(5);
  assert.match(placeName(random, "dark_fantasy"), /^[A-Z]/);
  assert.match(personName(random, "mystery"), /^[A-Z][a-z]+ [A-Z][a-z]+$/);
  assert.equal(generateSettlement({ name: "Given Name", seed: 1 }).name, "Given Name");
  assert.equal(generateSettlement({ size: "nonsense", terrain: "moon", seed: 1 }).size, "village");
});

const dm = createUser("dm", "x");
const campaign = createCampaign(dm.id, { title: "T", description: "", theme: "", maxPlayers: 4, startingLevel: 3, difficulty: "normal" });
const place = insertKnownLocation({ campaignId: campaign.id, name: "Thornhollow", layoutDescription: "" });

test("populating a place writes its people, shops, rumours and hook, once", () => {
  assert.equal(placeIsWritten(campaign, place), false);
  const outcome = populateSettlement(campaign, place, { size: "village", terrain: "forest" });
  assert.equal(outcome.ok, true, outcome.error);
  assert.equal(outcome.npcs, 6);
  assert.equal(outcome.shops, 2);
  assert.equal(listNpcs(campaign.id).filter((npc) => npc.location === "Thornhollow").length, 6);
  assert.equal(listShops(campaign.id).length, 2);
  assert.ok(listShops(campaign.id).every((shop) => shop.locationId === place.id));
  assert.ok(listRollTables(campaign.id).some((table) => table.name === "Rumours in Thornhollow"));
  const hook = listLoreEntries(campaign.id).find((entry) => entry.tags.includes("hook"));
  assert.ok(hook, "no hook lore entry");
  assert.equal(hook.visibility, "dm");
  assert.ok(getLocation(place.id).layoutDescription.length > 20);
  assert.equal(placeIsWritten(campaign, place), true);
  assert.match(populateSettlement(campaign, place, {}).error, /already has people/);
});

console.log(`settlement: ${passed} tests passed`);
removeTempDir(dir);
