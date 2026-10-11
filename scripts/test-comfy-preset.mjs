// Vitest transforms the admin TSX component and mocks authentication while
// this script exercises the real settings route and temporary SQLite store.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test, vi } from "vitest";
import { removeTempDir } from "./lib/remove-temp-dir.mjs";

vi.mock("@/lib/admin-api", () => ({
  requireAdmin: async () => ({ isAdmin: true }),
  isErrorResponse: (value) => value instanceof Response,
}));
vi.mock("@/lib/image-backend-rescue", () => ({ rescueStrandedCampaigns: async () => [] }));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "odm-comfy-preset-"));
process.env.SQLITE_DB_PATH = path.join(dir, "test.sqlite");
process.env.DB_ENCRYPTION_KEY = randomBytes(32).toString("hex");

const { GET, PATCH } = await import("../src/app/api/admin/settings/route.ts");
const { getGlobalConfig } = await import("../src/lib/db/app-settings.ts");
const { AdminImagesSection, comfyModelOptions, comfyModelPatch, comfyModelStatus, fetchComfyModels } = await import("../src/app/admin/AdminImagesSection.tsx");

async function patch(images) {
  return PATCH(new Request("http://localhost/api/admin/settings", {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ images }),
  }));
}

test("ComfyUI admin preset persists and renders correctly", async () => {
let passed = 0;
const initial = await (await GET()).json();
assert.equal(initial.config.images.comfyWorkflowPreset, "checkpoint");
assert.equal(getGlobalConfig().images.comfyWorkflowPreset, "checkpoint");
passed += 1;
console.log("ok - existing configuration defaults to standard checkpoint");

let response = await patch({ comfyCheckpoint: "saved-checkpoint.safetensors", comfyWorkflowPreset: "z_turbo" });
assert.equal(response.status, 200);
assert.equal((await response.json()).config.images.comfyWorkflowPreset, "z_turbo");
assert.equal(getGlobalConfig().images.comfyCheckpoint, "saved-checkpoint.safetensors");
let loaded = await (await GET()).json();
assert.equal(loaded.config.images.comfyWorkflowPreset, "z_turbo");
assert.equal(loaded.config.images.comfyCheckpoint, "saved-checkpoint.safetensors");
passed += 1;
console.log("ok - admin PATCH persists and GET reloads the Z-Image Turbo preset");

const render = (config) => renderToStaticMarkup(React.createElement(AdminImagesSection, {
  images: config.images,
  env: loaded.envDefaults,
  harness: config.harness,
  phoneWorld: false,
  openaiKey: "",
  onImages: () => {},
  onOpenaiKey: () => {},
}));
const zHtml = render(loaded.config);
assert.match(zHtml, /Image model/);
assert.match(zHtml, /Z-Image Turbo/);
assert.doesNotMatch(zHtml, /ComfyUI workflow preset|Checkpoint \(model file\)/);
passed += 1;
console.log("ok - rendered Z selection shows one image model control");

const options = comfyModelOptions("saved-checkpoint.safetensors", ["installed.safetensors"], true);
const DEFAULT = { value: "checkpoint:", label: "Default checkpoint", hint: "CyberRealisticXLPlay_V6.0.safetensors" };
assert.deepEqual(options, [
  DEFAULT,
  { value: "checkpoint:saved-checkpoint.safetensors", label: "saved-checkpoint.safetensors", hint: "Saved selection; not reported by this ComfyUI." },
  { value: "checkpoint:installed.safetensors", label: "installed.safetensors" },
  { value: "preset:z_turbo", label: "Z-Image Turbo" },
]);
assert.deepEqual(comfyModelOptions("", [], true), [
  DEFAULT,
  { value: "preset:z_turbo", label: "Z-Image Turbo" },
]);
assert.deepEqual(comfyModelPatch("checkpoint:installed.safetensors", options), {
  comfyWorkflowPreset: "checkpoint", comfyCheckpoint: "installed.safetensors",
});
assert.deepEqual(comfyModelPatch("preset:z_turbo", options), { comfyWorkflowPreset: "z_turbo" });
assert.deepEqual(comfyModelPatch("checkpoint:saved-checkpoint.safetensors", options), {
  comfyWorkflowPreset: "checkpoint", comfyCheckpoint: "saved-checkpoint.safetensors",
});
assert.deepEqual(comfyModelPatch("checkpoint:", options), {
  comfyWorkflowPreset: "checkpoint", comfyCheckpoint: "",
});
assert.equal(comfyModelPatch("checkpoint:invented.safetensors", options), null);
const collision = comfyModelOptions("", ["preset:z_turbo"], true);
assert.deepEqual(comfyModelPatch("checkpoint:preset:z_turbo", collision), {
  comfyWorkflowPreset: "checkpoint", comfyCheckpoint: "preset:z_turbo",
});
const restored = { ...loaded.config, images: { ...loaded.config.images, ...comfyModelPatch("checkpoint:saved-checkpoint.safetensors", options) } };
assert.match(render(restored), /saved-checkpoint\.safetensors/);
assert.doesNotMatch(render(restored), /ComfyUI workflow preset|Checkpoint \(model file\)/);
passed += 1;
console.log("ok - discovered, saved, default, and Z choices map to one persisted selection");

const found = { unet: "zimage/z_image_turbo_bf16.safetensors", clip: "qwen_3_4b.safetensors", vae: "ae.safetensors" };
const lacking = { ...found, clip: "" };
assert.deepEqual(comfyModelOptions("", [], true, found).at(-1), { value: "preset:z_turbo", label: "Z-Image Turbo", hint: "Uses z_image_turbo_bf16.safetensors" });
assert.deepEqual(comfyModelOptions("", [], true, lacking).at(-1), { value: "preset:z_turbo", label: "Z-Image Turbo", hint: "Its files are not all on this ComfyUI." });
// A failed check says nothing about the files.
assert.deepEqual(comfyModelOptions("", [], false, lacking).at(-1), { value: "preset:z_turbo", label: "Z-Image Turbo" });
assert.equal(comfyModelStatus(null, true), "Checking installed models…");
assert.equal(comfyModelStatus({ checkpoints: [], zImage: null, error: "Could not reach ComfyUI." }, true), "Could not reach ComfyUI.");
assert.equal(comfyModelStatus({ checkpoints: ["a.safetensors"], zImage: found, error: null }, false), "Installed checkpoints from ComfyUI.");
assert.match(comfyModelStatus({ checkpoints: [], zImage: found, error: null }, true), /with z_image_turbo_bf16\.safetensors, qwen_3_4b\.safetensors and ae\.safetensors\. It runs without a negative prompt/);
assert.equal(comfyModelStatus({ checkpoints: [], zImage: lacking, error: null }, true), "This ComfyUI is missing the Qwen 3 4B text encoder (models/text_encoders).");
passed += 1;
console.log("ok - the picker names the Z-Image files it found, and what a ComfyUI still lacks");

const requests = [];
const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
  requests.push({ url, init });
  const requestedUrl = JSON.parse(init.body).url;
  return Response.json(requestedUrl.endsWith(":8188")
    ? { ok: true, checkpoints: ["installed.safetensors", 7], zImage: { unet: "z.safetensors", clip: 4, vae: "ae.safetensors" } }
    : { ok: false, error: "Could not reach ComfyUI.", checkpoints: [] });
});
try {
  const signal = new AbortController().signal;
  assert.deepEqual(await fetchComfyModels("http://localhost:8188", signal), {
    checkpoints: ["installed.safetensors"], zImage: { unet: "z.safetensors", clip: "", vae: "ae.safetensors" }, error: null,
  });
  assert.deepEqual(await fetchComfyModels("http://localhost:8288", signal), {
    checkpoints: [], zImage: null, error: "Could not reach ComfyUI.",
  });
  assert.deepEqual(requests.map(({ url, init }) => [url, init.method, JSON.parse(init.body).url, init.signal]), [
    ["/api/comfy", "POST", "http://localhost:8188", signal],
    ["/api/comfy", "POST", "http://localhost:8288", signal],
  ]);
} finally {
  fetchSpy.mockRestore();
}
passed += 1;
console.log("ok - model discovery uses the existing endpoint for success and changed-URL errors");

