// Forgiving normalizers for model-supplied tool-call enums: synonyms map to
// canonical values, genuinely wrong input passes through for zod to reject.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const {
  normalizeAbility,
  normalizeAdvantage,
  normalizeEventKind,
  normalizeListAction,
  normalizeRestKind,
  normalizeRollKind,
} = await import("../src/lib/dm/arg-coerce.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

test("normalizeAbility: full names, punctuation, phrases", () => {
  assert.equal(normalizeAbility("Wisdom"), "wis");
  assert.equal(normalizeAbility("DEX"), "dex");
  assert.equal(normalizeAbility("strength save"), "str");
  assert.equal(normalizeAbility("wis."), "wis");
  assert.equal(normalizeAbility("constitution"), "con");
  assert.equal(normalizeAbility("charm"), "charm");
  assert.equal(normalizeAbility(3), 3);
});

test("normalizeAdvantage: abbreviations and phrases", () => {
  assert.equal(normalizeAdvantage("adv"), "advantage");
  assert.equal(normalizeAdvantage("with advantage"), "advantage");
  assert.equal(normalizeAdvantage("disadv"), "disadvantage");
  assert.equal(normalizeAdvantage("Disadvantage"), "disadvantage");
  assert.equal(normalizeAdvantage("normal"), "none");
  assert.equal(normalizeAdvantage("straight roll"), "none");
  assert.equal(normalizeAdvantage("none"), "none");
  assert.equal(normalizeAdvantage("banana"), "banana");
});

test("normalizeRollKind: spaces, hyphens, shorthand", () => {
  assert.equal(normalizeRollKind("saving throw"), "saving_throw");
  assert.equal(normalizeRollKind("save"), "saving_throw");
  assert.equal(normalizeRollKind("skill-check"), "skill_check");
  assert.equal(normalizeRollKind("skill"), "skill_check");
  assert.equal(normalizeRollKind("check"), "skill_check");
  assert.equal(normalizeRollKind("init"), "initiative");
  assert.equal(normalizeRollKind("ability"), "ability_check");
  assert.equal(normalizeRollKind("attack roll"), "attack");
  assert.equal(normalizeRollKind("dmg"), "damage");
  assert.equal(normalizeRollKind("custom"), "custom");
});

test("normalizeRestKind: phrasings", () => {
  assert.equal(normalizeRestKind("short_rest"), "short");
  assert.equal(normalizeRestKind("a long rest"), "long");
  assert.equal(normalizeRestKind("night's sleep"), "long");
  assert.equal(normalizeRestKind("breather"), "short");
  assert.equal(normalizeRestKind("nap"), "nap");
});

test("normalizeListAction: learn/forget/buying/selling", () => {
  assert.equal(normalizeListAction("learn"), "add");
  assert.equal(normalizeListAction("teach"), "add");
  assert.equal(normalizeListAction("forget"), "remove");
  assert.equal(normalizeListAction("unlearn"), "remove");
  assert.equal(normalizeListAction("purchase"), "buy");
  assert.equal(normalizeListAction("buying"), "buy");
  assert.equal(normalizeListAction("selling"), "sell");
  assert.equal(normalizeListAction("sale"), "sell");
  assert.equal(normalizeListAction("add"), "add");
  assert.equal(normalizeListAction("steal"), "steal");
});

const KINDS = ["achievement", "item", "relationship", "death", "level_up", "story"];

test("normalizeEventKind: exact, fuzzy, semantic, fallback", () => {
  assert.equal(normalizeEventKind("story", KINDS), "story");
  assert.equal(normalizeEventKind("Level Up", KINDS), "level_up");
  assert.equal(normalizeEventKind("achievements", KINDS), "achievement");
  assert.equal(normalizeEventKind("bond formed", KINDS), "relationship");
  assert.equal(normalizeEventKind("loot", KINDS), "item");
  assert.equal(normalizeEventKind("quest complete", KINDS), "achievement");
  assert.equal(normalizeEventKind("died", KINDS), "death");
  assert.equal(normalizeEventKind("plot twist", KINDS), "story");
  assert.equal(normalizeEventKind(undefined, KINDS), "story");
});

console.log(`test-arg-coerce: ${passed} tests passed`);
