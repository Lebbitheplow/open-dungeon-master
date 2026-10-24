import { getGlobalConfig } from "@/lib/db/app-settings";
import {
  BackendRefusal,
  describeTransportFailure,
  fetchBackend,
  forEachStreamLine,
  MAX_BACKEND_BODY_BYTES,
  MAX_BACKEND_ERROR_BYTES,
  readBody,
} from "@/lib/backend-fetch";
import {
  describeEndpoint,
  endpointKind,
  profileById,
  resolveSampling,
  toolRouteFromError,
  toolsUnsupportedByServer,
  unsupportedParamFromError,
  type OpenAiToolRoute,
} from "@/lib/dm/sampling-logic";
import {
  customResponsesEndpoint,
  readResponsesReply,
  responsesPayload,
} from "@/lib/openai-responses";
import {
  buildPropsUrl,
  contextCacheKey,
  normalizeBaseUrl,
  OPENAI_CONTEXT_TOKENS,
  paramsFromModelName,
  readContextWindow,
  readReasoningKnob,
  readModelParams,
} from "@/lib/dm/context-probe-logic";
import { serverEnv } from "@/lib/server-env";
import { isPrivateBackendHost } from "@/lib/backend-host";
import { chatTimings, chatUsage, ollamaUsage, type TokenUsage } from "@/lib/usage/parse";
import { apiSpeedEligibility } from "@/lib/speed-tier";
import { noteSpeed } from "@/lib/speed-status";
import { DEFAULT_LOCAL_CONTEXT_TOKENS, knownLocalContextWindow, knownLocalModelParams } from "@/lib/text-models";
import { SMALL_MODEL_PARAMS } from "@/lib/dm/model-tuning-logic";
import { catalogContextWindow, hostedCatalogModel, hostedContextWindow } from "@/lib/model-registry/catalog";
import { ollamaModelInfo, soleListedModel, soleModelListing } from "@/lib/model-registry/discovery";
import { harnessConfig, harnessContextTokens } from "@/lib/harness/status";
import { DEFAULT_WINDOW } from "@/lib/story-window";
import { currentJobSignal, jobStopReason, noteJobProgress, withJobStage } from "@/lib/dm/job-control";
import { MODEL_STAGE_GRACE_MS } from "@/lib/dm/job-stage-logic";
import { rolesMustAlternate, withAlternatingRoles } from "@/lib/chat-roles-logic";
import {
  createStreamRepetitionGuard,
  cutRepetition,
  firstCopyOf,
  streamRepetitionResponse,
} from "@/lib/stream-repetition";

// Shared chat-completion client for both providers:
// - custom: any OpenAI-compatible /chat/completions (llama.cpp, LM Studio,
//   vLLM, OpenRouter, remote Ollama), streaming SSE
// - local: Ollama /api/chat, streaming NDJSON
// Used by the solo narrator (/api/story) and the campaign DM loop.

const DEFAULT_MAX_OUTPUT_TOKENS = 16_384;
const MAX_CONFIGURABLE_OUTPUT_TOKENS = 65_536;
const DEFAULT_LOCAL_MAX_OUTPUT_TOKENS = 4_096;
const DEFAULT_CUSTOM_TEXT_TIMEOUT_MS = 3 * 60 * 1000;
const DEFAULT_LOCAL_TEXT_TIMEOUT_MS = 6 * 60 * 1000;
const MIN_TEXT_TIMEOUT_MS = 30 * 1000;
const MAX_TEXT_TIMEOUT_MS = 30 * 60 * 1000;
const SMALL_MODEL_LOCAL_CONTEXT_TOKENS = 32_768;

export type TextContentPart = {
  type: "text";
  text: string;
};

export type ImageContentPart = {
  type: "image_url";
  image_url: {
    url: string;
  };
};

export type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | Array<TextContentPart | ImageContentPart>;
  tool_calls?: unknown;
  tool_call_id?: string;
  // A provider's own continuation items that rode with this assistant turn
  // (the Responses API's encrypted reasoning, src/lib/openai-responses.ts):
  // replayed to that transport on the next step of the same DM turn, never
  // shown, never sent to any other backend.
  provider_items?: unknown[];
};

export type StreamDeltaHandler = (text: string) => void;

export type StreamedToolCall = {
  id?: string;
  type?: "function";
  function: { name: string; arguments: string };
};

export type UpstreamChatMessage = {
  content?: unknown;
  tool_calls?: unknown;
  // See ChatMessage.provider_items.
  provider_items?: unknown[];
};

export type UpstreamResult = {
  message?: UpstreamChatMessage;
  error?: Response;
  // The backend's finish_reason for the first choice, when it sent one:
  // "stop", "tool_calls", or "length" for a reply cut at the output cap.
  // Read by the DM turn loop to tell a model that ran out of room from one
  // that chose to say nothing (issue #120). "repetition" is this client's
  // own: a narration-only reply that began looping, cut after its first copy
  // (src/lib/stream-repetition.ts).
  finishReason?: string;
  // What the backend said the call cost, for the usage ledger
  // (src/lib/usage/ledger.ts); absent when it said nothing.
  usage?: UpstreamUsage;
};

export type UpstreamUsage = TokenUsage & {
  model: string;
  backend: "local" | "custom" | "openai" | "openrouter" | "harness";
  // Sent with a key.
  keyed: boolean;
  // Sent with a key to a public host: the host pays per call
  // (src/lib/shared-host.ts isPrivateBackendHost says which hosts are local).
  paid: boolean;
};

export type ChatRequestOptions = {
  tools?: readonly unknown[];
  toolChoice?: "auto" | "none";
  temperature?: number;
  onDelta?: StreamDeltaHandler;
  timeoutMs?: number;
  // Ask the backend for reasoning/thinking mode on this call. Qwen-family
  // models are unreliable tool callers without it under long prompts
  // (measured ~1/5 request_roll without vs ~4/5 with on qwen3.6-35b);
  // llama.cpp and vLLM honor chat_template_kwargs, and OpenRouter ignores
  // the unknown field. OpenAI answers 400 for it, so describeEndpoint keeps
  // it off that backend entirely. Reasoning deltas never reach onDelta: the
  // stream parser forwards only delta.content, and reads the reasoning only
  // to stop a loop in it. `false` is sent too, not left to the server:
  // Qwen's and Gemma's chat templates reason by default, so a call that
  // wants none (the final narration) would think anyway. Left unset, it is
  // off as well, as on Ollama: a stock llama-server running Qwen3.5 9B spent
  // the whole 4,096-token reply of the campaign's setup call thinking and
  // wrote no JSON.
  thinking?: boolean;
  // A helper call that wants as little thinking as the model allows. A model
  // whose template reads reasoning_effort and has no thinking switch
  // (gpt-oss) is sent "low": `thinking: false` alone reaches it as
  // enable_thinking, which it ignores, and the claims reader on gpt-oss-20b
  // wrote up to 4,011 tokens (52 seconds) to answer a short form while the
  // table waited (2026-10-23). Never set on a turn's calls: the effort is
  // written into the prompt's first message, so changing it between the
  // calls of one turn would make the server read the whole prompt again.
  reasoningEffort?: "low";
  // The most reasoning this call may stream, in characters, before it is cut
  // and the same call asked again without thinking. Unset, no limit: the
  // server's own budget (llama-server --reasoning-budget) applies. Ollama has
  // none, and Qwen3.5 9B there thought 18,700 characters to the reply cap
  // and wrote nothing.
  reasoningBudgetChars?: number;
  // The most this call's reply may run to: what the window leaves after the
  // prompt (src/lib/dm/request-fit.ts), or what the task needs. The backend's
  // own cap still applies when it is smaller. Unset keeps that cap alone.
  maxOutputTokens?: number;
  // What the call is for and where it sits, for the usage record
  // (src/lib/usage/model-calls.ts): "turn", "claims", "compaction"... Never
  // sent to the backend.
  meta?: { task?: string; turnId?: string; callIndex?: number };
  // Body fields a previous attempt was rejected for, omitted on the retry.
  // Set only by requestCustomMessage's own unsupported-parameter path; no
  // caller outside this module should populate it.
  dropParams?: readonly string[];
  // The tool routes this call has already been refused on, so two refusals
  // that each name the other route cannot send it back and forth. Set only
  // by requestCustomMessage's own route switch, like dropParams.
  refusedRoutes?: readonly OpenAiToolRoute[];
  // Set on the one retry of a reply the backend's own parser threw away
  // (UNPARSED_REPLY), so a second refusal is the answer. Set only by
  // requestCustomMessage, like dropParams.
  unparsedRetried?: boolean;
  // Which of the server's two models this call is for: the admin's Fast
  // setting is per role (issue 255). Unset reads as the story model.
  role?: "story" | "utility";
  // Only read by the "harness" provider (src/lib/harness/bridge.ts). An agent
  // program reads its tool list once, when it starts, so the DM loop hands
  // over every tool the turn could offer; the bridge still refuses a call
  // that is not offered at that moment.
  harness?: {
    campaignId?: string;
    catalogue?: readonly unknown[];
    turn?: boolean;
  };
};

// The reply cap a request to this hosted model goes out with: the
// configured cap, or the model's own when the catalog says it writes less
// (issue #383). A strict API refuses a max_tokens above the model's limit.
// A server on this machine or the LAN caps its own replies to its window.
export function maxOutputTokensFor(baseUrl: string, model: string): number {
  const configured = configuredMaxOutputTokens();
  const own = hostedCatalogModel(baseUrl, model)?.outputTokens ?? 0;
  return own > 0 && own < configured ? own : configured;
}

