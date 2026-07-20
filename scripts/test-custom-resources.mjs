// The generated custom genre-class resource counters: that resources.json
// is current with the catalogs, and that the counters land on real sheets.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);
const { populateResources, matchResource } = await import(
  "../src/lib/srd/class-resources.ts"
);

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const resources = JSON.parse(
  readFileSync(join(root, "src", "lib", "classes", "resources.json"), "utf8"),
).resources;

test("resources.json is not stale against the catalogs", () => {
  const result = spawnSync(
    process.execPath,
    [join(here, "generate-class-resources.mjs"), "--check"],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("the catalogs actually produced a body of counters", () => {
  assert.ok(resources.length > 150, `only ${resources.length} counters generated`);
});

test("every generated row is well formed", () => {
  const ids = new Set();
  for (const row of resources) {
    assert.match(row.id, /^[a-z0-9_]+$/, row.id);
    assert.equal(ids.has(row.id), false, `duplicate id ${row.id}`);
    ids.add(row.id);
    assert.ok(row.uses >= 1, row.id);
    assert.ok(row.match.length > 0, row.id);
    assert.ok(["short", "long"].includes(row.recharge), row.id);
    assert.ok(row.guidance.length > 0, row.id);
  }
});

test("a counter lands on a character carrying its feature", () => {
  // Pick a real generated counter and prove the feature name populates it.
  const sample = resources.find((row) => row.recharge === "short" && !row.ability);
  const map = populateResources(
    [{ name: sample.displayName }],
    5,
    { str: 0, dex: 0, con: 2, int: 1, wis: 3, cha: 1 },
    undefined,
  );
  assert.equal(map[sample.id]?.max, sample.uses);
  assert.equal(map[sample.id]?.used, 0);
});

test("an ability-scaled counter sizes to the modifier", () => {
  const scaled = resources.find((row) => row.ability);
  if (!scaled) {
    return;
  }
  const mods = { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 };
  mods[scaled.ability] = 4;
  const map = populateResources([{ name: scaled.displayName }], 8, mods, undefined);
  assert.ok(map[scaled.id].max >= 4, `${scaled.id} did not scale with ${scaled.ability}`);
});

test("an upgrade feature raises the base counter", () => {
  const upgraded = resources.find((row) => row.upgrades && row.upgrades.length);
  if (!upgraded) {
    return;
  }
  const upgrade = upgraded.upgrades[0];
  const base = populateResources(
    [{ name: upgraded.displayName }],
    10,
    { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 },
    undefined,
  );
  const withUpgrade = populateResources(
    [{ name: upgraded.displayName }, { name: upgrade.match }],
    10,
    { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 },
    undefined,
  );
  assert.ok(
    withUpgrade[upgraded.id].max >= base[upgraded.id].max,
    `${upgraded.id} upgrade did not raise the max`,
  );
  assert.equal(withUpgrade[upgraded.id].max, Math.max(upgraded.uses, upgrade.uses));
});

test("the model can find a custom counter by its display name", () => {
  const sample = resources[0];
  assert.equal(matchResource(sample.displayName)?.id, sample.id);
});

// Every genre catalog should contribute counters, so no class family is
// silently left without power bars.
test("all six genres are represented", () => {
  const genres = readdirSync(join(root, "src", "lib", "classes"))
    .filter((name) => name.endsWith("-features.json"))
    .map((name) => name.replace("-features.json", ""));
  for (const genre of genres) {
    const prefix = `${genre.replace(/[^a-z0-9]+/g, "_")}_`;
    assert.ok(
      resources.some((row) => row.id.startsWith(prefix)),
      `no counters generated for ${genre}`,
    );
  }
});

console.log(`test-custom-resources: ${passed} passed`);
