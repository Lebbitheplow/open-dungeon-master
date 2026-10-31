import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);
const { cardArtwork } = await import("../src/lib/battlemap/card-art.ts");
const { iconCandidates } = await import("../src/lib/icons.ts");
const { SRD_WEAPON_WEIGHT_LB } = await import("../src/lib/srd/weapons.ts");
const { buildIconList } = await import("./icon-set.mjs");
const catalogue = await buildIconList();
const root = path.resolve(import.meta.dirname, "..");
let passed = 0;
function test(name, fn) { fn(); passed++; }

test("every standard fantasy weapon has distinct, available card artwork", () => {
  const names = [...Object.keys(SRD_WEAPON_WEIGHT_LB), "Sling"];
  assert.equal(names.length, 37);
  const paths = new Set();
  for (const name of names) {
    const original = Object.freeze({ kind: "item", key: name, family: "item-weapon" });
    const art = cardArtwork(original);
    assert.equal(art.kind, "action", name);
    assert.equal(art.family, "item-weapon");
    const [src, fallback] = iconCandidates(art);
    assert.ok(src.startsWith("/assets/icons/action/weapon-"), name);
    assert.ok(existsSync(path.join(root, "public", src)), name);
    assert.equal(fallback, "/assets/icons/family/item-weapon.webp");
    paths.add(src);
    assert.equal(original.kind, "item");
  }
  assert.equal(paths.size, 37);
});

test("common inventory spellings map to their intended item art", () => {
  for (const [name, key] of [
    ["Potion of Healing (Greater)", "gear-potion-of-healing"],
    ["Alchemist’s Fire (flask)", "gear-alchemists-fire"],
    ["Rope, hempen (50 feet)", "gear-rope"],
    ["Ball bearings (bag of 1,000)", "gear-ball-bearings"],
    ["Healer's Kit", "gear-healers-kit"],
  ]) assert.equal(cardArtwork({ kind: "item", key: name }).key, key, name);
});

test("a weapon written in the book's order or with a bonus shows its weapon's painting", () => {
  for (const [name, key] of [
    ["Crossbow, hand", "weapon-hand-crossbow"],
    ["Crossbow, light", "weapon-light-crossbow"],
    ["Longsword +1", "weapon-longsword"],
    ["+2 Warhammer", "weapon-warhammer"],
  ]) assert.equal(cardArtwork({ kind: "item", key: name, family: "item-weapon" }).key, key, name);
});

test("unknown, custom and genre items retain their existing fallback", () => {
  for (const key of ["Moon Longsword", "Pistol", "Unknown Relic"]) {
    const ref = { kind: "item", key, family: "item-weapon" };
    assert.equal(cardArtwork(ref), ref);
  }
});

test("other surfaces and non-item icons retain their original artwork", () => {
  assert.equal(iconCandidates({ kind: "item", key: "Longsword", family: "item-weapon" })[0], "/assets/icons/item/longsword.webp");
  for (const ref of [{ kind: "spell", key: "Magic Missile" }, { kind: "action", key: "disengage" }]) {
    assert.equal(cardArtwork(ref), ref);
  }
});

test("all gear catalogue entries are shipped and addressable", () => {
  const entries = JSON.parse(readFileSync(path.join(root, "scripts/card-art-subjects.json")));
  assert.equal(entries.length, 51);
  for (const { id, label } of entries) {
    const art = cardArtwork({ kind: "item", key: label });
    assert.equal(art.key, id, label);
    assert.ok(existsSync(path.join(root, "public", iconCandidates(art)[0])), label);
  }
});

test("every core action resolves to a shipped painting for all five genre presets", () => {
  const genres = ["cyberpunk", "steampunk", "mystery", "horror", "post_apocalyptic"];
  const actions = ["attack", "cast", "dash", "disengage", "dodge", "help", "hide", "ready", "grapple", "shove", "use-object", "end-turn", "search", "escape", "stand-up"];
  const paths = new Set();
  for (const genre of genres) for (const key of actions) {
    const original = Object.freeze({ kind: "action", key, family: "item-gear" });
    const art = cardArtwork(original, genre);
    const [src, fallback] = iconCandidates(art);
    assert.equal(src, `/assets/icons/action/${genre.replaceAll("_", "-")}-${key}.webp`);
    assert.equal(fallback, "/assets/icons/family/item-gear.webp");
    assert.ok(existsSync(path.join(root, "public", src)), src);
    assert.equal(original.key, key);
    paths.add(src);
  }
  assert.equal(paths.size, 75);
});

test("fantasy, custom and unrecognized genres retain base art; missing variants keep the original", () => {
  const ref = Object.freeze({ kind: "action", key: "ready" });
  for (const genre of [undefined, null, "high_fantasy", "dark_fantasy", "custom", "unknown", "../../cyberpunk"]) {
    assert.equal(cardArtwork(ref, genre), ref);
  }
  const unsupported = { kind: "action", key: "natural-bite" };
  assert.equal(cardArtwork(unsupported, "cyberpunk"), unsupported);
  const spell = { kind: "spell", key: "Fireball" };
  assert.equal(cardArtwork(spell, "cyberpunk"), spell);
  assert.equal(cardArtwork({ kind: "item", key: "Longsword" }, "cyberpunk").key, "weapon-longsword");
  const pistol = { kind: "item", key: "Pistol", family: "item-weapon" };
  assert.equal(cardArtwork(pistol, "mystery"), pistol);
});

test("the generator catalogue retains genre art and does not regenerate it as square fantasy icons", () => {
  const subjects = JSON.parse(readFileSync(path.join(root, "scripts/genre-action-subjects.json")));
  assert.equal(subjects.length, 75);
  assert.equal(new Set(subjects.map(({ id }) => id)).size, 75);
  for (const subject of subjects) {
    const entry = catalogue.find((icon) => icon.id === `action-${subject.id}`);
    assert.ok(entry, subject.id);
    assert.equal(entry.externalArt, true, subject.id);
    assert.equal(entry.genre, subject.genre, subject.id);
  }
});

console.log(`card art: ${passed} checks passed`);
