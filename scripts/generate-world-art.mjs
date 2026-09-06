// Renders thumbnails for world packs through a local ComfyUI, then writes the
// web-sized WebP a pack embeds.
//
//   node scripts/generate-world-art.mjs [dir] [--only <packId>] [--kinds cover,monster,...]
//                                       [--dry-run] [--force] [--reencode]
//
// `dir` defaults to data/worlds, the installed packs on this server. Two
// outputs, on purpose, mirroring generate-placeholders.mjs:
//   data/world-art-src/<packId>/<key>.png   full-size render, gitignored
//   data/world-art/<packId>/<key>.webp      thumbnail, what the pack embeds
//
// Rendering writes nothing into the packs. When the run is done:
//   node scripts/world-pack-art.mjs embed <dir>
// folds data/world-art/<id>/ into each manifest's `art` map.
//
// Resumable by design: a job is skipped when its WebP exists, so an interrupted
// run continues where it stopped. --force ignores what is on disk; --reencode
// rebuilds every WebP from the kept PNGs without touching the GPU.

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire, register } from "node:module";
import {
  DEFAULT_CHECKPOINT,
  DEFAULT_COMFY_URL,
  comfyReachable,
  encodeWebp,
  renderImage,
  seedFor,
} from "./lib/comfy-render.mjs";
import { worldArtJobs } from "./world-art-set.mjs";

register("./lib/register-alias.mjs", import.meta.url);
const require = createRequire(import.meta.url);
const { worldPackSchema } = await import("../src/lib/worlds/types.ts");
const { packArtKey, packArtSlots, PACK_ART_KINDS } = await import("../src/lib/worlds/art.ts");
const { findRace, findClass } = await import("../src/lib/srd/index.ts");

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC_DIR = path.join(ROOT, "data", "world-art-src");
const OUT_DIR = path.join(ROOT, "data", "world-art");
const CONTENT_DB = path.join(ROOT, "data", "content", "open5e.sqlite");

const CHECKPOINT = process.env.WORLD_ART_CHECKPOINT || DEFAULT_CHECKPOINT;

// Twenty steps at SDXL's smaller buckets: the output ships at 256 px, so the
// extra resolution and steps the placeholder set paid for would be cropped
// and downscaled away. Roughly fifteen seconds a picture on the iGPU that
// rendered the placeholder set.
const STEPS = 20;
const CFG = 6.5;
const RENDER = {
  square: { width: 768, height: 768 },
  landscape: { width: 1024, height: 576 },
};
// The same shipped sizes as the placeholder plates, so a pack's art fits every
// slot a plate does. Quality 75 rather than 70: these are detailed pictures,
// not silhouettes, and at 256 px the difference is visible.
const SHIP = {
  square: { width: 256, height: 256 },
  landscape: { width: 704, height: 400 },
};
const QUALITY = 75;

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] ?? "" : "";
};
const positional = args.filter((arg, index) => !arg.startsWith("--") && !["--only", "--kinds"].includes(args[index - 1]));
const dir = path.resolve(positional[0] ?? path.join(ROOT, "data", "worlds"));
const only = option("--only");
const kinds = option("--kinds")
  ? option("--kinds").split(",").map((entry) => entry.trim()).filter(Boolean)
  : [...PACK_ART_KINDS];
const dryRun = flag("--dry-run");
const force = flag("--force");
const reencode = flag("--reencode");

for (const kind of kinds) {
  if (!PACK_ART_KINDS.includes(kind)) {
    console.error(`Unknown kind "${kind}". Kinds: ${PACK_ART_KINDS.join(", ")}`);
    process.exit(1);
  }
}

function loadPacks() {
  if (!existsSync(dir)) {
    console.error(`No such directory: ${dir}`);
    process.exit(1);
  }
  const packs = [];
  for (const file of readdirSync(dir).filter((name) => name.endsWith(".json") && name !== "index.json").sort()) {
    const parsed = worldPackSchema.safeParse(JSON.parse(readFileSync(path.join(dir, file), "utf8")));
    if (!parsed.success) {
      console.error(`${file} is not a valid world pack; run scripts/validate-world-packs.mjs first.`);
      process.exit(1);
    }
    if (!only || parsed.data.id === only) {
      packs.push(parsed.data);
    }
  }
  return packs;
}

// What the SRD thing behind a reskin is called, so the prompt can say "a
// dwarf" next to the pack's own name for one. Monsters come from the content
// pack when it is installed; without it the slug's own words are close enough.
function canonicalLookups() {
  let monsterNames = new Map();
  if (existsSync(CONTENT_DB)) {
    try {
      const { default: Database } = require("better-sqlite3-multiple-ciphers");
      const db = new Database(CONTENT_DB, { readonly: true });
      monsterNames = new Map(db.prepare("SELECT slug, name FROM monsters").all().map((row) => [row.slug, row.name]));
      db.close();
    } catch {
      monsterNames = new Map();
    }
  }
  return {
    race: (id) => findRace(id)?.name?.toLowerCase() ?? "",
    class: (id) => findClass(id)?.name?.toLowerCase() ?? "",
    monster: (slug) => (monsterNames.get(slug) ?? slug.replace(/-/g, " ")).toLowerCase(),
  };
}

