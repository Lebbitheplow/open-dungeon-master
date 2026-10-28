import os from "node:os";
import { capabilitiesSnapshot, type Capabilities } from "@/lib/capabilities";
import type { Campaign } from "@/lib/db/campaigns";
import { getGlobalConfig } from "@/lib/db/app-settings";
import { SMALL_MODEL_PARAMS } from "@/lib/dm/model-tuning-logic";
import { hostAvailability } from "@/lib/harness/discover";
import { harnessConfig, probeHarness } from "@/lib/harness/status";
import { hostPlatform } from "@/lib/host-platform";
import { comfyModel } from "@/lib/image-models/catalog";
import {
  backendKeyFor,
  probeCustomContextWindow,
  storyContextTokens,
  storyModelParams,
  storyWindowAssumed,
  utilityEndpoint,
} from "@/lib/model-client";
import { modelCatalog } from "@/lib/model-registry/catalog";
import { providerForBaseUrl } from "@/lib/model-registry/catalog-logic";
import { ollamaBaseUrl, soleListedModel } from "@/lib/model-registry/discovery";
import { describeMachine, graphicsMemoryGb, LOCAL_STORYTELLER_MINIMUM_GB, machine, storytellerFit, type Machine } from "@/lib/model-registry/hardware";
import { modelChoices, type ModelChoices } from "@/lib/model-registry/registry";
import type { ReportAgentProgram, ReportModel, ReportSetup } from "@/lib/report-setup";
import { isLoopbackOrigin } from "@/lib/server-address";
import { isDeviceWorld, serverEnv } from "@/lib/server-env";
import { identifyTextServer, TEXT_SERVER_LABEL, type TextServerKind } from "@/lib/setup/discovery-logic";
import { storyWindowVerdict } from "@/lib/story-window";
import { sttStatus } from "@/lib/stt-backend";
import { BUILTIN_STT_MODEL } from "@/lib/stt-builtin";
import { narrationModel, ttsBackend } from "@/lib/tts-backend";
import type { StorySettings } from "@/lib/types";
import { checkForUpdate, currentBuild, updateChannel } from "@/lib/update-check";
import { voiceConfig } from "@/lib/voice/config";

// The server's half of a report's setup (src/lib/report-setup.ts): every
// version, how the server runs, and each AI piece by kind and model, with
// what is below the supported minimum worked out here from the checks the
// server already makes (the model registry's verdict, the machine's
// graphics memory, the narrator's window, the admin's Test backend). Most
// problems people reported were one of these. Addresses and keys never go
// in; the bundle's cutter takes out any that a backend's own error quotes.
//
// Every probe has a few seconds, so a backend that is down makes the
// report say so instead of holding it up.

const PROBE_MS = 3_000;
const LIST_MS = 5_000;
const AGENT_MS = 6_000;

export type ReportTable = { dmMode: string; role: string; game: Campaign["gameSettings"] };

function within<T>(work: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    work.catch(() => fallback),
    new Promise<T>((resolve) => {
      const timer = setTimeout(() => resolve(fallback), ms);
      timer.unref?.();
    }),
  ]);
}

function where(baseUrl: string): string {
  return isLoopbackOrigin(baseUrl) ? "on this machine" : "on another machine";
}

function hostedProvider(baseUrl: string): string {
  return providerForBaseUrl(baseUrl, modelCatalog().providers);
}

// Which server answers at an OpenAI-compatible address, from its own model
// list (llama.cpp, Ollama, LM Studio...): the setup scan's reading.
async function engineAt(baseUrl: string, apiKey: string): Promise<TextServerKind | ""> {
  const response = await fetch(`${baseUrl.replace(/\/+$/, "")}/models`, {
    cache: "no-store",
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
    signal: AbortSignal.timeout(PROBE_MS),
  });
  if (!response.ok) return "";
  return identifyTextServer(await response.json().catch(() => null), "openai-compatible");
}

function customBackend(baseUrl: string, engine: TextServerKind | ""): string {
  const hosted = hostedProvider(baseUrl);
  if (hosted) return `${hosted} (hosted API)`;
  return `${engine ? TEXT_SERVER_LABEL[engine] : TEXT_SERVER_LABEL["openai-compatible"]} ${where(baseUrl)}`;
}

