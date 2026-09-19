// Renders the VFX flipbooks in scripts/vfx-set.mjs through the local ComfyUI
// with LTX Video and writes the sprite sheets the board plays.
//
// Each clip is rendered on black at 512 px, its frames kept under
// data/vfx-src (which git ignores), then cut to the sheet: every frame scaled
// to 128 px, laid 8 across, black kept black (the board draws the sheet with
// additive blending, so black is transparent and no matte is needed). The
// shipped sheet goes to public/fx/<id>.webp with a manifest beside it.
//
//   node scripts/generate-vfx.mjs --dry-run
//   node scripts/generate-vfx.mjs --only burst-fire,loop-torch
//   node scripts/generate-vfx.mjs --model 13b          (the distilled 13B, slower, cleaner)
//   node scripts/generate-vfx.mjs --resheet            (rebuild sheets from kept frames)
//   node scripts/generate-vfx.mjs

import { execFileSync } from "node:child_process";
import { mkdirSync, existsSync, writeFileSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { VFX_LIST, SHEET } from "./vfx-set.mjs";
import { seedFor, comfyReachable, requireNodes, DEFAULT_COMFY_URL } from "./lib/comfy-render.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const SRC_DIR = path.join(ROOT, "data", "vfx-src");
const OUT_DIR = path.join(ROOT, "public", "fx");
const REVIEW = path.join(ROOT, "scripts", "vfx-review.json");

const MODELS = {
  "2b": { ckpt: "ltx-video-2b-v0.9.5.safetensors", steps: 25, cfg: 3 },
  "13b": { ckpt: "ltxv-13b-0.9.8-distilled-fp8.safetensors", steps: 8, cfg: 1 },
};

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const force = args.includes("--force");
const resheet = args.includes("--resheet");
const flag = (name, fallback) => {
  const arg = args.find((a) => a.startsWith(`--${name}`));
  if (!arg) return fallback;
  return arg.includes("=") ? arg.split("=")[1] : args[args.indexOf(arg) + 1];
};
const seedSalt = flag("seed-salt", "");
const only = flag("only", null);
const modelKey = flag("model", "2b");
const model = MODELS[modelKey];
if (!model) {
  console.error(`--model must be one of ${Object.keys(MODELS).join(", ")}`);
  process.exit(1);
}
const review = existsSync(REVIEW) ? JSON.parse(readFileSync(REVIEW, "utf8")) : { rejected: {} };

const terms = only ? only.split(",").map((t) => t.trim()).filter(Boolean) : [];
const selected = terms.length ? VFX_LIST.filter((v) => terms.some((t) => v.id.includes(t) || v.family === t || v.tone === t)) : VFX_LIST;
if (!selected.length) {
  console.error(`--only ${only} matched nothing`);
  process.exit(1);
}
const seedOf = (v) => seedFor(v.id + seedSalt + (review.rejected[v.id] ?? ""));

if (dryRun) {
  for (const v of selected) console.log(`\n# ${v.family}/${v.id}  ${v.frames} frames  seed ${seedOf(v)}\n  + ${v.prompt}`);
  console.log(`\n${selected.length} clip(s). Nothing rendered.`);
  process.exit(0);
}

function workflow(v, seed) {
  return {
    "1": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: model.ckpt } },
    "2": { class_type: "CLIPLoader", inputs: { clip_name: "t5xxl_fp16.safetensors", type: "ltxv", device: "default" } },
    "3": { class_type: "CLIPTextEncode", inputs: { text: v.prompt, clip: ["2", 0] } },
    "4": { class_type: "CLIPTextEncode", inputs: { text: v.negative, clip: ["2", 0] } },
    "5": { class_type: "EmptyLTXVLatentVideo", inputs: { width: v.width, height: v.height, length: v.frames, batch_size: 1 } },
    "6": { class_type: "LTXVConditioning", inputs: { positive: ["3", 0], negative: ["4", 0], frame_rate: 24 } },
    "7": { class_type: "ModelSamplingLTXV", inputs: { model: ["1", 0], max_shift: 2.05, base_shift: 0.95, latent: ["5", 0] } },
    "8": { class_type: "LTXVScheduler", inputs: { steps: model.steps, max_shift: 2.05, base_shift: 0.95, stretch: true, terminal: 0.1, latent: ["5", 0] } },
    "9": { class_type: "KSamplerSelect", inputs: { sampler_name: "euler" } },
    "10": { class_type: "SamplerCustom", inputs: { model: ["7", 0], add_noise: true, noise_seed: seed, cfg: model.cfg, positive: ["6", 0], negative: ["6", 1], sampler: ["9", 0], sigmas: ["8", 0], latent_image: ["5", 0] } },
    "11": { class_type: "VAEDecode", inputs: { samples: ["10", 0], vae: ["1", 2] } },
    "12": { class_type: "SaveImage", inputs: { images: ["11", 0], filename_prefix: `odm-vfx-${v.id}` } },
  };
}

