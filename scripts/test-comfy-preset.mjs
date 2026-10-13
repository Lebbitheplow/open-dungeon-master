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
console.log("ok - admin PATCH persists and GET reloads a catalog model preset");

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

// What /api/comfy reports for a ComfyUI (src/lib/comfyui.ts).
const report = (id, files, { missing = [], verified = null } = {}) => ({ id, files, missing, downloadGb: 0, verified, needGb: null, fits: null });
const zFiles = { unet: "zimage/z_image_turbo_bf16.safetensors", clip: "qwen_3_4b.safetensors", vae: "ae.safetensors" };
const measured = { verdict: "recommended", seconds: { square: 19, landscape: 14.7 }, coldSeconds: 24, peakGb: 23.6, steps: 8, device: "AMD Radeon 8060S Graphics" };
const discovery = (models, checkpoints = ["installed.safetensors"]) => ({
  checkpoints, models, hardware: { id: "strix-halo", label: "AMD Strix Halo" }, device: null, error: null,
});
const DEFAULT = { value: "checkpoint:", label: "Default checkpoint", hint: "CyberRealisticXLPlay_V6.0.safetensors" };

const found = discovery([
  report("z_turbo", zFiles, { verified: measured }),
  report("flux2_klein_4b", { unet: "", clip: "qwen_3_4b.safetensors", vae: "" }, { missing: [{ what: "the FLUX.2 klein 4B model" }] }),
]);
const options = comfyModelOptions({ checkpoint: "saved-checkpoint.safetensors", preset: "checkpoint" }, found);

// A model this hardware failed to run, or that peaked past this GPU, is
// kept off the picker; the saved one stays whatever its verdict.
const unfit = discovery([
  report("z_turbo", zFiles, { verified: measured }),
  { ...report("flux2_dev", zFiles, { verified: { ...measured, verdict: "fails" } }) },
  { ...report("krea2_turbo", zFiles), needGb: 90, fits: false },
]);
assert.deepEqual(
  comfyModelOptions({ checkpoint: "", preset: "checkpoint" }, unfit).filter((option) => option.group === "Models").map((option) => option.value),
  ["preset:z_turbo"],
);
assert.ok(
  comfyModelOptions({ checkpoint: "", preset: "flux2_dev" }, unfit).some((option) => option.value === "preset:flux2_dev"),
  "the saved model is offered even when its verdict is fails",
);
passed += 1;
console.log("ok - the picker leaves off what cannot paint here, keeping the saved model");
assert.deepEqual(options, [
  DEFAULT,
  { value: "preset:z_turbo", label: "Z-Image Turbo", group: "Models", hint: "Recommended. 19 s a picture, peaks 23.6 GB on AMD Strix Halo." },
  { value: "checkpoint:saved-checkpoint.safetensors", label: "saved-checkpoint.safetensors", group: "Checkpoints", hint: "Saved selection; not reported by this ComfyUI." },
  { value: "checkpoint:installed.safetensors", label: "installed.safetensors", group: "Checkpoints" },
]);
// Before any check: the saved model is still offered, with nothing claimed about it.
assert.deepEqual(comfyModelOptions({ checkpoint: "", preset: "z_turbo" }, null), [
  DEFAULT,
  { value: "preset:z_turbo", label: "Z-Image Turbo", group: "Models" },
]);
// A saved model whose files are gone stays listed, and says so.
assert.deepEqual(comfyModelOptions({ checkpoint: "", preset: "flux2_klein_4b" }, found).find((option) => option.value === "preset:flux2_klein_4b"), {
  value: "preset:flux2_klein_4b", label: "FLUX.2 [klein] 4B", group: "Models", hint: "Its files are not all on this ComfyUI.",
});
// A checkpoint the catalog knows is named with its settings.
assert.equal(
  comfyModelOptions({ checkpoint: "", preset: "checkpoint" }, discovery([], ["sd3.5_large_fp8_scaled.safetensors"])).at(-1).hint,
  "Stable Diffusion 3.5 Large settings.",
);
assert.deepEqual(comfyModelPatch("checkpoint:installed.safetensors", options), {
  comfyWorkflowPreset: "checkpoint", comfyCheckpoint: "installed.safetensors",
});
assert.deepEqual(comfyModelPatch("preset:z_turbo", options), { comfyWorkflowPreset: "z_turbo" });
assert.deepEqual(comfyModelPatch("checkpoint:saved-checkpoint.safetensors", options), {
  comfyWorkflowPreset: "checkpoint", comfyCheckpoint: "saved-checkpoint.safetensors",
});
assert.deepEqual(comfyModelPatch("checkpoint:", options), { comfyWorkflowPreset: "checkpoint", comfyCheckpoint: "" });
assert.equal(comfyModelPatch("checkpoint:invented.safetensors", options), null);
assert.equal(comfyModelPatch("preset:flux2_klein_4b", options), null);
const collision = comfyModelOptions({ checkpoint: "", preset: "checkpoint" }, discovery([], ["preset:z_turbo"]));
assert.deepEqual(comfyModelPatch("checkpoint:preset:z_turbo", collision), {
  comfyWorkflowPreset: "checkpoint", comfyCheckpoint: "preset:z_turbo",
});
const restored = { ...loaded.config, images: { ...loaded.config.images, ...comfyModelPatch("checkpoint:saved-checkpoint.safetensors", options) } };
assert.match(render(restored), /saved-checkpoint\.safetensors/);
assert.doesNotMatch(render(restored), /ComfyUI workflow preset|Checkpoint \(model file\)/);
passed += 1;
console.log("ok - installed models, saved, default and checkpoint choices map to one persisted selection");

