// What each answer in the guided setup (src/app/setup) writes. Every patch
// is an ordinary PATCH /api/admin/settings body, so the wizard can never set
// anything the admin panel could not, and the panel shows exactly what the
// wizard chose. Pure, so scripts/test-setup-wizard.mjs checks each one.
import { keyForListing, keyProvider, normalizeBaseUrl, type KeyProviderId } from "./discovery-logic.ts";

export type HarnessChoiceId = "claude" | "codex" | "opencode" | "grok";

// The agent programs with an image tool of their own (src/lib/harness
// adapters' `paints`), for the wizard, which cannot import the adapters.
export const PAINTING_AGENTS: readonly HarnessChoiceId[] = ["codex", "grok"];

export type StoryChoice =
  // A model server on this machine or the network.
  | { kind: "local"; baseUrl: string; model: string; apiKey: string }
  // A hosted provider and its key. A blank key keeps the one already saved.
  | { kind: "key"; provider: KeyProviderId; baseUrl: string; model: string; apiKey: string }
  // An agent program signed in on this machine.
  | { kind: "agent"; id: HarnessChoiceId; model: string; utilityModel: string }
  // A person narrates.
  | { kind: "none" };

export type Patch = Record<string, unknown>;

// savedBaseUrl is where the key already saved on this server belongs. A
// blank key field keeps that key only for that same host: moving the
// storyteller from OpenAI to a llama-server on this machine must not carry
// the OpenAI key along to every turn there, so a new host clears it.
export function storyPatch(choice: StoryChoice, savedBaseUrl = ""): { patch: Patch } | { error: string } {
  if (choice.kind === "none") {
    return { patch: { text: { provider: "none" } } };
  }
  if (choice.kind === "agent") {
    return {
      patch: {
        harness: { id: choice.id, model: choice.model.trim(), utilityModel: choice.utilityModel.trim() },
        text: { provider: "harness" },
      },
    };
  }
  const baseUrl = normalizeBaseUrl(choice.kind === "key" ? keyProvider(choice.provider).baseUrl || choice.baseUrl : choice.baseUrl);
  if (!baseUrl) {
    return { error: "Enter the server's address." };
  }
  const model = choice.model.trim();
  if (!model) {
    return { error: "Pick a model." };
  }
  const apiKey = choice.apiKey.trim();
  const sameHost = keyForListing({ typed: "", savedKey: "kept", savedBaseUrl, baseUrl }) === "kept";
  return {
    patch: {
      text: {
        provider: "custom",
        customBaseUrl: baseUrl,
        customModel: model,
        // Omitted means "keep": the key field never receives the saved key.
        ...(apiKey ? { customApiKey: apiKey } : sameHost ? {} : { customApiKey: "" }),
      },
    },
  };
}

export type PicturesChoice =
  // preset "z_turbo" paints with Z-Image Turbo and keeps the checkpoint for
  // switching back.
  | { kind: "comfyui"; url: string; checkpoint: string; preset?: "checkpoint" | "z_turbo" }
  // OpenAI's images API on the storyteller's OpenAI key, or on its own.
  | { kind: "openai"; apiKey: string }
  // The agent program's own image tool, once a test picture has come back.
  | { kind: "agent" }
  // Painted placeholders. A ComfyUI started later at its default address is
  // picked up on its own.
  | { kind: "none" };

export function picturesPatch(choice: PicturesChoice): Patch {
  if (choice.kind === "comfyui") {
    return {
      images: {
        defaultBackend: "comfyui",
        comfyUrl: choice.url.trim().replace(/\/+$/, ""),
        comfyCheckpoint: choice.checkpoint.trim(),
        comfyWorkflowPreset: choice.preset ?? "checkpoint",
      },
    };
  }
  if (choice.kind === "openai") {
    const apiKey = choice.apiKey.trim();
    return { images: { defaultBackend: "openai", openaiBaseUrl: "", ...(apiKey ? { openaiApiKey: apiKey } : {}) } };
  }
  if (choice.kind === "agent") {
    // Both switches: the default backend alone leaves the agent's pictures
    // off (harnessImagesReady also wants images "native").
    return { images: { defaultBackend: "harness" }, harness: { images: "native" } };
  }
  return { images: { defaultBackend: "", comfyUrl: "" } };
}

export type NarrationChoice =
  | { kind: "kokoro"; url: string; voice: string }
  // OpenAI's speech API: blank key borrows the storyteller's OpenAI key.
  | { kind: "openai"; apiKey: string }
  | { kind: "off" };

export function narrationPatch(choice: NarrationChoice): Patch {
  if (choice.kind === "kokoro") {
    return {
      speech: { ttsProvider: "kokoro", kokoroUrl: choice.url.trim().replace(/\/+$/, ""), ttsVoice: choice.voice.trim() },
    };
  }
  if (choice.kind === "openai") {
    const apiKey = choice.apiKey.trim();
    return {
      speech: { ttsProvider: "openai", ttsBaseUrl: "", ttsModel: "", ttsVoice: "", ...(apiKey ? { ttsApiKey: apiKey } : {}) },
    };
  }
  return { speech: { ttsProvider: "off" } };
}

// Dictation needs no answer: a Whisper at its usual address is found on
// its own, and without one the built-in engine or an OpenAI key takes over
// (src/lib/stt-logic.ts).

export type JoiningChoice = {
  signupMode: "open" | "invite" | "closed";
  publicUrl: string;
};

export function joiningPatch(choice: JoiningChoice): Patch {
  return {
    signupMode: choice.signupMode,
    publicUrl: choice.publicUrl.trim().replace(/\/+$/, ""),
  };
}

export function namePatch(serverName: string): Patch {
  return { serverName: serverName.trim().slice(0, 100) };
}

// Two patches into one body: the sections are disjoint objects, so a
// shallow merge per section is enough.
export function mergePatches(...patches: Patch[]): Patch {
  const out: Patch = {};
  for (const patch of patches) {
    for (const [key, value] of Object.entries(patch)) {
      const before = out[key];
      out[key] =
        before && typeof before === "object" && value && typeof value === "object" && !Array.isArray(value)
          ? { ...(before as Patch), ...(value as Patch) }
          : value;
    }
  }
  return out;
}
