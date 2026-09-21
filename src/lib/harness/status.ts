// Which agent programs this machine has, whether they are signed in, and
// which one the admin chose. Probes are slow (each starts the program), so
// results are cached for five minutes; the admin page can force a refresh.

import os from "node:os";
import { getGlobalConfig } from "@/lib/db/app-settings";
import { buildChildEnv } from "./child-env.ts";
import { childPath, findBinary, hostAvailability } from "./discover.ts";
import { claudeAdapter } from "./adapters/claude.ts";
import { opencodeAdapter } from "./adapters/opencode.ts";
import { codexAdapter } from "./adapters/codex.ts";
import { grokAdapter } from "./adapters/grok.ts";
import { fakeAdapter } from "./adapters/fake.ts";
import type { HarnessAdapter, HarnessConfig, HarnessId, HarnessStatus } from "./types.ts";
import { HARNESS_IDS } from "./types.ts";

const STATUS_TTL_MS = 5 * 60_000;

export const ADAPTERS: Record<HarnessId, HarnessAdapter> = {
  claude: claudeAdapter,
  codex: codexAdapter,
  opencode: opencodeAdapter,
  grok: grokAdapter,
};

// The scripted stand-in the tests drive (scripts/lib/fake-harness.mjs).
// Only reachable with HARNESS_FAKE set, never on a real server.
export function adapterFor(id: HarnessId): HarnessAdapter {
  if (process.env.HARNESS_FAKE && process.env.HARNESS_FAKE !== "0") {
    return fakeAdapter;
  }
  return ADAPTERS[id];
}

export function harnessConfig(): HarnessConfig {
  return getGlobalConfig().harness;
}

type StatusCache = Map<HarnessId, HarnessStatus>;
declare global {
  var __odmHarnessStatus: StatusCache | undefined;
}

function cache(): StatusCache {
  if (!globalThis.__odmHarnessStatus) {
    globalThis.__odmHarnessStatus = new Map();
  }
  return globalThis.__odmHarnessStatus;
}

// A test turn that went all the way through proves the lockdown for the
// adapters that could not be proven from their tool list alone.
declare global {
  var __odmHarnessProven: Set<HarnessId> | undefined;
}

export function markLockdownProven(id: HarnessId) {
  if (!globalThis.__odmHarnessProven) {
    globalThis.__odmHarnessProven = new Set();
  }
  globalThis.__odmHarnessProven.add(id);
  const cached = cache().get(id);
  if (cached) {
    cached.lockdownProven = true;
  }
}

export function forgetHarnessStatus(id?: HarnessId) {
  if (id) {
    cache().delete(id);
  } else {
    cache().clear();
  }
}

// Shown on the card, never the full address.
export function maskAccount(account: string | undefined): string | undefined {
  if (!account) {
    return undefined;
  }
  const at = account.indexOf("@");
  if (at <= 0) {
    return account.length > 4 ? `${account.slice(0, 2)}…` : account;
  }
  return `${account.slice(0, Math.min(2, at))}…${account.slice(at)}`;
}

export async function resolveHarnessBinary(id: HarnessId, config = harnessConfig()): Promise<string | null> {
  if (process.env.HARNESS_FAKE && process.env.HARNESS_FAKE !== "0") {
    return process.execPath;
  }
  const explicit = config.id === id ? config.binaryPath : "";
  return findBinary(ADAPTERS[id].binaryNames, explicit);
}

export async function probeHarness(id: HarnessId, options: { refresh?: boolean; phone?: boolean } = {}): Promise<HarnessStatus> {
  const cached = cache().get(id);
  if (!options.refresh && cached && Date.now() - cached.checkedAt < STATUS_TTL_MS) {
    return cached;
  }
  const adapter = adapterFor(id);
  const base = {
    id,
    label: ADAPTERS[id].label,
    installHint: ADAPTERS[id].installHint,
    signInHint: ADAPTERS[id].signInHint,
    lockdown: ADAPTERS[id].lockdown,
    checkedAt: Date.now(),
  };
  const availability = hostAvailability(options.phone);
  const config = harnessConfig();
  if (availability !== "ok") {
    const status: HarnessStatus = {
      ...base,
      installed: false,
      auth: { state: "unknown" },
      models: [],
      lockdownProven: false,
      nativeImages: ADAPTERS[id].paints ? "untested" : "no",
      availability,
      message:
        availability === "container"
          ? "This server runs in a container, which cannot start programs installed on its host."
          : availability === "sandboxed-package"
            ? "This copy of the app is sandboxed (Flatpak or Snap) and cannot start other programs. The AppImage, deb, rpm, dmg and Windows builds can."
            : "Agent programs run on a computer, not a phone.",
    };
    cache().set(id, status);
    return status;
  }
  const binary = await resolveHarnessBinary(id, config);
  if (!binary) {
    const status: HarnessStatus = {
      ...base,
      installed: false,
      auth: { state: "unknown" },
      models: [],
      lockdownProven: false,
      nativeImages: ADAPTERS[id].paints ? "untested" : "no",
      availability,
      message:
        config.id === id && config.binaryPath
          ? `Nothing runnable at ${config.binaryPath}.`
          : `${ADAPTERS[id].label} was not found on this machine.`,
    };
    cache().set(id, status);
    return status;
  }
  const env = buildChildEnv(process.env, id, await childPath(binary), { HOME: os.homedir() });
  let probed: Awaited<ReturnType<HarnessAdapter["probe"]>>;
  try {
    probed = await adapter.probe(binary, env);
  } catch (error) {
    probed = {
      installed: true,
      auth: { state: "unknown" },
      models: [],
      message: error instanceof Error ? error.message : "The program could not be checked.",
    };
  }
  const verified = config.id === id && Boolean(config.imagesVerifiedAt);
  const status: HarnessStatus = {
    ...base,
    ...probed,
    path: binary,
    auth: { ...probed.auth, account: maskAccount(probed.auth.account) },
    lockdownProven: (probed.lockdownProven ?? false) || Boolean(globalThis.__odmHarnessProven?.has(id)),
    nativeImages: ADAPTERS[id].paints ? (verified ? "verified" : "untested") : "no",
    availability,
  };
  cache().set(id, status);
  return status;
}

export async function probeAllHarnesses(options: { refresh?: boolean; phone?: boolean } = {}): Promise<HarnessStatus[]> {
  return Promise.all(HARNESS_IDS.map((id) => probeHarness(id, options)));
}

// The context window a harness model is packed against. Capped at 128K for
// the same reason OpenAI is (src/lib/dm/context-probe-logic.ts): history is
// the residual block, and a plan's limits are counted in tokens.
export const HARNESS_CONTEXT_CAP = 128_000;

export function harnessContextTokens(config = harnessConfig()): number {
  const override = Number.parseInt(process.env.HARNESS_CONTEXT ?? "", 10);
  if (Number.isFinite(override) && override >= 8_000) {
    return override;
  }
  const cached = config.id ? cache().get(config.id) : undefined;
  const model = cached?.models.find((entry) => entry.id === config.model);
  return Math.min(model?.contextTokens ?? HARNESS_CONTEXT_CAP, HARNESS_CONTEXT_CAP);
}