function testedLine(choices: ModelChoices | null): { line: string; failed: string } {
  const tested = choices?.models.find((row) => row.selected)?.tested;
  if (!tested) return { line: "", failed: "" };
  const day = tested.at.slice(0, 10);
  if (tested.ok) return { line: `passed the backend test on ${day}`, failed: "" };
  const stages = [
    tested.stages.streaming ? "" : "streaming",
    tested.stages.toolCall ? "" : "tool calls",
    tested.stages.toolContinuation ? "" : "answering after a tool",
  ].filter(Boolean);
  return { line: `failed the backend test on ${day}`, failed: `failed the admin's Test backend on ${day}${stages.length ? ` (${stages.join(", ")})` : ""}` };
}

type ModelInput = {
  name: "The narrator" | "The helper model";
  backend: string;
  model: string;
  choices: ModelChoices | null;
  checks: string[];
};

// A model's facts and what is wrong with it, from the registry's answer.
function modelFacts(input: ModelInput): ReportModel {
  const { name, model, choices, checks } = input;
  const chosen = choices?.models.find((row) => row.selected) ?? null;
  const tested = testedLine(choices);
  if (choices && choices.reachable === false) {
    checks.push(choices.needsKey ? `${name}'s backend wants an API key.` : `${name}'s backend did not answer: ${choices.error}`);
  }
  if (!model) checks.push(`${name} has no model chosen, and its server does not list exactly one.`);
  for (const warning of chosen?.verdict.warnings ?? []) checks.push(`${name} (${model}): ${warning}`);
  if (tested.failed) checks.push(`${name} (${model}) ${tested.failed}.`);
  return {
    backend: input.backend,
    model,
    answers: choices ? choices.reachable : null,
    ...(chosen?.contextTokens ? { contextTokens: chosen.contextTokens } : {}),
    ...(tested.line ? { tested: tested.line } : {}),
  };
}

