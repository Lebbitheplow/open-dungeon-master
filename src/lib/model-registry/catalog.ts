// The model catalog as the server holds it: the bundled snapshot on first
// start, the copy cached in the data folder after that, and a fresh copy
// from models.dev once a day when the network allows. Reads are
// synchronous and never wait on the network: whoever asks gets what is
// held now, and a stale copy schedules its own refresh. The refresh writes
// one file of its own (model-catalog.json beside the database) and nothing
// else; it never touches settings, and nothing it downloads is run.
//
// ODM_MODEL_CATALOG=off keeps the server from asking models.dev at all; the
// snapshot and the cache still serve. ODM_MODEL_CATALOG_PATH moves the file.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { readBody } from "@/lib/backend-fetch";
import { serverEnv } from "@/lib/server-env";
import type { HarnessId, HarnessModel } from "@/lib/harness/types";
import type { ListedModel } from "@/lib/setup/discovery-logic";
import snapshot from "./snapshot.json";
import {
  assessModel,
  catalogModelCount,
  findCatalogModel,
  providerForBaseUrl,
  readCatalogProviders,
  readStoredCatalog,
  type CatalogModel,
  type ModelCatalog,
  type ModelRole,
} from "./catalog-logic";

export const MODELS_DEV_URL = "https://models.dev/api.json";

// The providers the bundled snapshot keeps (scripts/refresh-model-snapshot.mjs):
// the ones ODM reaches by name, and the ones whose rows name the open-weight
// models people run on their own machines.
export const SNAPSHOT_PROVIDERS: readonly string[] = [
  "openai",
  "anthropic",
  "openrouter",
  "google",
  "xai",
  "groq",
  "deepseek",
  "mistral",
  "fireworks-ai",
  "cerebras",
  "deepinfra",
  "ollama-cloud",
  "lmstudio",
  "llama",
  "moonshotai",
  "zai",
  "minimax",
  "alibaba",
  "perplexity",
  "cohere",
  "nvidia",
  "huggingface",
];

export const CATALOG_REFRESH_MS = 24 * 60 * 60 * 1000;
// A failed fetch is tried again after this, not on every read.
export const CATALOG_RETRY_MS = 60 * 60 * 1000;
export const MAX_CATALOG_BYTES = 32 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 20_000;
// A live answer with fewer rows than this is a broken answer, not a smaller
// catalog, and never replaces the copy held.
export const MIN_LIVE_MODELS = 500;

export type RefreshResult = { ok: boolean; error: string; catalog: ModelCatalog };

type State = {
  catalog: ModelCatalog;
  attemptedAt: number;
  error: string;
  refreshing: Promise<RefreshResult> | null;
};

declare global {
  var __odmModelCatalog: State | undefined;
}

export function catalogPath(): string {
  const explicit = serverEnv("ODM_MODEL_CATALOG_PATH").trim();
  if (explicit) return explicit;
  const db = process.env.SQLITE_DB_PATH;
  // Run-time state, kept out of a standalone build's trace (PR #184).
  return path.join(db ? path.dirname(db) : path.join(/*turbopackIgnore: true*/ process.cwd(), "data"), "model-catalog.json");
}

export function catalogRefreshEnabled(): boolean {
  return !["off", "0", "false", "no"].includes(serverEnv("ODM_MODEL_CATALOG").trim().toLowerCase());
}

function fromSnapshot(): ModelCatalog {
  const stored = readStoredCatalog(snapshot);
  return { fetchedAt: stored?.fetchedAt ?? "", source: "snapshot", providers: stored?.providers ?? {} };
}

function fromDisk(): ModelCatalog | null {
  try {
    const text = readFileSync(catalogPath(), "utf8");
    if (text.length > MAX_CATALOG_BYTES) return null;
    const stored = readStoredCatalog(JSON.parse(text));
    return stored && catalogModelCount(stored.providers) > 0 ? { ...stored, source: "cache" } : null;
  } catch {
    // No cache yet, or one that cannot be read: the snapshot serves.
    return null;
  }
}

function state(): State {
  if (!globalThis.__odmModelCatalog) {
    globalThis.__odmModelCatalog = { catalog: fromDisk() ?? fromSnapshot(), attemptedAt: 0, error: "", refreshing: null };
  }
  return globalThis.__odmModelCatalog;
}

