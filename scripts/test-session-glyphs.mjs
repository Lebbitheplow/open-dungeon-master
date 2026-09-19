// The paintings the running session wears: every tab, mode and system line
// must name a glyph file that exists, because GameIcon renders nothing for a
// missing one and the rail would silently lose its icon.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { TAB_GLYPHS, TABLE_GLYPH, SUBTAB_GLYPHS, MODE_GLYPHS, systemLineGlyph } = await import(
  "../src/app/campaigns/[campaignId]/sessionGlyphs.ts"
);
const { TABLE_TAB_IDS } = await import("../src/lib/dm/table-tabs.ts").catch(() => ({}));

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}
const glyphFile = (name) => new URL(`../public/assets/icons/glyph/${name}.webp`, import.meta.url);

test("every mapped glyph is a file that ships", () => {
  const names = [
    ...Object.values(TAB_GLYPHS),
    TABLE_GLYPH,
    ...Object.values(SUBTAB_GLYPHS),
    ...Object.values(MODE_GLYPHS),
  ];
  for (const name of names) {
    assert.equal(existsSync(glyphFile(name)), true, `${name} is missing`);
  }
});

test("every panel tab has a painting", () => {
  for (const id of TABLE_TAB_IDS ?? ["dm", "lead", "party", "battle", "map", "story", "notes", "chat", "context", "settings"]) {
    assert.ok(TAB_GLYPHS[id], `no glyph for the ${id} tab`);
  }
});

test("every composer mode has a painting", () => {
  for (const kind of ["do", "say", "ooc", "lead", "narrate"]) {
    assert.ok(MODE_GLYPHS[kind], `no glyph for ${kind}`);
  }
});

test("a system line is read for its subject", () => {
  assert.equal(systemLineGlyph("Talia rolled a 17 on her Stealth check"), "die-d20");
  assert.equal(systemLineGlyph("Durgan rolls 2d6 for damage"), "die-d6");
  assert.equal(systemLineGlyph("The party takes a long rest"), "rest-long");
  assert.equal(systemLineGlyph("The party takes a short rest"), "rest-short");
  assert.equal(systemLineGlyph("Nyx reaches level 4"), "rest-level-up");
  assert.equal(systemLineGlyph("Combat begins"), "cue-battle");
  assert.equal(systemLineGlyph("Brannoc paid 12 gp for rope"), "cue-coin");
  assert.equal(systemLineGlyph("The party arrives at the Drowned Market"), "cue-travel");
  assert.equal(systemLineGlyph("Wight 2 is slain"), "cue-death");
});

test("a line about nothing in particular rings the bell", () => {
  assert.equal(systemLineGlyph("The lead changed the table's settings"), "cue-bell");
  assert.equal(systemLineGlyph(""), "cue-bell");
});

test("whatever a system line picks is a file that ships", () => {
  const lines = ["rolled a d4", "d8", "d10", "d12", "d100", "heals 5", "x-card", "level up", "nothing"];
  for (const line of lines) {
    assert.equal(existsSync(glyphFile(systemLineGlyph(line))), true, line);
  }
});

console.log(`session glyphs: ${passed} passed`);
