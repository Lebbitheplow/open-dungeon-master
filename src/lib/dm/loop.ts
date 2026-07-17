import { z } from "zod";
import {
  allocateSeq,
  getCampaignById,
  getCampaignSummaryState,
  listMembers,
  setCampaignSummaryState,
} from "@/lib/db/campaigns";
import { insertCampaignMessage, listAllMessages, type CampaignMessage } from "@/lib/db/messages";
import { insertRoll, listRecentRolls } from "@/lib/db/rolls";
import { listSheets } from "@/lib/db/sheets";
import { d20Expression, rollExpression, type Advantage } from "@/lib/dice";
import { publishEphemeral, publishWithSeq } from "@/lib/events";
import { generateImageTool, parseGenerateImageToolCall } from "@/lib/image-tool";
import {
  requestCustomMessage,
  requestLocalMessage,
  type ChatMessage,
  type ChatRequestOptions,
  type StreamedToolCall,
  type UpstreamResult,
} from "@/lib/model-client";
import { computeSheetDerived, findSkill } from "@/lib/srd";
import { createStreamingArtifactFilter, extractStoryText } from "@/lib/story-prompt";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import type { StorySettings } from "@/lib/types";
import { buildDmMessages, requestRollTool } from "@/lib/dm/prompt";

// One DM turn is a bounded tool loop: narrate -> maybe request rolls ->
// server rolls -> model interprets -> ... -> final narration. The model
// never invents dice results; every number comes from src/lib/dice.
const MAX_MODEL_CALLS = 4;

const rollArgsSchema = z.object({
  characterId: z.string().optional(),
  kind: z.enum([
    "skill_check",
    "saving_throw",
    "ability_check",
    "attack",
    "damage",
    "initiative",
    "custom",
  ]),
  skill: z.string().optional(),
  ability: z.enum(["str", "dex", "con", "int", "wis", "cha"]).optional(),
  dc: z.number().int().min(1).max(40).optional(),
  expression: z.string().max(60).optional(),
  advantage: z.enum(["none", "advantage", "disadvantage"]).optional(),
  reason: z.string().optional(),
});

type ParsedToolCall = {
  id?: string;
  name: string;
  rawArguments: string;
};

function extractToolCalls(toolCalls: unknown): ParsedToolCall[] {
  if (!Array.isArray(toolCalls)) {
    return [];
  }
  const parsed: ParsedToolCall[] = [];
  for (const call of toolCalls) {
    const raw = call as StreamedToolCall & { function?: { name?: unknown; arguments?: unknown } };
    const name = typeof raw?.function?.name === "string" ? raw.function.name : "";
    if (!name) {
      continue;
    }
    const args =
      typeof raw.function?.arguments === "string"
        ? raw.function.arguments
        : JSON.stringify(raw.function?.arguments ?? {});
    parsed.push({ id: typeof raw.id === "string" ? raw.id : undefined, name, rawArguments: args });
  }
  return parsed;
}

