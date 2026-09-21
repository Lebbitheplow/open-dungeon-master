// Pictures from the agent program's own image tool (Codex's image
// generation, Grok's image_gen). Offered only for programs that have one, and
// only once a real test picture has been made on this machine: the tools are
// documented, but whether they work headless under a given sign-in is not
// something to promise a table before it has been seen.
//
// A picture run is its own short session: only the image tool is on, no MCP,
// an empty scratch folder. The bytes are taken from the program's event
// stream or from a file it saved in that folder, never from anything it
// wrote as text, and they are checked before anything is written.

import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AspectPreset, GeneratedImage, ImageMode } from "@/lib/types";
import { buildChildEnv } from "./child-env.ts";
import { childPath } from "./discover.ts";
import { adapterFor, ADAPTERS, harnessConfig, resolveHarnessBinary } from "./status.ts";
import { isHarnessId } from "./types.ts";

export const MAX_HARNESS_IMAGE_BYTES = 8 * 1024 * 1024;
const PICTURE_TIMEOUT_MS = 5 * 60_000;

// Magic bytes, not a declared type: the program is not trusted to name what
// it wrote. Pure, so scripts/test-harness-images.mjs can pin it.
export function sniffImage(bytes: Buffer): { mime: string; ext: string } | null {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { mime: "image/png", ext: "png" };
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { mime: "image/jpeg", ext: "jpg" };
  }
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") {
    return { mime: "image/webp", ext: "webp" };
  }
  return null;
}

// Width and height from the header, so the picture is sized honestly
// without a decoder. Returns 0x0 when the header is not one we read.
export function imageSize(bytes: Buffer): { width: number; height: number } {
  const kind = sniffImage(bytes);
  if (kind?.ext === "png" && bytes.length >= 24) {
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  if (kind?.ext === "jpg") {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) {
        break;
      }
      const marker = bytes[offset + 1];
      const length = bytes.readUInt16BE(offset + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: bytes.readUInt16BE(offset + 5), width: bytes.readUInt16BE(offset + 7) };
      }
      offset += 2 + length;
    }
  }
  if (kind?.ext === "webp" && bytes.length >= 30) {
    const chunk = bytes.subarray(12, 16).toString("ascii");
    if (chunk === "VP8X") {
      return { width: 1 + bytes.readUIntLE(24, 3), height: 1 + bytes.readUIntLE(27, 3) };
    }
    if (chunk === "VP8 ") {
      return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
    }
  }
  return { width: 0, height: 0 };
}

export function acceptImage(bytes: Buffer | null | undefined): { bytes: Buffer; ext: string } | null {
  if (!bytes || bytes.length < 64 || bytes.length > MAX_HARNESS_IMAGE_BYTES) {
    return null;
  }
  const kind = sniffImage(bytes);
  return kind ? { bytes, ext: kind.ext } : null;
}

// Whether the admin's program may paint for the tables right now.
export function harnessImagesReady(): boolean {
  const config = harnessConfig();
  return (
    isHarnessId(config.id) &&
    ADAPTERS[config.id].paints &&
    config.images === "native" &&
    Boolean(config.imagesVerifiedAt)
  );
}

const ASPECT_WORDS: Record<AspectPreset, string> = {
  square: "square (1:1)",
  portrait: "portrait (2:3, taller than wide)",
  landscape: "landscape (3:2, wider than tall)",
};

function newestImageIn(dir: string, since: number): Buffer | null {
  let best: { file: string; mtime: number } | null = null;
  const walk = (folder: string, depth: number) => {
    if (depth > 3) {
      return;
    }
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const full = path.join(folder, entry.name);
      if (entry.isDirectory()) {
        walk(full, depth + 1);
      } else if (/\.(png|jpe?g|webp)$/i.test(entry.name)) {
        const mtime = statSync(full).mtimeMs;
        if (mtime >= since && (!best || mtime > best.mtime)) {
          best = { file: full, mtime };
        }
      }
    }
  };
  try {
    walk(dir, 0);
  } catch {
    return null;
  }
  const found = best as { file: string; mtime: number } | null;
  return found ? readFileSync(found.file) : null;
}

function slug(prompt: string): string {
  return (
    prompt
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 50) || "image"
  );
}

export async function generateHarnessImage(options: {
  prompt: string;
  mode: ImageMode;
  aspect: AspectPreset;
  negative?: string;
  // The admin's test picture runs before images are switched on.
  force?: boolean;
}): Promise<GeneratedImage> {
  const config = harnessConfig();
  if (!isHarnessId(config.id) || !ADAPTERS[config.id].paints) {
    throw new Error("The server's agent program cannot make pictures.");
  }
  if (!options.force && !harnessImagesReady()) {
    throw new Error("Pictures from the server's agent program are not switched on.");
  }
  const binary = await resolveHarnessBinary(config.id, config);
  if (!binary) {
    throw new Error("The server's agent program was not found.");
  }
  const started = Date.now();
  const cwd = mkdtempSync(path.join(os.tmpdir(), "odm-harness-img-"));
  const env = buildChildEnv(process.env, config.id, await childPath(binary), { HOME: os.homedir() });
  const adapter = adapterFor(config.id);
  let captured: Buffer | null = null;
  try {
    captured = await new Promise<Buffer | null>((resolve, reject) => {
      let settled = false;
      let program: { send(text: string): void; close(): void } | null = null;
      const finish = (value: Buffer | null, error?: Error) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        program?.close();
        if (error) {
          reject(error);
        } else {
          resolve(value);
        }
      };
      const timer = setTimeout(() => finish(null, new Error("The picture took too long.")), PICTURE_TIMEOUT_MS);
      adapter
        .start({
          binary,
          system:
            "You make one picture for a tabletop role-playing game. Use your image generation tool exactly once to draw what is asked, then reply with the single word done. Do not use any other tool.",
          model: config.model,
          effort: "",
          mcp: null,
          images: true,
          cwd,
          env,
          onEvent: (event) => {
            if (event.type === "image") {
              const accepted = acceptImage(event.bytes);
              if (accepted) {
                finish(accepted.bytes);
              }
            } else if (event.type === "turn_end") {
              finish(newestImageIn(cwd, started));
            } else if (event.type === "error") {
              finish(null, new Error(event.message));
            } else if (event.type === "exit") {
              finish(newestImageIn(cwd, started));
            }
          },
        })
        .then((started) => {
          program = started;
          if (settled) {
            started.close();
            return;
          }
          started.send(
            [
              `Draw: ${options.prompt}`,
              `Shape: ${ASPECT_WORDS[options.aspect]}.`,
              options.negative ? `Leave out: ${options.negative}.` : "",
            ]
              .filter(Boolean)
              .join("\n"),
          );
        })
        .catch((error) => finish(null, error instanceof Error ? error : new Error(String(error))));
    });
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
  const accepted = acceptImage(captured);
  if (!accepted) {
    throw new Error("The agent program finished without a picture ODM could use.");
  }
  const generatedDir = path.join(process.cwd(), "public", "generated");
  mkdirSync(generatedDir, { recursive: true });
  const filename = `${Date.now()}-harness-${slug(options.prompt)}.${accepted.ext}`;
  writeFileSync(path.join(generatedDir, filename), accepted.bytes);
  const size = imageSize(accepted.bytes);
  return {
    id: randomUUID(),
    url: `/generated/${filename}`,
    prompt: options.prompt,
    mode: options.mode,
    backend: "harness",
    aspect: options.aspect,
    width: size.width,
    height: size.height,
    elapsedSeconds: Math.round((Date.now() - started) / 100) / 10,
  };
}
