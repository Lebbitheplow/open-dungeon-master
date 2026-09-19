// A map's own skin (docs/visual-overhaul-plan.md 3.8 and 4.8): every theme has
// a default whose materials shipped, a named skin resolves, an unknown material
// falls back, and the skin a DM chose survives everything a prepared map goes
// through: the round trip to the column, a deploy onto a live board, a capture
// back off it, a duplicate, the workshop import and the workshop bundle.
//
// The second half needs a database, so like the workshop suite it makes its own
// throwaway key and temp file before importing anything and removes them on the
// way out.
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { register } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { removeTempDir } from "./lib/remove-temp-dir.mjs";

const dbPath = path.join(mkdtempSync(path.join(os.tmpdir(), "odm-skins-")), "test.sqlite");
process.env.SQLITE_DB_PATH = dbPath;
process.env.DB_ENCRYPTION_KEY = randomBytes(32).toString("hex");

register("./lib/register-alias.mjs", import.meta.url);
globalThis.__odmEmbedderPromise = Promise.resolve((texts) =>
  Promise.resolve({ tolist: () => texts.map(() => new Array(384).fill(0.1)) }),
);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const {
  SKINS,
  SKIN_CHARS,
  SKIN_ROLES,
  defaultSkinFor,
  isEmptyMapSkin,
  mapSkinKey,
  normalizeMapSkin,
  resolveSkin,
  skinById,
  skinChoices,
} = await import("../src/lib/battlemap/skins.ts");
const { MAP_THEMES } = await import("../src/lib/battlemap/generate.ts");
const { normalizeProps } = await import("../src/lib/battlemap/scene.ts");
const { paintKey, thumbRequest } = await import("../src/lib/battlemap/render/painted.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

// ---- the pure half ----

test("a skin is normalised: a known id or none, terrain characters only, ids shaped like ids", () => {
  assert.deepEqual(normalizeMapSkin(null), { id: "", bind: {} });
  assert.deepEqual(normalizeMapSkin("sunken-crypt"), { id: "", bind: {} });
  assert.deepEqual(normalizeMapSkin({ id: "no-such-skin" }), { id: "", bind: {} });
  assert.deepEqual(normalizeMapSkin({ id: "sunken-crypt" }), { id: "sunken-crypt", bind: {} });
  assert.deepEqual(
    normalizeMapSkin({
      id: "temple",
      bind: { "#": "wall-crystal", X: "wall-crystal", ".": "../../etc/passwd", "~": 7, ",": "Rough Bramble", "+": "a".repeat(80) },
    }),
    { id: "temple", bind: { "#": "wall-crystal" } },
  );
  assert.equal(isEmptyMapSkin(normalizeMapSkin({})), true);
  assert.equal(isEmptyMapSkin({ id: "", bind: { "#": "wall-crystal" } }), false);
});

test("the default for a theme is what a map wears until it is given a skin", () => {
  for (const theme of MAP_THEMES) {
    assert.equal(resolveSkin("high_fantasy", theme, null).id, defaultSkinFor("high_fantasy", theme));
    assert.equal(resolveSkin("high_fantasy", theme, { id: "", bind: {} }), skinById(defaultSkinFor("high_fantasy", theme)));
  }
  assert.equal(resolveSkin("cyberpunk", "interior", null).genre, "cyberpunk");
});

test("a named skin overrides the default, and an override lays one material over it", () => {
  const crypt = resolveSkin("high_fantasy", "field", { id: "sunken-crypt", bind: {} });
  assert.equal(crypt, skinById("sunken-crypt"));
  const crystal = resolveSkin("high_fantasy", "interior", { id: "", bind: { "#": "wall-crystal" } });
  assert.equal(crystal.bind["#"], "wall-crystal");
  assert.equal(crystal.bind["."], skinById("stone-dungeon").bind["."], "the rest of the skin is untouched");
  assert.notEqual(crystal, skinById("stone-dungeon"));
  assert.equal(skinById("stone-dungeon").bind["#"], "wall-dungeon-mossy", "the shared skin was mutated");
  // Choosing the skin's own material is no override at all.
  assert.equal(resolveSkin("high_fantasy", "interior", { id: "", bind: { "#": "wall-dungeon-mossy" } }), skinById("stone-dungeon"));
});

test("the cache key tells two skins apart and calls the empty one nothing", () => {
  assert.equal(mapSkinKey(null), "");
  assert.equal(mapSkinKey({ id: "", bind: {} }), "");
  assert.notEqual(mapSkinKey({ id: "temple", bind: {} }), mapSkinKey({ id: "sewer", bind: {} }));
  assert.notEqual(mapSkinKey({ id: "", bind: { "#": "wall-ice" } }), mapSkinKey({ id: "", bind: { "~": "wall-ice" } }));
  const base = { width: 2, height: 1, terrain: ".#", theme: "interior", genre: null, seedKey: "m", quality: "full" };
  assert.notEqual(paintKey(base), paintKey({ ...base, skin: { id: "temple", bind: {} } }));
  assert.notEqual(paintKey(base), paintKey({ ...base, stamps: [{ x: 0, y: 0, id: "barrel" }] }));
  assert.equal(paintKey(base), paintKey({ ...base, skin: { id: "", bind: {} }, stamps: [] }));
  assert.notEqual(paintKey(thumbRequest(base)), paintKey(base), "a thumbnail is not the board's picture");
  assert.equal(thumbRequest(base).dressing, false);
  assert.equal(thumbRequest(base).cell, 8);
  assert.equal(thumbRequest(base, 16).cell, 16);
});

test("the picker leads with the campaign's own setting and offers every skin exactly once", () => {
  const fantasy = skinChoices("high_fantasy");
  assert.equal(fantasy[0].group, "This setting");
  assert.ok(fantasy[0].skins.every((skin) => !skin.genre));
  const cyber = skinChoices("cyberpunk");
  assert.ok(cyber[0].skins.length > 0 && cyber[0].skins.every((skin) => skin.genre === "cyberpunk"));
  assert.equal(cyber[1].group, "Fantasy");
  for (const groups of [fantasy, cyber, skinChoices("post-apocalyptic"), skinChoices(null)]) {
    const ids = groups.flatMap((group) => group.skins.map((skin) => skin.id));
    assert.equal(ids.length, SKINS.length);
    assert.equal(new Set(ids).size, SKINS.length);
  }
});

const manifestPath = path.join(ROOT, "public", "assets", "tiles", "manifest.json");
if (existsSync(manifestPath)) {
  const tiles = JSON.parse(readFileSync(manifestPath, "utf8")).tiles;
  const catalogue = new Map(tiles.map((tile) => [tile.id, tile.category]));

  test("every theme's default skin, and every named skin, paints with materials of the right kind", () => {
    for (const skin of SKINS) {
      for (const char of SKIN_CHARS) {
        const category = catalogue.get(skin.bind[char]);
        assert.ok(category, `${skin.id} ${char}: ${skin.bind[char]} did not ship`);
        assert.ok(SKIN_ROLES[char].categories.includes(category), `${skin.id} paints ${char} with a ${category}`);
      }
    }
    for (const theme of MAP_THEMES) {
      assert.ok(skinById(defaultSkinFor(null, theme)), theme);
    }
  });

  test("with the catalogue to hand, an unknown material or the wrong kind of one falls back", () => {
    const base = skinById("stone-dungeon");
    assert.equal(resolveSkin(null, "interior", { id: "", bind: { "#": "wall-made-of-cheese" } }, catalogue), base);
    assert.equal(resolveSkin(null, "interior", { id: "", bind: { "#": "water-deep-blue" } }, catalogue), base, "water is not a wall");
    assert.equal(resolveSkin(null, "interior", { id: "", bind: { "#": "wall-crystal" } }, catalogue).bind["#"], "wall-crystal");
    // Lava is a hazard that paints as the liquid.
    assert.equal(resolveSkin(null, "cave", { id: "", bind: { "~": "hazard-lava-molten" } }, catalogue).bind["~"], "hazard-lava-molten");
  });
}

test("a prop keeps the stamp it is drawn as, and loses anything that is not shaped like an id", () => {
  const terrain = "#####" + "#...#" + "#####";
  const props = normalizeProps(
    [
      { x: 1, y: 1, name: "Barrel", kind: "prop", stamp: "barrel" },
      { x: 2, y: 1, name: "Trap", kind: "prop", stamp: "../uploads/x.png" },
      { x: 3, y: 1, name: "Innkeeper", kind: "npc" },
    ],
    terrain,
    5,
    3,
  );
  assert.deepEqual(props, [
    { x: 1, y: 1, name: "Barrel", kind: "prop", stamp: "barrel" },
    { x: 2, y: 1, name: "Trap", kind: "prop" },
    { x: 3, y: 1, name: "Innkeeper", kind: "npc" },
  ]);
});

// ---- the database half ----

const { getDatabase, nowIso } = await import("../src/lib/db/core.ts");
const db = getDatabase();
const { createCampaign, getCampaignById } = await import("../src/lib/db/campaigns.ts");
const { createWorkshop } = await import("../src/lib/db/workshops.ts");
const { copyPreparedMaps, getPreparedMap, listPreparedMaps, updatePreparedMap } = await import("../src/lib/db/prepared-maps.ts");
const { captureBoardIntoLibrary, createLibraryMap, deployPreparedMap, libraryState, setLibrarySkin } = await import(
  "../src/lib/dm/map-library.ts"
);
const { createEncounter } = await import("../src/lib/db/encounters.ts");
const { createBattleMap, getBattleMapForEncounter, listTokens } = await import("../src/lib/db/battle-maps.ts");
const { exportWorkshopBundle, importWorkshopBundle } = await import("../src/lib/db/workshop-bundle.ts");
const { readBundle } = await import("../src/lib/workshop/bundle.ts");

const userId = randomUUID();
db.prepare(`INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, 'x', ?)`).run(
  userId,
  `skins-${userId.slice(0, 8)}`,
  nowIso(),
);
const workshop = createWorkshop(userId, { title: "Skin prep", targetParty: { size: 4, level: 3 } });
const campaign = createCampaign(userId, {
  title: "The table",
  description: "",
  theme: "",
  maxPlayers: 5,
  startingLevel: 1,
  difficulty: "normal",
});

const CHOSEN = { id: "sunken-crypt", bind: { "#": "wall-crystal" } };

test("the migration added skin_json to both map tables, defaulting to the empty skin", () => {
  for (const table of ["prepared_maps", "battle_maps"]) {
    const column = db.prepare(`PRAGMA table_info(${table})`).all().find((entry) => entry.name === "skin_json");
    assert.ok(column, `${table}.skin_json is missing`);
    assert.equal(column.notnull, 1);
  }
});

const made = createLibraryMap(workshop, { name: "Crypt", width: 16, height: 12, seed: 99, hint: "a crypt" }).map;

test("a new map wears the default, and the library says which setting decides it", () => {
  assert.deepEqual(made.skin, { id: "", bind: {} });
  assert.equal(libraryState(workshop).genre, getCampaignById(workshop.id).gameSettings.genre);
});

test("a map can be created already wearing a named skin", () => {
  const dressed = createLibraryMap(workshop, { name: "Temple", width: 12, height: 10, blank: "rock", skin: { id: "temple", bind: {} } }).map;
  assert.deepEqual(getPreparedMap(workshop.id, dressed.id).skin, { id: "temple", bind: {} });
});

test("the skin round-trips through the column, normalised on the way in", () => {
  const outcome = setLibrarySkin(workshop, made.id, { ...CHOSEN, bind: { ...CHOSEN.bind, Q: "nonsense", ".": "NOT AN ID" } });
  assert.ok(!("error" in outcome), outcome.error);
  assert.deepEqual(getPreparedMap(workshop.id, made.id).skin, CHOSEN);
  assert.deepEqual(JSON.parse(db.prepare(`SELECT skin_json FROM prepared_maps WHERE id = ?`).get(made.id).skin_json), CHOSEN);
  assert.ok("error" in setLibrarySkin(workshop, randomUUID(), CHOSEN), "a map from nowhere took a skin");
});

test("editing anything else leaves the skin alone, and junk in the column reads as the default", () => {
  updatePreparedMap(workshop.id, made.id, { notes: "cold and wet", theme: "interior" });
  assert.deepEqual(getPreparedMap(workshop.id, made.id).skin, CHOSEN);
  const other = createLibraryMap(workshop, { name: "Junk", width: 12, height: 10, blank: "ground" }).map;
  db.prepare(`UPDATE prepared_maps SET skin_json = ? WHERE id = ?`).run("{not json", other.id);
  assert.deepEqual(getPreparedMap(workshop.id, other.id).skin, { id: "", bind: {} });
});

test("a duplicate carries the skin (the editor sends it with the rest of the copy)", () => {
  const copy = createLibraryMap(workshop, { name: "Crypt (copy)", width: 16, height: 12, blank: "rock" }).map;
  updatePreparedMap(workshop.id, copy.id, { terrain: getPreparedMap(workshop.id, made.id).terrain, skin: getPreparedMap(workshop.id, made.id).skin });
  assert.deepEqual(getPreparedMap(workshop.id, copy.id).skin, CHOSEN);
});

test("the workshop import copies the skin with the map", () => {
  copyPreparedMaps(workshop.id, campaign.id);
  const arrived = listPreparedMaps(campaign.id).find((map) => map.name === "Crypt");
  assert.ok(arrived, "the map did not travel");
  assert.deepEqual(arrived.skin, CHOSEN);
});

test("deploy puts the skin on the live board, and capture brings it back", () => {
  const encounter = createEncounter(campaign.id, "A fight in the crypt");
  assert.ok(encounter, "no encounter");
  createBattleMap({
    encounterId: encounter.id,
    campaignId: campaign.id,
    width: 12,
    height: 10,
    terrain: "#".repeat(120),
    ambient: "bright",
    theme: "field",
    lights: [],
    seed: 1,
  });
  assert.deepEqual(getBattleMapForEncounter(encounter.id).skin, { id: "", bind: {} });
  const prepared = listPreparedMaps(campaign.id).find((map) => map.name === "Crypt");
  const deployed = deployPreparedMap(campaign, prepared.id);
  assert.ok(!("error" in deployed), deployed.error);
  assert.deepEqual(getBattleMapForEncounter(encounter.id).skin, CHOSEN);

  const captured = captureBoardIntoLibrary(campaign, "Crypt as played");
  assert.ok(!("error" in captured), captured.error);
  assert.deepEqual(getPreparedMap(campaign.id, captured.map.id).skin, CHOSEN);

  // A stamped prop goes onto the table as a token that remembers its stamp.
  const furnished = createLibraryMap(campaign, { name: "Furnished", width: 12, height: 10, blank: "ground" }).map;
  updatePreparedMap(campaign.id, furnished.id, {
    scene: {
      props: [
        { x: 3, y: 3, name: "Barrel", kind: "prop", stamp: "barrel" },
        { x: 5, y: 3, name: "Innkeeper", kind: "npc" },
      ],
    },
  });
  deployPreparedMap(campaign, furnished.id);
  const tokens = listTokens(getBattleMapForEncounter(encounter.id).id);
  assert.equal(tokens.find((token) => token.name === "Barrel").stamp, "barrel");
  assert.equal(tokens.find((token) => token.name === "Innkeeper").stamp, "");

  // New ground without a skin wears its own default again.
  const plain = createLibraryMap(campaign, { name: "Plain", width: 12, height: 10, blank: "ground" }).map;
  deployPreparedMap(campaign, plain.id);
  assert.deepEqual(getBattleMapForEncounter(encounter.id).skin, { id: "", bind: {} });
});

test("the workshop bundle carries the skin out and back in, and an older bundle still reads", () => {
  const result = exportWorkshopBundle(workshop.id, {
    name: "Skins",
    blurb: "Maps with their looks.",
    version: "1.0.0",
    author: "A tester",
    homepage: "",
    inspiredBy: "Original work",
    rightsHolder: "",
  });
  assert.ok(!("error" in result), result.error);
  const text = JSON.stringify(result.bundle);
  const round = readBundle(text);
  assert.ok(!("error" in round), round.error);
  assert.deepEqual(round.bundle.maps.find((map) => map.name === "Crypt").skin, CHOSEN);

  const stranger = randomUUID();
  db.prepare(`INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, 'x', ?)`).run(
    stranger,
    `bundle-${stranger.slice(0, 8)}`,
    nowIso(),
  );
  const landed = importWorkshopBundle(stranger, round.bundle);
  assert.ok(!("error" in landed), landed.error);
  assert.deepEqual(listPreparedMaps(landed.workshopId).find((map) => map.name === "Crypt").skin, CHOSEN);

  // A bundle written before skins existed has no such field on its maps.
  const older = JSON.parse(text);
  for (const map of older.maps) {
    delete map.skin;
  }
  const read = readBundle(JSON.stringify(older));
  assert.ok(!("error" in read), read.error);
  assert.deepEqual(read.bundle.maps[0].skin, {});
  const again = importWorkshopBundle(stranger, read.bundle);
  assert.ok(!("error" in again), again.error);
  assert.ok(listPreparedMaps(again.workshopId).every((map) => isEmptyMapSkin(map.skin)));
});

removeTempDir(path.dirname(dbPath));
console.log(`map skins: ${passed} checks passed.`);