// The cap a call goes out with: the backend's, or the call's own when that
// is smaller (what the window leaves, or what the task needs).
function callOutputCap(backendCap: number, options: ChatRequestOptions): number {
  const asked = options.maxOutputTokens;
  return typeof asked === "number" && Number.isFinite(asked) && asked > 0 ? Math.max(16, Math.min(backendCap, Math.floor(asked))) : backendCap;
}

export function configuredMaxOutputTokens() {
  const raw = serverEnv("OPENROUTER_MAX_TOKENS");
  const parsed = Number.parseInt(raw, 10);

  if (!Number.isFinite(parsed)) {
    return DEFAULT_MAX_OUTPUT_TOKENS;
  }

  return Math.max(512, Math.min(parsed, MAX_CONFIGURABLE_OUTPUT_TOKENS));
}

export function localMaxOutputTokens() {
  const parsed = Number.parseInt(serverEnv("LOCAL_TEXT_MAX_TOKENS"), 10);

  if (!Number.isFinite(parsed)) {
    return DEFAULT_LOCAL_MAX_OUTPUT_TOKENS;
  }

  return Math.max(256, Math.min(parsed, MAX_CONFIGURABLE_OUTPUT_TOKENS));
}

// The window Ollama is asked for (num_ctx): the model's own, capped at the
// 64K the docs run llama-server with (story-window.ts DEFAULT_WINDOW), which
// plays the full tool set. Ollama reserves the cache for the whole window
// when it loads the model, used or not: gpt-oss-20b's native 128K is about
// 3 GB of cache on top of the model, more than a 16 GB card has to spare.
// The model's own window comes from the documented table, then what Ollama
// said of the model, then the catalog's row for the same weights, then the
// 128K most current models share. A small model (model-tuning-logic.ts
// SMALL_MODEL_PARAMS) plays on the short rules, whose prompts stay near 20K,
// so it asks for 32K: Qwen3.5 9B's native 262K is a cache of about 8.6 GB,
// which pushed most of the model off a 4 GB card. LOCAL_TEXT_CONTEXT, when
// set, decides instead, up to the model's own window.
export function localContextTokens(model: string) {
  const native = knownLocalContextWindow(model) ?? catalogContextWindow(model) ?? DEFAULT_LOCAL_CONTEXT_TOKENS;
  const raw = serverEnv("LOCAL_TEXT_CONTEXT");
  const parsed = Number.parseInt(raw, 10);

  if (!Number.isFinite(parsed)) {
    const params = knownLocalModelParams(model) ?? paramsFromModelName(model);
    if (params && params < SMALL_MODEL_PARAMS) {
      return Math.min(native, SMALL_MODEL_LOCAL_CONTEXT_TOKENS);
    }
    return Math.min(native, DEFAULT_WINDOW);
  }

  return Math.max(2_048, Math.min(parsed, native));
}

// Conservative stand-in for an OpenAI-compatible endpoint whose window we
// cannot know. llama.cpp, LM Studio, vLLM and OpenRouter all report it
// differently or not at all, and overshooting means the server silently
// truncates the prompt, which is far worse than packing less. Operators who
// know their endpoint can raise it with OPENAI_COMPAT_CONTEXT.
export const DEFAULT_CUSTOM_CONTEXT_TOKENS = 16_384;

// The context window the DM prompt is being built against, resolved the same
// way requestDmMessage routes the call (src/lib/dm/model.ts). Local models
// have a known native window; custom endpoints do not, so they fall back to
// the documented default unless the operator says otherwise.
export function storyContextTokens(settings: {
  textProvider: string;
  localTextModel: string;
  customBaseUrl?: string;
  customModel?: string;
}): number {
  if (settings.textProvider === "local") {
    return localContextTokens(settings.localTextModel);
  }
  // An agent program's model has a large window, but the table packs against
  // 128K for the same reason OpenAI does (src/lib/harness/status.ts).
  if (settings.textProvider === "harness") {
    return harnessContextTokens();
  }
  // An explicit setting always wins: the operator knows their deployment
  // better than a probe does.
  const raw = Number.parseInt(serverEnv("OPENAI_COMPAT_CONTEXT"), 10);
  if (Number.isFinite(raw) && raw > 0) {
    return Math.max(2_048, raw);
  }
  // OpenAI has nothing to probe, so its window comes from the catalog's
  // row, capped at the shared floor (src/lib/dm/context-probe-logic.ts): the
  // retired small-window models keep their real size, a model the catalog
  // has never heard of packs against the floor. A blank campaign model
  // resolves the way requestCustomMessage resolves it.
  if (endpointKind(settings.customBaseUrl ?? "") === "openai") {
    return openAiWindow(
      settings.customBaseUrl ?? "",
      (settings.customModel ?? "").trim() || getGlobalConfig().text.customModel || serverEnv("OPENAI_COMPAT_MODEL"),
    );
  }
  const probed = probedContextWindows.get(
    contextCacheKey(settings.customBaseUrl ?? "", settings.customModel ?? ""),
  )?.window;
  if (probed) {
    return Math.max(2_048, probed);
  }
  // A hosted provider (OpenRouter, DeepSeek, Groq and the rest) answers no
  // /props, but the catalog knows its models' windows. Capped where OpenAI
  // is, and for the same reason: the prompt is billed by the token.
  const hosted = hostedContextWindow(settings.customBaseUrl ?? "", settings.customModel ?? "");
  return hosted ? Math.min(Math.max(2_048, hosted), OPENAI_CONTEXT_TOKENS) : DEFAULT_CUSTOM_CONTEXT_TOKENS;
}

// Whether the story window above is only the conservative stand-in: a custom
// endpoint nobody configured, that answered no probe and that the catalog
// does not know. The request fitter treats such a window as advice, not a
// wall (src/lib/dm/model.ts): the real server may well have more room, and
// a turn it would have answered is never refused on a guess.
export function storyWindowAssumed(settings: {
  textProvider: string;
  customBaseUrl?: string;
  customModel?: string;
}): boolean {
  if (settings.textProvider === "local" || settings.textProvider === "harness") {
    return false;
  }
  if (Number.parseInt(serverEnv("OPENAI_COMPAT_CONTEXT"), 10) > 0 || endpointKind(settings.customBaseUrl ?? "") === "openai") {
    return false;
  }
  if (probedContextWindows.get(contextCacheKey(settings.customBaseUrl ?? "", settings.customModel ?? ""))?.window) {
    return false;
  }
  return !hostedContextWindow(settings.customBaseUrl ?? "", settings.customModel ?? "");
}

// Where a table's utility model on an OpenAI-compatible server is reached:
// its own address, or with none typed the storyteller's server and key, so
// a helper model on the same llama.cpp server needs only its name.
export function utilityEndpoint(settings: {
  customBaseUrl?: string;
  customApiKey?: string;
  utilityBaseUrl: string;
  utilityApiKey: string;
}): { baseUrl: string; apiKey: string } {
  const own = settings.utilityBaseUrl.trim();
  return own
    ? { baseUrl: own, apiKey: settings.utilityApiKey }
    : { baseUrl: (settings.customBaseUrl ?? "").trim(), apiKey: settings.customApiKey ?? "" };
}

// The same for a table's own utility model on a custom endpoint.
export function utilityWindowAssumed(settings: { utilityProvider: string; utilityModel: string; utilityBaseUrl: string; customBaseUrl?: string }): boolean {
  const { baseUrl } = utilityEndpoint({ ...settings, utilityApiKey: "" });
  if (settings.utilityProvider === "local" || endpointKind(baseUrl) === "openai") {
    return false;
  }
  return !probedContextWindows.get(contextCacheKey(baseUrl, settings.utilityModel.trim()))?.window;
}

function openAiWindow(baseUrl: string, model: string): number {
  const known = hostedContextWindow(baseUrl, model);
  return known ? Math.min(Math.max(2_048, known), OPENAI_CONTEXT_TOKENS) : OPENAI_CONTEXT_TOKENS;
}

// Windows learned from an endpoint's own /props (or from its refusal of a
// request too big for it), keyed by base URL and model. A window is kept for
// a while, not for the life of the process: llama-server can be restarted
// with another -c while ODM runs on, and a probe that failed at startup
// (the server still loading) must not leave the default in place until ODM
// restarts. A miss is retried sooner than a hit, and probes of one endpoint
// that overlap share one request.
type ProbedWindow = { window: number; at: number };
const PROBE_HIT_TTL_MS = 30 * 60_000;
const PROBE_MISS_TTL_MS = 2 * 60_000;
const probedContextWindows = new Map<string, ProbedWindow>();
const probesInFlight = new Map<string, Promise<number | null>>();

// A refusal that named the server's real window teaches it; one that did
// not forgets what was known, so the next turn probes again.
export function learnContextWindow(baseUrl: string, model: string, window: number | null): void {
  const key = contextCacheKey(baseUrl, model);
  if (window && window > 0) {
    probedContextWindows.set(key, { window: Math.floor(window), at: Date.now() });
  } else {
    probedContextWindows.delete(key);
  }
}

// Every window learned so far is dropped; the admin's text settings changed.
export function forgetContextWindows(): void {
  probedContextWindows.clear();
  reasoningKnobs.clear();
}

