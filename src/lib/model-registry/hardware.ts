// What this machine can hold: its memory and its graphics card, read from
// ComfyUI's /system_stats when one runs here (it names the card), else from
// the card's own driver (amdgpu's sysfs nodes, nvidia-smi) or, on Apple
// silicon, the one pool a Mac shares. A local model that cannot fit is kept
// off the list before anyone waits on it. Asked once every few minutes.

import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { configValue } from "@/lib/app-config";
import { getGlobalConfig } from "@/lib/db/app-settings";
import { hostPlatform } from "@/lib/host-platform";

export type Gpu = { name: string; vramGb: number };

export type Machine = {
  ramGb: number;
  gpu: Gpu | null;
  // One pool of memory shared by the CPU and GPU (Apple silicon, AMD Strix
  // Halo): the weights are held once, so RAM is the whole budget.
  unified: boolean;
  checkedAt: number;
};

// The least graphics memory a local storyteller is supported on: gpt-oss-20b
// on a 16 GB card. The desktop app holds the same line (its
// LOCAL_AI_MINIMUM_GB), and docs/text-backends.md explains it.
export const LOCAL_STORYTELLER_MINIMUM_GB = 16;
// About what the recommended storyteller (Qwen3.6-35B-A3B at Q4) needs.
export const RECOMMENDED_STORYTELLER_GB = 28;

const CHECK_TTL_MS = 5 * 60_000;
const STATS_TIMEOUT_MS = 2_500;
const PROBE_TIMEOUT_MS = 3_000;
const run = promisify(execFile);

const gb = (bytes: unknown) => (typeof bytes === "number" && bytes > 0 ? Math.round((bytes / 1024 ** 3) * 10) / 10 : 0);

// ComfyUI's /system_stats: "cuda:0 AMD Radeon 8060S Graphics : native".
export function readGpuStats(json: unknown): Gpu | null {
  const device = (json as { devices?: Array<{ name?: unknown; vram_total?: unknown }> } | null)?.devices?.[0];
  if (!device || typeof device.name !== "string") return null;
  return {
    name: device.name.replace(/^\w+:\d+\s+/, "").replace(/\s*:\s*\w+$/, "").trim(),
    vramGb: gb(device.vram_total),
  };
}

// nvidia-smi --query-gpu=memory.total,name --format=csv,noheader,nounits:
// "24564, NVIDIA GeForce RTX 4090", the first card's line.
export function readNvidiaSmi(stdout: string): Gpu | null {
  const [memory, ...name] = (stdout.split("\n")[0] ?? "").split(",");
  const mib = Number(memory);
  if (!Number.isFinite(mib) || mib <= 0) return null;
  return { name: name.join(",").trim() || "NVIDIA graphics", vramGb: Math.round((mib / 1024) * 10) / 10 };
}

// amdgpu's sysfs nodes, the largest card's: its own memory and the GTT pool
// it addresses in system memory, which on an APU with a small carve-out is
// the real capacity. Null when no card exposes them.
export function readAmdSysfs(root = "/sys/class/drm"): { vramGb: number; gttGb: number } | null {
  let vramGb = 0;
  let gttGb = 0;
  let found = false;
  let cards: string[] = [];
  try {
    cards = fs.readdirSync(root).filter((card) => /^card\d+$/.test(card));
  } catch {
    return null;
  }
  for (const card of cards) {
    const read = (node: string) => {
      try {
        return Number(fs.readFileSync(path.join(root, card, "device", node), "utf8"));
      } catch {
        return Number.NaN;
      }
    };
    const vram = read("mem_info_vram_total");
    if (!Number.isFinite(vram)) continue;
    found = true;
    vramGb = Math.max(vramGb, gb(vram));
    const gtt = read("mem_info_gtt_total");
    if (Number.isFinite(gtt)) gttGb = Math.max(gttGb, gb(gtt));
  }
  return found ? { vramGb, gttGb } : null;
}

export function unifiedMemory(gpu: Gpu | null, ramGb: number): boolean {
  if (!gpu) return false;
  if (/Radeon(\s*\(TM\))?\s*8[0-9]{3}S|Ryzen\s*AI\s*Max|gfx1151|Apple\s*M\d|Apple\s*GPU|Apple silicon/i.test(gpu.name)) return true;
  // A "GPU" with as good as all of the machine's memory is the machine's
  // memory (a unified box reports a share of RAM as its VRAM); a big card
  // in a small box is not.
  return ramGb > 0 && gpu.vramGb >= ramGb * 0.85;
}

// The memory a model's weights can sit in on the GPU: the card's own, or the
// share of a unified pool the system leaves it. Null when no card is known.
export function graphicsMemoryGb(machine: Pick<Machine, "ramGb" | "gpu" | "unified">): number | null {
  if (!machine.gpu) return null;
  return machine.unified ? machine.ramGb * 0.8 : machine.gpu.vramGb;
}

