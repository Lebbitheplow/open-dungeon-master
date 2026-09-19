// Which painted flipbook an effect plays, and that the sheets it names are on
// disk in the shape the player reads. See docs/visual-overhaul-plan.md 8b.3.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { FLIPBOOK_BY_DAMAGE, flipbookFor, flipbookFrame } = await import("../src/lib/battlemap/flipbooks.ts");

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

test("energy damage, healing, death and crits have a sheet; the mundane does not", () => {
  assert.equal(flipbookFor({ kind: "attack", outcome: "hit", damageType: "Fire" }), "burst-fire");
  assert.equal(flipbookFor({ kind: "spell", damageType: "necrotic" }), "burst-necrotic");
  assert.equal(flipbookFor({ kind: "heal" }), "heal-bloom");
  assert.equal(flipbookFor({ kind: "death" }), "death-collapse");
  assert.equal(flipbookFor({ kind: "attack", outcome: "crit", damageType: "slashing" }), "crit-flare");
  assert.equal(flipbookFor({ kind: "attack", outcome: "hit", damageType: "bludgeoning" }), null);
  assert.equal(flipbookFor({ kind: "door" }), null);
});

test("a miss paints nothing, whatever it would have dealt", () => {
  assert.equal(flipbookFor({ kind: "attack", outcome: "miss", damageType: "fire" }), null);
  assert.equal(flipbookFor({ kind: "attack", damageType: "fire" }), null);
});

test("a sheet plays its frames once and ends", () => {
  const sheet = { frames: 41, fps: 24 };
  assert.equal(flipbookFrame(sheet, 0), 0);
  assert.equal(flipbookFrame(sheet, 1000), 24);
  assert.equal(flipbookFrame(sheet, 1700), 40);
  assert.equal(flipbookFrame(sheet, 1750), -1);
  assert.equal(flipbookFrame(sheet, -5), -1);
});

const manifestPath = path.join(ROOT, "public", "fx", "manifest.json");
if (existsSync(manifestPath)) {
  const sheets = new Map(JSON.parse(readFileSync(manifestPath, "utf8")).sheets.map((s) => [s.id, s]));

  test("every sheet the board can ask for exists, on disk, in the player's shape", () => {
    for (const id of [...Object.values(FLIPBOOK_BY_DAMAGE), "heal-bloom", "death-collapse", "crit-flare"]) {
      const sheet = sheets.get(id);
      assert.ok(sheet, `${id} is not in public/fx/manifest.json`);
      assert.ok(existsSync(path.join(ROOT, "public", sheet.src)), `${sheet.src} is missing`);
      assert.ok(sheet.frames > 0 && sheet.columns > 0 && sheet.frame > 0 && sheet.fps > 0, id);
    }
  });

  test("the manifest lists no sheet whose file is gone", () => {
    assert.deepEqual([...sheets.values()].filter((s) => !existsSync(path.join(ROOT, "public", s.src))).map((s) => s.id), []);
  });
}

console.log(`flipbooks: ${passed} checks passed`);