// What a backend's refusal says of its window, when the request was too big
// for it: llama-server names n_ctx, vLLM and OpenAI the maximum context
// length. Null when the refusal was about something else; 0 when it was
// about the window but named no size.
export function contextOverflowWindow(text: string): number | null {
  if (!/exceed(?:s|ed)? the available context|context[_ ]length[_ ]exceeded|maximum context length|context window|exceed_context_size|too many tokens|prompt is too long/i.test(text)) {
    return null;
  }
  const named =
    /"n_ctx"\s*:\s*(\d+)/.exec(text) ??
    /maximum context length is (\d+)/i.exec(text) ??
    /context (?:window|length) of (\d+)/i.exec(text);
  return named ? Number.parseInt(named[1], 10) : 0;
}

// How each probed model's template is told to think less (readReasoningKnob),
// keyed like the windows above.
const reasoningKnobs = new Map<string, "effort" | "switch" | null>();

// What a backend taught us about a model, keyed like the windows above and
// kept for the process: the route its tools run on when its 400 named one
// (issue #129), and the body fields it refused, so the next call omits them
// instead of paying the 400 again.
const learnedToolRoutes = new Map<string, OpenAiToolRoute>();
const rememberedDrops = new Map<string, Set<string>>();
// Models whose chat template refused two user messages in a row
// (src/lib/chat-roles-logic.ts): sent with neighbours joined from then on.
const alternatingRoles = new Set<string>();

// llama.cpp and llama-swap expose the real n_ctx the server was launched with
// (its -c flag) on /props. Nothing else in the OpenAI-compatible ecosystem
// reports it, so a miss is completely ordinary and falls through quietly.
export async function probeCustomContextWindow(
  baseUrl: string,
  apiKey: string,
  model: string,
): Promise<number | null> {
  // A vendor API has no /props; asking would only post the table's key to a
  // path that answers 404.
  const url = endpointKind(baseUrl) === "local" ? buildPropsUrl(baseUrl, model) : "";
  if (!url) {
    return null;
  }
  // Keyed by base URL AND model: llama-server's --models-preset router serves
  // several models from one port, each launched with its own -c.
  const cacheKey = contextCacheKey(baseUrl, model);
  const cached = probedContextWindows.get(cacheKey);
  if (cached && Date.now() - cached.at < (cached.window ? PROBE_HIT_TTL_MS : PROBE_MISS_TTL_MS)) {
    return cached.window || null;
  }
  const running = probesInFlight.get(cacheKey);
  if (running) {
    return running;
  }
  // The key the chat call itself goes out with (resolveCustomKey): a table
  // on the server's own backend names no key of its own, and a keyed
  // llama-server refuses /props without one, so every such table was packed
  // against the 16K default on a 64K server.
  const trimmedBase = baseUrl.trim();
  const key = resolveCustomKey(trimmedBase, apiKey, customChatEndpoint(trimmedBase)).resolvedKey;
  const probe = (async () => {
    try {
      // Never redirected (the URL is a campaign's; see fetchBackend), and
      // read under a ceiling: the window is one number in a small object.
      const response = await fetch(url, {
        headers: key ? { Authorization: `Bearer ${key}` } : undefined,
        signal: AbortSignal.timeout(2_000),
        redirect: "error",
      });
      if (!response.ok) {
        probedContextWindows.set(cacheKey, { window: cached?.window ?? 0, at: Date.now() });
        return cached?.window || null;
      }
      const body = await readBody(response, MAX_BACKEND_ERROR_BYTES);
      const props = body.complete ? JSON.parse(body.text) : null;
      const window = readContextWindow(props) ?? 0;
      probedContextWindows.set(cacheKey, { window, at: Date.now() });
      reasoningKnobs.set(cacheKey, readReasoningKnob(props));
      return window || null;
    } catch {
      // Unreachable, not llama.cpp, or too slow. The miss is remembered for
      // a short while so a turn does not pay the timeout again; a window
      // learned before stays until a probe says otherwise.
      probedContextWindows.set(cacheKey, { window: cached?.window ?? 0, at: Date.now() });
      return cached?.window || null;
    } finally {
      probesInFlight.delete(cacheKey);
    }
  })();
  probesInFlight.set(cacheKey, probe);
  return probe;
}

// How many parameters the model behind a custom endpoint has, from its
// /v1/models listing (llama-server's meta.n_params), kept like the windows
// above: a hit for half an hour, a miss for two minutes. Only a server on
// this machine or the LAN is asked; a vendor API lists no sizes.
const probedModelParams = new Map<string, { params: number; at: number }>();

export async function probeCustomModelParams(baseUrl: string, apiKey: string, model: string): Promise<number | null> {
  const base = normalizeBaseUrl(baseUrl);
  if (!base || endpointKind(baseUrl) !== "local") {
    return null;
  }
  const cacheKey = contextCacheKey(baseUrl, model);
  const cached = probedModelParams.get(cacheKey);
  if (cached && Date.now() - cached.at < (cached.params ? PROBE_HIT_TTL_MS : PROBE_MISS_TTL_MS)) {
    return cached.params || null;
  }
  const key = resolveCustomKey(baseUrl.trim(), apiKey, customChatEndpoint(baseUrl.trim())).resolvedKey;
  let params = 0;
  try {
    const response = await fetch(`${base}/v1/models`, {
      headers: key ? { Authorization: `Bearer ${key}` } : undefined,
      signal: AbortSignal.timeout(2_000),
      redirect: "error",
    });
    if (response.ok) {
      const body = await readBody(response, MAX_BACKEND_ERROR_BYTES);
      params = (body.complete ? readModelParams(JSON.parse(body.text), model) : null) ?? 0;
    }
  } catch {
    // Unreachable or not llama.cpp: the model's name may still say.
  }
  probedModelParams.set(cacheKey, { params, at: Date.now() });
  return params || null;
}

// The story model's size where anything says it: what the server reported
// (Ollama's /api/show, llama-server's /v1/models), else the figure its name
// states. A small model is small wherever it runs, so a hosted one is sized
// by its name too. Null for an agent program or a name with no size.
export function storyModelParams(settings: {
  textProvider: string;
  localTextModel: string;
  customBaseUrl?: string;
  customModel?: string;
}): number | null {
  if (settings.textProvider === "harness") {
    return null;
  }
  if (settings.textProvider === "local") {
    return knownLocalModelParams(settings.localTextModel) ?? paramsFromModelName(settings.localTextModel);
  }
  const model = (settings.customModel ?? "").trim() || getGlobalConfig().text.customModel || serverEnv("OPENAI_COMPAT_MODEL");
  return probedModelParams.get(contextCacheKey(settings.customBaseUrl ?? "", settings.customModel ?? ""))?.params || paramsFromModelName(model);
}

// The context window of the model a utility call (Ask, the lore check) runs
// on, resolved the way requestUtilityMessage (src/lib/dm/model.ts) routes it.
// A local or custom utility model that fails is retried on the story model
// with the same messages, so those two routes answer the smaller of the two
// windows: what is sized for the utility model must still fit the story
// model it may land on. A custom endpoint is probed once, as the turn probes
// the story endpoint (src/lib/dm/context-retrieval.ts).
export async function utilityContextTokens(settings: {
  textProvider: string;
  localTextModel: string;
  customBaseUrl?: string;
  customModel?: string;
  utilityProvider: string;
  utilityModel: string;
  utilityBaseUrl: string;
  utilityApiKey: string;
}): Promise<number> {
  const model = settings.utilityModel.trim();
  if (settings.utilityProvider === "harness" || (settings.textProvider === "harness" && !model)) {
    const config = harnessConfig();
    return harnessContextTokens({ ...config, model: config.utilityModel || config.model });
  }
  const story = storyContextTokens(settings);
  if (!model) {
    return story;
  }
  return Math.min(await utilityModelContextTokens(settings), story);
}

// The utility model's own window, for a table that names one: what a call
// on it is fitted to before any fallback (src/lib/dm/model.ts), where
// utilityContextTokens above answers the smaller of it and the story's.
export async function utilityModelContextTokens(settings: {
  utilityProvider: string;
  utilityModel: string;
  utilityBaseUrl: string;
  utilityApiKey: string;
  customBaseUrl?: string;
  customApiKey?: string;
}): Promise<number> {
  const model = settings.utilityModel.trim();
  if (settings.utilityProvider === "local") {
    return localContextTokens(model);
  }
  const { baseUrl, apiKey } = utilityEndpoint(settings);
  if (endpointKind(baseUrl) === "openai") {
    return openAiWindow(baseUrl, model);
  }
  const probed = await probeCustomContextWindow(baseUrl, apiKey, model);
  return probed ? Math.max(2_048, probed) : DEFAULT_CUSTOM_CONTEXT_TOKENS;
}

export function resolveTextTimeoutMs(
  explicit: number | undefined,
  envKey: string,
  fallback: number,
) {
  const raw = explicit ?? Number.parseInt(serverEnv(envKey), 10);

  if (!Number.isFinite(raw)) {
    return fallback;
  }

  return Math.max(MIN_TEXT_TIMEOUT_MS, Math.min(raw, MAX_TEXT_TIMEOUT_MS));
}

// Story-arc generation and chapter summaries digest the whole story so far
// with no streaming, so the entire reply must land inside one timeout.
export function arcTextTimeoutMs() {
  return resolveTextTimeoutMs(undefined, "ARC_TEXT_TIMEOUT_MS", 8 * 60 * 1000);
}

