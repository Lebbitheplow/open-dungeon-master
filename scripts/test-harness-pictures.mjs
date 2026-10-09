// The agent program's pictures at the table (src/lib/harness/picture-test.ts,
// src/lib/image-backend-rescue.ts). The report: Codex passed the admin's test
// picture while every map at the table failed. Reproduced on a real server:
// the campaign had been made before pictures were switched on, so it still
// painted with a ComfyUI that was not there. Here, offline, with the scripted
// fake agent (HARNESS_FAKE) painting real PNGs: the test goes through the
// tables' own door and queue, the stranded campaign is moved, its map then
// paints, and a picture the agent declines says why at the table.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";
import { removeTempDir } from "./lib/remove-temp-dir.mjs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "odm-harness-pictures-"));
const scriptFile = path.join(dir, "fake-script.json");
process.env.SQLITE_DB_PATH = path.join(dir, "test.sqlite");
process.env.DB_ENCRYPTION_KEY = randomBytes(32).toString("hex");
process.env.HARNESS_FAKE = "1";
process.env.HARNESS_FAKE_SCRIPT = scriptFile;
const setScript = (turns) => fs.writeFileSync(scriptFile, JSON.stringify(turns));
// Pictures land in <cwd>/public/generated.
const home = process.cwd();
process.chdir(dir);

register("./lib/register-alias.mjs", pathToFileUrl(path.join(home, "scripts", "x.mjs")));
function pathToFileUrl(file) {
  return new URL(`file://${file}`);
}

const { strandedMoves, rescueStrandedCampaigns, campaignPictures } = await import("../src/lib/image-backend-rescue.ts");
const { pictureStages, testHarnessPictures, TEST_MAP_PROMPT } = await import("../src/lib/harness/picture-test.ts");
const { noPictureMessage } = await import("../src/lib/harness/images.ts");
const { pictureFailureReason } = await import("../src/lib/dm/images.ts");
const { fakePng } = await import("../src/lib/harness/adapters/fake.ts");
const { imageSize } = await import("../src/lib/image-format.ts");
const { saveGlobalConfig } = await import("../src/lib/db/app-settings.ts");
const { createUser } = await import("../src/lib/db/users.ts");
const { createCampaign, getCampaignById, updateGameSettings, updateStorySettings } = await import("../src/lib/db/campaigns.ts");
const { upsertCurrentLocation, getLocation } = await import("../src/lib/db/locations.ts");
const { enqueueLocationMap } = await import("../src/lib/dm/maps.ts");
const { generateStoryImage } = await import("../src/lib/image-generate.ts");
const { imagesAvailable } = await import("../src/lib/capabilities.ts");

