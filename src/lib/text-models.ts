// "custom" = any OpenAI-compatible server (llama.cpp, LM Studio, vLLM,
// OpenRouter, a remote Ollama). OpenRouter is no longer its own provider; it
// is reached through "custom" with the OpenRouter preset URL.
//
// "none" is a positive record that this server has no AI DM at all. Without
// it, "no AI" and "the shipped 127.0.0.1:8001 default with nothing listening"
// are indistinguishable, and the UI cannot warn anyone before a campaign
// fails its first turn.
//
// "harness" hands the storyteller to an agent program the server's admin has
// installed and signed into (Claude Code, Codex, opencode, Grok Build). Which
// one, and on which model, is chosen once for the whole server in the admin
// panel (src/lib/harness/); a campaign only says "use the server's agent".
export type TextProvider = "local" | "custom" | "none" | "harness";

// No model is named here. The "local" provider runs whatever tag the
// admin picked from what Ollama lists (src/lib/model-registry), and a
// server with exactly one chat model runs that one unasked.

// The window Ollama reported for a model (/api/show, asked by the model
// registry when the model is listed or chosen). Kept for the process, like
// the windows probed from llama.cpp in model-client.
const learnedWindows = new Map<string, number>();

export function rememberLocalContextWindow(modelId: string, tokens: number) {
  if (Number.isFinite(tokens) && tokens >= 2_048) {
    learnedWindows.set(modelId, Math.floor(tokens));
  }
}

// The native window of a local model where Ollama has said it. Null for a
// model nobody has asked about yet. Ollama resolves tags without regard to
// case, so this does too.
export function knownLocalContextWindow(modelId: string): number | null {
  const wanted = modelId.toLowerCase();
  for (const [id, tokens] of learnedWindows) {
    if (id.toLowerCase() === wanted) return tokens;
  }
  return null;
}

export const DEFAULT_LOCAL_CONTEXT_TOKENS = 131_072;

export function localModelContextWindow(modelId: string): number {
  return knownLocalContextWindow(modelId) ?? DEFAULT_LOCAL_CONTEXT_TOKENS;
}

// Any tag Ollama can serve. The type was once the union of five documented
// builds; a campaign saved with one of those reads the same today.
export type LocalTextModelId = string;

export const MAX_MODEL_ID_LENGTH = 200;

// A usable Ollama tag: non-empty, one line, no longer than the settings
// fields hold. Whether Ollama has it is the registry's question, not this
// one's, so a model pulled after the app shipped is as welcome as the
// documented ones.
export function isLocalTextModelId(value: unknown): value is LocalTextModelId {
  return typeof value === "string" && value.trim() !== "" && value.trim() === value && value.length <= MAX_MODEL_ID_LENGTH && !/[\s]/.test(value);
}

export function isTextProvider(value: unknown): value is TextProvider {
  return value === "local" || value === "custom" || value === "none" || value === "harness";
}
