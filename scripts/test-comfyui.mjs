// What the server will take back from a ComfyUI URL (src/lib/comfyui.ts).
//
// The URL can be a campaign's own setting, so whatever answers there is
// played here by a stubbed fetch that speaks the protocol and then
// misbehaves: a redirect toward an internal address, a page that is not a
// picture, a body with no end. None of them may be followed, read past the
// ceiling, or written under public/generated.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";
import { removeTempDir } from "./lib/remove-temp-dir.mjs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "odm-comfyui-"));
process.env.SQLITE_DB_PATH = path.join(dir, "test.sqlite");
process.env.DB_ENCRYPTION_KEY = randomBytes(32).toString("hex");

register("./lib/register-alias.mjs", import.meta.url);

const { buildCheckpointWorkflow, buildZTurboWorkflow, comfyStatus, generateComfyImage, MAX_COMFY_IMAGE_BYTES } = await import("../src/lib/comfyui.ts");
const { getGlobalConfig, saveGlobalConfig } = await import("../src/lib/db/app-settings.ts");
const { imageVariantsSettled } = await import("../src/lib/image-variants.ts");

// Generated files land under the working directory; keep them out of the repo.
const repoCwd = process.cwd();
process.chdir(dir);
const generatedDir = path.join(dir, "public", "generated");
// Originals only: the WebP copies of an earlier test's picture are written
// in the background and may land at any moment.
const generatedFiles = () =>
  (fs.existsSync(generatedDir) ? fs.readdirSync(generatedDir) : []).filter((name) => !/\.w\d+\.webp$/.test(name));

const COMFY = "http://comfy.test";
const METADATA = "http://169.254.169.254/latest/meta-data/iam/security-credentials/";
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);
const JPEG = Buffer.from(
  "/9j/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAABQb/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCfAAFQ/9k=",
  "base64",
);

const json = (value) => Response.json(value);
const redirectTo = (location) => new Response(null, { status: 302, headers: { location } });

// A ComfyUI that does its job, with any route overridable.
function fakeComfy(overrides = {}) {
  const routes = {
    "/system_stats": () => json({ system: {} }),
    "/object_info/CheckpointLoaderSimple": () =>
      json({ CheckpointLoaderSimple: { input: { required: { ckpt_name: [["model.safetensors"]] } } } }),
    // ComfyUI's tutorial downloads for Z-Image Turbo, not the files the
    // reference workflow names; the VAE kept in a subfolder.
    "/object_info/UNETLoader": () =>
      json({ UNETLoader: { input: { required: { unet_name: [["flux1-schnell.safetensors", "z_image_turbo_bf16.safetensors"]] } } } }),
    "/object_info/CLIPLoader": () =>
      json({ CLIPLoader: { input: { required: { clip_name: ["COMBO", { options: ["clip_l.safetensors", "qwen_3_4b.safetensors"] }] } } } }),
    "/object_info/VAELoader": () => json({ VAELoader: { input: { required: { vae_name: [["flux/ae.safetensors"]] } } } }),
    "/prompt": () => json({ prompt_id: "p1" }),
    "/history/p1": () =>
      json({ p1: { status: { completed: true }, outputs: { 7: { images: [{ filename: "out.png", subfolder: "", type: "output" }] } } } }),
    "/view": () => new Response(PNG, { headers: { "content-type": "image/png" } }),
    ...overrides,
  };
  const seen = [];
  const fetchStub = async (input, init) => {
    const url = new URL(String(input));
    seen.push({ url: url.href, redirect: init?.redirect, body: init?.body });
    if (url.origin !== COMFY) {
      // Only reachable if a redirect was followed.
      return new Response("AWS_SECRET_ACCESS_KEY=hunter2");
    }
    const route = routes[url.pathname];
    return route ? route(url) : new Response("not found", { status: 404 });
  };
  return { fetchStub, seen };
}

const generate = () =>
  generateComfyImage({ url: COMFY, checkpoint: "model.safetensors", prompt: "a tavern", mode: "fast", aspect: "square" });

let passed = 0;
async function test(name, comfy, fn) {
  const realFetch = globalThis.fetch;
  globalThis.fetch = comfy.fetchStub;
  try {
    await fn(comfy);
  } finally {
    globalThis.fetch = realFetch;
  }
  passed += 1;
  console.log(`ok - ${name}`);
}

function assertNothingLeaked(seen, before) {
  assert.ok(!seen.some((call) => !call.url.startsWith(COMFY)), "a redirect was followed off the ComfyUI host");
  assert.ok(seen.every((call) => call.redirect === "manual"), "a ComfyUI request would follow redirects");
  assert.deepEqual(generatedFiles(), before, "something was written under public/generated");
}