async function narratorFacts(settings: StorySettings, here: Machine | null, checks: string[]): Promise<ReportModel> {
  const cfg = getGlobalConfig();
  if (settings.textProvider === "none") return { backend: "none", model: "", off: true };
  if (settings.textProvider === "harness") {
    return {
      backend: "agent program",
      model: harnessConfig().model || "the program's default",
      contextTokens: storyContextTokens(settings),
      fastTier: Boolean(harnessConfig().speed),
    };
  }
  let facts: ReportModel;
  let resolved: StorySettings;
  let local: boolean;
  if (settings.textProvider === "local") {
    const base = ollamaBaseUrl();
    const model = settings.localTextModel.trim() || (await within(soleListedModel({ provider: "local", baseUrl: base }), PROBE_MS, ""));
    resolved = { ...settings, localTextModel: model };
    local = isLoopbackOrigin(base);
    const choices = await within(modelChoices({ role: "story", provider: "local", baseUrl: base, selected: model }), LIST_MS, null);
    facts = modelFacts({ name: "The narrator", backend: `Ollama ${where(base)}`, model, choices, checks });
  } else {
    const base = settings.customBaseUrl.trim();
    if (!base) {
      checks.push("The narrator has no backend address set.");
      return { backend: TEXT_SERVER_LABEL["openai-compatible"], model: settings.customModel };
    }
    const key = backendKeyFor(base, settings.customApiKey ?? "");
    const named = settings.customModel.trim() || cfg.text.customModel.trim() || serverEnv("OPENAI_COMPAT_MODEL").trim();
    const [engine, sole] = await Promise.all([
      hostedProvider(base) ? Promise.resolve("" as const) : within(engineAt(base, key), PROBE_MS, "" as const),
      named ? Promise.resolve("") : within(soleListedModel({ provider: "custom", baseUrl: base, apiKey: key }), PROBE_MS, ""),
    ]);
    const model = named || sole;
    resolved = { ...settings, customModel: model };
    local = isLoopbackOrigin(base);
    // Asks the server for its window, as a turn would, so the report does
    // not call a window assumed only because no turn has run since a restart.
    if (model) await within(probeCustomContextWindow(base, key, model), PROBE_MS, null);
    const choices = await within(modelChoices({ role: "story", provider: "custom", baseUrl: base, apiKey: key, selected: model }), LIST_MS, null);
    facts = modelFacts({ name: "The narrator", backend: customBackend(base, engine), model, choices, checks });
    if (engine === "ollama") {
      checks.push(
        'The narrator reaches Ollama through its OpenAI-compatible address, which ignores the window the table asks for, so Ollama runs it at its own default (4K on a 16 GB card) and long prompts are cut. Choose "Ollama" as the storyteller backend instead, or run llama.cpp.',
      );
    }
    facts.fastTier = Boolean(cfg.text.speed);
  }
  const tokens = storyContextTokens(resolved);
  const assumed = storyWindowAssumed(resolved);
  facts.contextTokens = tokens;
  if (assumed) {
    facts.windowAssumed = true;
    // A backend that did not answer could not be asked; that is said above.
    if (facts.answers !== false) {
      checks.push(
        `The narrator's server never said how large its context window is, so the table assumes ${tokens.toLocaleString("en-US")} tokens, too few for fights. Start the server with a larger window (llama-server -c 65536) or set OPENAI_COMPAT_CONTEXT.`,
      );
    }
  } else {
    const verdict = storyWindowVerdict(tokens);
    if (verdict.level !== "ok") checks.push(`The narrator's window: ${verdict.text}`);
  }
  const params = storyModelParams(resolved);
  if (params) {
    facts.paramsB = Math.round(params / 1e8) / 10;
    if (params < SMALL_MODEL_PARAMS) {
      checks.push(
        `The narrator model (${facts.model}) is small, about ${facts.paramsB}B parameters. Models under ${SMALL_MODEL_PARAMS / 1e9}B are below the supported minimum: they run with short rules and get more wrong.`,
      );
    }
  }
  if (local && here && storytellerFit(here) === "below") {
    checks.push(
      `The narrator runs on this machine, which has about ${Math.round(graphicsMemoryGb(here) ?? 0)} GB of graphics memory; a local narrator needs at least ${LOCAL_STORYTELLER_MINIMUM_GB} GB.`,
    );
  }
  return facts;
}

async function helperFacts(settings: StorySettings, checks: string[]): Promise<ReportModel | null> {
  const model = settings.utilityModel.trim();
  const provider = settings.utilityProvider || settings.textProvider;
  if (provider === "harness") {
    const helper = harnessConfig().utilityModel || model;
    return helper ? { backend: "agent program", model: helper } : null;
  }
  if (!model) return null;
  if (provider === "local") {
    const base = ollamaBaseUrl();
    const choices = await within(modelChoices({ role: "utility", provider: "local", baseUrl: base, selected: model }), LIST_MS, null);
    return modelFacts({ name: "The helper model", backend: `Ollama ${where(base)}`, model, choices, checks });
  }
  const endpoint = utilityEndpoint({ ...settings, utilityApiKey: settings.utilityApiKey ?? "" });
  if (!endpoint.baseUrl) return { backend: TEXT_SERVER_LABEL["openai-compatible"], model };
  const key = backendKeyFor(endpoint.baseUrl, endpoint.apiKey);
  const choices = await within(modelChoices({ role: "utility", provider: "custom", baseUrl: endpoint.baseUrl, apiKey: key, selected: model }), LIST_MS, null);
  return modelFacts({ name: "The helper model", backend: customBackend(endpoint.baseUrl, ""), model, choices, checks });
}

