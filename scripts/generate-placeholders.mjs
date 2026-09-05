// Renders the default placeholder art in scripts/placeholder-set.mjs through a
// local ComfyUI, then writes the web-sized WebP the app actually ships.
//
//   node scripts/generate-placeholders.mjs [--dry-run] [--only <group>] [--force]
//
// Two outputs, on purpose:
//   data/placeholder-src/<group>/<id>.png   full-size render, gitignored
//   public/assets/placeholders/<group>/...  downscaled WebP, committed
//
// The PNG originals are kept so the shipped sizes can be re-encoded without
// spending another four hours on the GPU. Only the WebP is committed: 200-odd
// 1024px PNGs would be a third of a gigabyte in a repo that a phone client
// vendors wholesale.
//
// Resumable by design. Every job is skipped when its WebP already exists, so
// an interrupted run continues where it stopped and --only <group> re-renders
// one slice. --force ignores what is on disk.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { placeholderJobs } from "./placeholder-set.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC_DIR = path.join(ROOT, "data", "placeholder-src");
const OUT_DIR = path.join(ROOT, "public", "assets", "placeholders");

const COMFY_URL = (process.env.COMFYUI_URL || "http://127.0.0.1:8188").replace(/\/+$/, "");
// Pinned rather than auto-selected: the whole set has to look like one set, so
// swapping the checkpoint halfway through is exactly the failure to avoid.
// This is the same SDXL checkpoint src/lib/defaults.ts pins for the app.
const CHECKPOINT = process.env.PLACEHOLDER_CHECKPOINT || "CyberRealisticXLPlay_V6.0.safetensors";

const STEPS = 26;
const CFG = 7.0;
const SAMPLER = "dpmpp_2m";
const SCHEDULER = "karras";

// Rendered at SDXL's native buckets. Anything bigger degrades on an SDXL
// checkpoint, so this is a ceiling rather than a preference.
const RENDER = {
  square: { width: 1024, height: 1024 },
  landscape: { width: 1344, height: 768 },
};

// Shipped at the size the UI draws, not the size the model painted. The
// whole set rides inside the desktop app and the Android APK (the client
// repo vendors public/ wholesale), so bytes here are bytes on every phone.
//
// The biggest portrait in the app is sm:size-24 (96 CSS px, 288 device px
// on a 3x phone) and every other one is 44 to 56 px, so 256 covers them; the
// widest landscape slot is a campaign cover filling a column, where a soft
// painterly plate upscaled a little is invisible and a crisp one would be
// too. Quality 70 on a silhouette-and-haze image is transparent at these
// sizes and roughly a third of the bytes of 82; sharp-yuv keeps the rim
// light from bleeding at the edge. scripts/test-placeholders.mjs holds the
// set to a byte budget so nobody re-encodes it back up by accident.
const SHIP = {
  square: { width: 256, height: 256 },
  landscape: { width: 704, height: 400 },
};

function shipSize(job) {
  return SHIP[job.aspect];
}

const QUALITY = 70;

const JOB_TIMEOUT_MS = 15 * 60 * 1000;
const POLL_MS = 700;

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const force = args.includes("--force");
const reencode = args.includes("--reencode");
const onlyIndex = args.indexOf("--only");
const only = onlyIndex >= 0 ? args[onlyIndex + 1] : "";

// A stable seed per file: rerunning one group reproduces the picture that was
// already reviewed instead of rolling a different one.
function seedFor(key) {
  let hash = 2166136261;
  for (let i = 0; i < key.length; i += 1) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % 2147483647;
}

function buildWorkflow({ prompt, negative, width, height, seed }) {
  return {
    "1": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: CHECKPOINT } },
    "2": { class_type: "CLIPTextEncode", inputs: { text: prompt, clip: ["1", 1] } },
    "3": { class_type: "CLIPTextEncode", inputs: { text: negative, clip: ["1", 1] } },
    "4": { class_type: "EmptyLatentImage", inputs: { width, height, batch_size: 1 } },
    "5": {
      class_type: "KSampler",
      inputs: {
        model: ["1", 0],
        positive: ["2", 0],
        negative: ["3", 0],
        latent_image: ["4", 0],
        seed,
        steps: STEPS,
        cfg: CFG,
        sampler_name: SAMPLER,
        scheduler: SCHEDULER,
        denoise: 1,
      },
    },
    "6": { class_type: "VAEDecode", inputs: { samples: ["5", 0], vae: ["1", 2] } },
    "7": { class_type: "SaveImage", inputs: { images: ["6", 0], filename_prefix: "odm-placeholder" } },
  };
}

