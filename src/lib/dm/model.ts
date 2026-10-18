import {
  customBackendIsPaid,
  localContextTokens,
  requestCustomMessage,
  requestLocalMessage,
  storyContextTokens,
  storyWindowAssumed,
  utilityModelContextTokens,
  utilityWindowAssumed,
  type ChatMessage,
  type ChatRequestOptions,
  type UpstreamResult,
} from "@/lib/model-client";
import { requestHarnessMessage } from "@/lib/harness/bridge";
import { harnessConfig, harnessContextTokens } from "@/lib/harness/status";
import { raceJobStop, withJobStage } from "@/lib/dm/job-control";
import { MODEL_STAGE_GRACE_MS } from "@/lib/dm/job-stage-logic";
import { paidAiAllowedNow, paidAiRefusalResponse } from "@/lib/shared-host";
import { recordUsage } from "@/lib/usage/ledger";
import { recordModelCall, type ModelCallOutcome } from "@/lib/usage/model-calls";
import { fitRequest, requestTokens, toolDefinitionTokens, type FitMessage } from "@/lib/dm/request-fit";
import { calibrationFor, noteReportedInput } from "@/lib/dm/token-calibration";
import { asInteractive, waitForInteractive } from "@/lib/dm/inference-gate";
import { currentModelTask } from "@/lib/usage/task-scope";
import { afterFailure, afterSuccess, breakerOpen, CLOSED, type BreakerState } from "@/lib/dm/utility-breaker-logic";
import { STORY_WINDOW_NEEDS } from "@/lib/story-window";
import type { StorySettings } from "@/lib/types";

// Every DM-side model call passes through here, which makes it the one place
// for what every call needs whatever it is for:
// - the shared-host bookkeeping (src/lib/shared-host.ts): the usage ledger,
//   written from what the backend reported, and the paid AI policy, which
//   refuses a keyed backend for a table that may not spend the host's key;
// - the request's size (src/lib/dm/request-fit.ts): fitted to the window the
//   model really has, with the reply capped to what the window leaves, or
//   refused before it is sent with the numbers that say why;
// - the measurements (src/lib/usage/model-calls.ts): one row per attempt;
// - interactive work ahead of upkeep on a shared backend
//   (src/lib/dm/inference-gate.ts).

// Options this module reads and the transports never see.
export type DmCallOptions = ChatRequestOptions & {
  // The least room the reply must keep; the call is refused under it.
  minOutputTokens?: number;
  // How the request may be fitted (src/lib/dm/request-fit.ts FitOptions):
  // the transcript lines inside it, and where the call's own work begins.
  fit?: { history?: { start: number; end: number }; protectFrom?: number };
  // Upkeep that waits while a table's turn is calling the same backend.
  background?: boolean;
};

// What the call was sized to, for the turn's Context panel.
export type CallSizing = {
  windowTokens: number;
  promptTokens: number;
  toolTokens: number;
  outputTokens: number;
  dropped: number;
  clipped: number;
  // The window is only assumed (the endpoint reports none) and the request
  // outgrew it: it went out uncapped, and outputTokens is 0.
  windowAssumed?: true;
};

export type DmCallResult = UpstreamResult & {
  sizing?: CallSizing;
  durationMs?: number;
  firstTokenMs?: number;
};

type Route = {
  provider: "harness" | "local" | "custom";
  // Who the backend is configured for: a utility call with no utility model
  // of its own runs on the story route.
  backendRole: "story" | "utility";
  model: string;
  baseUrl: string;
  apiKey: string;
  windowTokens: number;
  // The window is the stand-in for an endpoint that says nothing of its
  // own (model-client.ts storyWindowAssumed): fitted to as advice, never a
  // reason to refuse a call the server may well have room for.
  windowAssumed: boolean;
  // One backend, for calibration and the interactive gate.
  key: string;
};

const DEFAULT_MIN_OUTPUT = { story: 1_024, utility: 512 } as const;

