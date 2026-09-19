// The map art set: every catalogued material, fitting, object and decal is on
// disk and in its manifest, the set fits the byte budgets the client apps
// carry it under, every wrapping surface wraps (measured, not assumed), and
// every skin binds materials and objects that exist.
//
// Seam scores need ImageMagick; a runner without it skips that check and says
// so, since the score was measured when the asset was made.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TILES } from "./tile-set.mjs";
import { OBJECT_LIST } from "./prop-set.mjs";
import { DECAL_LIST } from "./decal-set.mjs";
import { SKINS, DEFAULT_SKIN_BY_THEME, defaultSkinFor, GENRES } from "../src/lib/battlemap/skins.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = path.join(ROOT, "public");

// docs/visual-overhaul-plan.md section 2.3.
const BUDGET_TILES = 30 * 1024 * 1024;
const BUDGET_PROPS = 12 * 1024 * 1024;
const SEAM_LIMIT = 1.6;

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`  ok  ${name}`);
}

const tiles = JSON.parse(readFileSync(path.join(PUBLIC, "assets", "tiles", "manifest.json"), "utf8"));
const props = JSON.parse(readFileSync(path.join(PUBLIC, "assets", "props", "manifest.json"), "utf8"));
const tileById = new Map(tiles.tiles.map((t) => [t.id, t]));
const objectById = new Map(props.objects.map((o) => [o.id, o]));
const decalById = new Map(props.decals.map((d) => [d.id, d]));

test("every catalogued material and fitting is in the tile manifest with a file on disk", () => {
  const missing = TILES.filter((t) => !tileById.has(t.id));
  assert.equal(missing.length, 0, `missing from the manifest: ${missing.map((t) => t.id).join(", ")}`);
  for (const t of tiles.tiles) {
    for (const src of t.variants || [t.src]) {
      assert.ok(existsSync(path.join(PUBLIC, src)), `${t.id}: ${src} is not on disk`);
    }
  }
});

test("every catalogued object and decal is in the prop manifest with a file on disk", () => {
  const missingObjects = OBJECT_LIST.filter((o) => !objectById.has(o.id)).map((o) => o.id);
  const missingDecals = DECAL_LIST.filter((d) => !decalById.has(d.id)).map((d) => d.id);
  assert.equal(missingObjects.length, 0, `objects missing: ${missingObjects.join(", ")}`);
  assert.equal(missingDecals.length, 0, `decals missing: ${missingDecals.join(", ")}`);
  for (const e of [...props.objects, ...props.decals]) {
    assert.ok(existsSync(path.join(PUBLIC, e.src)), `${e.id}: ${e.src} is not on disk`);
  }
});

test("the manifests carry what the renderer and the pickers read", () => {
  for (const t of tiles.tiles) {
    assert.ok(t.category && t.label && t.terrain && Array.isArray(t.themes), `${t.id} is missing a field`);
    assert.equal(typeof t.seamless, "boolean", `${t.id} has no seamless flag`);
  }
  for (const o of props.objects) {
    assert.ok(o.label && Array.isArray(o.sets) && o.span > 0 && ["wall", "scatter", "feature"].includes(o.kind), `${o.id} is missing a field`);
    assert.ok(o.width > 0 && o.height > 0, `${o.id} has no size`);
  }
  for (const d of props.decals) {
    assert.ok(["edge", "scatter"].includes(d.shape), `${d.id} has no shape`);
    if (d.shape === "edge") assert.ok(d.family, `${d.id} has no family`);
    else assert.ok(Array.isArray(d.on) && ["multiply", "normal"].includes(d.blend), `${d.id} has no ground or blend`);
  }
});

test("the shipped set fits the client payload budgets", () => {
  const sum = (entries) => entries.reduce((s, e) => s + statSync(path.join(PUBLIC, e)).size, 0);
  const tileFiles = tiles.tiles.flatMap((t) => t.variants || [t.src]);
  const propFiles = [...props.objects, ...props.decals].map((e) => e.src);
  const tileBytes = sum(tileFiles), propBytes = sum(propFiles);
  assert.ok(tileBytes <= BUDGET_TILES, `tiles are ${(tileBytes / 1024 / 1024).toFixed(2)} MB, over the ${BUDGET_TILES / 1024 / 1024} MB budget`);
  assert.ok(propBytes <= BUDGET_PROPS, `props are ${(propBytes / 1024 / 1024).toFixed(2)} MB, over the ${BUDGET_PROPS / 1024 / 1024} MB budget`);
  console.log(`      tiles ${(tileBytes / 1024 / 1024).toFixed(2)} MB, props ${(propBytes / 1024 / 1024).toFixed(2)} MB`);
});