const zReference = JSON.parse(fs.readFileSync(new URL("./fixtures/comfy-z-turbo.json", import.meta.url), "utf8"));
const REFERENCE_FILES = { unet: "z_image_turbo_nvfp4.safetensors", clip: "qwen_3_4b_fp8_mixed.safetensors", vae: "ae.safetensors" };
const TUTORIAL_FILES = { unet: "z_image_turbo_bf16.safetensors", clip: "qwen_3_4b.safetensors", vae: "flux/ae.safetensors" };
// The reference graph with another ComfyUI's files in its three loaders.
const withFiles = (graph, files) => {
  const copy = structuredClone(graph);
  copy["57:28"].inputs.unet_name = files.unet;
  copy["57:30"].inputs.clip_name = files.clip;
  copy["57:29"].inputs.vae_name = files.vae;
  return copy;
};
assert.deepEqual(
  buildZTurboWorkflow({ prompt: "a tavern", width: 1024, height: 1024, seed: 42, files: REFERENCE_FILES }),
  zReference,
  "Z-Image Turbo graph must match the supplied API workflow with only its prompt, size, seed and files varying",
);
passed += 1;
console.log("ok - Z-Image Turbo graph matches the supplied workflow");

const checkpointGraph = buildCheckpointWorkflow({
  checkpoint: "model.safetensors", prompt: "a tavern", width: 768, height: 768, seed: 42, negative: "no swords",
});
assert.equal(checkpointGraph["1"].inputs.ckpt_name, "model.safetensors");
assert.equal(checkpointGraph["3"].inputs.text.endsWith(", no swords"), true);
assert.deepEqual(checkpointGraph["5"].inputs, {
  model: ["1", 0], positive: ["2", 0], negative: ["3", 0], latent_image: ["4", 0],
  seed: 42, steps: 25, cfg: 6, sampler_name: "euler", scheduler: "normal", denoise: 1,
});
assert.equal(checkpointGraph["7"].inputs.filename_prefix, "open-dungeon");
passed += 1;
console.log("ok - standard checkpoint workflow keeps its model, negatives, and sampler");

await test("a well-behaved ComfyUI still produces a picture", fakeComfy(), async ({ seen }) => {
  const image = await generate();
  assert.match(image.url, /^\/generated\/.*-comfyui-a-tavern\.png$/);
  assert.deepEqual(fs.readFileSync(path.join(dir, "public", image.url)), PNG);
  assert.ok(seen.every((call) => call.redirect === "manual"));
});

await test(
  "a JPEG is saved as a .jpg, not under a .png name",
  fakeComfy({ "/view": () => new Response(JPEG) }),
  async () => {
    const image = await generate();
    assert.match(image.url, /\.jpg$/);
  },
);

await test(
  "the final download redirected to an internal address is refused, not followed",
  fakeComfy({ "/view": () => redirectTo(METADATA) }),
  async ({ seen }) => {
    const before = generatedFiles();
    await assert.rejects(generate(), /redirect/);
    assertNothingLeaked(seen, before);
  },
);

await test(
  "a download that is not a picture is never published",
  fakeComfy({ "/view": () => new Response("<html>internal admin page</html>", { headers: { "content-type": "image/png" } }) }),
  async ({ seen }) => {
    const before = generatedFiles();
    await assert.rejects(generate(), /not a PNG, JPEG or WebP/);
    assertNothingLeaked(seen, before);
  },
);

{
  // A body with no declared length that never stops: read only to the cap.
  let pulled = 0;
  const endless = () =>
    new Response(
      new ReadableStream({
        pull(controller) {
          pulled += 1;
          controller.enqueue(new Uint8Array(1024 * 1024).fill(0x41));
        },
      }),
    );
  await test("an endless download is cut off at the ceiling", fakeComfy({ "/view": endless }), async ({ seen }) => {
    const before = generatedFiles();
    await assert.rejects(generate(), /more than 32MB/);
    assert.ok(pulled <= MAX_COMFY_IMAGE_BYTES / (1024 * 1024) + 2, `read ${pulled}MB of an endless body`);
    assertNothingLeaked(seen, before);
  });
}

await test(
  "a download that declares more than the ceiling is refused before it is read",
  fakeComfy({ "/view": () => new Response(PNG, { headers: { "content-length": String(10 * 1024 * 1024 * 1024) } }) }),
  async ({ seen }) => {
    const before = generatedFiles();
    await assert.rejects(generate(), /more than 32MB/);
    assertNothingLeaked(seen, before);
  },
);

await test(
  "a redirecting history poll fails at once rather than polling for ten minutes",
  fakeComfy({ "/history/p1": () => redirectTo(METADATA) }),
  async ({ seen }) => {
    const before = generatedFiles();
    const started = Date.now();
    await assert.rejects(generate(), /redirect/);
    assert.ok(Date.now() - started < 5_000, "the poll kept retrying a redirect");
    assertNothingLeaked(seen, before);
  },
);