// Resolve a request_roll call into a canonical expression using the sheet as
// the only source of modifiers.
function resolveRollExpression(
  args: z.infer<typeof rollArgsSchema>,
  sheet: CharacterSheet | null,
): { expression: string; detail: string } | { error: string } {
  const advantage: Advantage = args.advantage ?? "none";

  if (args.kind === "skill_check") {
    if (!sheet) {
      return { error: "skill_check needs a valid characterId from GAME STATE." };
    }
    // Models often send display names ("Sleight of Hand"); normalize to ids.
    const normalizedSkill = (args.skill ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
    const skill = normalizedSkill ? findSkill(normalizedSkill) : null;
    if (!skill) {
      return { error: `Unknown skill "${args.skill ?? ""}". Use a 5e skill id like "stealth".` };
    }
    const derived = computeSheetDerived(sheet);
    return {
      expression: d20Expression(derived.skills[skill.id] ?? 0, advantage),
      detail: skill.id,
    };
  }

  if (args.kind === "saving_throw" || args.kind === "ability_check") {
    if (!sheet) {
      return { error: `${args.kind} needs a valid characterId from GAME STATE.` };
    }
    if (!args.ability) {
      return { error: `${args.kind} needs an ability (str, dex, con, int, wis, cha).` };
    }
    const derived = computeSheetDerived(sheet);
    const modifier =
      args.kind === "saving_throw"
        ? derived.saves[args.ability]
        : derived.abilityMods[args.ability];
    return { expression: d20Expression(modifier, advantage), detail: args.ability };
  }

  if (args.kind === "initiative") {
    if (!sheet) {
      return { error: "initiative needs a valid characterId from GAME STATE." };
    }
    const derived = computeSheetDerived(sheet);
    return { expression: d20Expression(derived.initiative, advantage), detail: "initiative" };
  }

  // attack / damage / custom: the model supplies the expression (NPC stat
  // blocks live in its narration for now); the dice library enforces sanity.
  if (!args.expression) {
    return { error: `${args.kind} needs a dice expression like "1d20+4" or "2d6+2".` };
  }
  return { expression: args.expression, detail: args.reason?.slice(0, 60) ?? "" };
}

function requestDmMessage(
  settings: StorySettings,
  messages: ChatMessage[],
  options: ChatRequestOptions,
): Promise<UpstreamResult> {
  if (settings.textProvider === "local") {
    return requestLocalMessage(settings.localTextModel, messages, options);
  }
  return requestCustomMessage(
    settings.customBaseUrl,
    settings.customModel,
    settings.customApiKey,
    messages,
    options,
  );
}

// Runs one full DM narration turn for a campaign. Called via the per-campaign
// queue after a player action (or campaign kickoff).
export async function runDmTurn(campaignId: string) {
  const campaign = getCampaignById(campaignId);
  if (!campaign || campaign.status !== "active") {
    return;
  }

  publishEphemeral(campaignId, "dm_status", { state: "thinking" });

  const members = listMembers(campaignId);
  const sheets = listSheets(campaignId);
  const history = listAllMessages(campaignId);
  const { summary } = getCampaignSummaryState(campaignId);

  const state = {
    campaign,
    members,
    sheets,
    recentRolls: listRecentRolls(campaignId, 5),
    storySummary: summary,
  };

  const conversation: ChatMessage[] = buildDmMessages(state, history);
  const sheetsById = new Map(sheets.map((sheet) => [sheet.id, sheet]));

  const narrationParts: string[] = [];
  const rollIds: string[] = [];
  let imageArgs: ReturnType<typeof parseGenerateImageToolCall> = null;
  let failed = "";

  const imageEnabled =
    campaign.settings.imageGenerationEnabled && campaign.settings.autoImages;
  const tools = imageEnabled ? [requestRollTool, generateImageTool] : [requestRollTool];

  for (let call = 0; call < MAX_MODEL_CALLS; call += 1) {
    const finalCall = call === MAX_MODEL_CALLS - 1;
    // Fresh reasoning-artifact filter per model call; each call is its own
    // stream. Withheld trailing text is flushed after the call completes.
    const filter = createStreamingArtifactFilter();
    const { message, error } = await requestDmMessage(campaign.settings, conversation, {
      tools,
      // Force pure narration on the last permitted call so a tool-happy model
      // cannot loop forever.
      toolChoice: finalCall ? "none" : "auto",
      onDelta: (text) => {
        const visible = filter.push(text);
        if (visible) {
          publishEphemeral(campaignId, "dm_delta", { text: visible });
        }
      },
    });

    if (error) {
      const payload = (await error.json().catch(() => null)) as { error?: string } | null;
      failed = payload?.error || "The Dungeon Master could not reach the model backend.";
      break;
    }

    const trailing = filter.flush();
    if (trailing) {
      publishEphemeral(campaignId, "dm_delta", { text: trailing });
    }
    if (process.env.DM_DEBUG) {
      console.log(
        `[dm-debug] call ${call}: content=${JSON.stringify(String(message?.content ?? "").slice(0, 300))} tool_calls=${JSON.stringify(message?.tool_calls ?? null).slice(0, 500)}`,
      );
    }
    const visibleText = extractStoryText(message?.content);
    if (visibleText?.trim()) {
      narrationParts.push(visibleText.trim());
    }

    const toolCalls = extractToolCalls(message?.tool_calls);
    const rollCalls = toolCalls.filter((toolCall) => toolCall.name === "request_roll");
    if (!imageArgs) {
      imageArgs = parseGenerateImageToolCall(message?.tool_calls);
    }

    if (!rollCalls.length || finalCall) {
      break;
    }

    publishEphemeral(campaignId, "dm_status", { state: "rolling" });

    // Echo the assistant turn (with its tool calls) then answer each call
    // with a tool result carrying the real dice outcome.
    conversation.push({
      role: "assistant",
      content: visibleText || "",
      tool_calls: message?.tool_calls,
    });

    for (const rollCall of rollCalls) {
      let resultPayload: Record<string, unknown>;
      let parsedArgs: z.infer<typeof rollArgsSchema> | null = null;
      try {
        parsedArgs = rollArgsSchema.parse(JSON.parse(rollCall.rawArguments || "{}"));
      } catch {
        parsedArgs = null;
      }

      if (!parsedArgs) {
        resultPayload = {
          error:
            "Invalid request_roll arguments. Send JSON with kind, and skill/ability/dc or expression as documented.",
        };
      } else {
        // Prefer the exact characterId; fall back to a case-insensitive name
        // match, since models sometimes send the character's name instead.
        const requestedId = parsedArgs.characterId?.trim() ?? "";
        const sheet =
          sheetsById.get(requestedId) ??
          sheets.find((entry) => entry.name.toLowerCase() === requestedId.toLowerCase()) ??
          null;
        const resolved = resolveRollExpression(parsedArgs, sheet);
        if ("error" in resolved) {
          resultPayload = { error: resolved.error };
        } else {
          try {
            const outcome = rollExpression(resolved.expression);
            const roll = insertRoll({
              campaignId,
              characterId: sheet?.id ?? null,
              requestedBy: "dm",
              kind: parsedArgs.kind,
              detail: resolved.detail,
              advantage: parsedArgs.advantage ?? "none",
              dc: parsedArgs.dc ?? null,
              result: outcome,
            });
            rollIds.push(roll.id);
            publishWithSeq(campaignId, allocateSeq(campaignId), "roll_result", { roll });
            resultPayload = {
              total: roll.total,
              dice: outcome.terms,
              ...(parsedArgs.dc !== undefined
                ? { dc: parsedArgs.dc, success: roll.total >= parsedArgs.dc }
                : {}),
              ...(outcome.crit ? { crit: outcome.crit } : {}),
              note: "Narrate this real result. Do not roll again for the same action.",
            };
          } catch (rollError) {
            resultPayload = {
              error:
                rollError instanceof Error ? rollError.message : "Invalid dice expression.",
            };
          }
        }
      }

      conversation.push({
        role: "tool",
        ...(rollCall.id ? { tool_call_id: rollCall.id } : {}),
        content: JSON.stringify(resultPayload),
      });
    }

    publishEphemeral(campaignId, "dm_status", { state: "narrating" });
  }

  // Persist the turn: narration segments joined, roll markers appended so the
  // UI renders dice cards inline between narration and interpretation.
  let content = narrationParts.join("\n\n").trim();
  if (!content && !failed) {
    content = "The moment hangs there, waiting on the party's next move.";
  }

  if (failed) {
    const seq = allocateSeq(campaignId);
    const message = insertCampaignMessage({
      campaignId,
      seq,
      authorType: "system",
      content: `The DM ran into a problem: ${failed}`,
    });
    publishWithSeq(campaignId, seq, "message_added", { message });
    publishEphemeral(campaignId, "dm_status", { state: "idle" });
    return;
  }

  // Interleave roll markers before the final narration segment when rolls
  // happened mid-turn.
  if (rollIds.length && narrationParts.length > 1) {
    const lastPart = narrationParts[narrationParts.length - 1];
    const earlier = narrationParts.slice(0, -1).join("\n\n");
    content = `${earlier}\n\n${rollIds.map((id) => `[roll:${id}]`).join("\n")}\n\n${lastPart}`;
  } else if (rollIds.length) {
    content = `${rollIds.map((id) => `[roll:${id}]`).join("\n")}\n\n${content}`;
  }

  const seq = allocateSeq(campaignId);
  const message = insertCampaignMessage({
    campaignId,
    seq,
    authorType: "dm",
    content,
    imageRequest:
      imageEnabled && imageArgs?.prompt
        ? {
            needed: true,
            prompt: imageArgs.prompt,
            mode: campaign.settings.imageMode,
            backend: campaign.settings.imageBackend,
            aspect: campaign.settings.aspect,
            reason: imageArgs.reason,
            characterIds: [],
          }
        : undefined,
  });
  publishWithSeq(campaignId, seq, "message_added", { message });
  publishEphemeral(campaignId, "dm_status", { state: "idle" });

  await maybeCompactHistory(campaignId, history);
}

// Rolling-summary compaction, mirroring the solo narrator: once the log
// grows past a threshold, fold the oldest passages into the campaign summary.
const COMPACT_THRESHOLD = 120;
const COMPACT_BATCH = 40;

async function maybeCompactHistory(campaignId: string, history: CampaignMessage[]) {
  const campaign = getCampaignById(campaignId);
  if (!campaign || history.length < COMPACT_THRESHOLD) {
    return;
  }
  const { summary, coveredCount } = getCampaignSummaryState(campaignId);
  if (history.length - coveredCount < COMPACT_THRESHOLD) {
    return;
  }

  const batch = history.slice(coveredCount, coveredCount + COMPACT_BATCH);
  const transcript = batch
    .map((message) => `${message.authorType === "dm" ? "DM" : "Player"}: ${message.content}`)
    .join("\n\n");

  const { message } = await requestDmMessage(
    campaign.settings,
    [
      {
        role: "system",
        content:
          "You maintain the canonical campaign memory for an ongoing D&D 5e game. Merge the existing summary with the new passages into one updated summary. Preserve plot threads, NPCs met, promises, injuries, loot, locations, and party decisions. Compact past-tense prose, at most 500 words. Output only the summary.",
      },
      {
        role: "user",
        content: `Existing summary:\n${summary || "(none yet)"}\n\nNew passages to fold in:\n${transcript}`,
      },
    ],
    {},
  );

  const updated = extractStoryText(message?.content);
  if (updated) {
    setCampaignSummaryState(campaignId, updated.slice(0, 8_000), coveredCount + batch.length);
  }
}
