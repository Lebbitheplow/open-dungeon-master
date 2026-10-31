import type { StorySettings } from "@/lib/types";
import { checkTools } from "@/lib/dm/check-tools";
import { effectTools } from "@/lib/dm/effect-tools";
import { encounterTools } from "@/lib/dm/encounter-tools";
import { handleItemTool } from "@/lib/dm/gear-tool";
import { hazardTools } from "@/lib/dm/hazard-tools";
import { salvageJsonToolCalls } from "@/lib/dm/json-salvage";
import { requestDmMessage, type DmCallOptions } from "@/lib/dm/model";
import { storyModelTuning } from "@/lib/dm/model-tuning";
import { MIN_LEAN_ROOM_TOKENS, SMALL_MODEL_REASONING_CHARS, type ModelTuning } from "@/lib/dm/model-tuning-logic";
import {
  DM_SYSTEM,
  dmSystemText,
  firstMovePartyTool,
  recordEventTool,
  requestPlayerInputTool,
  requestRollTool,
  sendWhisperTool,
  updateLocationTool,
} from "@/lib/dm/prompt";
import { restTools } from "@/lib/dm/rest-tools";
import { extractToolCalls, salvageXmlToolCalls, type ParsedToolCall } from "@/lib/dm/rolls";
import { shopTools } from "@/lib/dm/shop-tools";
import { socialTools } from "@/lib/dm/social-tools";
import { compactTool, type ToolDefLike } from "@/lib/dm/tool-profiles";
import { worldTools } from "@/lib/dm/world-tools";
import { storyContextTokens, type ChatMessage, type UpstreamResult } from "@/lib/model-client";
import { extractReplyText, extractStoryText } from "@/lib/story-prompt";

// The quick probe (scripts/lib/provider-capability-probe.mjs) asks for one
// small tool on a one-line prompt, without streaming it. A campaign turn is
// heavier: the storyteller's whole rules, a few dozen tool schemas, the call
// streamed, and the narration asked for afterwards with the tools closed. A
// backend can pass the probe and still fail all of that (an OpenAI-compatible
// host whose streamed tool calls arrive broken, a model that loses its tools
// under a long prompt), and the table found out only once a campaign began.
// This plays one turn of that shape through the call a campaign's turn makes
// (requestDmMessage: the window fitted, the reply sized to what it leaves,
// the parameter retries and route switches), with the tools, rules and
// thinking a campaign on this backend would send, so a pass here is a pass
// at the table. It never sends more than that table's first call would.

type ToolDef = { function: { name: string } };

// What a turn on a small or unreported window carries, and what one with room
// carries. A server that does not report its window is planned at 16K
// (DEFAULT_CUSTOM_CONTEXT_TOKENS), and the larger set would overflow it.
const CORE_TOOLS: ToolDefLike[] = [
  requestRollTool,
  requestPlayerInputTool,
  firstMovePartyTool,
  updateLocationTool,
  recordEventTool,
  sendWhisperTool,
  ...checkTools,
];
const ROOMY_WINDOW = 32_768;

// The short rules as a small model's first call reads them: out of a fight,
// no group opened yet, the rest one more_tools call away. Lines a group or a
// class needs stay out, as they would on a table that has none of them.
const BRIEF_CONTEXT = {
  inEncounter: false,
  groups: new Set<string>(),
  caster: false,
  features: false,
  classFeatures: false,
  featSpells: false,
  dying: false,
  arc: false,
  recall: false,
  map: false,
  legendary: false,
  moreTools: true,
  classes: null,
  brief: true,
};

export type TrialShape = { tools: ToolDefLike[]; rules: string; tuning: ModelTuning };