function allJobs(packs) {
  const canonical = canonicalLookups();
  const jobs = [];
  // Covers first across every pack, so the picker has a face for each world
  // within minutes; then each pack in full; then the backgrounds of every
  // pack last, because a stopped run should have spent its time on the
  // faces a player meets first.
  const perPack = packs.map((pack) => {
    const slots = packArtSlots(pack).filter((slot) => kinds.includes(slot.kind));
    return worldArtJobs(pack, canonical, { slots, packArtKey });
  });
  for (const list of perPack) {
    jobs.push(...list.filter((job) => job.kind === "cover"));
  }
  for (const list of perPack) {
    jobs.push(...list.filter((job) => job.kind !== "cover" && job.kind !== "background"));
  }
  for (const list of perPack) {
    jobs.push(...list.filter((job) => job.kind === "background"));
  }
  return jobs;
}

function srcPathFor(job) {
  return path.join(SRC_DIR, job.packId, `${job.key}.png`);
}

function outPathFor(job) {
  return path.join(OUT_DIR, job.packId, `${job.key}.webp`);
}

function reencodeAll(jobs) {
  let done = 0;
  let missing = 0;
  let bytes = 0;
  for (const job of jobs) {
    const src = srcPathFor(job);
    if (!existsSync(src)) {
      missing += 1;
      continue;
    }
    const out = outPathFor(job);
    mkdirSync(path.dirname(out), { recursive: true });
    encodeWebp(src, out, SHIP[job.aspect], QUALITY);
    bytes += statSync(out).size;
    done += 1;
  }
  console.log(`Re-encoded ${done} at quality ${QUALITY}: ${(bytes / 1024 / 1024).toFixed(1)} MB total.`);
  if (missing) {
    console.log(`${missing} have no original in data/world-art-src; run without --reencode to render them.`);
  }
}

async function main() {
  const packs = loadPacks();
  if (!packs.length) {
    console.error(only ? `No pack with id "${only}" in ${dir}.` : `No packs in ${dir}.`);
    process.exit(1);
  }
  const jobs = allJobs(packs);

  if (dryRun) {
    for (const job of jobs) {
      console.log(`${job.packId}/${job.key} [${job.aspect}]\n  ${job.prompt}\n`);
    }
    console.log(`${jobs.length} pictures across ${packs.length} pack(s).`);
    return;
  }

  if (reencode) {
    reencodeAll(jobs);
    return;
  }

  if (!(await comfyReachable(DEFAULT_COMFY_URL))) {
    console.error(`Could not reach ComfyUI at ${DEFAULT_COMFY_URL}. Start it and try again.`);
    process.exit(1);
  }

  const pending = jobs.filter((job) => force || !existsSync(outPathFor(job)));
  console.log(
    `${jobs.length} pictures across ${packs.length} pack(s), ${pending.length} to render on ${CHECKPOINT} at ${DEFAULT_COMFY_URL}.`,
  );

  const startedAt = Date.now();
  const failures = [];
  for (const [index, job] of pending.entries()) {
    const src = srcPathFor(job);
    const out = outPathFor(job);
    mkdirSync(path.dirname(src), { recursive: true });
    mkdirSync(path.dirname(out), { recursive: true });
    const jobStartedAt = Date.now();
    try {
      if (force || !existsSync(src)) {
        const png = await renderImage({
          checkpoint: CHECKPOINT,
          prompt: job.prompt,
          negative: job.negative,
          seed: seedFor(`${job.packId}/${job.key}`),
          steps: STEPS,
          cfg: CFG,
          prefix: "odm-world-art",
          ...RENDER[job.aspect],
        });
        writeFileSync(src, png);
      }
      encodeWebp(src, out, SHIP[job.aspect], QUALITY);
    } catch (error) {
      failures.push({ job, message: error instanceof Error ? error.message : String(error) });
      console.error(`  !! ${job.packId}/${job.key}: ${failures.at(-1).message}`);
      continue;
    }
    const elapsed = (Date.now() - startedAt) / 1000;
    const remaining = ((elapsed / (index + 1)) * (pending.length - index - 1)) / 60;
    console.log(
      `[${index + 1}/${pending.length}] ${job.packId}/${job.key} ` +
        `${((Date.now() - jobStartedAt) / 1000).toFixed(0)}s, ~${remaining.toFixed(0)} min left`,
    );
  }

  console.log(`\nDone in ${((Date.now() - startedAt) / 60000).toFixed(0)} min.`);
  if (failures.length) {
    console.log(`${failures.length} failed; rerun to retry just those.`);
    process.exit(1);
  }
}

await main();