function formatTimeout(ms: number) {
  const seconds = Math.round(ms / 1000);
  if (seconds >= 60) {
    const minutes = Math.round(seconds / 60);
    return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
  }

  return `${seconds} seconds`;
}

function createRequestTimeout(ms: number) {
  const controller = new AbortController();
  let timedOut = false;
  const abortNow = () => {
    timedOut = true;
    controller.abort();
  };
  const timeoutId = setTimeout(abortNow, ms);
  // The DM job this call runs in may be stopped (the lead's Stop, a rewind,
  // the queue's watchdog: src/lib/dm/job-control.ts). The request goes with
  // it, headers or stream, and says so rather than blaming the backend.
  const job = currentJobSignal();
  if (job?.aborted) {
    controller.abort();
  } else {
    job?.addEventListener("abort", () => controller.abort(), { once: true });
  }

  return {
    signal: controller.signal,
    clear: () => clearTimeout(timeoutId),
    timedOut: () => timedOut,
    stopped: () => job?.aborted === true && !timedOut,
    abortNow,
    cancel: () => controller.abort(),
  };
}

// A call cut short because its DM job was stopped, in the stop's own words.
function stoppedResult(): UpstreamResult {
  return {
    error: Response.json({ error: jobStopReason() ?? "the turn was stopped.", code: "stopped" }, { status: 499 }),
  };
}

// Thrown from inside a stream reader to stop a reply that began repeating.
// firstCopy is the reply up to the end of the loop's first copy, or null
// when there is no reply to keep: a loop in the reasoning channel, or one
// whose first copy ends inside reasoning the server left in the reply.
class StreamRepetitionError extends Error {
  readonly firstCopy: string | null;

  constructor(firstCopy: string | null) {
    super("The model began repeating itself.");
    this.firstCopy = firstCopy;
  }
}

// A call that may only narrate (toolChoice "none": the turn's forced last
// call, its tools-closed rescue, a continue, a reroll) loses nothing a table
// needs when its reply is cut after the loop's first copy, so that copy is
// the reply. A call that could still choose tools fails instead: its prose
// without the calls the stream never finished would narrate outcomes nothing
// resolved.
function narratesOnly(options: ChatRequestOptions) {
  return options.toolChoice === "none";
}

function repeatedStreamResult(error: StreamRepetitionError, options: ChatRequestOptions): UpstreamResult {
  if (error.firstCopy !== null && narratesOnly(options)) {
    console.warn("[model] the narration began repeating one passage; its first copy is the reply");
    return { message: { content: error.firstCopy }, finishReason: "repetition" };
  }
  return { error: streamRepetitionResponse() };
}

function guardStreamDelta(onDelta: StreamDeltaHandler | undefined, cancel: () => void) {
  if (!onDelta) return undefined;
  const guard = createStreamRepetitionGuard();
  let streamed = "";
  return (text: string) => {
    streamed += text;
    if (guard.push(text)) {
      cancel();
      throw new StreamRepetitionError(firstCopyOf(streamed, guard.firstCopyEnd));
    }
    onDelta(text);
  };
}

// Reasoning past the call's budget (ChatRequestOptions.reasoningBudgetChars).
class ReasoningBudgetError extends Error {
  constructor() {
    super("The model's reasoning ran past its budget.");
  }
}

// The reasoning channel loops too, and on a server with no reasoning budget
// it runs to the output cap before any story text. Read only for that, and
// for the call's own budget; it never reaches the table.
function guardReasoningDelta(streaming: boolean, cancel: () => void, budgetChars?: number) {
  if (!streaming) return undefined;
  const guard = createStreamRepetitionGuard();
  let length = 0;
  return (text: string) => {
    length += text.length;
    if (budgetChars && length > budgetChars) {
      cancel();
      throw new ReasoningBudgetError();
    }
    if (guard.push(text)) {
      cancel();
      throw new StreamRepetitionError(null);
    }
  };
}

// llama-server's own parser refusing what the model wrote (common/chat.cpp:
// "The model produced output that does not match the expected peg-native
// format"), inside a stream that answered 200 or as a 500. The whole reply is
// thrown away. gpt-oss-20b does it when the server's reasoning budget forces
// the end of its thought (--reasoning-budget, which the app's preset sets) and
// it writes on without opening its answer: 4 of 734 calls on the BC-250 and 2
// of about 80 fight turns, each a halted turn (2026-10-20). llama.cpp b10621,
// the build the app pins, b11721 and master all parse it so. A fresh reply is
// almost always whole, so the call is asked once more.
const UNPARSED_REPLY = /model produced output that does not match the expected/i;

function unparsedRetry(options: ChatRequestOptions): ChatRequestOptions {
  console.warn("[model] the backend could not parse the model's reply and threw it away; the call is asked again");
  return { ...options, unparsedRetried: true };
}

// The same call asked again without thinking, once its reasoning ran past
// the budget: an answer decided at once beats none after minutes.
function withoutThinking(options: ChatRequestOptions): ChatRequestOptions {
  console.warn("[model] the reasoning ran past its budget; the call is asked again without thinking");
  return { ...options, thinking: false, reasoningBudgetChars: undefined };
}

// A reply that arrived whole cannot be stopped early, but one that may only
// narrate is cut after a loop's first copy before a continue, a reroll, an
// expansion, the guard's rewrite or a recap keeps it. A loop inside reasoning
// the server left in the reply has no copy worth keeping and fails as a
// streamed one does.
function cutWholeReply(result: UpstreamResult, options: ChatRequestOptions): UpstreamResult {
  const content = result.message?.content;
  if (!narratesOnly(options) || typeof content !== "string") {
    return result;
  }
  const cut = cutRepetition(content);
  if (cut === undefined) {
    return result;
  }
  if (cut === null) {
    return { error: streamRepetitionResponse() };
  }
  console.warn("[model] the narration repeated one passage; its first copy is the reply");
  return { ...result, message: { ...result.message, content: cut }, finishReason: "repetition" };
}

type OllamaChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  images?: string[];
  tool_calls?: unknown;
};

// Ollama takes a call's arguments as an object and refuses a JSON string with
// a 400. The calls it returned itself are objects already; a call the turn
// salvaged from a reply's text (a small model writing its call as JSON:
// src/lib/dm/json-salvage.ts) is echoed in the OpenAI shape, a string, and
// sank the next request of the turn.
function ollamaToolCalls(calls: unknown): unknown {
  if (!Array.isArray(calls)) {
    return calls;
  }
  return calls.map((call) => {
    const fn = (call as { function?: { name?: unknown; arguments?: unknown } })?.function;
    if (!fn || typeof fn.arguments !== "string") {
      return call;
    }
    let args: unknown = {};
    try {
      args = JSON.parse(fn.arguments || "{}");
    } catch {
      // A model's malformed arguments: the call already failed on its own.
    }
    return { function: { name: fn.name, arguments: args && typeof args === "object" && !Array.isArray(args) ? args : {} } };
  });
}

function toOllamaMessages(messages: ChatMessage[]): OllamaChatMessage[] {
  return messages.map((message) => {
    if (typeof message.content === "string") {
      return {
        role: message.role,
        content: message.content,
        ...(message.tool_calls ? { tool_calls: ollamaToolCalls(message.tool_calls) } : {}),
      };
    }

    const textParts: string[] = [];
    const images: string[] = [];
    for (const part of message.content) {
      if (part.type === "text") {
        textParts.push(part.text);
        continue;
      }

      // Only data URLs reach this point; Ollama wants the bare base64 payload.
      const base64 = part.image_url.url.split(",")[1];
      if (base64) {
        images.push(base64);
      }
    }

    return {
      role: message.role,
      content: textParts.join("\n\n"),
      ...(images.length ? { images } : {}),
    };
  });
}

function hasImageParts(messages: ChatMessage[]) {
  return messages.some(
    (message) =>
      typeof message.content !== "string" &&
      message.content.some((part) => part.type === "image_url"),
  );
}

// Flatten multimodal messages to text-only for backends that can't take
// images (e.g. llama.cpp without an mmproj file). Portrait labels survive as
// text, so character continuity degrades gracefully instead of erroring.
function stripImageParts(messages: ChatMessage[]): ChatMessage[] {
  return messages.map((message) => {
    if (typeof message.content === "string") {
      return message;
    }

    return {
      ...message,
      content: message.content
        .filter((part): part is TextContentPart => part.type === "text")
        .map((part) => part.text)
        .join("\n\n"),
    };
  });
}

// Resolve a user-entered backend URL to its /chat/completions endpoint.
// Accepts a bare host (http://127.0.0.1:8080), a versioned base (.../v1), or
// the full endpoint, so people can paste whatever their server prints.
export function customChatEndpoint(baseUrl: string): string {
  const url = baseUrl.trim().replace(/\/+$/, "");
  if (/\/chat\/completions$/.test(url)) return url;
  if (/\/v\d+$/.test(url)) return `${url}/chat/completions`;
  return `${url}/v1/chat/completions`;
}

