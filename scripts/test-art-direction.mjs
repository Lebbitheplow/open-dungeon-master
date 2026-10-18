// A campaign's look for generated maps and scene pictures (issue 377): the
// setting's style by default, a preset or the table's own words when picked,
// and no painted lettering on maps. The pure half is checked directly; the
// prompts the table really sends are read off the scripted fake agent
// (HARNESS_FAKE) standing in as the picture backend.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";
import { removeTempDir } from "./lib/remove-temp-dir.mjs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "odm-art-direction-"));
const scriptFile = path.join(dir, "fake-script.json");
process.env.SQLITE_DB_PATH = path.join(dir, "test.sqlite");
process.env.DB_ENCRYPTION_KEY = randomBytes(32).toString("hex");
process.env.HARNESS_FAKE = "1";
process.env.HARNESS_FAKE_SCRIPT = scriptFile;
const home = process.cwd();
process.chdir(dir);
register("./lib/register-alias.mjs", new URL(`file://${path.join(home, "scripts", "x.mjs")}`));

const {
  ART_STYLE_LABELS,
  ART_STYLE_NOTES,
  ART_STYLE_PRESETS,
  MAP_NEGATIVE,
  artDirection,
  locationMapPrompt,
  scenePrompt,
  typedStyle,
} = await import("../src/lib/art-direction.ts");
const { ART_STYLES, ART_STYLE_TEXT_MAX } = await import("../src/lib/types.ts");
const { GENRE_PRESETS } = await import("../src/lib/genres.ts");
const { normalizeSettings } = await import("../src/lib/db/settings.ts");
const { generateImageTool } = await import("../src/lib/image-tool.ts");
const { TEST_MAP_PROMPT } = await import("../src/lib/harness/picture-test.ts");
const { worldPackSchema } = await import("../src/lib/worlds/types.ts");
const { saveGlobalConfig } = await import("../src/lib/db/app-settings.ts");
const { createUser } = await import("../src/lib/db/users.ts");
const { allocateSeq, createCampaign, getCampaignById, updateStorySettings } = await import(
  "../src/lib/db/campaigns.ts"
);
const { insertCampaignMessage } = await import("../src/lib/db/messages.ts");
const { upsertCurrentLocation } = await import("../src/lib/db/locations.ts");
const { fulfillMessageImage } = await import("../src/lib/dm/images.ts");
const { enqueueLocationMap } = await import("../src/lib/dm/maps.ts");
const { imageVariantsSettled } = await import("../src/lib/image-variants.ts");

let passed = 0;
async function test(name, fn) {
  await fn();
  passed += 1;
}

const SETTING = { mapStyle: "setting map words", sceneStyle: "setting scene words" };
const art = (artStyle, artStyleMap = "", artStyleScene = "") => ({ artStyle, artStyleMap, artStyleScene });