await test(
  "an endless history answer is cut off too",
  fakeComfy({
    "/history/p1": () =>
      new Response(
        new ReadableStream({
          pull(controller) {
            controller.enqueue(new Uint8Array(1024 * 1024).fill(0x20));
          },
        }),
      ),
  }),
  async ({ seen }) => {
    const before = generatedFiles();
    await assert.rejects(generate(), /more than 4MB/);
    assertNothingLeaked(seen, before);
  },
);

await test(
  "a redirect in answer to the workflow submit is refused",
  fakeComfy({ "/prompt": () => new Response(null, { status: 307, headers: { location: METADATA } }) }),
  async ({ seen }) => {
    await assert.rejects(generate(), /redirect/);
    assertNothingLeaked(seen, generatedFiles());
  },
);

await test(
  "the status check reports a redirect instead of following it",
  fakeComfy({ "/system_stats": () => redirectTo(METADATA) }),
  async ({ seen }) => {
    const status = await comfyStatus(COMFY);
    assert.equal(status.ok, false);
    assert.match(status.error, /redirect/);
    assert.ok(!seen.some((call) => !call.url.startsWith(COMFY)));
  },
);

saveGlobalConfig({ images: { comfyCheckpoint: "keep-this-checkpoint.safetensors", comfyWorkflowPreset: "z_turbo" } });
await test("Z-Image Turbo submits its graph with this ComfyUI's files, no checkpoint and no table negatives", fakeComfy(), async ({ seen }) => {
  const image = await generateComfyImage({
    url: COMFY, checkpoint: "", prompt: "a tavern",
    mode: "fast", aspect: "square", seed: 42, negative: "private table boundary",
  });
  assert.match(image.url, /^\/generated\/.*-comfyui-a-tavern\.png$/);
  assert.deepEqual(fs.readFileSync(path.join(dir, "public", image.url)), PNG);
  assert.equal(JSON.stringify(JSON.parse(seen.find((call) => call.url.endsWith("/prompt")).body)).includes("CheckpointLoaderSimple"), false);
  const sent = JSON.parse(seen.find((call) => call.url.endsWith("/prompt")).body);
  // The files this ComfyUI lists, in the otherwise unchanged reference graph.
  assert.deepEqual(sent.prompt, withFiles(zReference, TUTORIAL_FILES));
  assert.equal(JSON.stringify(sent).includes("private table boundary"), false);
  assert.equal(getGlobalConfig().images.comfyCheckpoint, "keep-this-checkpoint.safetensors");
});

await test(
  "Z-Image Turbo names the file a ComfyUI lacks instead of submitting a graph it will refuse",
  fakeComfy({ "/object_info/CLIPLoader": () => json({ CLIPLoader: { input: { required: { clip_name: [["clip_l.safetensors"]] } } } }) }),
  async ({ seen }) => {
    const before = generatedFiles();
    await assert.rejects(
      generateComfyImage({ url: COMFY, prompt: "a tavern", mode: "fast", aspect: "square" }),
      /missing the Qwen 3 4B text encoder \(models\/text_encoders\) for Z-Image Turbo/,
    );
    assert.ok(!seen.some((call) => call.url.endsWith("/prompt")), "a graph went to ComfyUI anyway");
    assertNothingLeaked(seen, before);
  },
);

await test("the status check reports the Z-Image Turbo files it found", fakeComfy(), async () => {
  assert.deepEqual((await comfyStatus(COMFY)).zImage, TUTORIAL_FILES);
});
await test(
  "a ComfyUI without the Z-Image loaders still reports its checkpoints",
  fakeComfy({ "/object_info/UNETLoader": () => new Response("no such node", { status: 404 }), "/object_info/VAELoader": () => new Response("<html>") }),
  async () => {
    const status = await comfyStatus(COMFY);
    assert.equal(status.ok, true);
    assert.deepEqual(status.checkpoints, ["model.safetensors"]);
    assert.deepEqual(status.zImage, { unet: "", clip: "qwen_3_4b.safetensors", vae: "" });
  },
);

saveGlobalConfig({ images: { comfyWorkflowPreset: "checkpoint" } });
await test("switching back keeps the stored checkpoint and submits the standard graph", fakeComfy(), async ({ seen }) => {
  await generateComfyImage({ url: COMFY, checkpoint: getGlobalConfig().images.comfyCheckpoint,
    prompt: "a tavern", mode: "fast", aspect: "square", seed: 42 });
  const sent = JSON.parse(seen.find((call) => call.url.endsWith("/prompt")).body);
  assert.equal(sent.prompt["1"].inputs.ckpt_name, "keep-this-checkpoint.safetensors");
  assert.equal(sent.prompt["5"].inputs.sampler_name, "euler");
});

await imageVariantsSettled();
process.chdir(repoCwd);
removeTempDir(dir);
console.log(`test-comfyui: ${passed} passed`);
