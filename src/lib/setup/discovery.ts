// The guided setup's scan: asks each AI service's usual address on this
// machine whether something is listening, all at once, each with a short
// timeout, so a fresh server can offer what it found instead of asking for
// URLs and model names. Admin-only (POST /api/admin/setup); the rules for
// reading the answers are in discovery-logic.ts.
import { hostAvailability } from "@/lib/harness/discover";
import {
  COMFYUI_PORT,
  KOKORO_PORT,
  TEXT_SERVER_LABEL,
  WHISPER_PORT,
  identifyTextServer,
  modelsUrl,
  normalizeBaseUrl,
  originOf,
  pickZImageFiles,
  readComfyCheckpoints,
  readComfyFiles,
  readKokoroVoices,
  readModelList,
  readModelsAnswer,
  recommendedModel,
  scanHosts,
  textPorts,
  zImageMissing,
  Z_IMAGE_SLOTS,
  type ListedModel,
  type TextServerKind,
} from "@/lib/setup/discovery-logic";

// Long enough for a busy llama-server (or a machine deep in swap) to answer
// /models while it decodes; every port is asked at once, so the whole scan
// still takes about this long.
const SCAN_TIMEOUT_MS = 3_000;
// A hosted provider's model list can be large and far away.
const LIST_TIMEOUT_MS = 12_000;

export type FoundTextServer = {
  kind: TextServerKind;
  label: string;
  baseUrl: string;
  // The server answered 401: it is there, and wants its key.
  needsKey: boolean;
  models: ListedModel[];
  recommended: string;
};

export type ScanResult = {
  inContainer: boolean;
  text: FoundTextServer[];
  // zImage: all three Z-Image Turbo files are there to pick it.
  comfyui: { url: string; checkpoints: string[]; zImage: boolean } | null;
  kokoro: { url: string; voices: string[] } | null;
  whisper: { url: string } | null;
};

async function getJson(url: string, timeoutMs: number, headers: Record<string, string> = {}) {
  try {
    const response = await fetch(url, { cache: "no-store", headers, signal: AbortSignal.timeout(timeoutMs) });
    const body = await response.json().catch(() => null);
    return { status: response.status, body };
  } catch {
    return { status: 0, body: null };
  }
}

async function findTextServer(host: string, port: number, guess: TextServerKind): Promise<FoundTextServer | null> {
  const baseUrl = normalizeBaseUrl(originOf(host, port));
  const { status, body } = await getJson(modelsUrl(baseUrl), SCAN_TIMEOUT_MS);
  const verdict = readModelsAnswer(status);
  if (verdict === "absent") {
    return null;
  }
  const kind = verdict === "found" ? identifyTextServer(body, guess) : guess;
  const models = verdict === "found" ? readModelList(body) : [];
  // A 200 with no list at all is some other web server on the port.
  if (verdict === "found" && !body) {
    return null;
  }
  return {
    kind,
    label: TEXT_SERVER_LABEL[kind],
    baseUrl,
    needsKey: verdict === "needs-key",
    models,
    recommended: recommendedModel(models),
  };
}

async function findComfy(host: string) {
  const url = originOf(host, COMFYUI_PORT);
  const stats = await getJson(`${url}/system_stats`, SCAN_TIMEOUT_MS);
  if (stats.status !== 200) {
    return null;
  }
  const { unet, clip, vae } = Z_IMAGE_SLOTS;
  const [info, unets, clips, vaes] = await Promise.all(
    ["CheckpointLoaderSimple", unet.node, clip.node, vae.node].map((node) => getJson(`${url}/object_info/${node}`, SCAN_TIMEOUT_MS)),
  );
  const zImage = pickZImageFiles({
    unet: readComfyFiles(unets.body, unet.node, unet.input),
    clip: readComfyFiles(clips.body, clip.node, clip.input),
    vae: readComfyFiles(vaes.body, vae.node, vae.input),
  });
  return { url, checkpoints: readComfyCheckpoints(info.body), zImage: zImageMissing(zImage).length === 0 };
}

async function findKokoro(host: string) {
  const url = originOf(host, KOKORO_PORT);
  const health = await getJson(`${url}/health`, SCAN_TIMEOUT_MS);
  if (health.status !== 200) {
    return null;
  }
  const voices = await getJson(`${url}/v1/audio/voices`, SCAN_TIMEOUT_MS);
  return { url, voices: readKokoroVoices(voices.body) };
}

async function findWhisper(host: string) {
  const url = originOf(host, WHISPER_PORT);
  const models = await getJson(`${url}/v1/models`, SCAN_TIMEOUT_MS);
  return models.status === 200 ? { url } : null;
}

// The first host that answers wins for each single service.
async function firstOf<T>(hosts: string[], find: (host: string) => Promise<T | null>): Promise<T | null> {
  const results = await Promise.all(hosts.map(find));
  return results.find((result) => result !== null) ?? null;
}

export async function scanLocalServices(ownPort = process.env.PORT): Promise<ScanResult> {
  const inContainer = hostAvailability() === "container";
  const hosts = scanHosts(inContainer);
  const ports = textPorts(ownPort);
  const [textResults, comfyui, kokoro, whisper] = await Promise.all([
    Promise.all(hosts.flatMap((host) => ports.map(({ port, guess }) => findTextServer(host, port, guess)))),
    firstOf(hosts, findComfy),
    firstOf(hosts, findKokoro),
    firstOf(hosts, findWhisper),
  ]);
  // Host networking answers the same server on both names; keep the first.
  const seenPorts = new Set<string>();
  const text = textResults.filter((found): found is FoundTextServer => {
    if (!found) return false;
    const port = new URL(found.baseUrl).port;
    if (seenPorts.has(port)) return false;
    seenPorts.add(port);
    return true;
  });
  return { inContainer, text, comfyui, kokoro, whisper };
}

export type ModelListing =
  | { ok: true; baseUrl: string; models: ListedModel[]; recommended: string }
  | { ok: false; baseUrl: string; error: string; needsKey?: boolean };

// One server's model list, for an address or key typed into the wizard.
// The key is used for this one request and never stored here.
export async function listModels(baseUrlInput: string, apiKey: string, preferred?: readonly string[]): Promise<ModelListing> {
  const baseUrl = normalizeBaseUrl(baseUrlInput);
  if (!baseUrl) {
    return { ok: false, baseUrl, error: "Enter the server's address." };
  }
  let host = "";
  try {
    host = new URL(baseUrl).host;
  } catch {
    return { ok: false, baseUrl, error: "That address is not a web address." };
  }
  const { status, body } = await getJson(
    modelsUrl(baseUrl),
    LIST_TIMEOUT_MS,
    apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
  );
  if (status === 0) {
    return { ok: false, baseUrl, error: `Nothing answered at ${host}. Is the server running, and is the address right?` };
  }
  if (status === 401 || status === 403) {
    return {
      ok: false,
      baseUrl,
      needsKey: true,
      error: apiKey ? `${host} turned the key down. Check it was copied whole.` : `${host} wants an API key.`,
    };
  }
  if (status < 200 || status >= 300) {
    return { ok: false, baseUrl, error: `${host} answered ${status} when asked for its models.` };
  }
  const models = readModelList(body);
  if (!models.length) {
    return { ok: false, baseUrl, error: `${host} lists no chat models. Load one, then look again.` };
  }
  return { ok: true, baseUrl, models, recommended: recommendedModel(models, preferred) };
}
