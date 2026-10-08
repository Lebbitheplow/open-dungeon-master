// The Map Forge's pure half (docs/visual-overhaul-plan.md 4.1 and 4.8): the
// preview and the saved map are the same map, the read-back says what the kind
// of place decided, the history keeps seven, and the reveal floods outward.
// The agreement check needs the library, and so a throwaway database.
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { register } from "node:module";
import os from "node:os";
import path from "node:path";
import { removeTempDir } from "./lib/remove-temp-dir.mjs";

const dbPath = path.join(mkdtempSync(path.join(os.tmpdir(), "odm-forge-")), "test.sqlite");
process.env.SQLITE_DB_PATH = dbPath;
process.env.DB_ENCRYPTION_KEY = randomBytes(32).toString("hex");

register("./lib/register-alias.mjs", import.meta.url);
globalThis.__odmEmbedderPromise = Promise.resolve((texts) =>
  Promise.resolve({ tolist: () => texts.map(() => new Array(384).fill(0.1)) }),
);

const forge = await import("../src/app/workshop/maps/forge.ts");
const { MAP_SIZE, generateBattleMap } = await import("../src/lib/battlemap/generate.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

const label = (theme) => ({ cave: "Cave", forest: "Forest", swamp: "Swamp", riverside: "Water", interior: "Indoors", field: "Open ground" })[theme];

const sceneLabel = (scene) => ({ crypt: "Crypt", desert: "Desert", tavern: "Tavern" })[scene] ?? scene;

test("the outcome is what the generator draws for every kind of place, and open ground for none", () => {
  for (const scene of ["", "crypt", "forest", "coast", "tavern", "swamp", "desert", "plains"]) {
    for (const [theme, ambient] of [["", ""], ["forest", ""], ["", "dim"]]) {
      const settings = { scene, theme, ambient };
      const real = generateBattleMap({ seed: 7, scene: scene || null, theme: theme || undefined, ambient: ambient || undefined, pcCount: 4, enemyCount: 4 });
      assert.deepEqual(forge.forgeOutcome(settings), { theme: real.theme, ambient: real.ambient }, JSON.stringify(settings));
    }
  }
});

test("the sentences say who decided: the kind of place, the DM, or nobody", () => {
  const said = forge.explainForge({ scene: "crypt", theme: "", ambient: "" }, label, sceneLabel);
  assert.match(said[0], /Crypt is fought on cave/);
  assert.match(said[1], /The light is what cave usually has/);
  const overruled = forge.explainForge({ scene: "crypt", theme: "forest", ambient: "bright" }, label, sceneLabel);
  assert.match(overruled[0], /You said forest outright/);
  assert.match(overruled[1], /You set the light to daylight/);
  assert.match(forge.explainForge({ scene: "", theme: "", ambient: "" }, label, sceneLabel)[0], /open ground/);
  assert.match(forge.explainForge({ scene: "desert", theme: "", ambient: "" }, label, sceneLabel)[2], /Desert scatters rough ground/);
  for (const sentence of [...said, ...overruled]) {
    assert.ok(!sentence.includes(String.fromCharCode(0x2014)), "an em dash crept into the copy");
  }
});

test("the history keeps the newest seven, and bringing one back moves it rather than listing it twice", () => {
  const roll = (seed) => ({ ...forge.FORGE_START, seed });
  let history = [];
  for (let seed = 1; seed <= 9; seed += 1) {
    history = forge.pushHistory(history, roll(seed));
  }
  assert.equal(forge.HISTORY_LIMIT, 7);
  assert.deepEqual(history.map((entry) => entry.seed), [9, 8, 7, 6, 5, 4, 3]);
  history = forge.pushHistory(history, roll(5));
  assert.deepEqual(history.map((entry) => entry.seed), [5, 9, 8, 7, 6, 4, 3]);
  // The same seed at another size is another map.
  assert.equal(forge.pushHistory(history, { ...roll(5), width: 12 }).length, 7);
  assert.equal(forge.pushHistory(history, { ...roll(5), width: 12 })[0].width, 12);
});

test("sizes are held to the generator's band, and a seed is a 32 bit number", () => {
  assert.deepEqual(forge.clampSize(99, 1), { width: MAP_SIZE.maxWidth, height: MAP_SIZE.minHeight });
  assert.deepEqual(forge.clampSize(Number.NaN, 14.4), { width: 20, height: 14 });
  for (const random of [() => 0, () => 0.5, () => 0.999999999]) {
    const seed = forge.freshSeed(random);
    assert.ok(Number.isInteger(seed) && seed >= 0 && seed <= 0xffffffff);
  }
});

test("the reveal floods from the centre a ring at a time, inside the motion scale", () => {
  const { rings, last } = forge.floodRings(20, 15);
  assert.equal(rings.length, 300);
  assert.equal(Math.min(...rings), 0);
  assert.equal(rings[7 * 20 + 9], 0, "the centre is first");
  assert.equal(rings[0], last, "a corner is last");
  assert.equal(last, 9);
  assert.equal(forge.FLOOD.ringMs, 26);
  assert.equal(forge.FLOOD.tileMs, 380);
  assert.equal(forge.floodProgress(0, 0), 0);
  assert.equal(forge.floodProgress(0, 380), 1);
  assert.equal(forge.floodProgress(3, 3 * 26 + 190), 0.5);
  assert.equal(forge.floodProgress(9, 100), 0, "an outer ring waits its turn");
  assert.equal(forge.sweepMs(20, 15), 520 + 35 * 16);
  // The die turns whole turns that cover the reveal, never fewer than one.
  assert.equal(forge.dieSpins(20, 15), Math.round((520 + 35 * 16) / forge.DIE_TURN_MS));
  assert.equal(forge.dieSpins(6, 6, 0.1), 1);
  assert.ok(forge.dieSpins(20, 15, 2) > forge.dieSpins(20, 15));
  assert.equal(forge.floodTotalMs(20, 15), 9 * 26 + 380);
  assert.ok(forge.floodTotalMs(24, 18) <= 900, "the flood outlasts a scene beat");
});

// ---- what is previewed is what is saved ----

const { getDatabase, nowIso } = await import("../src/lib/db/core.ts");
const { createWorkshop } = await import("../src/lib/db/workshops.ts");
const { createLibraryMap } = await import("../src/lib/dm/map-library.ts");
const db = getDatabase();
const userId = randomUUID();
db.prepare(`INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, 'x', ?)`).run(userId, `forge-${userId.slice(0, 8)}`, nowIso());
const workshop = createWorkshop(userId, { title: "Forge prep", targetParty: { size: 4, level: 1 } });

test("the client's preview and the server's saved map agree on ten seeds", () => {
  const cases = [
    { scene: "", theme: "", ambient: "" },
    { scene: "crypt", theme: "", ambient: "" },
    { scene: "river", theme: "", ambient: "" },
    { scene: "tundra", theme: "", ambient: "dim" },
    { scene: "forest", theme: "interior", ambient: "" },
  ];
  let seed = 20260915;
  for (let index = 0; index < 10; index += 1) {
    const settings = cases[index % cases.length];
    const size = forge.clampSize(12 + index, 10 + (index % 9));
    const roll = { ...settings, ...size, seed: (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) };
    const previewed = forge.forgeGenerate(roll);
    const body = forge.createBodyFor(roll);
    assert.equal(body.do, "create");
    const saved = createLibraryMap(workshop, { name: `Roll ${index}`, ...body }).map;
    assert.equal(saved.terrain, previewed.terrain, `seed ${roll.seed}: the ground differs`);
    assert.equal(saved.theme, previewed.theme);
    assert.equal(saved.ambient, previewed.ambient);
    assert.deepEqual(saved.lights, previewed.lights);
    assert.equal(saved.seed, roll.seed);
    assert.deepEqual([saved.width, saved.height], [roll.width, roll.height]);
  }
});

removeTempDir(path.dirname(dbPath));
console.log(`map forge: ${passed} checks passed.`);
