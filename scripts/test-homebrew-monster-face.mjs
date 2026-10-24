// The face a homebrew or Workshop monster wears (src/lib/placeholders.ts
// monsterPlaceholder, found by M6's journey 62). The plate used to be looked
// up by the monster's whole name before its type, so a homebrew construct
// its author called "Bandit" wore the rulebook bandit's plate in the fight,
// though the Bestiary tells its author the creature type is its picture.
// Now, for a stat block somebody wrote (slug "homebrew:<id>"):
//
//   - a picture of its own (MonsterTile's `art`) beats any plate;
//   - without one, its type decides: the genre's plate for that type, or
//     the type's own, and the boss plate at CR 11 and up as for any monster;
//   - its name finds nothing, neither a family plate nor a genre's named
//     enemy token.
//
// A rulebook monster keeps the face it had: its family plate by slug or by
// name, its genre's enemy token, and a name-only monster (no slug) still
// finds its family.
import assert from "node:assert/strict";
import { register } from "node:module";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

register("./lib/register-jsx.mjs", import.meta.url);
const { monsterPlaceholder } = await import("../src/lib/placeholders.ts");
const { MonsterTile } = await import("../src/lib/ui.tsx");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`ok: ${name}`);
}
const plate = (url) => /\/monster\/([^/]+)\.webp$/.exec(url)?.[1] ?? url;
const HOMEBREW = "homebrew:3f9c2a";

test("a homebrew monster with a picture of its own wears that picture", () => {
  const markup = renderToStaticMarkup(
    createElement(MonsterTile, { type: "construct", cr: 1, genre: "high_fantasy", slug: HOMEBREW, name: "Bandit", art: "/uploads/tide-golem.webp" }),
  );
  assert.match(markup, /src="\/uploads\/tide-golem\.webp"/);
  assert.doesNotMatch(markup, /\/monster\//, "no plate is drawn under it");
});

test("a homebrew construct called Bandit wears the construct's plate, not the bandit's", () => {
  assert.equal(plate(monsterPlaceholder("construct", { cr: 1, genre: "high_fantasy", seed: "Bandit", slug: HOMEBREW, name: "Bandit" })), "construct");
  // The tile the Bestiary lists draw agrees with the fight.
  const markup = renderToStaticMarkup(createElement(MonsterTile, { type: "construct", cr: 1, genre: "high_fantasy", seed: "Bandit", slug: HOMEBREW, name: "Bandit" }));
  assert.match(markup, /\/monster\/construct\.webp/);
});

test("a homebrew monster named after any family plate keeps its own type's", () => {
  for (const [name, type] of [["Owlbear", "beast"], ["Ghoul 2", "construct"], ["Lich", "fiend"]]) {
    assert.equal(plate(monsterPlaceholder(type, { cr: 3, genre: "high_fantasy", slug: HOMEBREW, name })), type, `${name} as a ${type}`);
  }
});

test("a homebrew monster in a reskinned genre draws that genre's plate for its type, not a named enemy token", () => {
  const cyberpunk = monsterPlaceholder("humanoid", { cr: 1, genre: "cyberpunk", seed: "x", slug: HOMEBREW, name: "Ganger" });
  const named = monsterPlaceholder("humanoid", { cr: 1, genre: "cyberpunk", seed: "x", name: "Ganger" });
  assert.equal(cyberpunk, monsterPlaceholder("humanoid", { cr: 1, genre: "cyberpunk", seed: "x", slug: HOMEBREW, name: "Somebody" }), "the name changes nothing");
  assert.match(cyberpunk, /\/monster\/[\w-]+\.webp$/);
  if (named !== cyberpunk) {
    assert.notEqual(plate(cyberpunk), plate(named), "the genre's named token is not drawn for it");
  }
});

test("a big homebrew monster still gets its genre's boss plate", () => {
  assert.equal(plate(monsterPlaceholder("construct", { cr: 15, genre: "high_fantasy", slug: HOMEBREW, name: "Bandit" })), "high-fantasy-boss");
});

test("rulebook monsters keep the faces they had", () => {
  assert.equal(plate(monsterPlaceholder("humanoid", { cr: 0.125, genre: "high_fantasy", slug: "bandit", name: "Bandit" })), "bandit", "the SRD bandit by its slug");
  assert.equal(plate(monsterPlaceholder("monstrosity", { cr: 3, genre: "high_fantasy", slug: "owlbear", name: "Owlbear" })), "owlbear");
  assert.equal(plate(monsterPlaceholder("undead", { cr: 1, genre: "high_fantasy", name: "Ghoul 2" })), "ghoul", "a name-only monster (no slug) still finds its family");
  assert.equal(plate(monsterPlaceholder("undead", { cr: 1, genre: "high_fantasy", slug: "custom", name: "Ghoul" })), "ghoul", "an invented enemy (slug custom) too");
  assert.equal(plate(monsterPlaceholder("beast", { cr: 0.125, genre: "cyberpunk", seed: "giant-rat", slug: "giant-rat", name: "Sump Rat" })), "beast", "the reskin guard is unchanged");
});

console.log(`test-homebrew-monster-face: ${passed} passed`);