function storyRoute(settings: StorySettings): Route {
  if (settings.textProvider === "harness") {
    return { provider: "harness", backendRole: "story", model: harnessConfig().model, baseUrl: "", apiKey: "", windowTokens: harnessContextTokens(), windowAssumed: false, key: "harness" };
  }
  if (settings.textProvider === "local") {
    return {
      provider: "local",
      backendRole: "story",
      model: settings.localTextModel,
      baseUrl: "",
      apiKey: "",
      windowTokens: storyContextTokens(settings),
      windowAssumed: false,
      key: `local|${settings.localTextModel}`,
    };
  }
  return {
    provider: "custom",
    backendRole: "story",
    model: settings.customModel,
    baseUrl: settings.customBaseUrl,
    apiKey: settings.customApiKey,
    windowTokens: storyContextTokens(settings),
    windowAssumed: storyWindowAssumed(settings),
    key: `custom|${(settings.customBaseUrl || "").trim()}|${settings.customModel}`,
  };
}

// The utility model's own route, or null when the table has none and its
// utility work runs on the story route.
async function utilityRoute(settings: StorySettings): Promise<Route | null> {
  const model = (settings.utilityModel ?? "").trim();
  if (settings.utilityProvider === "harness" || (settings.textProvider === "harness" && !model)) {
    const config = harnessConfig();
    return {
      provider: "harness",
      backendRole: "utility",
      model: config.utilityModel || config.model,
      baseUrl: "",
      apiKey: "",
      windowTokens: harnessContextTokens({ ...config, model: config.utilityModel || config.model }),
      windowAssumed: false,
      key: "harness|utility",
    };
  }
  if (!model) {
    return null;
  }
  if (settings.utilityProvider === "local") {
    return { provider: "local", backendRole: "utility", model, baseUrl: "", apiKey: "", windowTokens: localContextTokens(model), windowAssumed: false, key: `local|${model}` };
  }
  // Sized to the utility model's own window; a fallback to the story model
  // is fitted again to that one.
  return {
    provider: "custom",
    backendRole: "utility",
    model,
    baseUrl: settings.utilityBaseUrl,
    apiKey: settings.utilityApiKey,
    windowTokens: await utilityModelContextTokens(settings),
    windowAssumed: utilityWindowAssumed(settings),
    key: `custom|${(settings.utilityBaseUrl || "").trim()}|${model}`,
  };
}

function capacityResponse(route: Route, reason: string): Response {
  const where =
    route.provider === "local"
      ? "LOCAL_TEXT_CONTEXT, or the model's own context length in Ollama"
      : "OPENAI_COMPAT_CONTEXT and the server's own context setting (llama-server -c)";
  return Response.json(
    {
      error: `The ${route.backendRole === "utility" ? "utility" : "story"} model's context window is too small for this request. ${reason} Raise the window (${where}) or choose a model with a larger one.${route.backendRole === "utility" ? "" : ` ${STORY_WINDOW_NEEDS}`}`,
      code: "context_capacity",
    },
    { status: 413 },
  );
}

// The host's own paid-AI refusal (src/lib/shared-host.ts), told apart from
// a backend's 403 (a wrong key), which is an ordinary failure.
const POLICY_REFUSAL = Symbol("policyRefusal");

function outcomeOf(result: UpstreamResult): ModelCallOutcome {
  if (!result.error) {
    return "ok";
  }
  if ((result as { [POLICY_REFUSAL]?: boolean })[POLICY_REFUSAL]) {
    return "refused";
  }
  if (result.error.status === 499) {
    return "stopped";
  }
  if (result.error.status === 413) {
    return "capacity";
  }
  return "error";
}

// An agent program's reply, as a stage of the DM job it runs in. The program
// cannot be aborted mid-reply, so a stopped job stops waiting on it; the
// turn's own cleanup ends the program (releaseHarnessConversation).
function harnessCall(
  messages: ChatMessage[],
  options: ChatRequestOptions,
  context: Parameters<typeof requestHarnessMessage>[2],
): Promise<UpstreamResult> {
  const timeoutMs = options.timeoutMs ?? harnessConfig().turnTimeoutSec * 1_000;
  return withJobStage("waiting_model", timeoutMs + MODEL_STAGE_GRACE_MS, () =>
    raceJobStop(requestHarnessMessage(messages, options, context), (reason) => ({
      error: Response.json({ error: reason, code: "stopped" }, { status: 499 }),
    })),
  );
}

