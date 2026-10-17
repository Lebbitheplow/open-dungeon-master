// What the DM turn changes for the model a table runs on (issue #383), read
// from what the server knows about the model rather than from its name: the
// window it was launched with or the catalog gives, and the catalog's row
// (src/lib/model-registry). No model is named here, and none may be; a
// table of per-model prompt edits would go stale with every release, as the
// hard-coded model lists did before the registry.
//
// Three settings used to be one global switch each, set in the environment
// and the same for every model: the trimmed tool set (DM_LEAN_TOOLS), the
// thinking request on tool-deciding calls (DM_THINKING) and the reply cap
// (OPENROUTER_MAX_TOKENS). A switch set in the environment still wins.
//
// Dependency-free so scripts/test-model-tuning.mjs can import it directly.

export type CatalogFacts = {
  // 0 = the catalog does not say.
  outputTokens: number;
  toolCall: boolean;
  reasoning: boolean;
};

export type ModelTuning = {
  // Which tools a call is offered (src/lib/dm/tool-profiles.ts): the full
  // set, the full set less the sheet-changing tools, or the compact core
  // with the rest one more_tools call away.
  toolProfile: "full" | "lean" | "compact";
  leanTools: boolean;
  thinking: boolean;
  // The most a reply may run to, when the catalog caps the model below the
  // configured default; null keeps the default.
  outputCap: number | null;
  // Why, one line per setting the model changed, for the Context panel.
  notes: string[];
};

// The full tool set must leave at least this much of the window for the
// prompt and the reply, or the trimmed set is used. The documented default
// (a 64K window, a ~27K tool set) keeps the full set.
export const MIN_STORY_ROOM_TOKENS = 32_000;
// The trimmed set must leave at least this much, or the compact profile is
// used: a 48K window keeps the trimmed set as before, while 32K and less (the
// windows where the rules, the tools and a reply did not fit together) get
// the compact core and its more_tools (the context audit's F02).
export const MIN_LEAN_ROOM_TOKENS = 24_000;

function envSwitch(value: string | undefined): boolean | null {
  const raw = (value ?? "").trim();
  if (raw === "1") return true;
  if (raw === "0") return false;
  return null;
}

function tokens(count: number): string {
  return count >= 1_000 ? `${Math.round(count / 1_000)}K` : String(count);
}

function profileSwitch(value: string | undefined): ModelTuning["toolProfile"] | null {
  const raw = (value ?? "").trim().toLowerCase();
  return raw === "full" || raw === "lean" || raw === "compact" ? raw : null;
}

export function tuneForModel(input: {
  windowTokens: number;
  fullToolTokens: number;
  // The trimmed set's cost; absent, the trimmed set is judged as before
  // and the compact profile is never chosen on its own.
  leanToolTokens?: number;
  catalog: CatalogFacts | null;
  configuredOutputTokens: number;
  env?: { leanTools?: string; thinking?: string; toolProfile?: string };
}): ModelTuning {
  const notes: string[] = [];
  const { catalog } = input;

  const profileForced = profileSwitch(input.env?.toolProfile);
  const leanForced = envSwitch(input.env?.leanTools);
  const room = input.windowTokens - input.fullToolTokens;
  const leanRoom = input.leanToolTokens === undefined ? Number.POSITIVE_INFINITY : input.windowTokens - input.leanToolTokens;
  let toolProfile: ModelTuning["toolProfile"];
  if (profileForced) {
    toolProfile = profileForced;
    if (profileForced !== "full") notes.push(`${profileForced === "lean" ? "Trimmed" : "Compact"} tool set: DM_TOOL_PROFILE=${profileForced} in the server's environment.`);
  } else if (leanForced !== null) {
    toolProfile = leanForced ? "lean" : "full";
    if (leanForced) notes.push("Trimmed tool set: DM_LEAN_TOOLS=1 in the server's environment.");
  } else if (catalog && !catalog.toolCall) {
    toolProfile = "lean";
    notes.push("Trimmed tool set: the model catalog says this model takes no tool calls, so it is offered the fewest.");
  } else if (room >= MIN_STORY_ROOM_TOKENS) {
    toolProfile = "full";
  } else if (leanRoom >= MIN_LEAN_ROOM_TOKENS) {
    toolProfile = "lean";
    notes.push(
      `Trimmed tool set: the full set (about ${tokens(input.fullToolTokens)} tokens) would leave only ${tokens(Math.max(0, room))} of the ${tokens(input.windowTokens)} window for the story.`,
    );
  } else {
    toolProfile = "compact";
    notes.push(
      `Compact tool set: even the trimmed set (about ${tokens(input.leanToolTokens ?? 0)} tokens) would leave only ${tokens(Math.max(0, leanRoom))} of the ${tokens(input.windowTokens)} window, so calls carry the core actions and the rules they need, and the rest are one more_tools call away.`,
    );
  }
  const leanTools = toolProfile === "lean";

  const thinkingForced = envSwitch(input.env?.thinking);
  let thinking: boolean;
  if (thinkingForced !== null) {
    thinking = thinkingForced;
    if (!thinkingForced) notes.push("No thinking on tool calls: DM_THINKING=0 in the server's environment.");
  } else if (catalog && !catalog.reasoning) {
    thinking = false;
    notes.push("No thinking on tool calls: the model catalog says this model does not reason, so it samples at its usual temperature.");
  } else {
    thinking = true;
  }

  let outputCap: number | null = null;
  if (catalog && catalog.outputTokens > 0 && catalog.outputTokens < input.configuredOutputTokens) {
    outputCap = catalog.outputTokens;
    notes.push(`Replies capped at ${tokens(catalog.outputTokens)} tokens, the most the model catalog says it writes.`);
  }

  return { toolProfile, leanTools, thinking, outputCap, notes };
}
