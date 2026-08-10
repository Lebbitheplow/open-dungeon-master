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
  const crBySlug = new Map(
    db.prepare("SELECT slug, cr FROM monsters").all().map((row) => [row.slug, row.cr]),
  );
  db.close();

  test("every catalog slug exists in the content pack with a matching CR", () => {
    for (const genre of CATALOG_GENRES) {
      for (const entry of bestiaryForGenre(genre)) {
        assert.ok(crBySlug.has(entry.slug), `${genre}: ${entry.slug} not in content pack`);
        assert.equal(
          crBySlug.get(entry.slug),
          entry.cr,
          `${genre}: ${entry.slug} cr drifted from the content pack`,
        );
      }
    }
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

test("no pack means byte-identical behavior to the plain genre", () => {
  for (const genre of CATALOG_GENRES) {
    assert.deepEqual(bestiaryFor({ genre }), bestiaryForGenre(genre));
    assert.deepEqual(bestiaryFor({ genre, worldPack: "" }), bestiaryForGenre(genre));
  }
});

console.log(`test-bestiary: ${passed} passed`);
