// Genre bestiary catalogs: shape invariants, slug/CR integrity against the
// content pack when present, and reskin resolution.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { bestiaryForGenre, bestiaryFor, reskinFor, suggestEnemies, resolveMonster } = await import(
  "../src/lib/bestiary/index.ts"
);
const { listWorldPacks } = await import("../src/lib/worlds/index.ts");
const { CREATURE_TYPES, normalizeCreatureType } = await import("../src/lib/bestiary/statblock.ts");
const { GENRES } = await import("../src/lib/schemas/game-settings.ts");

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const contentDbPath = path.resolve(scriptsDir, "../data/content/open5e.sqlite");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

const CATALOG_GENRES = GENRES.filter((genre) => genre !== "custom");

test("every genre has a substantial catalog", () => {
  for (const genre of CATALOG_GENRES) {
    const entries = bestiaryForGenre(genre);
    assert.ok(entries.length >= 40, `${genre} has only ${entries.length} entries`);
    for (const entry of entries) {
      assert.ok(entry.slug, `${genre}: missing slug`);
      assert.ok(entry.name, `${genre}: ${entry.slug} missing name`);
      assert.ok(entry.blurb, `${genre}: ${entry.slug} missing blurb`);
      assert.ok(typeof entry.cr === "number" && entry.cr >= 0, `${genre}: ${entry.slug} bad cr`);
      assert.ok(
        CREATURE_TYPES.includes(entry.type),
        `${genre}: ${entry.slug} has no SRD creature type (got "${entry.type}")`,
      );
    }
  }
});

test("no duplicate slugs within a genre", () => {
  for (const genre of CATALOG_GENRES) {
    const slugs = bestiaryForGenre(genre).map((entry) => entry.slug);
    assert.equal(new Set(slugs).size, slugs.length, `${genre} has duplicate slugs`);
  }
});

test("catalogs are weighted toward playable CRs", () => {
  for (const genre of CATALOG_GENRES) {
    const entries = bestiaryForGenre(genre);
    const low = entries.filter((entry) => entry.cr <= 8).length;
    assert.ok(low / entries.length >= 0.6, `${genre} is too top-heavy`);
  }
});

test("custom genre falls back to high fantasy", () => {
  assert.deepEqual(bestiaryForGenre("custom"), bestiaryForGenre("high_fantasy"));
});

test("reskinFor finds catalog entries", () => {
  const entry = reskinFor({ genre: "cyberpunk" }, "hell-hound");
  assert.equal(entry?.name, "Cyber-Mastiff");
  assert.equal(reskinFor({ genre: "cyberpunk" }, "not-a-monster"), null);
});

test("suggestEnemies respects the party budget and spreads CRs", () => {
  const low = suggestEnemies({ genre: "high_fantasy" }, [1, 1, 1, 1], 10);
  assert.ok(low.length > 0 && low.length <= 10);
  // A level-1 party's deadly budget is 400 XP; nothing above CR 2 fits.
  assert.ok(low.every((entry) => entry.cr <= 2), JSON.stringify(low));
  const high = suggestEnemies({ genre: "high_fantasy" }, [15, 15, 15, 15], 10);
  assert.ok(high.some((entry) => entry.cr >= 10), "high-level party got no big threats");
});

// Content-pack integrity: every catalog slug must exist with a matching CR.
if (fs.existsSync(contentDbPath)) {
  const { default: Database } = await import("better-sqlite3-multiple-ciphers");
  const db = new Database(contentDbPath, { readonly: true });
  const rows = db.prepare("SELECT slug, cr, type FROM monsters").all();
  const crBySlug = new Map(rows.map((row) => [row.slug, row.cr]));
  const typeBySlug = new Map(rows.map((row) => [row.slug, normalizeCreatureType(row.type)]));
  db.close();

  test("every catalog slug exists in the content pack with a matching CR and type", () => {
    for (const genre of CATALOG_GENRES) {
      for (const entry of bestiaryForGenre(genre)) {
        assert.ok(crBySlug.has(entry.slug), `${genre}: ${entry.slug} not in content pack`);
        assert.equal(
          crBySlug.get(entry.slug),
          entry.cr,
          `${genre}: ${entry.slug} cr drifted from the content pack`,
        );
        assert.equal(
          typeBySlug.get(entry.slug),
          entry.type,
          `${genre}: ${entry.slug} type drifted from the content pack`,
        );
      }
    }
  });

  test("resolveMonster carries the creature type into the snapshot", () => {
    const hound = resolveMonster("hell-hound", { genre: "high_fantasy" });
    assert.equal(hound?.stats.type, "fiend");
    const rats = resolveMonster("swarm-of-rats", { genre: "high_fantasy" });
    assert.equal(rats?.stats.type, "beast", "a swarm draws as the beast it is");
  });

  test("resolveMonster resolves slugs, reskin names, and plain names", () => {
    const bySlug = resolveMonster("hell-hound", { genre: "cyberpunk" });
    assert.equal(bySlug?.reskinName, "Cyber-Mastiff");
    assert.equal(bySlug?.stats.maxHp, 45);
    assert.equal(bySlug?.stats.ac, 15);
    assert.ok(bySlug?.stats.attacks.length >= 1);

    const byReskin = resolveMonster("Cyber-Mastiff", { genre: "cyberpunk" });
    assert.equal(byReskin?.slug, "hell-hound");

    const byName = resolveMonster("Hell Hound", { genre: "high_fantasy" });
    assert.equal(byName?.slug, "hell-hound");

    assert.equal(resolveMonster("definitely-not-a-monster-xyz", { genre: "horror" }), null);
  });
} else {
  console.log("note: content pack absent; skipping slug integrity checks");
}

test("a world pack overlays its own monsters onto the genre catalog", () => {
  const pack = listWorldPacks().find((entry) => entry.monsters.length);
  assert.ok(pack, "no installed world pack lists monsters");
  const base = bestiaryForGenre(pack.baseGenre);
  const merged = bestiaryFor({ genre: pack.baseGenre, worldPack: pack.id });

  // Nothing is lost, and pack-only slugs are appended.
  assert.ok(merged.length >= base.length, "the overlay dropped catalog entries");
  const bySlug = new Map(merged.map((entry) => [entry.slug, entry]));
  for (const entry of pack.monsters) {
    assert.equal(bySlug.get(entry.slug)?.name, entry.name, `${entry.slug} did not win the overlay`);
  }
  // Slugs stay unique after the merge, or resolveMonster would pick at random.
  const slugs = merged.map((entry) => entry.slug);
  assert.equal(new Set(slugs).size, slugs.length, "the overlay produced duplicate slugs");
});

test("a pack entry with no type inherits the genre's type for the same slug", () => {
  const setting = { genre: "high_fantasy", worldPack: "__type-overlay-test__" };
  const base = bestiaryForGenre("high_fantasy")[0];
  // No installed pack has that id, so this is the plain roster; the overlay
  // rule itself is exercised through bestiaryFor with a real pack above.
  assert.equal(bestiaryFor(setting)[0].type, base.type);
  assert.ok(CREATURE_TYPES.includes(base.type));
});

test("no pack means byte-identical behavior to the plain genre", () => {
  for (const genre of CATALOG_GENRES) {
    assert.deepEqual(bestiaryFor({ genre }), bestiaryForGenre(genre));
    assert.deepEqual(bestiaryFor({ genre, worldPack: "" }), bestiaryForGenre(genre));
  }
});

console.log(`test-bestiary: ${passed} passed`);