function paidAndRefused(baseUrl: string, apiKey: string): boolean {
  return customBackendIsPaid(baseUrl, apiKey) && !paidAiAllowedNow();
}

function send(route: Route, messages: ChatMessage[], options: ChatRequestOptions): Promise<UpstreamResult> {
  if (route.provider === "harness") {
    return harnessCall(
      messages,
      options,
      route.backendRole === "utility"
        ? { role: "utility" }
        : { role: "story", campaignId: options.harness?.campaignId, catalogue: options.harness?.catalogue, turn: options.harness?.turn },
    );
  }
  if (route.provider === "local") {
    return requestLocalMessage(route.model, messages, { ...options, role: route.backendRole });
  }
  if (paidAndRefused(route.baseUrl, route.apiKey)) {
    return Promise.resolve({ error: paidAiRefusalResponse(route.backendRole), [POLICY_REFUSAL]: true } as UpstreamResult);
  }
  return requestCustomMessage(route.baseUrl, route.model, route.apiKey, messages, { ...options, role: route.backendRole });
}

// One attempt on one route: sized, gated, sent, measured.
async function attempt(
  route: Route,
  ledgerRole: "story" | "utility",
  messages: ChatMessage[],
  options: DmCallOptions,
  fallback: string | null,
): Promise<DmCallResult> {
  const scope = currentModelTask();
  const task = options.meta?.task ?? scope?.task ?? ledgerRole;
  const toolTokens = toolDefinitionTokens(options.tools);
  const calibration = calibrationFor(route.key);
  let sent = messages;
  let sizing: CallSizing | undefined;
  // An agent program keeps its own context (its CLI compacts it), so it is
  // measured but not fitted.
  if (route.provider !== "harness") {
    const fit = fitRequest(messages as FitMessage[], {
      windowTokens: route.windowTokens,
      tools: options.tools,
      minOutputTokens: Math.min(options.minOutputTokens ?? DEFAULT_MIN_OUTPUT[ledgerRole], Math.floor(route.windowTokens / 2)),
      maxOutputTokens: options.maxOutputTokens ?? Number.MAX_SAFE_INTEGER,
      history: options.fit?.history,
      protectFrom: options.fit?.protectFrom,
      calibration,
    });
    if (!fit.ok && route.windowAssumed) {
      // Only a guess at the window: send what fitting made of it, uncapped,
      // as before any of this was measured. A server that really is this
      // small refuses it, and that refusal teaches the real window
      // (model-client.ts contextOverflowWindow).
      console.warn(`[model] ${task}: ${fit.reason} The window is assumed (the endpoint reports none), so the request goes out anyway; set OPENAI_COMPAT_CONTEXT to the server's real window.`);
      sent = fit.messages as ChatMessage[];
      sizing = {
        windowTokens: route.windowTokens,
        promptTokens: fit.promptTokens,
        toolTokens: Math.ceil(toolTokens * calibration),
        outputTokens: 0,
        dropped: fit.dropped,
        clipped: fit.clipped,
        windowAssumed: true,
      };
    } else if (!fit.ok) {
      console.warn(`[model] ${task}: ${fit.reason}`);
      recordModelCall({
        task,
        role: ledgerRole,
        backend: route.provider,
        model: route.model,
        turnId: options.meta?.turnId,
        callIndex: options.meta?.callIndex,
        windowTokens: route.windowTokens,
        plannedInputTokens: fit.promptTokens,
        toolCount: options.tools?.length ?? 0,
        toolTokens,
        fitDropped: fit.dropped,
        fitClipped: fit.clipped,
        durationMs: 0,
        outcome: "capacity",
        fallback,
      });
      return { error: capacityResponse(route, fit.reason) };
    }
    if (fit.ok && (fit.dropped || fit.clipped)) {
      console.warn(
        `[model] ${task}: fitted to the ${route.windowTokens}-token window (${fit.dropped} older line(s) left out, ${fit.clipped} cut short); the reply may run to ${fit.outputTokens} tokens`,
      );
    }
    if (fit.ok) {
      sent = fit.messages as ChatMessage[];
      sizing = {
        windowTokens: route.windowTokens,
        promptTokens: fit.promptTokens,
        toolTokens: Math.ceil(toolTokens * calibration),
        outputTokens: fit.outputTokens,
        dropped: fit.dropped,
        clipped: fit.clipped,
      };
    }
  }

  const started = Date.now();
  let firstTokenAt = 0;
  const onDelta = options.onDelta
    ? (text: string) => {
        if (!firstTokenAt && text) firstTokenAt = Date.now();
        options.onDelta?.(text);
      }
    : undefined;
  const { minOutputTokens: _min, fit: _fit, background: asked, ...transport } = options;
  const background = asked ?? scope?.background ?? false;
  void _min;
  void _fit;
  const call = () =>
    send(route, sent, { ...transport, onDelta, ...(sizing && !sizing.windowAssumed ? { maxOutputTokens: sizing.outputTokens } : {}) });
  let waited = 0;
  if (background) {
    waited = await waitForInteractive(route.key);
  }
  const result = background ? await call() : await asInteractive(route.key, call);
  const durationMs = Date.now() - started - waited;
  const firstTokenMs = firstTokenAt ? firstTokenAt - started - waited : undefined;

  if (result.usage) {
    recordUsage({
      kind: result.usage.backend === "harness" ? "agent" : "text",
      role: ledgerRole,
      backend: result.usage.backend,
      model: result.usage.model,
      paid: result.usage.paid,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      cachedInputTokens: result.usage.cachedInputTokens,
      reasoningTokens: result.usage.reasoningTokens,
      durationMs,
    });
    // What the backend counted against what was estimated for the same
    // request, before calibration scaled it.
    if (route.provider !== "harness" && result.usage.inputTokens) {
      noteReportedInput(route.key, requestTokens(sent as FitMessage[], options.tools), result.usage.inputTokens, {
        partialReport: route.provider === "local",
      });
    }
  }
  recordModelCall({
    task,
    role: ledgerRole,
    backend: result.usage?.backend ?? route.provider,
    model: result.usage?.model ?? route.model,
    turnId: options.meta?.turnId,
    callIndex: options.meta?.callIndex,
    windowTokens: route.windowTokens,
    plannedInputTokens: sizing?.promptTokens ?? requestTokens(sent as FitMessage[], options.tools),
    inputTokens: result.usage?.inputTokens,
    cachedInputTokens: result.usage?.cachedInputTokens,
    cacheWriteTokens: result.usage?.cacheWriteTokens,
    outputTokens: result.usage?.outputTokens,
    reasoningTokens: result.usage?.reasoningTokens,
    maxOutputTokens: sizing?.windowAssumed ? undefined : sizing?.outputTokens,
    toolCount: options.tools?.length ?? 0,
    toolTokens,
    fitDropped: sizing?.dropped,
    fitClipped: sizing?.clipped,
    durationMs,
    firstTokenMs,
    promptMs: result.usage?.promptMs,
    generateMs: result.usage?.generateMs,
    loadMs: result.usage?.loadMs,
    finishReason: result.finishReason,
    outcome: outcomeOf(result),
    fallback,
  });
  return { ...result, ...(sizing ? { sizing } : {}), durationMs, ...(firstTokenMs !== undefined ? { firstTokenMs } : {}) };
}

