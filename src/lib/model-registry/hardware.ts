// What this machine can hold: its memory, and the GPU ComfyUI reports when
// one is running here (GET /system_stats, the only cheap place a GPU's
// memory is written down). A local model that cannot fit is kept off the
// list before anyone waits on it. Asked once every few minutes.

import os from "node:os";
import { configValue } from "@/lib/app-config";
import { getGlobalConfig } from "@/lib/db/app-settings";

export type Gpu = { name: string; vramGb: number };

export type Machine = {
  ramGb: number;
  gpu: Gpu | null;
  // One pool of memory shared by the CPU and GPU (Apple silicon, AMD Strix
  // Halo): the weights are held once, so RAM is the whole budget.
  unified: boolean;
  checkedAt: number;
};

const CHECK_TTL_MS = 5 * 60_000;
const STATS_TIMEOUT_MS = 2_500;

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

export function unifiedMemory(gpu: Gpu | null, ramGb: number): boolean {
  if (!gpu) return false;
  if (/Radeon(\s*\(TM\))?\s*8[0-9]{3}S|Ryzen\s*AI\s*Max|gfx1151|Apple\s*M\d|Apple\s*GPU/i.test(gpu.name)) return true;
  // A "GPU" with as good as all of the machine's memory is the machine's
  // memory (a unified box reports a share of RAM as its VRAM); a big card
  // in a small box is not.
  return ramGb > 0 && gpu.vramGb >= ramGb * 0.85;
}

// The memory a local model may take: RAM on a unified machine, RAM plus the
// card on a discrete one (Ollama and llama.cpp offload what the card cannot
// hold).
export function memoryBudgetGb(machine: Pick<Machine, "ramGb" | "gpu" | "unified">): number {
  return machine.unified || !machine.gpu ? machine.ramGb : machine.ramGb + machine.gpu.vramGb;
}

// Whether weights of this size run here; null when either side is unknown.
// The KV cache and the runtime want room beyond the file itself.
export function fitsMachine(sizeGb: number, machine: Pick<Machine, "ramGb" | "gpu" | "unified">): boolean | null {
  const budget = memoryBudgetGb(machine);
  if (!sizeGb || !budget) return null;
  return sizeGb * 1.1 <= budget;
}

declare global {
  var __odmMachine: Machine | undefined;
}

function comfyUrl(): string {
  return configValue(getGlobalConfig().images.comfyUrl, "COMFYUI_URL", "http://127.0.0.1:8188").replace(/\/+$/, "");
}

export async function machine(): Promise<Machine> {
  const cached = globalThis.__odmMachine;
  if (cached && Date.now() - cached.checkedAt < CHECK_TTL_MS) return cached;
  const ramGb = gb(os.totalmem());
  let gpu: Gpu | null = null;
  try {
    const response = await fetch(`${comfyUrl()}/system_stats`, { cache: "no-store", signal: AbortSignal.timeout(STATS_TIMEOUT_MS) });
    if (response.ok) gpu = readGpuStats(await response.json().catch(() => null));
  } catch {
    // No ComfyUI here: the GPU stays unknown and RAM is the budget.
  }
  const found: Machine = { ramGb, gpu, unified: unifiedMemory(gpu, ramGb), checkedAt: Date.now() };
  globalThis.__odmMachine = found;
  return found;
}

export function describeMachine(found: Pick<Machine, "ramGb" | "gpu" | "unified">): string {
  const memory = `${Math.round(found.ramGb)} GB memory`;
  if (!found.gpu) return memory;
  return found.unified ? `${found.gpu.name}, ${memory} shared` : `${found.gpu.name} with ${found.gpu.vramGb} GB, ${memory}`;
}