try {
  // ---- the pure half ----

  await test("every style has a label and a note, and every preset a map and a scene", () => {
    for (const style of ART_STYLES) {
      assert.ok(ART_STYLE_LABELS[style], style);
      assert.ok(ART_STYLE_NOTES[style], style);
    }
    for (const style of ART_STYLES.filter((style) => style !== "setting" && style !== "custom")) {
      assert.ok(ART_STYLE_PRESETS[style].map && ART_STYLE_PRESETS[style].scene, style);
    }
  });

  await test("a campaign that never chose follows its setting, as before", () => {
    const settings = normalizeSettings({});
    assert.equal(settings.artStyle, "setting");
    assert.deepEqual(artDirection(settings, SETTING), { map: SETTING.mapStyle, scene: SETTING.sceneStyle });
  });

  await test("a preset replaces both looks with its matched pair", () => {
    assert.deepEqual(artDirection(art("realistic"), SETTING), ART_STYLE_PRESETS.realistic);
  });

  await test("custom words win, and a blank one keeps the setting's look for that kind", () => {
    assert.deepEqual(artDirection(art("custom", "  survey map  ", "oil painting"), SETTING), {
      map: "survey map",
      scene: "oil painting",
    });
    assert.deepEqual(artDirection(art("custom", "", "oil painting"), SETTING), {
      map: SETTING.mapStyle,
      scene: "oil painting",
    });
  });

  await test("only typed words are sent for an English rewrite", () => {
    assert.equal(typedStyle(art("custom", "survey map", ""), "map"), "survey map");
    assert.equal(typedStyle(art("custom", "survey map", ""), "scene"), "");
    assert.equal(typedStyle(art("painted", "survey map", "x"), "map"), "", "a preset is English already");
  });

  await test("stored styles are bounded and a bad choice falls back", () => {
    const settings = normalizeSettings({ artStyle: "vaporwave", artStyleMap: `  ${"m".repeat(500)}  `, artStyleScene: 7 });
    assert.equal(settings.artStyle, "setting");
    assert.equal(settings.artStyleMap.length, ART_STYLE_TEXT_MAX);
    assert.equal(settings.artStyleScene, "");
  });

  await test("a map asks for no lettering and never for labels", () => {
    const prompt = locationMapPrompt("ink map", { name: "The Drowned Ford", layout: "a river crossing" });
    assert.equal(prompt, "top-down game map, ink map, clear pathways, no text or lettering, The Drowned Ford, a river crossing");
    assert.doesNotMatch(prompt, /label/i);
    assert.equal(locationMapPrompt("", { name: "Ford", layout: "" }), "top-down game map, clear pathways, no text or lettering, Ford");
    assert.match(MAP_NEGATIVE, /letters/);
    assert.doesNotMatch(TEST_MAP_PROMPT, /label/i, "the admin's test map is the tables' map");
  });

  await test("no setting asks its maps for labels, and every named setting has a scene look", () => {
    for (const preset of GENRE_PRESETS) {
      assert.doesNotMatch(preset.mapStyle, /label/i, preset.id);
      if (preset.id !== "custom") {
        assert.ok(preset.sceneStyle.trim(), `${preset.id} has no sceneStyle`);
      }
    }
  });

  await test("the scene's look leads the DM's subject", () => {
    assert.equal(scenePrompt("ink wash", " A ford at dusk "), "ink wash. A ford at dusk");
    assert.equal(scenePrompt("", "A ford at dusk"), "A ford at dusk");
  });

  await test("the DM is told the campaign sets the look", () => {
    const description = generateImageTool.function.parameters.properties.prompt.description;
    assert.match(description, /Leave out the art style/);
    assert.doesNotMatch(description, /camera style/);
  });

  await test("a world pack may carry a scene look, and one without it still loads", () => {
    assert.equal(worldPackSchema.shape.sceneStyle.parse(undefined), "");
  });

  // ---- what the table sends ----

  saveGlobalConfig({
    harness: { id: "codex", images: "native", imagesVerifiedAt: new Date().toISOString() },
    text: { provider: "harness" },
    images: { defaultBackend: "harness" },
  });
  const lead = createUser("rowan", "x");
  const created = createCampaign(lead.id, {
    title: "The Drowned Ford",
    description: "",
    theme: "",
    maxPlayers: 4,
    startingLevel: 3,
    difficulty: "normal",
    gameSettings: { genre: "horror", tableLanguage: "english" },
  });
  const horror = GENRE_PRESETS.find((preset) => preset.id === "horror");
  fs.writeFileSync(scriptFile, JSON.stringify(Array.from({ length: 12 }, () => [{ paint: [48, 32] }, { text: "done" }])));

  // The prompt the picture backend was handed for the last picture.
  async function sentFor(fn) {
    globalThis.__odmFakeHarnessLog = [];
    await fn();
    const prompts = globalThis.__odmFakeHarnessLog.filter((entry) => entry.kind === "prompt");
    assert.ok(prompts.length, "no picture was asked for");
    return String(prompts.at(-1).detail);
  }
  const scene = (text) => {
    const campaign = getCampaignById(created.id);
    const request = { needed: true, prompt: text, mode: "fast", aspect: "landscape" };
    const message = insertCampaignMessage({
      campaignId: campaign.id,
      seq: allocateSeq(campaign.id),
      authorType: "dm",
      content: "The ford is swollen with rain.",
      speech: [],
      imageRequest: request,
    });
    return sentFor(() => fulfillMessageImage(campaign.id, message.id, request, campaign.settings));
  };
  const location = upsertCurrentLocation({ campaignId: created.id, name: "The Drowned Ford", layoutDescription: "a river crossing" });
  const map = () => sentFor(() => enqueueLocationMap(getCampaignById(created.id), location.id));

  await test("by default a scene leads with the setting's look", async () => {
    const prompt = await scene("A lantern on the far bank");
    assert.ok(prompt.includes(`${horror.sceneStyle}. A lantern on the far bank`), prompt);
  });

  await test("by default a map uses the setting's map look and asks for no lettering", async () => {
    const prompt = await map();
    assert.ok(prompt.includes(`top-down game map, ${horror.mapStyle}, clear pathways, no text or lettering`), prompt);
    assert.doesNotMatch(prompt, /labeled areas/);
  });

  await test("a preset changes the next scene and the next map", async () => {
    updateStorySettings(created.id, { artStyle: "comic" });
    assert.ok((await scene("A lantern")).includes(`${ART_STYLE_PRESETS.comic.scene}. A lantern`));
    assert.ok((await map()).includes(ART_STYLE_PRESETS.comic.map));
  });

  await test("custom scene words leave the map on the setting's look", async () => {
    updateStorySettings(created.id, { artStyle: "custom", artStyleScene: "grainy film photograph", artStyleMap: "" });
    const scenePromptSent = await scene("A lantern");
    assert.ok(scenePromptSent.includes("grainy film photograph. A lantern"), scenePromptSent);
    assert.ok(!scenePromptSent.includes(horror.sceneStyle), "the setting's scene look gave way");
    assert.ok((await map()).includes(horror.mapStyle), "changing one look does not change the other");
  });

  console.log(`test-art-direction: ${passed} passed`);
} finally {
  await imageVariantsSettled();
  process.chdir(home);
  removeTempDir(dir);
}
