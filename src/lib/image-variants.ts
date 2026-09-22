// Smaller WebP copies of generated and uploaded pictures, written beside the
// original after it is saved (src/lib/image-format.ts names them).
//
// The work runs in a worker thread with pure WASM codecs (@jsquash/png,
// @jsquash/jpeg and @jsquash/webp to decode, @jsquash/resize to shrink,
// @jsquash/webp to encode), so it needs no native module, runs on the
// phone-hosted Node build, never blocks the event loop the tables share,
// and hands its memory back when the worker exits. The packages are
// loaded inside the worker from a code string, by real Node resolution
// from the server root, so the Next bundler never sees them; the
// standalone build carries them through outputFileTracingIncludes.
//
// Every failure is non-fatal: the original is what campaign data stores and
// what the serve routes fall back to. Jobs run one at a time.
import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { Worker } from "node:worker_threads";
import { imageSize, sniffImage, VARIANT_WIDTHS, variantFileName, type VariantWidth } from "@/lib/image-format";

// Well past a phone's worst case for a 3 MB picture (about a second on a
// desktop core, a few on a phone).
const JOB_TIMEOUT_MS = 90_000;
const WEBP_QUALITY = 82;

export type VariantResult = {
  written: string[];
  skipped: string[];
  error?: string;
};

// The worker's program. CommonJS text evaluated by the worker: it reads the
// picture, decodes it by the format the main thread sniffed, resizes for
// each target and writes each WebP through a temp file and a rename, so a
// half-written variant is never served.
const WORKER_SOURCE = String.raw`
const { parentPort, workerData } = require("node:worker_threads");
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const { pathToFileURL } = require("node:url");

if (typeof globalThis.ImageData === "undefined") {
  // The codecs return browser ImageData; Node has none.
  globalThis.ImageData = class ImageData {
    constructor(data, width, height) {
      this.data = data;
      this.width = width;
      this.height = height;
      this.colorSpace = "srgb";
    }
  };
}

function requireFrom(bases) {
  for (const base of bases) {
    try {
      const req = createRequire(base);
      req.resolve("@jsquash/webp");
      return req;
    } catch {}
  }
  throw new Error("the WebP codecs are not installed beside this server");
}

async function main() {
  const { source, format, targets, quality, bases } = workerData;
  const req = requireFrom(bases);
  const packageDir = (name) => path.dirname(req.resolve(name));
  const load = (dir, file) => import(pathToFileURL(path.join(dir, file)).href);
  const wasm = (dir, file) => new WebAssembly.Module(fs.readFileSync(path.join(dir, file)));

  const bytes = fs.readFileSync(source);
  let image;
  if (format === "png") {
    const dir = packageDir("@jsquash/png");
    const decoder = await load(dir, "decode.js");
    await decoder.init(wasm(dir, "codec/pkg/squoosh_png_bg.wasm"));
    image = await decoder.default(bytes);
  } else if (format === "jpeg") {
    const dir = packageDir("@jsquash/jpeg");
    const decoder = await load(dir, "decode.js");
    await decoder.init(wasm(dir, "codec/dec/mozjpeg_dec.wasm"));
    image = await decoder.default(bytes);
  } else if (format === "webp") {
    const dir = packageDir("@jsquash/webp");
    const decoder = await load(dir, "decode.js");
    await decoder.init(wasm(dir, "codec/dec/webp_dec.wasm"));
    image = await decoder.default(bytes);
  } else {
    throw new Error("unsupported format " + format);
  }

  const resizeDir = packageDir("@jsquash/resize");
  const resizer = await load(resizeDir, "index.js");
  await resizer.initResize(wasm(resizeDir, "lib/resize/pkg/squoosh_resize_bg.wasm"));
  const webpDir = packageDir("@jsquash/webp");
  const encoder = await load(webpDir, "encode.js");
  // Its CommonJS build; the encoder's own init runs the same check to pick
  // the matching glue, so both must agree.
  const { simd } = req("wasm-feature-detect");
  const simdReady = await simd();
  await encoder.init(wasm(webpDir, simdReady ? "codec/enc/webp_enc_simd.wasm" : "codec/enc/webp_enc.wasm"));

  const longEdge = Math.max(image.width, image.height);
  const written = [];
  const skipped = [];
  for (const target of targets) {
    const scale = Math.min(1, target.width / longEdge);
    if (scale === 1 && format === "webp") {
      // Already WebP and no smaller than asked: the original is the variant.
      skipped.push(target.file);
      continue;
    }
    let picture = image;
    if (scale < 1) {
      picture = await resizer.default(image, {
        width: Math.max(1, Math.round(image.width * scale)),
        height: Math.max(1, Math.round(image.height * scale)),
        method: "lanczos3",
        premultiply: true,
        linearRGB: false,
      });
    }
    const encoded = await encoder.default(picture, { quality });
    if (scale === 1 && encoded.byteLength >= bytes.length) {
      // Same size and no fewer bytes (a flat PNG, a tight JPEG): the
      // original serves better than a copy would.
      skipped.push(target.file);
      continue;
    }
    const temp = target.file + ".tmp-" + process.pid;
    fs.writeFileSync(temp, Buffer.from(encoded));
    fs.renameSync(temp, target.file);
    written.push(target.file);
  }
  return { written, skipped };
}

main().then(
  (result) => parentPort.postMessage({ ok: true, ...result }),
  (error) => parentPort.postMessage({ ok: false, error: String((error && error.message) || error) }),
);
`;