// The snapshot is always stale (its date is the build's); a fetched copy is
// stale a day after it was fetched.
export function catalogStale(catalog: Pick<ModelCatalog, "fetchedAt" | "source">, now = Date.now()): boolean {
  if (catalog.source === "snapshot") return true;
  const at = Date.parse(catalog.fetchedAt);
  return !Number.isFinite(at) || now - at > CATALOG_REFRESH_MS;
}

// The catalog held now. A stale one schedules a refresh in the background
// (at most one at a time, a failed one not retried for an hour) and is
// answered as it is.
export function modelCatalog(): ModelCatalog {
  const current = state();
  const now = Date.now();
  if (catalogRefreshEnabled() && !current.refreshing && catalogStale(current.catalog, now) && now - current.attemptedAt > CATALOG_RETRY_MS) {
    void refreshModelCatalog();
  }
  return current.catalog;
}

async function fetchLive(): Promise<ModelCatalog> {
  const response = await fetch(MODELS_DEV_URL, {
    cache: "no-store",
    headers: { accept: "application/json", "user-agent": "open-dungeon-master" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`models.dev answered ${response.status}.`);
  }
  const body = await readBody(response, MAX_CATALOG_BYTES);
  if (!body.complete) {
    throw new Error("models.dev's answer was larger than the catalog can be.");
  }
  let json: unknown;
  try {
    json = JSON.parse(body.text);
  } catch {
    throw new Error("models.dev's answer was not JSON.");
  }
  const providers = readCatalogProviders(json);
  const models = catalogModelCount(providers);
  if (models < MIN_LIVE_MODELS) {
    throw new Error(`models.dev listed only ${models} models; keeping the catalog held.`);
  }
  return { fetchedAt: new Date().toISOString(), source: "live", providers };
}

function writeCache(catalog: ModelCatalog) {
  const file = catalogPath();
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify({ fetchedAt: catalog.fetchedAt, providers: catalog.providers }));
  renameSync(tmp, file);
}

// Fetches models.dev now. One fetch at a time; a second caller joins the
// first. A failure keeps whatever was held and says why.
export function refreshModelCatalog(): Promise<RefreshResult> {
  const current = state();
  if (current.refreshing) return current.refreshing;
  current.attemptedAt = Date.now();
  current.refreshing = (async (): Promise<RefreshResult> => {
    try {
      const catalog = await fetchLive();
      try {
        writeCache(catalog);
      } catch (error) {
        // A read-only data folder still gets the live rows for this process.
        current.error = `The catalog could not be saved: ${error instanceof Error ? error.message : String(error)}`;
      }
      current.catalog = catalog;
      current.error = "";
      return { ok: true, error: "", catalog };
    } catch (error) {
      current.error = error instanceof Error ? error.message : "The catalog could not be fetched.";
      return { ok: false, error: current.error, catalog: current.catalog };
    } finally {
      current.refreshing = null;
    }
  })();
  return current.refreshing;
}

export type CatalogStatus = {
  source: ModelCatalog["source"];
  fetchedAt: string;
  providers: number;
  models: number;
  refreshEnabled: boolean;
  refreshing: boolean;
  error: string;
};

export function catalogStatus(): CatalogStatus {
  const current = state();
  return {
    source: current.catalog.source,
    fetchedAt: current.catalog.fetchedAt,
    providers: Object.keys(current.catalog.providers).length,
    models: catalogModelCount(current.catalog.providers),
    refreshEnabled: catalogRefreshEnabled(),
    refreshing: current.refreshing !== null,
    error: current.error,
  };
}

export function resetModelCatalogForTests() {
  globalThis.__odmModelCatalog = undefined;
}

// ---- the questions the request path asks, without waiting on anything ----

// The catalog row for a model on a hosted provider reached by URL; null for
// a private address (the server there knows its own model better).
export function hostedCatalogModel(baseUrl: string, model: string): CatalogModel | null {
  const { providers } = modelCatalog();
  const provider = providerForBaseUrl(baseUrl, providers);
  return provider ? findCatalogModel(providers, model, provider) : null;
}

export function hostedContextWindow(baseUrl: string, model: string): number | null {
  return hostedCatalogModel(baseUrl, model)?.contextTokens || null;
}