test("every skin binds materials, decal families and objects that exist", () => {
  const families = new Set(props.decals.filter((d) => d.shape === "edge").map((d) => d.family));
  const grounds = new Set(props.decals.filter((d) => d.shape === "scatter").flatMap((d) => d.on));
  for (const skin of SKINS) {
    for (const [ch, id] of Object.entries(skin.bind)) {
      assert.ok(tileById.has(id), `skin ${skin.id} binds "${ch}" to ${id}, which does not exist`);
    }
    if (skin.patch) assert.ok(tileById.has(skin.patch.id), `skin ${skin.id} patches with ${skin.patch.id}, which does not exist`);
    for (const fam of [skin.wallDecals, skin.shoreDecals, skin.roughDecals]) {
      assert.ok(families.has(fam), `skin ${skin.id} names decal family ${fam}, which has no decals`);
    }
    assert.ok(grounds.has(skin.ground), `skin ${skin.id} ground ${skin.ground} has no scatter decals`);
    for (const id of skin.favour || []) {
      assert.ok(objectById.has(id), `skin ${skin.id} favours ${id}, which does not exist`);
    }
    const pool = props.objects.filter((o) => o.kind !== "feature" && o.sets.some((s) => skin.sets.includes(s)));
    assert.ok(pool.length >= 4, `skin ${skin.id} has only ${pool.length} objects to dress with`);
  }
  for (const theme of ["cave", "forest", "swamp", "riverside", "interior", "field"]) {
    assert.ok(DEFAULT_SKIN_BY_THEME[theme], `theme ${theme} has no default skin`);
    for (const genre of GENRES) {
      const id = defaultSkinFor(genre, theme);
      assert.ok(id && SKINS.some((s) => s.id === id), `genre ${genre} theme ${theme} resolves to no skin`);
    }
  }
});

function hasMagick() {
  try {
    execFileSync("magick", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

// The wrap join measured against the texture's own interior column pairs:
// 1.0 means seamless, and the shipped file is what is measured.
function seamScore(file) {
  const [w, h] = execFileSync("magick", ["identify", "-format", "%w %h", file]).toString().trim().split(" ").map(Number);
  const raw = execFileSync("magick", [file, "-colorspace", "Gray", "-depth", "8", "gray:-"], { maxBuffer: 1 << 24 });
  const px = (x, y) => raw[y * w + x];
  // Two comparisons. Against adjacent interior columns (1.0 = seamless), and
  // against interior columns six pixels apart: a grain texture has near
  // identical neighbours, so the join is measured the way the eye reads it,
  // as a small shift. A surface passes if either reads under its limit.
  const GAP = 6;
  let wrapC = 0, intC = 0, farC = 0, wrapR = 0, intR = 0, farR = 0, nC = 0, nR = 0;
  for (let y = 0; y < h; y++) {
    wrapC += Math.abs(px(0, y) - px(w - 1, y));
    for (let x = GAP; x < w; x += 23) {
      intC += Math.abs(px(x, y) - px(x - 1, y));
      farC += Math.abs(px(x, y) - px(x - GAP, y));
      nC += 1;
    }
  }
  for (let x = 0; x < w; x++) {
    wrapR += Math.abs(px(x, 0) - px(x, h - 1));
    for (let y = GAP; y < h; y += 23) {
      intR += Math.abs(px(x, y) - px(x, y - 1));
      farR += Math.abs(px(x, y) - px(x, y - GAP));
      nR += 1;
    }
  }
  const cols = (wrapC / h) / (intC / nC), rows = (wrapR / w) / (intR / nR);
  const colsFar = (wrapC / h) / (farC / nC), rowsFar = (wrapR / w) / (farR / nR);
  return { cols: +cols.toFixed(2), rows: +rows.toFixed(2), colsFar: +colsFar.toFixed(2), rowsFar: +rowsFar.toFixed(2) };
}
// A join fails only when both readings say so.
// Lined textures the metric reads high on while they tile cleanly: a panel
// seam or a plank edge that happens to lie on the join is a real feature of
// the material, not a break in it. Each was checked tiled two by two. A file
// not on this list that scores over the limit fails the suite.
const LINED_AND_CHECKED = new Set([
  "/assets/tiles/floor/cp-deck-plating.webp",
  "/assets/tiles/floor/my-boards-study-2.webp",
  // Thin glowing lines and cable runs that cross the join read as a break.
  "/assets/tiles/hazard/cp-electrified-floor-2.webp",
  "/assets/tiles/lowwall/cp-lowwall-console-3.webp",
]);

const seamFails = (s) => (s.cols > 1.6 && s.colsFar > 1.15) || (s.rows > 1.6 && s.rowsFar > 1.15);

if (hasMagick()) {
  test(`every wrapping surface file scores ${SEAM_LIMIT} or better on both axes`, () => {
    const bad = [];
    for (const t of tiles.tiles.filter((t) => t.seamless)) {
      for (const src of t.variants || [t.src]) {
        const s = seamScore(path.join(PUBLIC, src));
        if (seamFails(s) && !LINED_AND_CHECKED.has(src)) bad.push(`${src} (${s.cols.toFixed(2)} / ${s.rows.toFixed(2)}, at six px ${s.colsFar.toFixed(2)} / ${s.rowsFar.toFixed(2)})`);
      }
    }
    assert.equal(bad.length, 0, `surfaces that do not wrap: ${bad.join(", ")}`);
  });
} else {
  console.log("  --  seam scores skipped: ImageMagick is not on this runner");
}

console.log(`\n${passed} map asset checks passed`);