function resolutionBases(): string[] {
  const bases = [path.join(process.cwd(), "package.json")];
  try {
    // The bundled server's own location, for a process started elsewhere.
    bases.push(import.meta.url);
  } catch {
    // Not every runtime exposes it; the working directory is enough then.
  }
  return bases;
}

function runWorker(job: {
  source: string;
  format: string;
  targets: Array<{ width: number; file: string }>;
}): Promise<VariantResult> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: VariantResult) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve(result);
      }
    };
    let worker: Worker;
    try {
      worker = new Worker(WORKER_SOURCE, {
        eval: true,
        // Not the parent's flags: an inspector or a loader hook would refuse.
        execArgv: [],
        workerData: { ...job, quality: WEBP_QUALITY, bases: resolutionBases() },
      });
    } catch (error) {
      finish({ written: [], skipped: [], error: error instanceof Error ? error.message : String(error) });
      return;
    }
    const timer = setTimeout(() => {
      void worker.terminate();
      finish({ written: [], skipped: [], error: "timed out" });
    }, JOB_TIMEOUT_MS);
    worker.on("message", (message: { ok: boolean; written?: string[]; skipped?: string[]; error?: string }) => {
      finish(
        message.ok
          ? { written: message.written ?? [], skipped: message.skipped ?? [] }
          : { written: [], skipped: [], error: message.error ?? "failed" },
      );
    });
    worker.on("error", (error) => finish({ written: [], skipped: [], error: error.message }));
    worker.on("exit", (code) => {
      if (code !== 0) {
        finish({ written: [], skipped: [], error: `worker exited with ${code}` });
      }
    });
  });
}

// Writes the variants of one picture that do not exist yet. Idempotent: a
// second call over the same file writes nothing. Awaitable for the backfill
// script and the tests; the server calls scheduleImageVariants instead.
export async function writeImageVariants(
  source: string,
  widths: readonly VariantWidth[] = VARIANT_WIDTHS,
): Promise<VariantResult> {
  let bytes: Buffer;
  try {
    bytes = await readFile(source);
  } catch (error) {
    return { written: [], skipped: [], error: error instanceof Error ? error.message : String(error) };
  }
  const kind = sniffImage(bytes);
  if (!kind) {
    return { written: [], skipped: [], error: "not a PNG, JPEG or WebP" };
  }
  const dir = path.dirname(source);
  const name = path.basename(source);
  const { width, height } = imageSize(bytes);
  const longEdge = Math.max(width, height);
  const targets: Array<{ width: number; file: string }> = [];
  const skipped: string[] = [];
  for (const target of widths) {
    const file = path.join(dir, variantFileName(name, target));
    if (existsSync(file)) {
      skipped.push(file);
    } else if (kind.format === "webp" && longEdge > 0 && longEdge <= target) {
      // Cheap header check of the rule the worker applies too.
      skipped.push(file);
    } else {
      targets.push({ width: target, file });
    }
  }
  if (!targets.length) {
    return { written: [], skipped };
  }
  const result = await runWorker({ source, format: kind.format, targets });
  return { ...result, skipped: [...skipped, ...result.skipped] };
}

// One job at a time, keyed by the original's absolute path, so a burst of
// saves cannot spawn a worker each and the serve route can wait for the
// copy it was asked for.
const pending = new Map<string, Promise<VariantResult>>();
let chain: Promise<unknown> = Promise.resolve();

function enqueue(source: string): Promise<VariantResult> {
  const existing = pending.get(source);
  if (existing) {
    return existing;
  }
  const job = chain.then(() => writeImageVariants(source)).finally(() => {
    pending.delete(source);
  });
  chain = job.catch(() => undefined);
  pending.set(source, job);
  return job;
}

// Fire and forget from the save path. The job starts on the next turn of
// the event loop, after the caller has returned its response.
export function scheduleImageVariants(source: string): void {
  setImmediate(() => {
    void enqueue(source).then((result) => {
      if (result.error) {
        console.warn(`[image-variants] ${path.basename(source)}: ${result.error}`);
      }
    });
  });
}

// The segments a serve route should stream for a ?w= request: the variant's
// when it exists (waiting briefly for one that is being written right now,
// as happens when a client asks the moment the picture lands), else the
// original's. The variant is always a sibling in the same folder; segments
// that would leave the root are handed back untouched for serve-file to
// refuse the way it always has.
export async function servedSegments(
  rootDir: string,
  segments: string[],
  width: VariantWidth,
  waitMs = 4000,
): Promise<string[]> {
  const name = segments[segments.length - 1];
  if (!name || segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    return segments;
  }
  const root = path.join(process.cwd(), "public", rootDir);
  const original = path.resolve(root, ...segments);
  if (!original.startsWith(root + path.sep)) {
    return segments;
  }
  const inFlight = pending.get(original);
  if (inFlight) {
    await Promise.race([inFlight, new Promise((resolve) => setTimeout(resolve, waitMs))]);
  }
  const variant = [...segments.slice(0, -1), variantFileName(name, width)];
  try {
    const info = await stat(path.resolve(root, ...variant));
    return info.isFile() ? variant : segments;
  } catch {
    return segments;
  }
}
