// The pure parts of the painted board: how sharp a picture a board gets, what
// makes it repaint, and that a setting always resolves to a skin whose
// materials exist. The painting itself needs a canvas and is checked in the
// browser. See docs/visual-overhaul-plan.md 3.6 and 3.8.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { cellSizeFor, paintKey } = await import("../src/lib/battlemap/render/painted.ts");
const { skinFor, defaultSkinFor, SKINS } = await import("../src/lib/battlemap/skins.ts");
const { MAP_THEMES } = await import("../src/lib/battlemap/generate.ts");

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

test("a small board is painted sharp, a huge one stays inside the pixel budget", () => {
  assert.equal(cellSizeFor(20, 15, "full"), 48);
  assert.equal(cellSizeFor(20, 15, "low"), 32);
  for (const [w, h] of [[60, 40], [80, 80], [120, 90]]) {
    const cell = cellSizeFor(w, h, "full");
    assert.ok(cell >= 16 && w * h * cell * cell <= 3_300_000, `${w}x${h} at ${cell}`);
    assert.ok(cellSizeFor(w, h, "low") <= cell);
  }
});

test("the picture repaints when the explored terrain, the setting or the quality changes, and not otherwise", () => {
  const base = { width: 3, height: 1, terrain: ".# ", theme: "interior", genre: "high_fantasy", seedKey: "map-1", quality: "full" };
  assert.equal(paintKey(base), paintKey({ ...base }));
  assert.notEqual(paintKey(base), paintKey({ ...base, terrain: ".#." }));
  assert.notEqual(paintKey(base), paintKey({ ...base, genre: "cyberpunk" }));
  assert.notEqual(paintKey(base), paintKey({ ...base, quality: "low" }));
  assert.notEqual(paintKey(base), paintKey({ ...base, seedKey: "map-2" }));
});

test("every map theme in every setting resolves to a real skin", () => {
  for (const genre of [null, "high_fantasy", "dark_fantasy", "cyberpunk", "steampunk", "post_apocalyptic", "post-apocalyptic", "horror", "mystery", "custom", "nonsense"]) {
    for (const theme of [...MAP_THEMES, "unknown-theme", null]) {
      const skin = skinFor(genre, theme);
      assert.ok(skin && SKINS.includes(skin), `${genre} / ${theme}`);
      assert.equal(skin.id, defaultSkinFor(genre, theme));
    }
  }
  assert.equal(skinFor("cyberpunk", "interior").genre, "cyberpunk");
  assert.equal(skinFor("post-apocalyptic", "field").genre, "post_apocalyptic");
  assert.equal(skinFor("high_fantasy", "cave").genre, undefined);
});

const manifestPath = path.join(ROOT, "public", "assets", "tiles", "manifest.json");
if (existsSync(manifestPath)) {
  const ids = new Set(JSON.parse(readFileSync(manifestPath, "utf8")).tiles.map((t) => t.id));
  test("every skin paints all six terrain characters with materials that shipped", () => {
    for (const skin of SKINS) {
      for (const ch of [".", "#", "~", ",", "+", "|"]) {
        assert.ok(ids.has(skin.bind[ch]), `${skin.id} binds "${ch}" to ${skin.bind[ch]}`);
      }
    }
  });
}

console.log(`painted maps: ${passed} checks passed`);