// The window the catalog gives weights served locally under any name.
export function catalogContextWindow(model: string): number | null {
  return findCatalogModel(modelCatalog().providers, model)?.contextTokens || null;
}

// Which catalog provider an agent program's models belong to. opencode
// names its models "provider/model", so the id says.
export function harnessCatalogProvider(id: HarnessId, modelId = ""): string {
  if (id === "claude") return "anthropic";
  if (id === "codex") return "openai";
  if (id === "grok") return "xai";
  const slash = modelId.indexOf("/");
  return slash > 0 ? modelId.slice(0, slash) : "";
}

// An agent program's model list with the catalog's window and deprecation
// filled in where the program gave none: the prompt is packed against the
// window, and a retired model is worth a word before it stops answering.
// When the program said nothing about which models are light, the cheapest
// by the catalog's price are: no name decides it.
export function enrichHarnessModels(id: HarnessId, models: HarnessModel[]): HarnessModel[] {
  const { providers } = modelCatalog();
  const rows = models.map((model) => {
    const asked = model.catalogId || model.id;
    return findCatalogModel(providers, asked, harnessCatalogProvider(id, asked));
  });
  const prices = rows.map((row) => row?.cost?.output ?? null);
  const known = prices.filter((price): price is number => price !== null);
  const cheapest = known.length > 1 ? Math.min(...known) : null;
  const dearest = known.length > 1 ? Math.max(...known) : null;
  const saidLight = models.some((model) => model.cheap);
  return models.map((model, index) => {
    const row = rows[index];
    const light = !saidLight && cheapest !== null && cheapest !== dearest && prices[index] === cheapest;
    if (!row) return model;
    return {
      ...model,
      contextTokens: model.contextTokens ?? (row.contextTokens || undefined),
      ...(row.status === "deprecated" ? { deprecated: true } : {}),
      ...(light ? { cheap: true } : {}),
    };
  });
}

// A server's model list for the guided setup's picker: the models the
// catalog says cannot narrate (no text, no tool calls, a window too small
// for the DM's instructions) left out, the window
// filled in where the server gave none, and a word on each deprecated row.
// A model the catalog has not heard of stays: unknown is not unfit.
export function fitListedModels(baseUrl: string, models: ListedModel[]): ListedModel[] {
  const { providers } = modelCatalog();
  const hint = providerForBaseUrl(baseUrl, providers);
  const out: ListedModel[] = [];
  for (const model of models) {
    const row = findCatalogModel(providers, model.id, hint);
    if (!row) {
      out.push(model);
      continue;
    }
    // The server's own word on the window (OpenRouter's context_length)
    // outranks the catalog's, as its word on tool calls does.
    const catalog = model.context ? { ...row, contextTokens: model.context } : row;
    if (assessModel({ role: "story", id: model.id, catalog, listed: true }).fit === "unfit") continue;
    out.push({
      ...model,
      label: row.status === "deprecated" && !/deprecated/i.test(model.label) ? `${model.label} (deprecated)` : model.label,
      ...(model.context || !row.contextTokens ? {} : { context: row.contextTokens }),
    });
  }
  return out;
}

// The model to preselect from a server's list, by what the catalog knows
// and nothing else: a current row that can do the role's work (narrate and
// call tools for the story, paint for pictures), reasoning ones first, the
// newest first, the cheaper first among those. A list the catalog knows
// nothing of is taken in the server's own order.
export function recommendListed(baseUrl: string, models: ListedModel[], role: ModelRole = "story"): string {
  const { providers } = modelCatalog();
  const hint = providerForBaseUrl(baseUrl, providers);
  const ranked = models
    .map((model) => ({ model, row: findCatalogModel(providers, model.id, hint) }))
    .filter(({ model, row }) => row && assessModel({ role, id: model.id, catalog: row, listed: true }).fit === "ok")
    .sort((a, b) => {
      const x = a.row as CatalogModel;
      const y = b.row as CatalogModel;
      return (
        Number(y.reasoning) - Number(x.reasoning) ||
        y.released.localeCompare(x.released) ||
        (x.cost?.input ?? Number.MAX_SAFE_INTEGER) - (y.cost?.input ?? Number.MAX_SAFE_INTEGER) ||
        a.model.id.localeCompare(b.model.id)
      );
    });
  return ranked[0]?.model.id ?? models[0]?.id ?? "";
}