assert.equal(comfyModelStatus(null, "z_turbo"), "Checking installed models…");
assert.equal(comfyModelStatus({ ...found, error: "Could not reach ComfyUI." }, "z_turbo"), "Could not reach ComfyUI.");
assert.equal(comfyModelStatus(found, "checkpoint"), "Installed checkpoints from ComfyUI.");
assert.match(
  comfyModelStatus(found, "z_turbo"),
  /with z_image_turbo_bf16\.safetensors, qwen_3_4b\.safetensors and ae\.safetensors\. It runs without a negative prompt/,
);
assert.equal(comfyModelStatus(found, "flux2_klein_4b"), "This ComfyUI is missing the FLUX.2 klein 4B model.");
// A model that honours a negative prompt says nothing about the boundary.
assert.doesNotMatch(
  comfyModelStatus(discovery([report("chroma1_hd", { unet: "Chroma1-HD-fp8mixed.safetensors", t5: "t5xxl_fp16.safetensors", vae: "ae.safetensors" })]), "chroma1_hd"),
  /negative prompt/,
);
passed += 1;
console.log("ok - the picker names the files it found for a model, and what a ComfyUI still lacks");

const requests = [];
const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
  requests.push({ url, init });
  const requestedUrl = JSON.parse(init.body).url;
  return Response.json(requestedUrl.endsWith(":8188")
    ? { ok: true, checkpoints: ["installed.safetensors", 7], models: [report("z_turbo", zFiles), null], hardware: null, device: null }
    : { ok: false, error: "Could not reach ComfyUI.", checkpoints: [] });
});
try {
  const signal = new AbortController().signal;
  assert.deepEqual(await fetchComfyModels("http://localhost:8188", signal), {
    checkpoints: ["installed.safetensors"], models: [report("z_turbo", zFiles)], hardware: null, device: null, error: null,
  });
  assert.deepEqual(await fetchComfyModels("http://localhost:8288", signal), {
    checkpoints: [], models: [], hardware: null, device: null, error: "Could not reach ComfyUI.",
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
console.log("ok - a save naming only a checkpoint switches a catalog model off");

// Every catalog model is a valid choice; a model dropped from a later
// catalog reads back as checkpoints rather than breaking the settings.
response = await patch({ comfyWorkflowPreset: "qwen_image_21_turbo" });
assert.equal(response.status, 200);
assert.equal(getGlobalConfig().images.comfyWorkflowPreset, "qwen_image_21_turbo");
const { globalConfigSchema } = await import("../src/lib/schemas/global-config.ts");
assert.equal(globalConfigSchema.parse({ images: { comfyWorkflowPreset: "retired_model" } }).images.comfyWorkflowPreset, "checkpoint");
passed += 1;
console.log("ok - any catalog model can be saved, and a retired one falls back to checkpoints");

removeTempDir(dir);
console.log(`test-comfy-preset: ${passed} passed`);
});