// Whether a story call would fit its window as it stands, without sending
// it: the compact profile asks before choosing how many tools to offer
// (src/lib/dm/turn.ts). An agent program, or a window only assumed, always
// answers yes, as the call itself would go.
export function fitsStoryWindow(settings: StorySettings, messages: ChatMessage[], options: DmCallOptions): boolean {
  const route = storyRoute(settings);
  if (route.provider === "harness" || route.windowAssumed) {
    return true;
  }
  return fitRequest(messages as FitMessage[], {
    windowTokens: route.windowTokens,
    tools: options.tools,
    minOutputTokens: Math.min(options.minOutputTokens ?? DEFAULT_MIN_OUTPUT.story, Math.floor(route.windowTokens / 2)),
    maxOutputTokens: options.maxOutputTokens ?? Number.MAX_SAFE_INTEGER,
    history: options.fit?.history,
    protectFrom: options.fit?.protectFrom,
    calibration: calibrationFor(route.key),
  }).ok;
}

// Routes a DM-side model call through the campaign's configured provider.
export async function requestDmMessage(
  settings: StorySettings,
  messages: ChatMessage[],
  options: DmCallOptions,
): Promise<DmCallResult> {
  // The agent policy (src/lib/harness/policy.ts) answers for the agent
  // program, inside the bridge.
  const route = storyRoute(settings);
  const result = await attempt(route, "story", messages, options, null);
  // A server that refused the request as too big for it and named its real
  // window (model-client.ts contextOverflowWindow) gets the request once
  // more, fitted to that window.
  if (result.error?.status === 413 && route.provider !== "harness") {
    const learned = storyRoute(settings);
    if (learned.windowTokens < route.windowTokens || (route.windowAssumed && !learned.windowAssumed)) {
      return attempt(learned, "story", messages, options, `refitted to the ${learned.windowTokens}-token window the backend reported`);
    }
  }
  return result;
}