async function agentFacts(settings: StorySettings, checks: string[]): Promise<ReportAgentProgram | null> {
  const harness = harnessConfig();
  const used = settings.textProvider === "harness" || settings.utilityProvider === "harness" || settings.imageBackend === "harness";
  if (!harness.id) {
    if (used) checks.push("An agent program is chosen as a backend, but none is set up under Admin > Agent program.");
    return null;
  }
  const status = await within(probeHarness(harness.id, { phone: hostPlatform() === "android" }), AGENT_MS, null);
  const state = !status
    ? "not checked (it took too long to answer)"
    : !status.installed
      ? "not installed"
      : status.auth.state === "signed-out"
        ? "signed out"
        : status.auth.state === "ready"
          ? `signed in${status.auth.kind === "api-key" ? " with an API key" : status.auth.kind === "subscription" ? " with a subscription" : ""}`
          : "sign-in not known";
  if (used && status) {
    if (status.availability !== "ok") checks.push(`${status.label} cannot run here: ${status.message || status.availability}.`);
    else if (!status.installed) checks.push(`${status.label} is chosen but not installed on the server.`);
    else if (status.auth.state === "signed-out") checks.push(`${status.label} is signed out.`);
  }
  return {
    program: status?.label ?? harness.id,
    version: status?.version ?? "",
    model: harness.model || "the program's default",
    effort: harness.effort,
    helperModel: harness.utilityModel,
    state,
  };
}

const IMAGE_BACKENDS: Record<string, string> = {
  comfyui: "ComfyUI",
  openai: "an OpenAI-compatible images API",
  harness: "the agent program's own pictures",
  "mflux-hs": "the FLUX worker (mflux)",
  "sdnq-hs": "the FLUX worker (SDNQ)",
};

function picturesFacts(settings: StorySettings, caps: Capabilities | null, checks: string[]): NonNullable<ReportSetup["pictures"]> {
  const images = getGlobalConfig().images;
  const on = settings.imageGenerationEnabled !== false;
  const backend = settings.imageBackend;
  let model = "";
  if (backend === "comfyui") {
    const preset = images.comfyWorkflowPreset;
    model =
      preset && preset !== "checkpoint"
        ? (comfyModel(preset)?.label ?? preset)
        : settings.comfyCheckpoint || images.comfyCheckpoint || "no checkpoint chosen";
  } else if (backend === "openai") {
    const host = hostedProvider(images.openaiBaseUrl || "https://api.openai.com/v1");
    model = [images.openaiModel || "no model chosen", host ? `at ${host}` : ""].filter(Boolean).join(" ");
  }
  if (on && caps && caps.images.backend === backend) {
    if (caps.images.needsModel) checks.push("Pictures are on, but no picture model is chosen.");
    else if (!caps.images.reachable) checks.push(`Pictures are on, but ${IMAGE_BACKENDS[backend] ?? backend} did not answer.`);
  }
  return { on, backend: IMAGE_BACKENDS[backend] ?? backend, model };
}

async function narrationFacts(table: ReportTable | undefined, caps: Capabilities | null, checks: string[]): Promise<NonNullable<ReportSetup["narration"]>> {
  const speech = ttsBackend();
  const on = speech.provider !== "off" && (table ? table.game.ttsEnabled !== false : true);
  const model = await within(narrationModel(speech), PROBE_MS, speech.model);
  const backend =
    speech.provider === "off"
      ? "off"
      : speech.provider === "kokoro"
        ? `Kokoro ${where(speech.v1)}`
        : hostedProvider(speech.v1)
          ? `${hostedProvider(speech.v1)} speech (hosted API)`
          : `an OpenAI-compatible speech server ${where(speech.v1)}`;
  if (on && caps) {
    if (caps.tts.needsModel) checks.push("Narration is on, but no speech model is chosen.");
    else if (!caps.tts.reachable) checks.push("Narration is on, but the speech server did not answer.");
  }
  return { on, backend, model, voice: table?.game.ttsVoice || speech.defaultVoice, characterVoices: Boolean(table?.game.ttsAutoCast) };
}

async function dictationFacts(checks: string[]): Promise<NonNullable<ReportSetup["dictation"]>> {
  const speech = getGlobalConfig().speech;
  const stt = await within(sttStatus(), PROBE_MS, null);
  if (!stt) return { backend: "not known (the check took too long)", model: "" };
  if (stt.active === "whisper" && stt.whisper.needsModel) checks.push("Dictation's Whisper service lists several models and none is chosen.");
  if (stt.active === "openai" && stt.openai.needsModel) checks.push("Dictation's OpenAI-compatible speech-to-text has no model chosen.");
  switch (stt.active) {
    case "whisper":
      return { backend: "a Whisper service", model: speech.sttModel || "the service's own model" };
    case "builtin":
      return { backend: "built in to the server", model: BUILTIN_STT_MODEL };
    case "openai":
      return { backend: "OpenAI-compatible speech-to-text", model: speech.sttOpenaiModel };
    default:
      return { backend: "none on the server (a phone can use its own recognizer)", model: "" };
  }
}

