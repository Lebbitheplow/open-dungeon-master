// The paintings the running session wears: every tab, mode and system line
// must name a glyph file that exists, because GameIcon renders nothing for a
// missing one and the rail would silently lose its icon.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { TAB_GLYPHS, TABLE_GLYPH, SUBTAB_GLYPHS, MODE_GLYPHS } = await import(
  "../src/app/campaigns/[campaignId]/sessionGlyphs.ts"
);
const { SYSTEM_GLYPHS, isSystemGlyph } = await import("../src/lib/system-glyphs.ts");
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

// A system line's icon is stored by the code that writes it (the type of
// insertCampaignMessage requires one), never read from its words.
test("every icon a system line can store is a file that ships", () => {
  for (const glyph of SYSTEM_GLYPHS) {
    assert.equal(existsSync(glyphFile(glyph)), true, glyph);
  }
  assert.ok(isSystemGlyph("cue-death"));
  assert.ok(!isSystemGlyph("cue-unknown"));
  assert.ok(!isSystemGlyph(null));
});

console.log(`session glyphs: ${passed} passed`);
