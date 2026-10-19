import { reportProgress, type AddonTask } from "@/lib/addons/tasks";

// Things on this computer only one addon should use at a time: the
// manifest's `exclusive` ("gpu", "blender"). A run that names one waits until
// no other run holds it, first come first served, and says so on its
// progress line, so a 3D map build and a PDF importer's OCR never fight over
// the graphics card. Calls to one addon already go one at a time
// (src/lib/addons/runtime.ts); this is about addons with each other.
//
// In memory, like the runs themselves: a restart ends every run, and every
// hold with it. The server's own model and picture backends are not in this
// queue; it only orders addons.

type Holder = { taskId: string; addonName: string };
type Waiter = { keys: string[]; holder: Holder; start: () => void };
type ResourceState = { held: Map<string, Holder>; waiting: Waiter[] };

declare global {
  var __odmAddonResources: ResourceState | undefined;
}

function state(): ResourceState {
  return (globalThis.__odmAddonResources ??= { held: new Map(), waiting: [] });
}

// Starts every waiter whose resources are free, in arrival order. A waiter
// that cannot start keeps the ones behind it off its resources, so a busy
// pair of short runs cannot starve a long one forever.
function pump() {
  const current = state();
  const claimed = new Set<string>();
  for (const waiter of [...current.waiting]) {
    const free = waiter.keys.every((key) => !current.held.has(key) && !claimed.has(key));
    if (free) {
      current.waiting = current.waiting.filter((entry) => entry !== waiter);
      for (const key of waiter.keys) current.held.set(key, waiter.holder);
      waiter.start();
    } else {
      for (const key of waiter.keys) claimed.add(key);
    }
  }
}

function waitingMessage(keys: string[]): string {
  const current = state();
  for (const key of keys) {
    const holder = current.held.get(key);
    if (holder) return `Waiting for ${holder.addonName}, which is using the ${key}`;
  }
  return `Waiting its turn for the ${keys.join(" and ")}`;
}

function acquire(keys: string[], task: AddonTask): Promise<void> {
  return new Promise((resolve, reject) => {
    const signal = task.controller.signal;
    if (signal.aborted) {
      reject(new Error("Cancelled."));
      return;
    }
    const onAbort = () => {
      state().waiting = state().waiting.filter((entry) => entry !== waiter);
      pump();
      reject(new Error("Cancelled."));
    };
    const waiter: Waiter = {
      keys,
      holder: { taskId: task.id, addonName: task.addonName },
      start: () => {
        signal.removeEventListener("abort", onAbort);
        resolve();
      },
    };
    signal.addEventListener("abort", onAbort, { once: true });
    state().waiting.push(waiter);
    pump();
    if (state().waiting.includes(waiter)) reportProgress(task, { progress: 0, message: waitingMessage(keys) });
  });
}

function release(keys: string[], taskId: string) {
  const current = state();
  for (const key of keys) {
    if (current.held.get(key)?.taskId === taskId) current.held.delete(key);
  }
  pump();
}

// Runs `work` once this task holds every resource in `keys`, and lets go of
// them when it ends, however it ends.
export async function withExclusive<T>(keys: readonly string[], task: AddonTask, work: () => Promise<T>): Promise<T> {
  const wanted = [...new Set(keys)].sort();
  if (!wanted.length) return work();
  await acquire(wanted, task);
  try {
    return await work();
  } finally {
    release(wanted, task.id);
  }
}