response = await patch({ comfyWorkflowPreset: "checkpoint" });
assert.equal(response.status, 200);
assert.equal(getGlobalConfig().images.comfyCheckpoint, "saved-checkpoint.safetensors");
response = await patch({ comfyWorkflowPreset: "unsupported" });
assert.equal(response.status, 400);
assert.equal(getGlobalConfig().images.comfyWorkflowPreset, "checkpoint");
passed += 1;
console.log("ok - partial updates keep checkpoint and reject invalid presets");

// The desktop app's local AI installer writes only the checkpoint it put in
// place; that is a choice of checkpoint, not one ignored behind Z-Image.
await patch({ comfyWorkflowPreset: "z_turbo" });
response = await patch({ defaultBackend: "comfyui", comfyUrl: "http://127.0.0.1:8188", comfyCheckpoint: "installed.safetensors" });
assert.equal(response.status, 200);
assert.equal(getGlobalConfig().images.comfyWorkflowPreset, "checkpoint");
assert.equal(getGlobalConfig().images.comfyCheckpoint, "installed.safetensors");
// The admin panel sends both, and its Z choice stands.
response = await patch({ comfyCheckpoint: "installed.safetensors", comfyWorkflowPreset: "z_turbo" });
assert.equal(getGlobalConfig().images.comfyWorkflowPreset, "z_turbo");
// A save about something else leaves the choice alone.
response = await patch({ comfyUrl: "http://127.0.0.1:8189" });
assert.equal(getGlobalConfig().images.comfyWorkflowPreset, "z_turbo");
passed += 1;
console.log("ok - a save naming only a checkpoint switches Z-Image Turbo off");

removeTempDir(dir);
console.log(`test-comfy-preset: ${passed} passed`);
});