// How this server runs. Docker and the apps say so in the environment; a
// server that is none of those is a source checkout, the only other way
// to install it.
function installKind(build: ReturnType<typeof currentBuild>): string {
  if (hostPlatform() === "android") return "the Android app's own world";
  if (isDeviceWorld()) return "the desktop app's own world";
  const sandbox = hostAvailability();
  if (sandbox === "container") return "Docker (or another container)";
  if (sandbox === "sandboxed-package") return "a Flatpak or Snap package";
  const parts = ["a source checkout"];
  if (build.ahead) parts.push(`${build.ahead} commits past ${build.tag || "the last release"}`);
  if (build.dirty) parts.push("with local changes");
  if (!build.known) parts.push("built without git");
  return parts.join(", ");
}

function machineLine(here: Machine | null): string {
  if (!here) return "";
  const fit = storytellerFit(here);
  const word =
    fit === "below"
      ? `below the ${LOCAL_STORYTELLER_MINIMUM_GB} GB a local narrator needs`
      : fit === "minimum"
        ? "enough for a local narrator"
        : fit === "recommended"
          ? "room for a recommended local narrator"
          : "graphics memory not known";
  return `${describeMachine(here)} (${word})`;
}

export async function gatherSetup(settings: StorySettings, table?: ReportTable): Promise<ReportSetup> {
  const build = currentBuild();
  const [here, caps, update] = await Promise.all([
    within(machine(), PROBE_MS, null),
    within(capabilitiesSnapshot(), LIST_MS, null),
    within(checkForUpdate(build), PROBE_MS, null),
  ]);
  // Each piece keeps its own list, so the order below is the order read.
  const first: string[] = [];
  const narratorChecks: string[] = [];
  const helperChecks: string[] = [];
  const agentChecks: string[] = [];
  const pictureChecks: string[] = [];
  const narrationChecks: string[] = [];
  const dictationChecks: string[] = [];
  if (update?.state === "available") {
    first.push(`A newer release is out (${update.latest.version}); this server runs ${build.version}. Update first: the problem may already be fixed.`);
  }
  if (table && settings.textProvider === "none" && table.dmMode !== "human") {
    first.push(`No narrator is set up, but this table's GM mode (${table.dmMode}) needs one.`);
  }
  const [narrator, helper, agentProgram, narration, dictation] = await Promise.all([
    narratorFacts(settings, here, narratorChecks),
    helperFacts(settings, helperChecks),
    agentFacts(settings, agentChecks),
    narrationFacts(table, caps, narrationChecks),
    dictationFacts(dictationChecks),
  ]);
  const pictures = picturesFacts(settings, caps, pictureChecks);
  const voice = voiceConfig();
  const checkFirst = [
    ...new Set([...first, ...narratorChecks, ...helperChecks, ...agentChecks, ...pictureChecks, ...narrationChecks, ...dictationChecks]),
  ];
  return {
    version: build.version,
    build: build.label,
    commit: build.commit,
    channel: updateChannel(),
    install: installKind(build),
    platform: `${hostPlatform()} ${os.release()}`,
    arch: os.arch(),
    node: process.versions.node,
    deviceWorld: isDeviceWorld(),
    machine: machineLine(here),
    ...(table ? { dmMode: table.dmMode, role: table.role } : {}),
    narrator,
    helper,
    agentProgram,
    pictures,
    narration,
    dictation,
    voiceChat: {
      on: voice.enabled && (table ? table.game.voice.enabled !== false : true),
      mode: voice.mode,
      transcribes: table ? Boolean(table.game.voice.transcribe) : Boolean(caps?.voice.transcribes),
    },
    checkFirst,
  };
}
