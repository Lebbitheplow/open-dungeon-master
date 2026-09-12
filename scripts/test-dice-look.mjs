// A player's dice look: what a stored record parses to, what the profile
// route accepts, and the tray config a look becomes. The parse is lenient
// (each bad field falls back alone) while the write check is strict, and
// two different looks must never map to the same library theme name.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const {
  DEFAULT_DICE_LOOK,
  DICE_LOOK_PRESETS,
  DICE_MATERIALS,
  DICE_TEXTURES,
  diceLookKey,
  diceLookTheme,
  isValidDiceLook,
  parseDiceLook,
  sameDiceLook,
} = await import("../src/lib/dice/dice-look.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

test("nothing stored parses to the default look", () => {
  assert.deepEqual(parseDiceLook(undefined), DEFAULT_DICE_LOOK);
  assert.deepEqual(parseDiceLook(null), DEFAULT_DICE_LOOK);
  assert.deepEqual(parseDiceLook("junk"), DEFAULT_DICE_LOOK);
});

test("each bad field falls back on its own", () => {
  const look = parseDiceLook({
    face: "#123456",
    numbers: "red",
    outline: "#abcdef",
    texture: "velvet",
    material: "glass",
  });
  assert.equal(look.face, "#123456");
  assert.equal(look.numbers, DEFAULT_DICE_LOOK.numbers);
  assert.equal(look.outline, "#ABCDEF", "hex is normalised to upper case");
  assert.equal(look.texture, DEFAULT_DICE_LOOK.texture);
  assert.equal(look.material, "glass");
});

test("an empty outline means no outline and survives the parse", () => {
  assert.equal(parseDiceLook({ outline: "" }).outline, "");
  assert.equal(parseDiceLook({ outline: "none" }).outline, DEFAULT_DICE_LOOK.outline);
});

test("the strict check accepts every preset and refuses partial records", () => {
  for (const preset of DICE_LOOK_PRESETS) {
    assert.ok(isValidDiceLook(preset.look), `${preset.id} should be valid`);
  }
  assert.ok(isValidDiceLook(DEFAULT_DICE_LOOK));
  assert.equal(isValidDiceLook({ ...DEFAULT_DICE_LOOK, face: undefined }), false);
  assert.equal(isValidDiceLook({ ...DEFAULT_DICE_LOOK, texture: "velvet" }), false);
  assert.equal(isValidDiceLook({ ...DEFAULT_DICE_LOOK, outline: "black" }), false);
  assert.equal(isValidDiceLook({ ...DEFAULT_DICE_LOOK, face: "#fff" }), false);
  assert.equal(isValidDiceLook(null), false);
});

test("presets only use textures and materials the tray ships", () => {
  const textures = new Set(DICE_TEXTURES.map((entry) => entry.id));
  const materials = new Set(DICE_MATERIALS.map((entry) => entry.id));
  const ids = new Set();
  for (const preset of DICE_LOOK_PRESETS) {
    assert.ok(textures.has(preset.look.texture), `${preset.id}: texture ${preset.look.texture}`);
    assert.ok(materials.has(preset.look.material), `${preset.id}: material ${preset.look.material}`);
    assert.ok(!ids.has(preset.id), `duplicate preset id ${preset.id}`);
    ids.add(preset.id);
  }
});

test("the first preset is the tray's original look", () => {
  assert.ok(sameDiceLook(DICE_LOOK_PRESETS[0].look, DEFAULT_DICE_LOOK));
});

test("the theme names the look uniquely and maps colours to the library's words", () => {
  const theme = diceLookTheme(DEFAULT_DICE_LOOK);
  assert.equal(theme.theme_customColorset.background, DEFAULT_DICE_LOOK.face);
  assert.equal(theme.theme_customColorset.foreground, DEFAULT_DICE_LOOK.numbers);
  assert.equal(theme.theme_customColorset.outline, "none", "no outline is the library's 'none'");
  assert.equal(theme.theme_customColorset.texture, "paper");
  assert.equal(theme.theme_customColorset.material, "plastic");
  assert.equal(theme.theme_material, "plastic");
  assert.equal(theme.theme_customColorset.name, diceLookKey(DEFAULT_DICE_LOOK));

  const other = { ...DEFAULT_DICE_LOOK, outline: "#000000" };
  assert.notEqual(diceLookKey(other), diceLookKey(DEFAULT_DICE_LOOK));
  assert.equal(diceLookTheme(other).theme_customColorset.outline, "#000000");
  assert.equal(diceLookKey({ ...DEFAULT_DICE_LOOK }), diceLookKey(DEFAULT_DICE_LOOK), "same look, same name");
});

console.log(`test-dice-look: ${passed} checks passed`);