let passed = 0;
async function test(name, fn) {
  await fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

const row = (overrides) => ({ id: "x", title: "X", kind: "campaign", backend: "comfyui", picturesOn: true, mapsOn: true, canPaint: false, ...overrides });

try {
  await test("only campaigns on a backend that cannot paint move, and only onto one that can", () => {
    const campaigns = [
      row({ id: "a", title: "The Old Road", mapsOn: false }),
      row({ id: "b", title: "Working Comfy", canPaint: true }),
      row({ id: "c", title: "No Pictures", picturesOn: false }),
      row({ id: "d", title: "Prep", kind: "workshop", mapsOn: false }),
      row({ id: "e", title: "Already Agent", backend: "harness" }),
    ];
    assert.deepEqual(
      strandedMoves(campaigns, "harness", true),
      [
        { id: "a", title: "The Old Road", from: "comfyui", mapsTurnedOn: true },
        { id: "d", title: "Prep", from: "comfyui", mapsTurnedOn: false },
      ],
    );
    assert.deepEqual(strandedMoves(campaigns, "harness", false), [], "a default that cannot paint rescues nobody");
  });

  await test("the test's verdicts: painted, saved, and the map's landscape shape", () => {
    const image = { id: "i", url: "/generated/x.png", prompt: "", mode: "fast", aspect: "landscape", width: 1536, height: 1024, elapsedSeconds: 61 };
    const good = pictureStages({ image, error: "", file: { bytes: 4_000_000, kind: "png", width: 1536, height: 1024 } });
    assert.deepEqual(good.map((stage) => [stage.id, stage.ok]), [["painted", true], ["saved", true], ["shape", true]]);
    const square = pictureStages({ image: { ...image, width: 1024, height: 1024 }, error: "", file: { bytes: 9, kind: "png", width: 1024, height: 1024 } });
    assert.equal(square.find((stage) => stage.id === "shape").ok, false);
    assert.match(square.find((stage) => stage.id === "shape").detail, /crops it/);
    const missing = pictureStages({ image, error: "", file: null });
    assert.equal(missing.find((stage) => stage.id === "saved").ok, false);
    const failed = pictureStages({ image: null, error: "Codex answered without a picture", file: null });
    assert.deepEqual(failed.map((stage) => stage.ok), [false, null, null]);
    assert.match(failed[0].detail, /without a picture/);
  });

  await test("a run with no picture says what the program said instead, flattened and cut short", () => {
    assert.equal(noPictureMessage("Codex", ""), "Codex finished without a picture ODM could use.");
    assert.equal(noPictureMessage("Codex", "done"), "Codex finished without a picture ODM could use.");
    assert.equal(noPictureMessage("Codex", "I can't\n  draw that."), 'Codex answered without a picture: "I can\'t draw that."');
    assert.ok(noPictureMessage("Codex", "x".repeat(900)).length < 300);
    assert.equal(pictureFailureReason(new Error("Could not reach ComfyUI at http://127.0.0.1:9.")), "Could not reach ComfyUI at http://127.0.0.1:9.");
    assert.equal(pictureFailureReason(null), "The picture backend did not answer.");
    assert.ok(pictureFailureReason(new Error("y".repeat(500))).length <= 240);
  });

  await test("the fake agent paints a real PNG of the size asked", () => {
    const png = fakePng(30, 20);
    assert.deepEqual(imageSize(png), { width: 30, height: 20 });
  });

  // The reported server: an agent storyteller, no ComfyUI, campaigns made
  // before the agent's pictures were switched on.
  // An OpenAI picture key is set, so a campaign on OpenAI CAN paint and must
  // never be moved. (A player's campaign follows the server's addresses, so
  // a per-campaign ComfyUI address would not express "working" here.)
  saveGlobalConfig({
    harness: { id: "codex" },
    text: { provider: "harness" },
    images: { defaultBackend: "", comfyUrl: "http://127.0.0.1:9", openaiApiKey: "sk-test-not-used" },
  });
  const lead = createUser("rowan", "x");
  const base = { description: "", theme: "low fantasy", maxPlayers: 4, startingLevel: 3, difficulty: "normal" };
  const oldRoad = createCampaign(lead.id, { ...base, title: "The Old Road", gameSettings: { mapsEnabled: false } });
  const working = createCampaign(lead.id, { ...base, title: "Working OpenAI", gameSettings: {} });
  updateStorySettings(working.id, { imageBackend: "openai" });
  const off = createCampaign(lead.id, { ...base, title: "No Pictures", gameSettings: {} });
  updateStorySettings(off.id, { imageGenerationEnabled: false });
  const prep = createCampaign(lead.id, { ...base, title: "Prep", kind: "workshop", gameSettings: {} });
  updateGameSettings(prep.id, { mapsEnabled: false });
  assert.equal(getCampaignById(oldRoad.id).settings.imageBackend, "comfyui");

  await test("the admin's test paints a landscape map through the tables' own door and queue", async () => {
    setScript([[{ paint: [36, 24] }, { text: "done" }]]);
    globalThis.__odmFakeHarnessLog = [];
    const result = await testHarnessPictures();
    assert.ok(result.image, result.error);
    assert.equal(result.image.backend, "harness");
    assert.deepEqual(result.stages.map((stage) => [stage.id, stage.ok]), [["painted", true], ["saved", true], ["shape", true]]);
    assert.ok(fs.existsSync(path.join(dir, "public", result.image.url)), "the file the table is sent exists");
    const started = globalThis.__odmFakeHarnessLog.find((entry) => entry.kind === "start")?.detail;
    assert.equal(started?.images, true, "only a picture session has the image tool");
    assert.equal(started?.mcp, false, "a picture session has no table tools");
    const prompt = globalThis.__odmFakeHarnessLog.find((entry) => entry.kind === "prompt")?.detail ?? "";
    assert.ok(prompt.includes(TEST_MAP_PROMPT.slice(0, 40)) && /landscape/.test(prompt), "it asked for the table's map, landscape");
    // The campaigns, as the panel shows them.
    const byTitle = Object.fromEntries(result.campaigns.map((entry) => [entry.title, entry]));
    assert.equal(byTitle["The Old Road"].canPaint, false);
    assert.equal(byTitle["Working OpenAI"].canPaint, true);
    assert.equal(result.wouldMove, 2, "the stranded campaign and workshop");
  });

  await test("before the agent is the default, nothing moves; after, only the stranded ones do", async () => {
    assert.deepEqual(await rescueStrandedCampaigns(), [], "the default (a dead ComfyUI) cannot paint either");
    saveGlobalConfig({ harness: { images: "native", imagesVerifiedAt: new Date().toISOString() }, images: { defaultBackend: "harness" } });
    const moved = await rescueStrandedCampaigns();
    assert.deepEqual(moved.map((move) => move.title).sort(), ["Prep", "The Old Road"]);
    assert.equal(getCampaignById(oldRoad.id).settings.imageBackend, "harness");
    assert.equal(getCampaignById(oldRoad.id).gameSettings.mapsEnabled, true, "its maps were off only because nothing could draw them");
    assert.equal(getCampaignById(prep.id).settings.imageBackend, "harness");
    assert.equal(getCampaignById(prep.id).gameSettings.mapsEnabled, false, "a workshop's maps are left alone");
    assert.equal(getCampaignById(working.id).settings.imageBackend, "openai", "a working backend is never switched");
    assert.equal(getCampaignById(off.id).settings.imageBackend, "comfyui", "pictures switched off stay off");
    assert.deepEqual(await rescueStrandedCampaigns(), [], "running it again moves nobody");
    assert.equal((await campaignPictures()).find((entry) => entry.title === "The Old Road").canPaint, true);
  });

  await test("the rescued campaign's next location map paints with the agent", async () => {
    setScript([[{ paint: [48, 32] }, { text: "done" }]]);
    const location = upsertCurrentLocation({ campaignId: oldRoad.id, name: "The Drowned Ford", layoutDescription: "a river crossing" });
    await enqueueLocationMap(getCampaignById(oldRoad.id), location.id);
    const map = getLocation(location.id).mapImage;
    assert.ok(map, "the map was painted");
    assert.equal(map.backend, "harness");
    assert.equal(map.width, 48);
  });

  await test("a campaign set to the agent can redraw a map even when the server's default backend differs", async () => {
    assert.equal(await imagesAvailable({ imageBackend: "harness", customBaseUrl: "", customApiKey: "" }), true);
    saveGlobalConfig({ harness: { images: "off" } });
    assert.equal(await imagesAvailable({ imageBackend: "harness", customBaseUrl: "", customApiKey: "" }), false);
    saveGlobalConfig({ harness: { images: "native" } });
  });

  await test("a picture the agent declines fails with its words, ready for the table", async () => {
    setScript([[{ text: "I can't help draw that scene." }]]);
    await assert.rejects(
      generateStoryImage(getCampaignById(oldRoad.id).settings, { prompt: "a grim cellar", mode: "fast", aspect: "landscape" }),
      (error) => {
        assert.match(pictureFailureReason(error), /answered without a picture: "I can't help draw that scene\."/);
        return true;
      },
    );
  });

  console.log(`\n${passed} agent picture checks passed`);
} finally {
  process.chdir(home);
  removeTempDir(dir);
}