// Per utility backend: whether it has been failing (utility-breaker-logic.ts).
declare global {
  var __odmUtilityBreakers: Map<string, BreakerState> | undefined;
}
function breakers(): Map<string, BreakerState> {
  return (globalThis.__odmUtilityBreakers ??= new Map<string, BreakerState>());
}

// Mechanical, non-narration work: history compaction, chapter summaries and
// fact extraction, world-arc ticks, lore checks, Ask answers. None of it is
// read as prose, so it runs happily on a small model while the story model
// keeps its weights and prompt cache resident.
//
// Entirely optional. With no utilityModel configured this runs on the story
// route (recorded as utility work), and a configured-but-unreachable utility
// model falls back to the story model rather than failing the job: a wrong
// model name in settings must never cost a table its chapter summary. A
// utility model that keeps failing is skipped for a while, and work too big
// for its window goes to the story model when that one has room.
export async function requestUtilityMessage(
  settings: StorySettings,
  messages: ChatMessage[],
  options: DmCallOptions,
): Promise<DmCallResult> {
  const route = await utilityRoute(settings);
  const story = storyRoute(settings);
  if (!route) {
    return attempt(story, "utility", messages, options, null);
  }
  if (route.provider === "harness") {
    return attempt(route, "utility", messages, options, null);
  }
  const state = breakers().get(route.key) ?? CLOSED;
  if (breakerOpen(state, Date.now())) {
    return attempt(story, "utility", messages, options, `utility model "${route.model}" skipped after repeated failures`);
  }
  const result = await attempt(route, "utility", messages, options, null);
  if (!result.error) {
    breakers().set(route.key, afterSuccess());
    return result;
  }
  const outcome = outcomeOf(result);
  if (outcome === "stopped") {
    return result;
  }
  if (outcome === "capacity") {
    return attempt(story, "utility", messages, options, `too big for the utility model "${route.model}"'s window`);
  }
  if (outcome === "refused") {
    return attempt(story, "utility", messages, options, `the host's paid AI policy refused the utility model "${route.model}"`);
  }
  breakers().set(route.key, afterFailure(state, Date.now()));
  console.error(`[model] utility model "${route.model}" failed; retrying on the story model`, result.error);
  return attempt(story, "utility", messages, options, `utility model "${route.model}" failed (${result.error.status})`);
}