// What the test turn sends for these settings. The profile, the short rules
// and thinking are the campaign's own answer (storyModelTuning). The trial
// does not tell the full profile from the trimmed one (both carry whole
// descriptions, and its set is smaller than either), so only where the
// compact profile begins matters: where the trimmed set leaves less than
// MIN_LEAN_ROOM_TOKENS, and the trimmed set is held to that size
// (scripts/test-tool-profiles.mjs keeps a 48K table on it). Below that a
// campaign sends first sentences only (compactTool), and so does the trial:
// whole descriptions there were 2,400 tokens more than a 32K table sends.
export function trialShape(settings: StorySettings): TrialShape {
  const windowTokens = storyContextTokens(settings);
  const tuning = storyModelTuning(settings, MIN_LEAN_ROOM_TOKENS, MIN_LEAN_ROOM_TOKENS);
  const set: ToolDefLike[] =
    windowTokens < ROOMY_WINDOW
      ? CORE_TOOLS
      : [
          ...CORE_TOOLS,
          ...socialTools,
          ...hazardTools,
          ...effectTools,
          ...encounterTools(false),
          ...worldTools,
          ...shopTools,
          ...restTools,
          handleItemTool,
        ];
  return {
    tools: tuning.toolProfile === "compact" ? set.map(compactTool) : set,
    rules: tuning.briefRules ? dmSystemText(false, BRIEF_CONTEXT) : DM_SYSTEM,
    tuning,
  };
}

const TRIAL_STATE = `GAME STATE
Location: the gatehouse of Kesh Barrow, a ruined hill fort at dusk.
Party:
- Ash (characterId: pc-ash), level 3 halfling rogue, proficient in Sleight of Hand and Stealth. HP 21/21.
Nobody else is here. The iron gate ahead is locked, and the lock is old but well made.`;

const TRIAL_ACTION = "[Ash] I kneel by the iron gate and try to pick its lock with my thieves' tools.";

// A roll the server would have made, answered the way the engine answers it.
const TRIAL_ROLL_RESULT = {
  ok: true,
  characterName: "Ash",
  roll: "1d20+5",
  total: 17,
  dc: 15,
  success: true,
};

export type TrialStage = { ok: boolean; detail?: string };
export type TrialResult = {
  ok: boolean;
  stages: { toolTurn: TrialStage; narration: TrialStage };
  toolCount: number;
  error?: string;
};

async function errorText(result: UpstreamResult): Promise<string> {
  const payload = (await result.error?.json().catch(() => null)) as { error?: string } | null;
  return payload?.error || `The backend answered ${result.error?.status ?? "with an error"}.`;
}

// The calls a turn would run from this reply: structured ones first, then
// the two nets a turn casts over calls written as text (src/lib/dm/turn.ts).
function callsIn(result: UpstreamResult, tools: unknown[]): { calls: ParsedToolCall[]; salvaged: boolean } {
  const structured = extractToolCalls(result.message?.tool_calls);
  if (structured.length) {
    return { calls: structured, salvaged: false };
  }
  const xml = salvageXmlToolCalls(extractReplyText(result.message?.content));
  const json = salvageJsonToolCalls(xml.text, tools);
  return { calls: [...xml.calls, ...json.calls], salvaged: true };
}

