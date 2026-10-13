// The ComfyUI image model catalog (src/lib/image-models): every entry is
// complete and builds a graph ComfyUI 0.39.2 accepts, files are found under
// whatever names and folders a ComfyUI lists without one model claiming
// another's weights, the hardware a ComfyUI runs on is recognised, and the
// verified.json rows (one per model and hardware) are well formed.
import assert from "node:assert/strict";
import fs from "node:fs";

const { ANY_CHECKPOINT, COMFY_MODELS, comfyModel, isComfyPreset } = await import("../src/lib/image-models/catalog.ts");
const curate = await import("../src/lib/image-models/curate.ts");
const { buildModelWorkflow, honoursNegative, modelDimensions } = await import("../src/lib/image-models/workflow.ts");
const { FOLDER_LOADER } = await import("../src/lib/image-models/types.ts");
const { listWords, measuredLine, seconds } = await import("../src/lib/image-models/describe.ts");
const rows = JSON.parse(fs.readFileSync(new URL("../src/lib/image-models/verified.json", import.meta.url), "utf8"));
const { nodes: NODE_INPUTS } = JSON.parse(fs.readFileSync(new URL("./fixtures/comfy-node-inputs.json", import.meta.url), "utf8"));

let passed = 0;
async function test(name, fn) {
  await fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

const dummyFiles = (model) => Object.fromEntries(Object.keys(model.files).map((slot) => [slot, `${slot}-file.safetensors`]));

await test("every catalog entry is complete, with one id each", () => {
  const ids = COMFY_MODELS.map((model) => model.id);
  assert.deepEqual(ids.filter((id, index) => ids.indexOf(id) !== index), []);
  assert.ok(!ids.includes("checkpoint"), "checkpoint is the generic preset, not a model");
  for (const model of COMFY_MODELS) {
    for (const key of ["label", "family", "maker", "license", "blurb"]) assert.ok(model[key], `${model.id} has no ${key}`);
    assert.match(model.released, /^\d{4}-\d{2}$/, `${model.id} released`);
    for (const [slot, file] of Object.entries(model.files)) {
      assert.ok(FOLDER_LOADER[file.folder], `${model.id}.${slot} folder`);
      assert.ok(file.names.length > 0 && file.names.every((name) => /\.(safetensors|sft)$/.test(name)), `${model.id}.${slot} names`);
      assert.match(file.url, /^https:\/\//, `${model.id}.${slot} url`);
      assert.ok(file.sizeGb > 0, `${model.id}.${slot} size`);
      assert.match(file.what, /\(models\/[a-z_]+\)$/, `${model.id}.${slot} says where it goes`);
    }
    assert.ok(isComfyPreset(model.id));
  }
  assert.ok(isComfyPreset("checkpoint"));
  assert.ok(!isComfyPreset("z-turbo"));
  assert.equal(comfyModel("qwen_image_21")?.label, "Qwen Image 2.1");
});

await test("every graph wires its own slots and only inputs ComfyUI 0.39.2 declares", () => {
  for (const model of [...COMFY_MODELS, ANY_CHECKPOINT]) {
    const files = dummyFiles(model);
    const graph = buildModelWorkflow(model, { prompt: "a tavern", negative: "no swords", width: 1024, height: 768, seed: 7, files });
    const nodes = Object.entries(graph);
    assert.equal(nodes.filter(([, node]) => node.class_type === "SaveImage").length, 1, `${model.id} saves one picture`);
    const used = new Set();
    for (const [id, node] of nodes) {
      const declared = NODE_INPUTS[node.class_type];
      assert.ok(declared, `${model.id} #${id}: ComfyUI has no ${node.class_type}`);
      for (const input of declared.required) assert.ok(input in node.inputs, `${model.id} ${node.class_type} lacks ${input}`);
      for (const [input, value] of Object.entries(node.inputs)) {
        assert.ok(declared.required.includes(input) || declared.optional.includes(input), `${model.id} ${node.class_type}.${input} is not an input`);
        if (Array.isArray(value)) assert.ok(graph[value[0]], `${model.id} ${node.class_type}.${input} points at nothing`);
        if (typeof value === "string" && value.endsWith("-file.safetensors")) used.add(value);
        assert.ok(value !== undefined && value !== "" || input === "negative_prompt", `${model.id} ${node.class_type}.${input} is empty`);
      }
    }
    // Every file slot the entry lists feeds the graph.
    assert.deepEqual([...used].sort(), Object.values(files).sort(), `${model.id} uses every file it lists`);
    assert.ok(JSON.stringify(graph).includes("a tavern"), `${model.id} paints the prompt`);
    assert.equal(JSON.stringify(graph).includes("no swords"), honoursNegative(model) || model.graph.negative === "text", `${model.id} negative`);
  }
});

await test("each model's own downloads are found, and no model claims another's weights", () => {
  for (const model of COMFY_MODELS) {
    for (const [slot, file] of Object.entries(model.files)) {
      for (const name of file.names) assert.equal(curate.pickFile(file, ["other.safetensors", `sub/${name}`]), `sub/${name}`, `${model.id}.${slot} ${name}`);
    }
  }
  const mainSlot = (model) => ("checkpoint" in model.graph.load ? model.graph.load.checkpoint : model.graph.load.unet);
  for (const a of COMFY_MODELS) {
    const mine = a.files[mainSlot(a)];
    for (const b of COMFY_MODELS) {
      const theirs = b.files[mainSlot(b)];
      if (a === b || theirs.folder !== mine.folder) continue;
      for (const name of theirs.names) {
        if (mine.names.includes(name)) continue;
        assert.equal(curate.pickFile(mine, [name]), "", `${a.id} would paint with ${b.id}'s ${name}`);
      }
    }
  }
  // Official names in catalog order win over other precisions; then the
  // family, first in ComfyUI's list, subfolders and Windows separators too.
  const z = comfyModel("z_turbo");
  assert.deepEqual(
    curate.pickModelFiles(z, {
      diffusion_models: ["flux1-schnell.safetensors", "z_image_turbo_nvfp4.safetensors", "z_image_turbo_bf16.safetensors"],
      text_encoders: ["clip_l.safetensors", "qwen_3_4b_fp8_mixed.safetensors", "qwen_3_4b.safetensors"],
      vae: ["qwen_image_vae.safetensors", "ae.safetensors"],
    }),
    { unet: "z_image_turbo_bf16.safetensors", clip: "qwen_3_4b.safetensors", vae: "ae.safetensors" },
  );
  assert.deepEqual(
    curate.pickModelFiles(z, {
      diffusion_models: ["qwen_image_2.1_int8_convrot.safetensors", "zimage\\z_image_turbo_nvfp4.safetensors"],
      text_encoders: ["text/Qwen3-4B-fp8.safetensors"],
      vae: ["Wan2_1_VAE_bf16.safetensors", "flux/ae.safetensors"],
    }),
    { unet: "zimage\\z_image_turbo_nvfp4.safetensors", clip: "text/Qwen3-4B-fp8.safetensors", vae: "flux/ae.safetensors" },
  );
  const partial = curate.pickModelFiles(z, { diffusion_models: ["zImageTurbo_v10.safetensors"], text_encoders: ["qwen3vl_8b_int8_convrot.safetensors"] });
  assert.deepEqual(partial, { unet: "zImageTurbo_v10.safetensors", clip: "", vae: "" });
  assert.deepEqual(curate.modelMissing(z, partial), [
    "the Qwen 3 4B text encoder (models/text_encoders)",
    "the FLUX VAE, ae.safetensors (models/vae)",
  ]);
});

await test("checkpoints are recognised for their settings, and video models are not offered as pictures", () => {
  assert.equal(curate.checkpointModel("CyberRealisticXLPlay_V6.0.safetensors")?.id, "sdxl");
  assert.equal(curate.checkpointModel("juggernautXL_v9.safetensors")?.id, "sdxl");
  assert.equal(curate.checkpointModel("ponyDiffusionV6XL_v6StartWithThisOne.safetensors")?.id, "pony_xl");
  assert.equal(curate.checkpointModel("sd3.5_large_fp8_scaled.safetensors")?.id, "sd35_large");
  assert.equal(curate.checkpointModel("sd_xl_refiner_1.0.safetensors"), null);
  assert.equal(curate.checkpointModel("Hassanblend-v4.safetensors"), null);
  assert.equal(curate.checkpointModel(""), null);
  for (const video of ["ltx-video-2b-v0.9.safetensors", "ltxv-13b-0.9.8-distilled-fp8.safetensors", "ltxv-spatial-upscaler-0.9.8.safetensors", "svd_xt.safetensors"]) {
    assert.equal(curate.isPictureCheckpoint(video), false, video);
  }
  for (const picture of ["CyberRealisticXLPlay_V6.0.safetensors", "sd3.5_large_fp8_scaled.safetensors", "Hassanblend-v4.safetensors"]) {
    assert.equal(curate.isPictureCheckpoint(picture), true, picture);
  }
});

await test("sizes follow ODM's modes and each model's own long side and multiple", () => {
  assert.deepEqual(modelDimensions(null, "fast", "square"), { width: 1024, height: 1024 });
  assert.deepEqual(modelDimensions(null, "fast", "landscape"), { width: 1024, height: 768 });
  assert.deepEqual(modelDimensions(null, "slow", "portrait"), { width: 1008, height: 1344 });
  const sixteen = { graph: { multiple: 16 } };
  assert.deepEqual(modelDimensions(sixteen, "slow", "landscape"), { width: 1344, height: 1008 });
  const big = { graph: { longSide: { fast: 2048, slow: 2048 }, multiple: 32 } };
  assert.deepEqual(modelDimensions(big, "fast", "landscape"), { width: 2048, height: 1536 });
});

await test("a model honours a table's negatives only through a weighed negative prompt", () => {
  assert.equal(honoursNegative(comfyModel("z_turbo")), false);
  assert.equal(honoursNegative(comfyModel("z_image")), true);
  assert.equal(honoursNegative(comfyModel("chroma1_hd")), true);
  assert.equal(honoursNegative(comfyModel("hidream_i1_fast")), false, "cfg 1 ignores the negative it encodes");
  assert.equal(honoursNegative(comfyModel("omnigen2")), true);
  assert.equal(honoursNegative(ANY_CHECKPOINT), true);
});

const STRIX_STATS = {
  system: { comfyui_version: "0.39.2", pytorch_version: "2.14.0+rocm7.2", ram_total: 134296588288 },
  devices: [{ name: "cuda:0 AMD Radeon 8060S Graphics : native", type: "cuda", vram_total: 128849018880 }],
};

await test("the machine a ComfyUI runs on is read from /system_stats", () => {
  const device = curate.readComfyDevice(STRIX_STATS);
  assert.deepEqual(device, { name: "AMD Radeon 8060S Graphics", memoryGb: 120, ramGb: 125.1, torch: "2.14.0+rocm7.2", comfyui: "0.39.2" });
  assert.equal(curate.hardwareProfile(device)?.id, "strix-halo");
  assert.equal(curate.hardwareProfile({ name: "AMD Radeon(TM) 8050S" })?.id, "strix-halo");
  assert.equal(curate.hardwareProfile({ name: "NVIDIA GeForce RTX 4090" }), null);
  assert.equal(curate.readComfyDevice({ system: {} }), null);
  assert.equal(curate.readComfyDevice(null), null);
});

await test("curation puts installed models first, then what this hardware recommended, then speed", () => {
  const row = (model, verdict, square, peakGb = 20, hardware = "strix-halo") => ({
    model, hardware, device: "AMD Radeon 8060S Graphics", memoryGb: 120, comfyui: "0.39.2", torch: "", date: "2026-10-12",
    files: {}, steps: 8, seconds: { square, landscape: square }, coldSeconds: square, peakGb, verdict,
  });
  const fixture = [row("z_turbo", "works", 19), row("flux2_klein_4b", "recommended", 9), row("flux2_dev", "fails", 0), row("krea2_turbo", "recommended", 30, 90), row("omnigen2", "poor", 200)];
  const lists = { diffusion_models: ["z_image_turbo_bf16.safetensors"], text_encoders: ["qwen_3_4b.safetensors"], vae: ["ae.safetensors"] };
  const strix = curate.curateModels({ lists, device: curate.readComfyDevice(STRIX_STATS), rows: fixture });
  assert.equal(strix[0].model.id, "z_turbo");
  assert.deepEqual(strix[0].missing, []);
  assert.deepEqual(strix.slice(1, 3).map((entry) => entry.model.id), ["flux2_klein_4b", "krea2_turbo"]);
  assert.equal(strix.at(-1).model.id, "flux2_dev", "what failed here goes last");
  assert.equal(strix.at(-2).model.id, "omnigen2", "then what ran poorly");
  // flux2_klein_4b needs its model and VAE, not the encoder Z-Image shares.
  assert.equal(strix[1].downloadGb, 8.1);
  // Elsewhere: no rows of its own, so measured peaks only warn.
  const card = curate.curateModels({ lists: {}, device: { name: "NVIDIA GeForce RTX 4060", memoryGb: 8, ramGb: 32, torch: "", comfyui: "" }, rows: fixture });
  assert.equal(card.find((entry) => entry.model.id === "krea2_turbo").fits, false);
  assert.equal(card.find((entry) => entry.model.id === "krea2_turbo").verified, null);
  assert.deepEqual(curate.supportedHardware("z_turbo", fixture), ["strix-halo"]);
  assert.deepEqual(curate.supportedHardware("flux2_dev", fixture), []);
});

await test("measurements are put into words", () => {
  assert.equal(seconds(18.6), "19 s");
  assert.equal(seconds(125), "2 min 5 s");
  assert.equal(seconds(120), "2 min");
  assert.equal(listWords(["a", "b", "c"]), "a, b and c");
  assert.equal(listWords(["a"]), "a");
  const verified = { verdict: "recommended", seconds: { square: 19, landscape: 15 }, peakGb: 23.6, device: "AMD Radeon 8060S Graphics" };
  assert.equal(measuredLine({ verified, needGb: 23.6, fits: true }, "AMD Strix Halo"), "Recommended. 19 s a picture, peaks 23.6 GB on AMD Strix Halo.");
  assert.equal(measuredLine({ verified: { ...verified, verdict: "fails" }, needGb: null, fits: null }, "AMD Strix Halo"), "Did not run on AMD Strix Halo.");
  assert.equal(measuredLine({ verified: { ...verified, verdict: "poor" }, needGb: 20, fits: true }, "AMD Strix Halo"), "Runs on AMD Strix Halo, but its pictures were poor there.");
  assert.equal(measuredLine({ verified: null, needGb: 40, fits: false }, null), "Peaked at 40 GB elsewhere, more than this GPU has.");
  assert.equal(measuredLine({ verified: null, needGb: null, fits: null }, "AMD Strix Halo"), "Not measured on AMD Strix Halo yet.");
});

await test("verified.json rows name a catalog model and a known hardware profile, once each", () => {
  const hardware = new Set(curate.HARDWARE_PROFILES.map((profile) => profile.id));
  const keys = new Set();
  for (const row of rows) {
    const model = comfyModel(row.model);
    assert.ok(model, `verified.json names unknown model ${row.model}`);
    assert.ok(hardware.has(row.hardware), `${row.model}: unknown hardware ${row.hardware}`);
    const key = `${row.model}/${row.hardware}`;
    assert.ok(!keys.has(key), `${key} twice`);
    keys.add(key);
    assert.ok(["recommended", "works", "poor", "fails"].includes(row.verdict), `${key} verdict`);
    assert.deepEqual(Object.keys(row.files).sort(), Object.keys(model.files).sort(), `${key} files`);
    assert.match(row.date, /^\d{4}-\d{2}-\d{2}$/);
    if (row.verdict !== "fails") {
      assert.ok(row.seconds.square > 0 && row.seconds.landscape > 0 && row.peakGb > 0, `${key} has its measurements`);
    } else {
      assert.ok(row.notes, `${key} says why it failed`);
    }
  }
});

console.log(`test-image-models: ${passed} passed`);