async function renderFrames(v, seed) {
  const r = await fetch(`${DEFAULT_COMFY_URL}/prompt`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: workflow(v, seed) }) });
  if (!r.ok) throw new Error(`ComfyUI rejected the job (${r.status}): ${(await r.text()).slice(0, 500)}`);
  const { prompt_id } = await r.json();
  const deadline = Date.now() + 30 * 60 * 1000;
  for (;;) {
    if (Date.now() > deadline) throw new Error(`clip ${v.id} did not finish in 30 min`);
    await new Promise((s) => setTimeout(s, 2000));
    const e = (await (await fetch(`${DEFAULT_COMFY_URL}/history/${prompt_id}`, { cache: "no-store" })).json())[prompt_id];
    if (!e) continue;
    if (e.status?.status_str === "error") throw new Error(`ComfyUI failed: ${JSON.stringify(e.status.messages).slice(0, 500)}`);
    if (!e.status?.completed) continue;
    const frames = [];
    for (const o of Object.values(e.outputs ?? {})) {
      for (const im of o.images ?? []) {
        const q = new URLSearchParams({ filename: im.filename, subfolder: im.subfolder ?? "", type: im.type ?? "output" });
        frames.push(Buffer.from(await (await fetch(`${DEFAULT_COMFY_URL}/view?${q}`)).arrayBuffer()));
      }
    }
    if (!frames.length) throw new Error(`clip ${v.id} produced no frames`);
    return frames;
  }
}

// The sheet: every frame to 128 px, 8 across. A burst is trimmed of the
// trailing frames that are already black (the board holds the last frame
// anyway), and `frames` in the manifest is what is left.
function buildSheet(v, frameDir, target) {
  const files = readdirSync(frameDir).filter((f) => f.endsWith(".png")).sort().map((f) => path.join(frameDir, f));
  let kept = files;
  if (!v.loop) {
    // Drop black tail frames: mean brightness under 1.5 per cent.
    let end = files.length;
    while (end > 8) {
      const mean = Number(execFileSync("magick", [files[end - 1], "-colorspace", "Gray", "-format", "%[fx:mean]", "info:"]).toString());
      if (mean > 0.015) break;
      end -= 1;
    }
    kept = files.slice(0, end);
  }
  const rows = Math.ceil(kept.length / SHEET.columns);
  execFileSync("magick", [
    "montage", ...kept, "-tile", `${SHEET.columns}x${rows}`, "-geometry", `${SHEET.frame}x${SHEET.frame}+0+0`, "-background", "black",
    "-strip", "-quality", "80", "-define", "webp:method=6", target,
  ]);
  return { frames: kept.length, rows };
}

if (!resheet) {
  if (!(await comfyReachable())) {
    console.error(`No ComfyUI at ${DEFAULT_COMFY_URL}. Start it, or pass --resheet to rebuild sheets from kept frames.`);
    process.exit(1);
  }
  await requireNodes(["EmptyLTXVLatentVideo", "LTXVConditioning", "ModelSamplingLTXV", "LTXVScheduler", "SamplerCustom"]);
}

mkdirSync(OUT_DIR, { recursive: true });
const manifestPath = path.join(OUT_DIR, "manifest.json");
const existing = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : { sheets: [] };
const known = new Map(existing.sheets.map((s) => [s.id, s]));
let rendered = 0;
const failures = [];
const startedAt = Date.now();

for (const [index, v] of selected.entries()) {
  const frameDir = path.join(SRC_DIR, v.id);
  const target = path.join(OUT_DIR, `${v.id}.webp`);
  const label = `[${index + 1}/${selected.length}] ${v.family}/${v.id}`;
  try {
    const have = existsSync(frameDir) && readdirSync(frameDir).some((f) => f.endsWith(".png"));
    if (have && (resheet || !force)) {
      // kept frames
    } else if (resheet) {
      console.log(`${label} no frames to re-sheet, skipped`);
      continue;
    } else {
      const frames = await renderFrames(v, seedOf(v));
      mkdirSync(frameDir, { recursive: true });
      for (const f of readdirSync(frameDir)) if (f.endsWith(".png")) execFileSync("rm", ["-f", path.join(frameDir, f)]);
      frames.forEach((png, i) => writeFileSync(path.join(frameDir, `${String(i).padStart(3, "0")}.png`), png));
      rendered += 1;
      const each = (Date.now() - startedAt) / 1000 / rendered;
      console.log(`${label} rendered ${frames.length} frames (${each.toFixed(0)}s each, ~${(((selected.length - index - 1) * each) / 60).toFixed(0)} min left)`);
    }
    const sheet = buildSheet(v, frameDir, target);
    known.set(v.id, {
      id: v.id, family: v.family, tone: v.tone, loop: v.loop, src: `/fx/${v.id}.webp`,
      frame: SHEET.frame, columns: SHEET.columns, frames: sheet.frames, fps: 24, bytes: statSync(target).size, seed: seedOf(v), model: modelKey,
    });
  } catch (error) {
    failures.push(`${v.id}: ${error.message}`);
    console.error(`${label} FAILED ${error.message}`);
  }
}

const sheets = [...known.values()].filter((s) => existsSync(path.join(OUT_DIR, `${s.id}.webp`))).sort((a, b) => a.id.localeCompare(b.id));
writeFileSync(manifestPath, `${JSON.stringify({ sheets }, null, 2)}\n`);
const bytes = sheets.reduce((s, e) => s + e.bytes, 0);
console.log(`\n${sheets.length} sheet(s) in public/fx (${rendered} rendered, ${(bytes / 1024 / 1024).toFixed(2)} MB).`);
if (failures.length) {
  console.error(`\n${failures.length} failed:\n${failures.map((f) => `  ${f}`).join("\n")}`);
  process.exit(1);
}
