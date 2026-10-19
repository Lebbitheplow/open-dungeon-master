// Issue 411: the genre classes' rules text is out of every page's first
// load. The grant tables read feature-names.json, generated from the six
// *-features.json catalogs; the text is fetched per catalog when a sheet asks
// (src/lib/classes/feature-text.ts), and the server registers all of it at
// once for the DM prompt (feature-text-all.ts).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import { fileURLToPath } from "node:url";

register("./lib/register-alias.mjs", import.meta.url);

const { classFeatureDescription, loadClassFeatureText, featureTextVersion, onFeatureText } = await import(
  "../src/lib/classes/feature-text.ts"
);
const { CUSTOM_CLASS_FEATURES } = await import("../src/lib/classes/index.ts");
const { describeFeature } = await import("../src/lib/help/index.ts");

let passed = 0;
async function test(name, fn) {
  await fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

const catalog = (file) => JSON.parse(readFileSync(new URL(`../src/lib/classes/${file}-features.json`, import.meta.url), "utf8"));

await test("feature-names.json is current with the catalogs", () => {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL("./build-feature-names.mjs", import.meta.url)), "--check"], {
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

await test("the grant tables carry every catalog name and no rules text", () => {
  const cyber = catalog("cyberpunk").classes.netrunner;
  assert.deepEqual(CUSTOM_CLASS_FEATURES.netrunner.levels["1"], cyber.levels["1"].map((feature) => feature.n));
  assert.equal(CUSTOM_CLASS_FEATURES.netrunner.subclasses[0].name, cyber.subclass.name);
  const names = readFileSync(new URL("../src/lib/classes/feature-names.json", import.meta.url), "utf8");
  assert.ok(!names.includes(cyber.levels["1"][0].d), "a line of rules text is in the names table");
});

await test("nothing is known until asked; asking fetches only that class's catalog", async () => {
  const horrorClass = Object.keys(catalog("horror").classes)[0];
  const horrorFeature = Object.values(catalog("horror").classes[horrorClass].levels)[0][0];
  assert.equal(classFeatureDescription("netrunner", "Deck Interface"), null);
  assert.equal(describeFeature("netrunner", "", "Deck Interface"), null);
  let heard = 0;
  const stop = onFeatureText(() => {
    heard += 1;
  });
  const before = featureTextVersion();
  await loadClassFeatureText(["netrunner", "fighter", "homebrew:abc"]);
  stop();
  assert.match(classFeatureDescription("netrunner", "deck  interface") ?? "", /cyberdeck/);
  assert.match(describeFeature("netrunner", "", "Deck Interface") ?? "", /cyberdeck/);
  assert.ok(featureTextVersion() > before && heard === 1, "the hook's store moved once");
  assert.equal(classFeatureDescription(horrorClass, horrorFeature.n), null, "another genre's catalog stayed unfetched");
  await loadClassFeatureText(["netrunner"]);
  assert.equal(featureTextVersion(), before + 1, "a catalog is fetched once");
});

await test("the server registers every catalog at once", async () => {
  await import("../src/lib/classes/feature-text-all.ts");
  for (const file of ["cyberpunk", "dark-fantasy", "horror", "mystery", "post-apocalyptic", "steampunk"]) {
    for (const [classId, table] of Object.entries(catalog(file).classes)) {
      for (const features of [...Object.values(table.levels), ...Object.values(table.subclass.levels)]) {
        for (const feature of features) {
          assert.ok(classFeatureDescription(classId, feature.n), `${classId}: ${feature.n} has no text`);
        }
      }
    }
  }
});

console.log(`feature text: ${passed} checks passed`);