// The memory a local model may take, reckoned the way the desktop app
// reckons it (its src/main/local-ai/catalog.ts), so the server, the app and
// the docs agree: most of a unified pool, or a card plus half the system
// memory, where a mixture-of-experts model's experts can wait at some cost
// in speed. With no card known, the machine's memory is the most a model
// could have, so only weights beyond it are judged too big.
export function memoryBudgetGb(machine: Pick<Machine, "ramGb" | "gpu" | "unified">): number {
  if (!machine.gpu) return machine.ramGb;
  return machine.unified ? machine.ramGb * 0.8 : machine.gpu.vramGb + machine.ramGb * 0.5;
}

// Whether weights of this size run here; null when either side is unknown.
// The KV cache and the runtime want room beyond the file itself.
export function fitsMachine(sizeGb: number, machine: Pick<Machine, "ramGb" | "gpu" | "unified">): boolean | null {
  const budget = memoryBudgetGb(machine);
  if (!sizeGb || !budget) return null;
  return sizeGb * 1.1 <= budget;
}

// Which local storyteller this machine runs, by the docs' table: below the
// 16 GB minimum, the minimum (gpt-oss-20b), or the recommended model. A
// "16 GB" card reports a little under 16 once its driver takes a share.
export type StorytellerFit = "unknown" | "below" | "minimum" | "recommended";

export function storytellerFit(machine: Pick<Machine, "ramGb" | "gpu" | "unified">): StorytellerFit {
  const graphics = graphicsMemoryGb(machine);
  if (graphics === null) return "unknown";
  if (graphics < LOCAL_STORYTELLER_MINIMUM_GB - 0.5) return "below";
  return memoryBudgetGb(machine) >= RECOMMENDED_STORYTELLER_GB ? "recommended" : "minimum";
}

declare global {
  var __odmMachine: Machine | undefined;
}

function comfyUrl(): string {
  return configValue(getGlobalConfig().images.comfyUrl, "COMFYUI_URL", "http://127.0.0.1:8188").replace(/\/+$/, "");
}

// The card from its own driver, when no ComfyUI named it.
async function probeGpu(ramGb: number): Promise<{ gpu: Gpu | null; unified: boolean }> {
  if (hostPlatform() === "darwin" && os.arch() === "arm64") {
    return { gpu: { name: "Apple silicon", vramGb: ramGb }, unified: true };
  }
  try {
    const { stdout } = await run("nvidia-smi", ["--query-gpu=memory.total,name", "--format=csv,noheader,nounits"], {
      timeout: PROBE_TIMEOUT_MS,
    });
    const gpu = readNvidiaSmi(stdout);
    if (gpu) return { gpu, unified: false };
  } catch {
    // No NVIDIA driver here.
  }
  if (hostPlatform() === "linux") {
    const amd = readAmdSysfs();
    if (amd) {
      // As the desktop app's scan decides it: a carve-out that is most of
      // RAM, or a GTT pool that dwarfs a small carve-out.
      const unified = amd.vramGb >= ramGb * 0.6 || (amd.gttGb >= ramGb * 0.4 && amd.vramGb < ramGb * 0.3);
      return { gpu: { name: "AMD graphics", vramGb: unified ? ramGb : amd.vramGb }, unified };
    }
  }
  return { gpu: null, unified: false };
}

export async function machine(): Promise<Machine> {
  const cached = globalThis.__odmMachine;
  if (cached && Date.now() - cached.checkedAt < CHECK_TTL_MS) return cached;
  const ramGb = gb(os.totalmem());
  let gpu: Gpu | null = null;
  let unified = false;
  try {
    const response = await fetch(`${comfyUrl()}/system_stats`, { cache: "no-store", signal: AbortSignal.timeout(STATS_TIMEOUT_MS) });
    if (response.ok) gpu = readGpuStats(await response.json().catch(() => null));
    unified = unifiedMemory(gpu, ramGb);
  } catch {
    // No ComfyUI here: the card's driver is asked below.
  }
  if (!gpu) ({ gpu, unified } = await probeGpu(ramGb));
  const found: Machine = { ramGb, gpu, unified, checkedAt: Date.now() };
  globalThis.__odmMachine = found;
  return found;
}

export function describeMachine(found: Pick<Machine, "ramGb" | "gpu" | "unified">): string {
  const memory = `${Math.round(found.ramGb)} GB memory`;
  if (!found.gpu) return `${memory}, no graphics card found`;
  return found.unified ? `${found.gpu.name}, ${memory} shared` : `${found.gpu.name} with ${found.gpu.vramGb} GB, ${memory}`;
}