// Any OpenAI-compatible server: llama.cpp, LM Studio, vLLM, TabbyAPI,
// KoboldCpp, OpenRouter, a remote Ollama, etc. The model name and base URL are
// per-chat settings; the key is optional (most local servers need none). When
// the URL is OpenRouter we add its attribution headers and fall back to the
// OPENROUTER_* env vars; otherwise the fallback is OPENAI_COMPAT_API_KEY.
// Which key, if any, a request to this base URL goes out with. Per-campaign
// key wins, then the admin-panel key, then the env vars. Fallback keys
// belong to the admin-configured backend: attaching them to any other URL
// would hand the server's key to whatever host a campaign's settings point
// at. The OpenRouter env key is gated on the host being OpenRouter, and on
// https: a campaign's http://openrouter.ai would send it in clear text
// (OpenRouter itself only answers https, so nothing working is lost). The
// optional utility backend gets the same treatment: its key is host-gated
// to its own configured URL, so pointing a campaign elsewhere cannot borrow
// it.
function resolveCustomKey(
  trimmedBase: string,
  apiKey: string,
  endpoint: string,
): { isGlobalBackend: boolean; isUtilityBackend: boolean; resolvedKey: string } {
  const globalText = getGlobalConfig().text;
  const isOpenRouter = describeEndpoint(trimmedBase).kind === "openrouter";
  const chatEndpoint = customChatEndpoint(trimmedBase);
  const globalBase = (globalText.customBaseUrl || serverEnv("OPENAI_COMPAT_BASE_URL") || "").trim();
  const isGlobalBackend = Boolean(globalBase) && customChatEndpoint(globalBase) === chatEndpoint;
  const utilityBase = (globalText.utilityBaseUrl || serverEnv("UTILITY_TEXT_BASE_URL") || "").trim();
  const isUtilityBackend = Boolean(utilityBase) && customChatEndpoint(utilityBase) === chatEndpoint;
  const resolvedKey =
    (apiKey || "").trim() ||
    (isGlobalBackend ? globalText.customApiKey : "") ||
    (isUtilityBackend ? globalText.utilityApiKey : "") ||
    (isOpenRouter && /^https:\/\//i.test(endpoint) ? serverEnv("OPENROUTER_API_KEY") : "") ||
    (isGlobalBackend ? serverEnv("OPENAI_COMPAT_API_KEY") : "") ||
    (isUtilityBackend ? serverEnv("UTILITY_TEXT_API_KEY") : "");
  return { isGlobalBackend, isUtilityBackend, resolvedKey };
}

// The key a request to this address goes out with when none is typed, the
// way a turn's own call resolves it (above): the admin pages' probe and
// model listing use it too, so they never try one host's key on another and
// find the utility server's key set in the environment.
export function backendKeyFor(baseUrl: string, typedKey = ""): string {
  const trimmedBase = baseUrl.trim();
  return resolveCustomKey(trimmedBase, typedKey, customChatEndpoint(trimmedBase)).resolvedKey;
}

// Whether a request to this backend would carry a key to a public host:
// the shared-host policy (src/lib/shared-host.ts) reads it before the call.
// A keyed server on this machine or the LAN is the host's own; a keyed
// public one bills the host per call.
export function customBackendIsPaid(baseUrl: string, apiKey: string): boolean {
  const trimmedBase = (baseUrl || "").trim();
  if (!trimmedBase || isPrivateBackendHost(trimmedBase)) {
    return false;
  }
  return resolveCustomKey(trimmedBase, apiKey, customChatEndpoint(trimmedBase)).resolvedKey !== "";
}

// Every model call says it is waiting on the model while it runs, with a
// deadline past its own timeout, so the DM queue's watchdog shows the stage
// and never stops a call its own timeout would still answer.
export function requestCustomMessage(
  baseUrl: string,
  model: string,
  apiKey: string,
  messages: ChatMessage[],
  options: ChatRequestOptions = {},
): Promise<UpstreamResult> {
  const timeoutMs = resolveTextTimeoutMs(options.timeoutMs, "CUSTOM_TEXT_TIMEOUT_MS", DEFAULT_CUSTOM_TEXT_TIMEOUT_MS);
  return withJobStage("waiting_model", timeoutMs + MODEL_STAGE_GRACE_MS, () =>
    requestCustomMessageNow(baseUrl, model, apiKey, messages, options),
  );
}

async function requestCustomMessageNow(
  baseUrl: string,
  model: string,
  apiKey: string,
  messages: ChatMessage[],
  options: ChatRequestOptions = {},
): Promise<UpstreamResult> {
  const { tools, toolChoice, temperature, onDelta } = options;
  const trimmedBase = (baseUrl || "").trim();

  if (!trimmedBase) {
    // A blank base URL under a server-wide "none" provider is not a
    // misconfiguration to debug; it is the admin's recorded answer, so the
    // table gets a plain statement instead of a hint about backend URLs.
    const configuredProvider =
      getGlobalConfig().text.provider || serverEnv("DEFAULT_TEXT_PROVIDER");
    if (configuredProvider === "none") {
      return {
        error: Response.json(
          { error: "This world has no AI storyteller configured." },
          { status: 400 },
        ),
      };
    }

    return {
      error: Response.json(
        {
          error:
            "No backend URL set. An admin sets the server's in the admin panel's text model settings (for example http://127.0.0.1:8080/v1).",
        },
        { status: 400 },
      ),
    };
  }

  const globalText = getGlobalConfig().text;
  const globalSampling = getGlobalConfig().sampling;
  // What this backend accepts in the body. "local" reproduces the behaviour
  // every self-hosted server already had, so the default llama-server install
  // receives the same payload it always did.
  const caps = describeEndpoint(trimmedBase);
  // Whole-host match from the parsed URL, never a substring of it: this flag
  // releases the server's OPENROUTER_API_KEY, and a campaign controls the
  // URL, so https://evil.test/.openrouter.ai must not read as OpenRouter.
  const isOpenRouter = caps.kind === "openrouter";
  // Nothing is named in code: a blank setting runs the one chat model the
  // server lists, when it lists exactly one (src/lib/model-registry).
  let resolvedModel =
    (model || "").trim() ||
    globalText.customModel ||
    serverEnv("OPENAI_COMPAT_MODEL") ||
    (isOpenRouter ? serverEnv("OPENROUTER_MODEL") : "");

  if (!resolvedModel) {
    const listing = await soleModelListing({ provider: "custom", baseUrl: trimmedBase, apiKey: resolveCustomKey(trimmedBase, apiKey, customChatEndpoint(trimmedBase)).resolvedKey });
    resolvedModel = listing.id;
    if (!resolvedModel) {
      // A server that never answered the listing is down or misaddressed;
      // only one that answered with several models needs a pick.
      return {
        error: listing.answered
          ? Response.json(
              {
                error:
                  "No model name set, and the server lists more than one. Pick the model in Text Model settings.",
              },
              { status: 400 },
            )
          : Response.json(
              {
                error: `Could not reach the backend at ${trimmedBase} to list its models. Check the URL and that your server is running.`,
              },
              { status: 502 },
            ),
      };
    }
  }

  // How this model runs its tools: Chat Completions until its first refusal
  // names another route (issue #129), then that route for the life of the
  // process. The Responses route is a different endpoint on the same base.
  const routeKey = contextCacheKey(trimmedBase, resolvedModel);
  const route: OpenAiToolRoute = learnedToolRoutes.get(routeKey) ?? "chat";
  const viaResponses = route === "responses";
  const dropped = new Set([
    ...(rememberedDrops.get(routeKey) ?? []),
    ...(options.dropParams ?? []),
  ]);
  const sentMessages = alternatingRoles.has(routeKey) ? withAlternatingRoles(messages) : messages;
  const chatEndpoint = customChatEndpoint(trimmedBase);
  const endpoint = viaResponses ? customResponsesEndpoint(trimmedBase) : chatEndpoint;
  const { isGlobalBackend, isUtilityBackend, resolvedKey } = resolveCustomKey(trimmedBase, apiKey, endpoint);
  // The Fast tier (issue 255): asked for only on the server's own backend
  // for this role (a campaign's own key is never spent at a premium on the
  // admin's word), on OpenAI's API, for any model: one without the tier
  // refuses the field, and the drop below runs it at standard speed.
  // Anywhere else nothing is sent, so a local or third-party server never
  // sees the field.
  const role = options.role ?? "story";
  const speedWanted =
    (role === "utility" ? globalText.utilitySpeed : globalText.speed) === "fast" &&
    (role === "utility" ? isUtilityBackend : isGlobalBackend) &&
    apiSpeedEligibility({ endpointKind: caps.kind, model: resolvedModel }).ok;
  // Thinking runs cooler per Qwen guidance; 0.9 there makes the thought
  // ramble past the point of ever emitting the tool call.
  // Per-role sampling, resolved from the admin config
  // (src/lib/dm/sampling-logic.ts). An explicit per-call temperature still
  // wins, and an unconfigured install resolves to exactly the previous
  // built-in defaults.
  const sampling = resolveSampling({
    role: isUtilityBackend ? "utility" : "story",
    configured: {
      ...(isUtilityBackend ? globalSampling.utility : globalSampling.story),
      ...(temperature !== undefined ? { temperature } : {}),
    },
    profile: profileById(globalSampling.profile || "default"),
    // Local servers ignore fields they do not know; OpenRouter and OpenAI
    // reject the local-only sampler fields (src/lib/dm/sampling-logic.ts).
    allowLocalOnly: caps.allowLocalOnlySamplers,
    thinking: options.thinking,
  });
  const requestPayload: Record<string, unknown> = viaResponses
    ? responsesPayload({
        model: resolvedModel,
        messages: sentMessages,
        sampling,
        maxOutputTokens: callOutputCap(maxOutputTokensFor(trimmedBase, resolvedModel), options),
        stream: Boolean(onDelta),
        tools,
        toolChoice,
      })
    : {
        model: resolvedModel,
        // A Responses turn's reasoning items are that API's own; Chat
        // Completions would refuse the unknown field.
        messages: sentMessages.map((message) => {
          if (!message.provider_items) return message;
          const rest = { ...message };
          delete rest.provider_items;
          return rest;
        }),
        ...sampling,
        // Explicit 0 so a server-side sampler preset cannot override it: a
        // positive presence penalty over the long DM prompt suppresses the
        // tool-call token sequence (measured 2/5 vs 4/5 request_roll rate on
        // llama-server with the qwen preset's 1.5). Deliberately NOT exposed as a
        // sampling option, and written after the spread so nothing can reinstate
        // it from config. Skipped on backends with no preset to override, where
        // 0 is already the default and reasoning models reject the field.
        ...(caps.sendZeroPresencePenalty ? { presence_penalty: 0 } : {}),
        ...(caps.allowTemplateKwargs ? { chat_template_kwargs: { enable_thinking: options.thinking === true } } : {}),
        // The last chunk of a stream carries the token counts only when
        // asked (OpenAI, llama-server, vLLM, LM Studio and OpenRouter all
        // honour it); a backend that rejects the field names it in its 400
        // and the retry drops it (DROPPABLE_PARAMS).
        ...(onDelta ? { stream: true, stream_options: { include_usage: true } } : {}),
      };

  if (!viaResponses) {
    // The output cap, under whichever name this backend takes. Dropping
    // max_tokens promotes the request to max_completion_tokens rather than
    // uncapping it, because that rename is why OpenAI's reasoning models
    // reject the older field.
    const maxTokensField =
      caps.maxTokensField === "max_completion_tokens" || dropped.has("max_tokens")
        ? "max_completion_tokens"
        : "max_tokens";
    if (!dropped.has(maxTokensField)) {
      requestPayload[maxTokensField] = callOutputCap(maxOutputTokensFor(trimmedBase, resolvedModel), options);
    }
    if (tools?.length) {
      requestPayload.tools = tools;
      requestPayload.tool_choice = toolChoice ?? "auto";
      // A model whose refusal asked for reasoning off: Chat Completions
      // cannot carry function tools alongside reasoning (issue #129). Off
      // this route the field is never sent: gpt-4.1 and the like 400 on it.
      if (route === "chat-no-reasoning") {
        requestPayload.reasoning_effort = "none";
      }
    }
    // A helper call on a template that thinks by effort, not by a switch
    // (readReasoningKnob): "low" is the least it does.
    if (
      options.reasoningEffort &&
      caps.allowTemplateKwargs &&
      requestPayload.reasoning_effort === undefined &&
      reasoningKnobs.get(routeKey) === "effort"
    ) {
      requestPayload.reasoning_effort = options.reasoningEffort;
    }
  }

  if (speedWanted) {
    requestPayload.service_tier = "fast";
  }
  for (const field of dropped) {
    delete requestPayload[field];
  }
  // A Fast request the provider refused (the drop below): said once, in
  // the panel, as the standard-speed call it became.
  if (speedWanted && dropped.has("service_tier")) {
    noteSpeed(role, { model: resolvedModel, refused: "The provider refused the Fast tier for this model or account; calls run at standard speed." });
  }

  const timeoutMs = resolveTextTimeoutMs(
    options.timeoutMs,
    "CUSTOM_TEXT_TIMEOUT_MS",
    DEFAULT_CUSTOM_TEXT_TIMEOUT_MS,
  );
  const requestTimeout = createRequestTimeout(timeoutMs);
  const guardedDelta = guardStreamDelta(onDelta, requestTimeout.cancel);
  const guardedReasoning = guardReasoningDelta(Boolean(onDelta), requestTimeout.cancel, options.reasoningBudgetChars);
  let upstream: Response;
  try {
    upstream = await fetchBackend(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(resolvedKey ? { Authorization: `Bearer ${resolvedKey}` } : {}),
        ...(isOpenRouter
          ? {
              "HTTP-Referer": serverEnv("OPENROUTER_APP_URL", "http://localhost:3000"),
              "X-Title": serverEnv("OPENROUTER_APP_TITLE", "Open Dungeon Master"),
            }
          : {}),
      },
      body: JSON.stringify(requestPayload),
      signal: requestTimeout.signal,
    });
  } catch (error) {
    if (error instanceof BackendRefusal) {
      return { error: Response.json({ error: error.message }, { status: 502 }) };
    }
    if (requestTimeout.stopped()) {
      return stoppedResult();
    }
    if (requestTimeout.timedOut()) {
      return {
        error: Response.json(
          {
            error: `${isOpenRouter ? "OpenRouter" : "Backend"} request timed out after ${formatTimeout(timeoutMs)}. The server may still be generating in the background; wait a moment, then retry or lower that backend's context/output settings.`,
          },
          { status: 504 },
        ),
      };
    }

    // Connection refused, DNS, TLS and a connect timeout all land here and
    // used to read alike; the reason tells a server that is down from a
    // wrong address or a certificate, and the code goes to the log.
    const failure = describeTransportFailure(error);
    return {
      error: Response.json(
        {
          error: `Could not reach the backend at ${endpoint}.${failure.reason ? ` ${failure.reason}` : ""} Check the URL and that your server is running.`,
          detail: `transport ${failure.code}`,
        },
        { status: 502 },
      ),
    };
  } finally {
    requestTimeout.clear();
  }

  if (!upstream.ok) {
    // Enough to recognise the error and quote its start; the rest unread.
    const { text } = await readBody(upstream, MAX_BACKEND_ERROR_BYTES);

    // Some servers can't accept image inputs at all (llama.cpp without an
    // mmproj, plain text models); retry the turn with text-only messages.
    if (hasImageParts(messages) && /image input|mmproj|image_url|vision/i.test(text)) {
      return requestCustomMessage(
        trimmedBase,
        resolvedModel,
        apiKey,
        stripImageParts(messages),
        options,
      );
    }

    // A chat template that takes user and assistant only in turn refused two
    // user messages in a row: the same call again with neighbours joined,
    // and every later call for this model joined from the start.
    if (!alternatingRoles.has(routeKey) && rolesMustAlternate(text)) {
      console.warn(`[model] ${endpoint}: ${resolvedModel}'s chat template takes user and assistant in turn; joining neighbouring messages`);
      alternatingRoles.add(routeKey);
      return requestCustomMessage(trimmedBase, resolvedModel, apiKey, messages, options);
    }

    // A request bigger than the server's window. The refusal often names
    // the real window (llama-server's n_ctx, vLLM's maximum context length),
    // which is kept for the next sizing; one that names none drops what was
    // known so the next turn probes again. Answered as the fitter's own
    // capacity refusal, so the caller can refit once and the table reads
    // what to change rather than a bare 400.
    const overflow = contextOverflowWindow(text);
    if (overflow !== null) {
      learnContextWindow(trimmedBase, model, overflow || null);
      return {
        error: Response.json(
          {
            error: `The request was larger than the model's context window${overflow ? ` (${overflow.toLocaleString("en-US")} tokens, as the backend reports)` : ""}.`,
            code: "context_capacity",
            learnedWindow: overflow || null,
            detail: text.slice(0, 300),
          },
          { status: 413 },
        ),
      };
    }

    // OpenAI's GPT-6 line refuses function tools on Chat Completions and
    // says what to do instead (issue #129): reasoning_effort "none", or the
    // Responses API. Take the route it names, remembered for the model, and
    // retry the same call there. Checked first because the retry without
    // tools at the bottom would otherwise match "Function tools ... not
    // supported" and hand the table a narrator with no request_roll and no
    // engines, in silence.
    // Never back to a route this call was already refused on: there are
    // three routes, so a backend whose refusals contradict each other costs
    // at most two switches, and the last refusal is the answer.
    const askedRoute = toolRouteFromError(text);
    const refusedRoutes = [...(options.refusedRoutes ?? []), route];
    if (tools?.length && askedRoute && askedRoute !== route && !refusedRoutes.includes(askedRoute)) {
      console.warn(
        `[model] ${endpoint} refused tools for ${resolvedModel}; switching to the "${askedRoute}" route`,
      );
      learnedToolRoutes.set(routeKey, askedRoute);
      return requestCustomMessage(trimmedBase, resolvedModel, apiKey, messages, { ...options, refusedRoutes });
    }

    // A strict backend rejected one named body field. Drop that field and
    // retry, so a model family ODM has never heard of still runs instead of
    // costing the table its turn. Checked BEFORE the tool retry below,
    // whose /not support/ arm would otherwise swallow "Unsupported
    // parameter: 'temperature' is not supported with this model" and strip
    // the tools instead of the temperature.
    //
    // Bounded three ways: only fields on the droppable list in
    // sampling-logic.ts, never the same field twice, and at most three drops
    // per request. Unreachable on a healthy local server, which answers 200.
    // The field stays dropped for this model for the life of the process,
    // so one 400 is paid once rather than on every turn.
    const offending = unsupportedParamFromError(text);
    if (offending && !dropped.has(offending) && dropped.size < 3) {
      console.warn(
        `[model] ${endpoint} rejected "${offending}"; retrying without it`,
      );
      const remembered = rememberedDrops.get(routeKey) ?? new Set<string>();
      remembered.add(offending);
      rememberedDrops.set(routeKey, remembered);
      return requestCustomMessage(trimmedBase, resolvedModel, apiKey, messages, {
        ...options,
        dropParams: [...dropped, offending],
      });
    }

    // Some servers don't implement function tools; retry without them.
    // Never on OpenAI, and never for a refusal that names reasoning or the
    // Responses API: those fail loudly below (src/lib/dm/sampling-logic.ts).
    if (tools?.length && toolsUnsupportedByServer(caps.kind, text)) {
      console.warn(`[model] ${endpoint} refused tools; retrying without them`);
      return requestCustomMessage(trimmedBase, resolvedModel, apiKey, messages, {
        ...options,
        tools: undefined,
        toolChoice: undefined,
      });
    }

    if (!options.unparsedRetried && UNPARSED_REPLY.test(text)) {
      return requestCustomMessageNow(baseUrl, model, apiKey, messages, unparsedRetry(options));
    }

    return {
      error: Response.json(
        {
          error: `${isOpenRouter ? "OpenRouter" : "Backend"} request failed (${upstream.status}).`,
          detail: text.slice(0, 300),
        },
        { status: upstream.status },
      ),
    };
  }

  // Transport trouble while reading the reply, worded the same on both
  // routes: a backend that refused its own reply, a stream that stalled, or
  // one that was cut.
  const readFailure = (error: unknown): UpstreamResult => {
    if (error instanceof BackendRefusal) {
      return { error: Response.json({ error: error.message }, { status: 502 }) };
    }
    if (requestTimeout.stopped()) {
      return stoppedResult();
    }
    return {
      error: Response.json(
        {
          error: requestTimeout.timedOut()
            ? `${isOpenRouter ? "OpenRouter" : "Backend"} stream stalled for ${formatTimeout(timeoutMs)}. Retry, or lower that backend's context/output settings.`
            : `The ${isOpenRouter ? "OpenRouter" : "backend"} stream was interrupted. Check the server and retry.`,
        },
        { status: requestTimeout.timedOut() ? 504 : 502 },
      ),
    };
  };

  // The ledger's view of this call, once the backend has said what it cost.
  const tagged = (usage: TokenUsage | null): { usage?: UpstreamUsage } =>
    usage
      ? {
          usage: {
            ...usage,
            model: resolvedModel,
            backend: isOpenRouter ? "openrouter" : caps.kind === "openai" ? "openai" : "custom",
            keyed: resolvedKey !== "",
            paid: resolvedKey !== "" && !isPrivateBackendHost(trimmedBase),
          },
        }
      : {};

  if (viaResponses) {
    try {
      const reply = await readResponsesReply(upstream, {
        onDelta: guardedDelta,
        onReasoningDelta: guardedReasoning,
        idleMs: timeoutMs,
        onIdleAbort: requestTimeout.abortNow,
        onChunk: noteJobProgress,
      });
      if ("failure" in reply) {
        return {
          error: Response.json(
            { error: "Backend request failed.", detail: reply.failure.slice(0, 300) },
            { status: 502 },
          ),
        };
      }
      if (speedWanted && !dropped.has("service_tier")) {
        noteSpeed(role, { model: resolvedModel, reported: reply.serviceTier ?? null });
      }
      const result: UpstreamResult = {
        message: reply.message,
        ...(reply.finishReason ? { finishReason: reply.finishReason } : {}),
        ...tagged(reply.usage ?? null),
      };
      return onDelta ? result : cutWholeReply(result, options);
    } catch (error) {
      if (error instanceof ReasoningBudgetError) return requestCustomMessageNow(baseUrl, model, apiKey, messages, withoutThinking(options));
      if (error instanceof StreamRepetitionError) return repeatedStreamResult(error, options);
      return readFailure(error);
    }
  }

  if (onDelta && upstream.body) {
    // OpenAI-compatible SSE: "data: {...}" lines carrying content and
    // tool-call fragments, terminated by "data: [DONE]".
    let streamUsage = null as TokenUsage | null;
    // llama-server's timings ride on the last chunk, which need not be the
    // one with the usage; merged in at the end.
    let streamTimings: Partial<TokenUsage> = {};
    let serviceTier = "";
    const contentParts: string[] = [];
    const toolCalls: Array<StreamedToolCall | undefined> = [];
    let upstreamError = "";
    let finishReason = "";

    try {
      await forEachStreamLine(upstream, timeoutMs, requestTimeout.abortNow, (line) => {
        if (!line.startsWith("data:")) {
          return;
        }
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") {
          return;
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(payload);
        } catch {
          return;
        }
        const record = parsed as {
          choices?: Array<{
            delta?: { content?: unknown; tool_calls?: unknown; reasoning_content?: unknown; reasoning?: unknown };
            finish_reason?: unknown;
          }>;
          error?: { message?: string } | string;
          service_tier?: unknown;
        };
        if (typeof record.service_tier === "string" && record.service_tier) {
          serviceTier = record.service_tier;
        }
        if (record.error) {
          upstreamError =
            typeof record.error === "string"
              ? record.error
              : record.error.message || "The backend reported a stream error.";
          return;
        }
        const reason = record.choices?.[0]?.finish_reason;
        if (typeof reason === "string" && reason) {
          finishReason = reason;
        }
        streamUsage = chatUsage(record) ?? streamUsage;
        streamTimings = { ...streamTimings, ...chatTimings(record) };
        const delta = record.choices?.[0]?.delta;
        // llama.cpp and DeepSeek name the reasoning reasoning_content;
        // OpenRouter and newer vLLM name it reasoning. One of them, so a
        // server that sends both is not read twice.
        const thought =
          typeof delta?.reasoning_content === "string"
            ? delta.reasoning_content
            : typeof delta?.reasoning === "string"
              ? delta.reasoning
              : "";
        if (thought) {
          guardedReasoning?.(thought);
        }
        if (typeof delta?.content === "string" && delta.content) {
          contentParts.push(delta.content);
          guardedDelta?.(delta.content);
        }
        if (Array.isArray(delta?.tool_calls)) {
          for (const call of delta.tool_calls) {
            const raw = call as {
              index?: number;
              id?: unknown;
              function?: { name?: unknown; arguments?: unknown };
            };
            const index = typeof raw.index === "number" ? raw.index : 0;
            const target = (toolCalls[index] ??= {
              type: "function",
              function: { name: "", arguments: "" },
            });
            if (typeof raw.id === "string" && raw.id) {
              target.id = raw.id;
            }
            if (typeof raw.function?.name === "string") {
              target.function.name += raw.function.name;
            }
            if (typeof raw.function?.arguments === "string") {
              target.function.arguments += raw.function.arguments;
            }
          }
        }
      }, noteJobProgress);
    } catch (error) {
      if (error instanceof ReasoningBudgetError) return requestCustomMessageNow(baseUrl, model, apiKey, messages, withoutThinking(options));
      if (error instanceof StreamRepetitionError) return repeatedStreamResult(error, options);
      return readFailure(error);
    }

    if (upstreamError) {
      // Asked again only while nothing of it reached the table: the parser
      // refuses at the point it stops following, and story text before that
      // point has already streamed.
      if (!options.unparsedRetried && UNPARSED_REPLY.test(upstreamError) && !contentParts.length && !toolCalls.some(Boolean)) {
        return requestCustomMessageNow(baseUrl, model, apiKey, messages, unparsedRetry(options));
      }
      return {
        error: Response.json(
          {
            error: `${isOpenRouter ? "OpenRouter" : "Backend"} stream failed.`,
            detail: upstreamError.slice(0, 300),
          },
          { status: 502 },
        ),
      };
    }

    const completedToolCalls = toolCalls.filter(Boolean) as StreamedToolCall[];
    if (speedWanted && !dropped.has("service_tier")) {
      noteSpeed(role, { model: resolvedModel, reported: serviceTier || null });
    }
    return {
      message: {
        content: contentParts.join(""),
        ...(completedToolCalls.length ? { tool_calls: completedToolCalls } : {}),
      },
      ...(finishReason ? { finishReason } : {}),
      ...tagged(streamUsage ? { ...streamTimings, ...streamUsage } : null),
    };
  }

  let data: { choices?: Array<{ message?: UpstreamChatMessage; finish_reason?: unknown }>; service_tier?: unknown };
  try {
    const body = await readBody(upstream, MAX_BACKEND_BODY_BYTES);
    if (!body.complete) {
      throw new BackendRefusal("The backend's reply was far larger than any reply.");
    }
    data = JSON.parse(body.text) as typeof data;
  } catch {
    return {
      error: Response.json(
        { error: "The backend returned an unreadable response." },
        { status: 502 },
      ),
    };
  }

  const finishReason = data?.choices?.[0]?.finish_reason;
  if (speedWanted && !dropped.has("service_tier")) {
    noteSpeed(role, { model: resolvedModel, reported: typeof data?.service_tier === "string" ? data.service_tier : null });
  }
  return cutWholeReply(
    {
      message: data?.choices?.[0]?.message,
      ...(typeof finishReason === "string" && finishReason ? { finishReason } : {}),
      ...tagged(chatUsage(data)),
    },
    options,
  );
}