async function render(options) {
  const submitted = await fetch(`${COMFY_URL}/prompt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: buildWorkflow(options) }),
  });
  if (!submitted.ok) {
    throw new Error(`ComfyUI rejected the job (${submitted.status}): ${await submitted.text()}`);
  }
  const { prompt_id: promptId } = await submitted.json();

  const deadline = Date.now() + JOB_TIMEOUT_MS;
  for (;;) {
    if (Date.now() > deadline) {
      throw new Error(`ComfyUI job ${promptId} did not finish in ${JOB_TIMEOUT_MS / 1000}s`);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    const history = await fetch(`${COMFY_URL}/history/${promptId}`, { cache: "no-store" });
    const entry = (await history.json())[promptId];
    if (!entry) {
      continue;
    }
    if (entry.status?.status_str === "error") {
      throw new Error(`ComfyUI failed: ${JSON.stringify(entry.status.messages).slice(0, 500)}`);
    }
    if (!entry.status?.completed) {
      continue;
    }
    for (const output of Object.values(entry.outputs ?? {})) {
      for (const image of output.images ?? []) {
        const query = new URLSearchParams({
          filename: image.filename,
          subfolder: image.subfolder ?? "",
          type: image.type ?? "output",
        });
        const file = await fetch(`${COMFY_URL}/view?${query}`);
        return Buffer.from(await file.arrayBuffer());
      }
    }
    throw new Error(`ComfyUI job ${promptId} produced no image`);
  }
}

// ImageMagick rather than a new dependency: the repo has no image library, and
// this script is the only thing that would ever pull one in.
function encodeWebp(sourcePath, targetPath, size) {
  execFileSync("magick", [
    sourcePath,
    "-resize", `${size.width}x${size.height}^`,
    "-gravity", "center",
    "-extent", `${size.width}x${size.height}`,
    "-strip",
    "-quality", String(QUALITY),
    "-define", "webp:method=6",
    "-define", "webp:sharp-yuv=1",
    targetPath,
  ]);
}

async function main() {
  const jobs = placeholderJobs().filter((job) => !only || job.group === only);
  if (!jobs.length) {
    console.error(only ? `No placeholders in group "${only}".` : "Nothing to render.");
    process.exit(1);
  }

  if (dryRun) {
    for (const job of jobs) {
      console.log(`${job.group}/${job.id}.webp [${job.aspect}]\n  ${job.prompt}\n`);
    }
    console.log(`${jobs.length} placeholders.`);
    return;
  }

  // Re-encoding never touches the GPU, so it neither needs ComfyUI up nor
  // wants to wait on it.
  if (reencode) {
    reencodeAll(jobs);
    return;
  }

  const status = await fetch(`${COMFY_URL}/system_stats`, { cache: "no-store" }).catch(() => null);
  if (!status?.ok) {
    console.error(`Could not reach ComfyUI at ${COMFY_URL}. Start it and try again.`);
    process.exit(1);
  }

  const pending = jobs.filter(
    (job) => force || !existsSync(path.join(OUT_DIR, job.group, `${job.id}.webp`)),
  );
  console.log(
    `${jobs.length} placeholders, ${pending.length} to render on ${CHECKPOINT} at ${COMFY_URL}.`,
  );

  const startedAt = Date.now();
  const failures = [];
  for (const [index, job] of pending.entries()) {
    const srcPath = path.join(SRC_DIR, job.group, `${job.id}.png`);
    const outPath = path.join(OUT_DIR, job.group, `${job.id}.webp`);
    mkdirSync(path.dirname(srcPath), { recursive: true });
    mkdirSync(path.dirname(outPath), { recursive: true });

    const jobStartedAt = Date.now();
    try {
      // A kept original means only the encode has to run again.
      if (force || !existsSync(srcPath)) {
        const png = await render({
          prompt: job.prompt,
          negative: job.negative,
          seed: seedFor(`${job.group}/${job.id}`),
          ...RENDER[job.aspect],
        });
        writeFileSync(srcPath, png);
      }
      encodeWebp(srcPath, outPath, shipSize(job));
    } catch (error) {
      failures.push({ job, message: error instanceof Error ? error.message : String(error) });
      console.error(`  !! ${job.group}/${job.id}: ${failures.at(-1).message}`);
      continue;
    }

    const elapsed = (Date.now() - startedAt) / 1000;
    const remaining = ((elapsed / (index + 1)) * (pending.length - index - 1)) / 60;
    console.log(
      `[${index + 1}/${pending.length}] ${job.group}/${job.id} ` +
        `${((Date.now() - jobStartedAt) / 1000).toFixed(0)}s, ~${remaining.toFixed(0)} min left`,
    );
  }

  writeManifest();

  console.log(`\nDone in ${((Date.now() - startedAt) / 60000).toFixed(0)} min.`);
  if (failures.length) {
    console.log(`${failures.length} failed; rerun to retry just those.`);
    process.exit(1);
  }
}

// Rebuilds every WebP from the kept PNG originals at the current sizes and
// quality. Seconds of CPU instead of hours on the GPU, which is what the
// gitignored data/placeholder-src tree is for.
function reencodeAll(jobs) {
  let done = 0;
  let missing = 0;
  let bytes = 0;
  for (const job of jobs) {
    const srcPath = path.join(SRC_DIR, job.group, `${job.id}.png`);
    if (!existsSync(srcPath)) {
      missing += 1;
      continue;
    }
    const outPath = path.join(OUT_DIR, job.group, `${job.id}.webp`);
    mkdirSync(path.dirname(outPath), { recursive: true });
    encodeWebp(srcPath, outPath, shipSize(job));
    bytes += statSync(outPath).size;
    done += 1;
  }
  writeManifest();
  console.log(`Re-encoded ${done} at quality ${QUALITY}: ${(bytes / 1024 / 1024).toFixed(1)} MB total.`);
  if (missing) {
    console.log(`${missing} have no original in data/placeholder-src; run without --reencode to render them.`);
  }
}

// The index the app and the client shells read: group -> ids, so a lookup can
// pick a placeholder without a directory listing, and an unknown key can fall
// back to the group's first entry.
function writeManifest() {
  const groups = {};
  for (const job of placeholderJobs()) {
    const file = path.join(OUT_DIR, job.group, `${job.id}.webp`);
    if (!existsSync(file)) {
      continue;
    }
    (groups[job.group] ??= []).push(job.id);
  }
  const manifestPath = path.join(OUT_DIR, "manifest.json");
  const manifest = {
    base: "/assets/placeholders",
    aspect: { square: "1:1", landscape: "16:9" },
    size: SHIP,
    groups,
  };
  const next = `${JSON.stringify(manifest, null, 2)}\n`;
  if (!existsSync(manifestPath) || readFileSync(manifestPath, "utf8") !== next) {
    mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(manifestPath, next);
  }
}

await main();