function argsObject(raw: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(raw || "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

export async function runBackendTrial(input: { settings: StorySettings; timeoutMs?: number }): Promise<TrialResult> {
  const { tools, rules, tuning } = trialShape(input.settings);
  const offered = new Set((tools as ToolDef[]).map((tool) => tool.function.name));
  const send = (messages: ChatMessage[], options: DmCallOptions) => requestDmMessage(input.settings, messages, options);
  const common: DmCallOptions = {
    timeoutMs: input.timeoutMs ?? 120_000,
    ...(tuning.outputCap ? { maxOutputTokens: tuning.outputCap } : {}),
    meta: { task: "backend_trial" },
  };
  const conversation: ChatMessage[] = [
    { role: "system", content: `${rules}\n\n${TRIAL_STATE}` },
    { role: "user", content: TRIAL_ACTION },
  ];
  const result = (toolTurn: TrialStage, narration: TrialStage, error?: string): TrialResult => ({
    ok: toolTurn.ok && narration.ok,
    stages: { toolTurn, narration },
    toolCount: tools.length,
    ...(error ? { error } : {}),
  });
  const skipped: TrialStage = { ok: false, detail: "Not tried: the tool call before it failed." };

  // A turn's first call: streamed, every tool offered, the model's choice,
  // thinking where a campaign's tool-deciding calls think (without it a
  // model a table plays well can narrate past its tools), and a small
  // model's thought cut as a turn cuts it.
  const first = await send(conversation, {
    ...common,
    tools,
    toolChoice: "auto",
    thinking: tuning.thinking,
    ...(tuning.briefRules ? { reasoningBudgetChars: SMALL_MODEL_REASONING_CHARS } : {}),
    onDelta: () => {},
  });
  if (first.error) {
    const error = await errorText(first);
    return result({ ok: false, detail: error }, skipped, error);
  }
  const { calls, salvaged } = callsIn(first, tools);
  const call = calls.find((entry) => offered.has(entry.name));
  if (!call) {
    const said = extractStoryText(extractReplyText(first.message?.content)).trim();
    const detail = calls.length
      ? `It called ${calls[0].name}, which is not one of the tools it was offered.`
      : first.finishReason === "length"
        ? "It ran out of room before calling a tool: the reply hit its output cap."
        : said
          ? "It narrated instead of calling a tool, so the table's dice and rules would never run."
          : "It answered with neither text nor a tool call.";
    return result({ ok: false, detail }, skipped);
  }
  if (!argsObject(call.rawArguments)) {
    return result({ ok: false, detail: `Its ${call.name} call came back with arguments that are not valid JSON.` }, skipped);
  }
  const toolTurn: TrialStage = {
    ok: true,
    detail: salvaged
      ? `Called ${call.name}, written as text rather than a structured call. A turn reads it, but less reliably.`
      : `Called ${call.name}.`,
  };

  // The tool result goes back, and the narration is asked for with the tools
  // closed, as a turn's last call is. A server that still answers with a
  // call gets one more try with no tools offered, as narrateAfterToolLeak in
  // src/lib/dm/turn.ts does.
  const callId = call.id || "trial-call-1";
  const answered: ChatMessage[] = [
    ...conversation,
    {
      role: "assistant",
      content: salvaged ? "" : extractReplyText(first.message?.content),
      tool_calls: [{ id: callId, type: "function", function: { name: call.name, arguments: call.rawArguments } }],
      ...(first.message?.provider_items?.length ? { provider_items: first.message.provider_items } : {}),
    },
    { role: "tool", tool_call_id: callId, content: JSON.stringify(TRIAL_ROLL_RESULT) },
  ];
  let narrated = "";
  const narrate = (options: DmCallOptions) => {
    narrated = "";
    return send(answered, { ...common, ...options, thinking: false, onDelta: (text) => (narrated += text) });
  };
  let last = await narrate({ tools, toolChoice: "none" });
  let leaked = false;
  if (!last.error && !narrated.trim() && callsIn(last, tools).calls.length) {
    leaked = true;
    last = await narrate({});
  }
  if (last.error) {
    const error = await errorText(last);
    return result(toolTurn, { ok: false, detail: error }, error);
  }
  const text = extractStoryText(narrated.trim() || extractReplyText(last.message?.content)).trim();
  if (!text) {
    return result(toolTurn, {
      ok: false,
      detail:
        last.finishReason === "length"
          ? "It ran out of room before narrating: the reply hit its output cap."
          : "It sent no narration after the tool result.",
    });
  }
  if (!narrated.trim()) {
    return result(toolTurn, { ok: false, detail: "It narrated, but the narration did not stream, so the table would wait for the whole reply in silence." });
  }
  return result(toolTurn, {
    ok: true,
    detail: leaked ? "Narrated once its tools were taken away; with them closed it still called one." : undefined,
  });
}