export function requestLocalMessage(
  requestedModel: string,
  messages: ChatMessage[],
  options: ChatRequestOptions & { omitThink?: boolean } = {},
): Promise<UpstreamResult> {
  const timeoutMs = resolveTextTimeoutMs(options.timeoutMs, "LOCAL_TEXT_TIMEOUT_MS", DEFAULT_LOCAL_TEXT_TIMEOUT_MS);
  return withJobStage("waiting_model", timeoutMs + MODEL_STAGE_GRACE_MS, () =>
    requestLocalMessageNow(requestedModel, messages, options),
  );
}

async function requestLocalMessageNow(
  requestedModel: string,
  messages: ChatMessage[],
  options: ChatRequestOptions & { omitThink?: boolean } = {},
): Promise<UpstreamResult> {
  const { temperature, onDelta } = options;
  // A call that may only narrate (toolChoice "none") goes without its
  // tools: Ollama has no tool_choice, so a tool list sent with the forced
  // last call left the model free to call one anyway.
  const tools = options.toolChoice === "none" ? undefined : options.tools;
  // The call's own thinking request wins (the turn asks for it on the calls
  // that choose tools, as it does on every other backend); left unset,
  // thinking stays off: Gemma 4 is a hybrid reasoning model and without
  // this spends most of the token budget on a hidden channel before any
  // story text. A model with no thinking channel refuses the field, and the
  // retry sends none (omitThink).
  const think = options.omitThink ? null : options.thinking === true;
  const baseUrl = serverEnv("OLLAMA_BASE_URL", "http://127.0.0.1:11434").replace(/\/$/, "");
  // A blank setting runs the one chat model Ollama has, when it has exactly
  // one; the model's own window is learned before the prompt is packed.
  const model = requestedModel.trim() || (await soleListedModel({ provider: "local", baseUrl }));
  if (!model) {
    return {
      error: Response.json(
        { error: "No local model is set, and Ollama lists more than one. Pick the model in Admin > Text model defaults." },
        { status: 400 },
      ),
    };
  }
  await ollamaModelInfo(model, baseUrl);
  // The admin's per-role sampling, resolved as the custom backend resolves
  // it (src/lib/dm/sampling-logic.ts); Ollama takes every sampler field in
  // its options. A per-call temperature still wins, and an unconfigured
  // install keeps 0.9 where the resolver leaves the temperature unset.
  const globalSampling = getGlobalConfig().sampling;
  const role = options.role ?? "story";
  const sampling = resolveSampling({
    role,
    configured: {
      ...(role === "utility" ? globalSampling.utility : globalSampling.story),
      ...(temperature !== undefined ? { temperature } : {}),
    },
    profile: profileById(globalSampling.profile || "default"),
    allowLocalOnly: true,
    thinking: think === true,
  });
  const requestPayload: Record<string, unknown> = {
    model,
    messages: toOllamaMessages(messages),
    stream: Boolean(onDelta),
    // Keep the model (and the story's prompt cache) resident between turns.
    keep_alive: "30m",
    options: {
      ...sampling,
      temperature: sampling.temperature ?? 0.9,
      // Pinned as on the OpenAI-compatible path (requestCustomMessage): a
      // positive presence penalty suppresses tool calls, and Ollama's own
      // qwen3.5:9b ships with 1.5 in its parameters.
      presence_penalty: 0,
      num_predict: callOutputCap(localMaxOutputTokens(), options),
      num_ctx: localContextTokens(model),
    },
  };

  if (think !== null) {
    requestPayload.think = think;
  }

  if (tools?.length) {
    requestPayload.tools = tools;
  }

  const timeoutMs = resolveTextTimeoutMs(
    options.timeoutMs,
    "LOCAL_TEXT_TIMEOUT_MS",
    DEFAULT_LOCAL_TEXT_TIMEOUT_MS,
  );
  const requestTimeout = createRequestTimeout(timeoutMs);
  const guardedDelta = guardStreamDelta(onDelta, requestTimeout.cancel);
  const guardedReasoning = guardReasoningDelta(Boolean(onDelta), requestTimeout.cancel, options.reasoningBudgetChars);
  let upstream: Response;
  try {
    upstream = await fetchBackend(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestPayload),
      signal: requestTimeout.signal,
    });
  } catch (error) {
    if (requestTimeout.stopped()) {
      return stoppedResult();
    }
    if (requestTimeout.timedOut()) {
      return {
        error: Response.json(
          {
            error: `The local model took longer than ${formatTimeout(timeoutMs)} to answer. Ollama may still be working in the background; wait a moment, then retry, restart Ollama if your fans stay high, or lower LOCAL_TEXT_CONTEXT / LOCAL_TEXT_MAX_TOKENS.`,
          },
          { status: 504 },
        ),
      };
    }

    const failure = describeTransportFailure(error);
    return {
      error: Response.json(
        {
          error: `Could not reach Ollama at ${baseUrl}.${failure.reason ? ` ${failure.reason}` : ""} Start the Ollama app (or \`ollama serve\`), pull the model with \`ollama pull ${model}\`, or switch this chat to a custom backend (LM Studio, llama.cpp, OpenRouter, ...) in Text Model settings.`,
          detail: `transport ${failure.code}`,
        },
        { status: 502 },
      ),
    };
  } finally {
    requestTimeout.clear();
  }

  if (!upstream.ok) {
    const text = await upstream.text();

    // Some local models lack a tool-call template; retry the turn without tools.
    if (tools?.length && /does not support tools/i.test(text)) {
      return requestLocalMessage(model, messages, { ...options, tools: undefined });
    }

    // Models without a thinking channel reject the think parameter; retry without it.
    if (think !== null && /does not support think/i.test(text)) {
      return requestLocalMessage(model, messages, { ...options, omitThink: true });
    }

    const hint = /not found/i.test(text)
      ? ` The model is not installed — run \`ollama pull ${model}\`.`
      : "";
    return {
      error: Response.json(
        {
          error: `Local model request failed (${upstream.status}).${hint}`,
          detail: text.slice(0, 300),
        },
        { status: 502 },
      ),
    };
  }

  if (onDelta && upstream.body) {
    // Ollama streams NDJSON: one JSON object per line with message.content
    // fragments; tool calls arrive whole on whichever line carries them.
    let localUsage = null as TokenUsage | null;
    const contentParts: string[] = [];
    const toolCalls: unknown[] = [];
    let upstreamError = "";
    let doneReason = "";

    try {
      await forEachStreamLine(upstream, timeoutMs, requestTimeout.abortNow, (line) => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(line);
        } catch {
          return;
        }
        const record = parsed as {
          message?: { content?: unknown; tool_calls?: unknown; thinking?: unknown };
          error?: unknown;
          done_reason?: unknown;
        };
        if (typeof record.done_reason === "string" && record.done_reason) {
          doneReason = record.done_reason;
        }
        if (record.error) {
          upstreamError = String(record.error);
          return;
        }
        if (typeof record.message?.thinking === "string" && record.message.thinking) {
          guardedReasoning?.(record.message.thinking);
        }
        if (typeof record.message?.content === "string" && record.message.content) {
          contentParts.push(record.message.content);
          guardedDelta?.(record.message.content);
        }
        if (Array.isArray(record.message?.tool_calls)) {
          toolCalls.push(...record.message.tool_calls);
        }
        localUsage = ollamaUsage(record) ?? localUsage;
      }, noteJobProgress);
    } catch (error) {
      if (error instanceof ReasoningBudgetError) return requestLocalMessageNow(requestedModel, messages, withoutThinking(options));
      if (error instanceof StreamRepetitionError) return repeatedStreamResult(error, options);
      if (requestTimeout.stopped()) {
        return stoppedResult();
      }
      return {
        error: Response.json(
          {
            error: requestTimeout.timedOut()
              ? `The local model stalled for ${formatTimeout(timeoutMs)} mid-passage. Ollama may still be working; wait a moment, then retry, or lower LOCAL_TEXT_CONTEXT / LOCAL_TEXT_MAX_TOKENS.`
              : "The local model stream was interrupted. Check that Ollama is still running and retry.",
          },
          { status: requestTimeout.timedOut() ? 504 : 502 },
        ),
      };
    }

    if (upstreamError) {
      return {
        error: Response.json(
          {
            error: "Local model stream failed.",
            detail: upstreamError.slice(0, 300),
          },
          { status: 502 },
        ),
      };
    }

    return {
      message: {
        content: contentParts.join(""),
        ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
      },
      ...(doneReason ? { finishReason: ollamaFinish(doneReason, toolCalls.length > 0) } : {}),
      ...(localUsage ? { usage: { ...localUsage, model, backend: "local" as const, keyed: false, paid: false } } : {}),
    };
  }

  let data: { message?: UpstreamChatMessage; done_reason?: unknown };
  try {
    data = (await upstream.json()) as typeof data;
  } catch {
    return {
      error: Response.json(
        { error: "The backend returned an unreadable response." },
        { status: 502 },
      ),
    };
  }
  const usage = ollamaUsage(data);
  const doneReason = typeof data?.done_reason === "string" ? data.done_reason : "";
  const wholeCalls = data?.message?.tool_calls;
  return cutWholeReply(
    {
      message: data?.message,
      ...(doneReason ? { finishReason: ollamaFinish(doneReason, Array.isArray(wholeCalls) && wholeCalls.length > 0) } : {}),
      ...(usage ? { usage: { ...usage, model, backend: "local" as const, keyed: false, paid: false } } : {}),
    },
    options,
  );
}

// Ollama's done_reason in the Chat Completions words the turn reads: a reply
// cut at num_predict is "length" either way (issue #120's empty-reply note).
function ollamaFinish(doneReason: string, calledTools: boolean): string {
  if (doneReason === "stop" && calledTools) {
    return "tool_calls";
  }
  return doneReason;
}
