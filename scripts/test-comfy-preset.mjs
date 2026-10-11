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
const { AdminImagesSection, comfyModelOptions, comfyModelPatch, fetchComfyModels } = await import("../src/app/admin/AdminImagesSection.tsx");

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
assert.deepEqual(options, [
  { value: "checkpoint:", label: "Default checkpoint" },
  { value: "checkpoint:saved-checkpoint.safetensors", label: "saved-checkpoint.safetensors", hint: "Saved selection; not reported by this ComfyUI." },
  { value: "checkpoint:installed.safetensors", label: "installed.safetensors" },
  { value: "preset:z_turbo", label: "Z-Image Turbo" },
]);
assert.deepEqual(comfyModelOptions("", [], true), [
  { value: "checkpoint:", label: "Default checkpoint" },
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

const requests = [];
const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
  requests.push({ url, init });
  const requestedUrl = JSON.parse(init.body).url;
  return Response.json(requestedUrl.endsWith(":8188")
    ? { ok: true, checkpoints: ["installed.safetensors", 7] }
    : { ok: false, error: "Could not reach ComfyUI.", checkpoints: [] });
});
try {
  const signal = new AbortController().signal;
  assert.deepEqual(await fetchComfyModels("http://localhost:8188", signal), {
    checkpoints: ["installed.safetensors"], error: null,
  });
  assert.deepEqual(await fetchComfyModels("http://localhost:8288", signal), {
    checkpoints: [], error: "Could not reach ComfyUI.",
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

removeTempDir(dir);
console.log(`test-comfy-preset: ${passed} passed`);
});
