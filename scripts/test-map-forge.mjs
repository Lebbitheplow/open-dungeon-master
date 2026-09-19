// The Map Forge's pure half (docs/visual-overhaul-plan.md 4.1 and 4.8): the
// preview and the saved map are the same map, the read-back names the word the
// generator matched, the history keeps seven, and the reveal floods outward.
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

test("the read-back names the word that chose the theme and the word that set the light", () => {
  const read = forge.readHint("a flooded crypt, pitch-black", null);
  assert.equal(read.theme, "cave");
  assert.equal(read.ambient, "dark");
  assert.equal(read.themeWord, "crypt");
  assert.equal(read.lightWord, "pitch-black");
  assert.deepEqual(
    read.words.map((word) => word.hit),
    [null, null, "theme", "light"],
  );
  assert.equal(read.words[2].text, "crypt,", "the word is shown as typed, comma and all");
});

test("the read-back agrees with the generator for every kind of place, and says nothing when nothing matched", () => {
  for (const hint of ["a mossy forest at dusk", "the harbor at noon", "tavern brawl", "a bog", "somewhere", "", "an ice cave, torchlit"]) {
    const read = forge.readHint(hint, null);
    const real = generateBattleMap({ seed: 7, hint: hint || undefined, pcCount: 4, enemyCount: 4 });
    assert.equal(read.theme, real.theme, hint);
    assert.equal(read.ambient, real.ambient, hint);
  }
  const plain = forge.readHint("somewhere", null);
  assert.deepEqual([plain.themeWord, plain.lightWord, plain.roughWord], [null, null, null]);
  assert.equal(forge.readHint("a mossy forest at dusk", null).lightWord, "dusk");
  // A word for daylight changes nothing in a place that is bright anyway, but
  // the generator did match it, so it is still named; under a cave's dark it
  // is what made the difference.
  assert.equal(forge.readHint("the harbor at noon", null).lightWord, "noon");
  assert.equal(forge.readHint("a cave at noon", null).ambient, "bright");
  assert.equal(forge.readHint("a cave at noon", null).lightWord, "noon");
  const ice = forge.readHint("an ice cave", null);
  assert.equal(ice.roughWord, "ice");
  assert.equal(ice.themeWord, "cave");
});

test("the sentences say who decided: the word, the DM, or nobody", () => {
  const read = forge.readHint("a flooded crypt, pitch-black", null);
  const said = forge.explainRead(read, { theme: "", ambient: "" }, label);
  assert.match(said[0], /crypt.*cave/);
  assert.match(said[1], /pitch-black.*light/);
  const overruled = forge.explainRead(read, { theme: "forest", ambient: "bright" }, label);
  assert.match(overruled[0], /You said forest outright/);
  assert.match(overruled[1], /You set the light to daylight/);
  assert.match(forge.explainRead(forge.readHint("", null), { theme: "", ambient: "" }, label)[0], /open ground/);
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
    { hint: "", theme: "", ambient: "" },
    { hint: "a flooded crypt, pitch-black", theme: "", ambient: "" },
    { hint: "the river docks at dusk", theme: "", ambient: "" },
    { hint: "an icy forest", theme: "", ambient: "dim" },
    { hint: "anything at all", theme: "interior", ambient: "" },
  ];
  let seed = 20260915;
  for (let index = 0; index < 10; index += 1) {
    const settings = cases[index % cases.length];
    const size = forge.clampSize(12 + index, 10 + (index % 9));
    const roll = { ...settings, ...size, seed: (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) };
    const previewed = forge.forgeGenerate(roll, workshop.gameSettings.genre);
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
