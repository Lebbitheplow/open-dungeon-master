import {
  allocateSeq,
  getCampaignById,
  getCampaignSummaryState,
  listMembers,
  setCampaignScene,
  setFloor,
  type Campaign,
} from "@/lib/db/campaigns";
import {
  createDmTurn,
  createPendingRoll,
  failStaleRunningTurns,
  getDmTurn,
  listPendingForTurn,
  saveDmTurn,
  type DmTurn,
} from "@/lib/db/dm-turns";
import { insertCampaignMessage, listAllMessages } from "@/lib/db/messages";
import { getRoll, insertRoll, listRecentRolls } from "@/lib/db/rolls";
import { listSheets } from "@/lib/db/sheets";
import { rollExpression } from "@/lib/dice";
import { publishEphemeral, publishPersisted, publishWithSeq } from "@/lib/events";
import { generateImageTool, parseGenerateImageToolCall } from "@/lib/image-tool";
import { createStreamingArtifactFilter, extractStoryText } from "@/lib/story-prompt";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { fulfillMessageImage } from "@/lib/dm/images";
import { enqueueNarrationAudio } from "@/lib/tts";
import { requestDmMessage } from "@/lib/dm/model";
import {
  extractToolCalls,
  resolveRollExpression,
  resolveSheetRef,
  rollArgsSchema,
  type RollArgs,
} from "@/lib/dm/rolls";
import {
  buildDmMessages,
  movePartyTool,
  recallStoryTool,
  recordEventTool,
  requestPlayerInputTool,
  requestRollTool,
  updateLocationTool,
} from "@/lib/dm/prompt";
import { listChapters } from "@/lib/db/chapters";
import { maybeCloseChapter } from "@/lib/dm/chapter-close";
import {
  hasRecentIdenticalEvent,
  insertCharacterEvent,
  listRecentEventsForCampaign,
  CHARACTER_EVENT_KINDS,
  type CharacterEventKind,
} from "@/lib/db/character-events";
import { enqueueLocationMap } from "@/lib/dm/maps";
import {
  getCurrentLocation,
  listLocations,
  updateCurrentLocationDetails,
  upsertCurrentLocation,
} from "@/lib/db/locations";
import { maybeCompactHistory } from "@/lib/dm/compaction";
import {
  applyDmMutation,
  MUTATION_CAP_PER_TURN,
  MUTATION_TOOL_NAMES,
  mutationTools,
} from "@/lib/dm/mutations";

const MUTATION_NAMES = new Set<string>(MUTATION_TOOL_NAMES);

// One DM turn is a bounded tool loop: narrate -> maybe request rolls ->
// server rolls -> model interprets -> ... -> final narration. The model
// never invents dice results; every number comes from src/lib/dice.
//
// The turn is a PERSISTED state machine (dm_turns): when a roll belongs to
// a player using physical dice, the turn saves its conversation, parks as
// awaiting_rolls, and the queue job ends. Submitting the roll enqueues
// resumeDmTurn, which appends the results and continues. Parked turns
// survive restarts.
const MAX_MODEL_CALLS = 4;

type TurnContext = {
  campaign: Campaign;
  sheets: CharacterSheet[];
  sheetsById: Map<string, CharacterSheet>;
  realDiceUserIds: Set<string>;
};

function loadContext(campaign: Campaign): TurnContext {
  const sheets = listSheets(campaign.id);
  const members = listMembers(campaign.id);
  const realDiceUserIds =
    campaign.gameSettings.dicePolicy === "real_allowed"
      ? new Set(members.filter((member) => member.useRealDice).map((member) => member.userId))
      : new Set<string>();
  return {
    campaign,
    sheets,
    sheetsById: new Map(sheets.map((sheet) => [sheet.id, sheet])),
    realDiceUserIds,
  };
}

export async function startDmTurn(campaignId: string) {
  const campaign = getCampaignById(campaignId);
  if (!campaign || campaign.status !== "active") {
    return;
  }
  failStaleRunningTurns(campaignId);

  publishEphemeral(campaignId, "dm_status", { state: "thinking" });

  const context = loadContext(campaign);
  const history = listAllMessages(campaignId);
  const { summary } = getCampaignSummaryState(campaignId);
  const currentLocation = getCurrentLocation(campaignId);
  const conversation = buildDmMessages(
    {
      campaign,
      members: listMembers(campaignId),
      sheets: context.sheets,
      recentRolls: listRecentRolls(campaignId, 5),
      storySummary: summary,
      currentLocation: currentLocation
        ? {
            name: currentLocation.name,
            layoutDescription: currentLocation.layoutDescription,
            connections: currentLocation.connections,
          }
        : null,
      visitedLocationNames: listLocations(campaignId)
        .filter((location) => location.visited)
        .map((location) => location.name)
        .slice(0, 15),
      recentEventsByCharacter: new Map(
        [...listRecentEventsForCampaign(campaignId, 3)].map(([characterId, events]) => [
          characterId,
          events.map((event) => event.summary),
        ]),
      ),
      chapters: listChapters(campaignId)
        .filter((chapter) => chapter.status === "closed")
        .map((chapter) => ({
          index: chapter.index,
          title: chapter.title,
          oneLiner: chapter.highlights[0] ?? "",
        })),
    },
    history,
  );

  const turn = createDmTurn(campaignId, conversation);
  await advance(context, turn);
}

export async function resumeDmTurn(campaignId: string, turnId: string) {
  const campaign = getCampaignById(campaignId);
  const turn = getDmTurn(turnId);
  if (!campaign || campaign.status !== "active" || !turn || turn.status !== "awaiting_rolls") {
    return;
  }
  const pendings = listPendingForTurn(turnId);
  if (pendings.some((pending) => pending.status === "pending")) {
    return;
  }

  // Answer each parked tool call with the roll the player entered (or the
  // digital fallback), in creation order.
  for (const pending of pendings) {
    const roll = pending.rollId ? getRoll(pending.rollId) : null;
    if (!roll) {
      continue;
    }
    if (!turn.rollIds.includes(roll.id)) {
      turn.rollIds.push(roll.id);
    }
    turn.conversation.push({
      role: "tool",
      ...(pending.toolCallId ? { tool_call_id: pending.toolCallId } : {}),
      content: JSON.stringify({
        total: roll.total,
        dice: roll.breakdown.terms,
        ...(pending.dc !== null ? { dc: pending.dc, success: roll.total >= pending.dc } : {}),
        ...(roll.breakdown.crit ? { crit: roll.breakdown.crit } : {}),
        rolledBy: pending.status === "submitted" ? "the player, with physical dice" : "the server",
        note: "Narrate this real result. Do not roll again for the same action.",
      }),
    });
  }

  turn.status = "running";
  saveDmTurn(turn);
  publishEphemeral(campaignId, "dm_status", { state: "narrating" });
  await advance(loadContext(campaign), turn);
}

async function advance(context: TurnContext, turn: DmTurn) {
  const { campaign, sheets, sheetsById, realDiceUserIds } = context;
  const campaignId = campaign.id;
  let failed = "";
  let spotlightSet = false;

  const imageEnabled =
    campaign.settings.imageGenerationEnabled && campaign.settings.autoImages;
  // DM_LEAN_TOOLS=1 trims the mutation tools if the model's tool fidelity
  // suffers under the full set.
  const leanTools = process.env.DM_LEAN_TOOLS === "1";
  const tools = [
    requestRollTool,
    requestPlayerInputTool,
    movePartyTool,
    updateLocationTool,
    recordEventTool,
    recallStoryTool,
    ...(leanTools ? [] : mutationTools),
    ...(imageEnabled ? [generateImageTool] : []),
  ];
  let movedParty = false;

  while (turn.callIndex < MAX_MODEL_CALLS) {
    const finalCall = turn.callIndex === MAX_MODEL_CALLS - 1;
    // Fresh reasoning-artifact filter per model call; each call is its own
    // stream. Withheld trailing text is flushed after the call completes.
    const filter = createStreamingArtifactFilter();
    const { message, error } = await requestDmMessage(campaign.settings, turn.conversation, {
      tools,
      // Force pure narration on the last permitted call so a tool-happy
      // model cannot loop forever.
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
        `[dm-debug] call ${turn.callIndex}: content=${JSON.stringify(String(message?.content ?? "").slice(0, 300))} tool_calls=${JSON.stringify(message?.tool_calls ?? null).slice(0, 500)}`,
      );
    }
    turn.callIndex += 1;

    const visibleText = extractStoryText(message?.content);
    if (visibleText?.trim()) {
      turn.narrationParts.push(visibleText.trim());
    }

    const toolCalls = extractToolCalls(message?.tool_calls);
    const rollCalls = toolCalls.filter((toolCall) => toolCall.name === "request_roll");
    const inputCalls = toolCalls.filter(
      (toolCall) => toolCall.name === "request_player_input",
    );
    const mutationCalls = toolCalls.filter((toolCall) => MUTATION_NAMES.has(toolCall.name));
    const locationCalls = toolCalls.filter(
      (toolCall) => toolCall.name === "move_party" || toolCall.name === "update_location",
    );
    const eventCalls = toolCalls.filter((toolCall) => toolCall.name === "record_event");
    const recallCalls = toolCalls.filter((toolCall) => toolCall.name === "recall_story");

    // Location bookkeeping is synchronous and cheap; maps render async on
    // the media queue when vision allows.
    const locationResults = new Map<string, Record<string, unknown>>();
    for (const locationCall of locationCalls) {
      const result = handleLocationCall(campaign, locationCall.name, locationCall.rawArguments);
      if (result.movedToNewLocation) {
        movedParty = true;
        delete result.movedToNewLocation;
      }
      locationResults.set(locationCall.id ?? locationCall.name, result);
    }
    const recallResults = new Map<string, Record<string, unknown>>();
    for (const recallCall of recallCalls) {
      recallResults.set(
        recallCall.id ?? "recall_story",
        handleRecallStory(campaignId, recallCall.rawArguments),
      );
    }
    const eventResults = new Map<string, Record<string, unknown>>();
    for (const eventCall of eventCalls) {
      eventResults.set(
        eventCall.id ?? "record_event",
        handleRecordEvent(campaign, eventCall.rawArguments, sheets, sheetsById),
      );
    }
    if (!turn.imageArgs) {
      const parsedImage = parseGenerateImageToolCall(message?.tool_calls);
      if (parsedImage?.prompt) {
        turn.imageArgs = { prompt: parsedImage.prompt, reason: parsedImage.reason };
      }
    }

    // Spotlight: hand the floor to the named characters.
    if (inputCalls.length && !spotlightSet) {
      const floorUserIds = parseSpotlightUserIds(inputCalls[0].rawArguments, sheets, sheetsById);
      if (floorUserIds) {
        const floor = {
          mode: "spotlight" as const,
          userIds: floorUserIds.userIds,
          prompt: floorUserIds.prompt,
        };
        setFloor(campaignId, floor);
        publishPersisted(campaignId, "floor_changed", { floor });
        spotlightSet = true;
      }
    }

    // Location-only calls with narration already in hand are pure
    // bookkeeping (applied above); the turn can end without another call.
    const needsFollowUp =
      rollCalls.length > 0 ||
      mutationCalls.length > 0 ||
      // The model asked for a chapter recall in order to use the answer.
      recallCalls.length > 0 ||
      ((locationCalls.length > 0 || eventCalls.length > 0) && !turn.narrationParts.length);

    if (!needsFollowUp) {
      saveDmTurn(turn);
      // A spotlight with no narration yet gets one forced-narration call so
      // the turn never lands empty.
      if (spotlightSet && !turn.narrationParts.length && !finalCall) {
        turn.conversation.push({
          role: "assistant",
          content: visibleText || "",
          tool_calls: message?.tool_calls,
        });
        for (const inputCall of inputCalls) {
          turn.conversation.push({
            role: "tool",
            ...(inputCall.id ? { tool_call_id: inputCall.id } : {}),
            content: JSON.stringify({
              ok: true,
              note: "The floor is theirs. Narrate the moment and stop.",
            }),
          });
        }
        continue;
      }
      break;
    }
    if (finalCall) {
      saveDmTurn(turn);
      break;
    }

    publishEphemeral(campaignId, "dm_status", { state: "rolling" });

    // Echo the assistant turn (with its tool calls) then answer each call
    // with a tool result carrying the real dice outcome.
    turn.conversation.push({
      role: "assistant",
      content: visibleText || "",
      tool_calls: message?.tool_calls,
    });

    for (const inputCall of inputCalls) {
      turn.conversation.push({
        role: "tool",
        ...(inputCall.id ? { tool_call_id: inputCall.id } : {}),
        content: JSON.stringify({ ok: spotlightSet, note: "Floor updated." }),
      });
    }

    for (const locationCall of locationCalls) {
      turn.conversation.push({
        role: "tool",
        ...(locationCall.id ? { tool_call_id: locationCall.id } : {}),
        content: JSON.stringify(
          locationResults.get(locationCall.id ?? locationCall.name) ?? { ok: true },
        ),
      });
    }

    for (const eventCall of eventCalls) {
      turn.conversation.push({
        role: "tool",
        ...(eventCall.id ? { tool_call_id: eventCall.id } : {}),
        content: JSON.stringify(
          eventResults.get(eventCall.id ?? "record_event") ?? { ok: true },
        ),
      });
    }

    for (const recallCall of recallCalls) {
      turn.conversation.push({
        role: "tool",
        ...(recallCall.id ? { tool_call_id: recallCall.id } : {}),
        content: JSON.stringify(
          recallResults.get(recallCall.id ?? "recall_story") ?? { ok: true },
        ),
      });
    }

    // Stat mutations resolve synchronously; the model narrates from the
    // compact results. A hard per-turn cap bounds the blast radius.
    for (const mutationCall of mutationCalls) {
      let result: Record<string, unknown>;
      if (turn.mutationCount >= MUTATION_CAP_PER_TURN) {
        result = { error: "Mutation limit reached for this turn." };
      } else {
        result = applyDmMutation(
          campaign,
          turn.id,
          mutationCall.name,
          mutationCall.rawArguments,
          sheets,
          sheetsById,
        ).result;
        if (!("error" in result)) {
          turn.mutationCount += 1;
        }
      }
      turn.conversation.push({
        role: "tool",
        ...(mutationCall.id ? { tool_call_id: mutationCall.id } : {}),
        content: JSON.stringify(result),
      });
    }

    let parkedAny = false;
    for (const rollCall of rollCalls) {
      let parsedArgs: RollArgs | null = null;
      try {
        parsedArgs = rollArgsSchema.parse(JSON.parse(rollCall.rawArguments || "{}"));
      } catch {
        parsedArgs = null;
      }

      if (!parsedArgs) {
        turn.conversation.push({
          role: "tool",
          ...(rollCall.id ? { tool_call_id: rollCall.id } : {}),
          content: JSON.stringify({
            error:
              "Invalid request_roll arguments. Send JSON with kind, and skill/ability/dc or expression as documented.",
          }),
        });
        continue;
      }

      const sheet = resolveSheetRef(parsedArgs.characterId, sheets, sheetsById);
      const resolved = resolveRollExpression(parsedArgs, sheet);
      if ("error" in resolved) {
        turn.conversation.push({
          role: "tool",
          ...(rollCall.id ? { tool_call_id: rollCall.id } : {}),
          content: JSON.stringify({ error: resolved.error }),
        });
        continue;
      }

      // Physical dice: park this call for the player instead of rolling.
      if (sheet && realDiceUserIds.has(sheet.userId)) {
        const pending = createPendingRoll({
          campaignId,
          turnId: turn.id,
          toolCallId: rollCall.id ?? null,
          userId: sheet.userId,
          characterId: sheet.id,
          kind: parsedArgs.kind,
          detail: resolved.detail,
          expression: resolved.expression,
          advantage: parsedArgs.advantage ?? "none",
          dc: parsedArgs.dc ?? null,
          reason: parsedArgs.reason?.slice(0, 200) ?? "",
        });
        publishPersisted(campaignId, "roll_pending", { pendingRoll: pending });
        parkedAny = true;
        continue;
      }

      // Digital roll: resolve immediately.
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
        turn.rollIds.push(roll.id);
        publishWithSeq(campaignId, allocateSeq(campaignId), "roll_result", { roll });
        turn.conversation.push({
          role: "tool",
          ...(rollCall.id ? { tool_call_id: rollCall.id } : {}),
          content: JSON.stringify({
            total: roll.total,
            dice: outcome.terms,
            ...(parsedArgs.dc !== undefined
              ? { dc: parsedArgs.dc, success: roll.total >= parsedArgs.dc }
              : {}),
            ...(outcome.crit ? { crit: outcome.crit } : {}),
            note: "Narrate this real result. Do not roll again for the same action.",
          }),
        });
      } catch (rollError) {
        turn.conversation.push({
          role: "tool",
          ...(rollCall.id ? { tool_call_id: rollCall.id } : {}),
          content: JSON.stringify({
            error: rollError instanceof Error ? rollError.message : "Invalid dice expression.",
          }),
        });
      }
    }

    if (parkedAny) {
      // Park: the queue job ends here. Submissions resume the turn.
      turn.status = "awaiting_rolls";
      saveDmTurn(turn);
      publishEphemeral(campaignId, "dm_status", { state: "awaiting_rolls" });
      return;
    }

    saveDmTurn(turn);
    publishEphemeral(campaignId, "dm_status", { state: "narrating" });
  }

  finalize(context, turn, failed);
  if (!failed) {
    await maybeCloseChapter(campaignId, { movedParty });
    await maybeCompactHistory(campaignId, listAllMessages(campaignId));
  }
}

// recall_story: return a past chapter's full summary by number, or the
// best matches for a query over titles, summaries, and highlights.
function handleRecallStory(campaignId: string, rawArguments: string): Record<string, unknown> {
  let args: { chapter?: unknown; query?: unknown };
  try {
    args = JSON.parse(rawArguments || "{}");
  } catch {
    return { error: "Invalid arguments." };
  }
  const closed = listChapters(campaignId).filter((chapter) => chapter.status === "closed");
  if (!closed.length) {
    return { error: "No closed chapters yet; the story is still in its first chapter." };
  }
  const describe = (chapter: (typeof closed)[number]) => ({
    chapter: chapter.index,
    title: chapter.title,
    summary: chapter.summary,
    highlights: chapter.highlights,
  });
  const requested = Number(args.chapter);
  if (Number.isInteger(requested) && requested > 0) {
    const match = closed.find((chapter) => chapter.index === requested);
    return match
      ? describe(match)
      : {
          error: `No closed chapter ${requested}.`,
          availableChapters: closed.map((chapter) => `${chapter.index}. ${chapter.title}`),
        };
  }
  const query = String(args.query ?? "").trim().toLowerCase();
  if (!query) {
    return {
      error: "Give a chapter number or a query.",
      availableChapters: closed.map((chapter) => `${chapter.index}. ${chapter.title}`),
    };
  }
  const terms = query.split(/\s+/).filter((term) => term.length > 2);
  const scored = closed
    .map((chapter) => {
      const haystack =
        `${chapter.title} ${chapter.summary} ${chapter.highlights.join(" ")}`.toLowerCase();
      const score = terms.reduce(
        (sum, term) => sum + (haystack.includes(term) ? 1 : 0),
        haystack.includes(query) ? 3 : 0,
      );
      return { chapter, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);
  if (!scored.length) {
    return {
      error: "Nothing matched.",
      availableChapters: closed.map((chapter) => `${chapter.index}. ${chapter.title}`),
    };
  }
  return { matches: scored.slice(0, 2).map((entry) => describe(entry.chapter)) };
}

// record_event: a lasting milestone on the character's permanent record
// (feeds the profile "story so far" and future GAME STATE blocks).
function handleRecordEvent(
  campaign: Campaign,
  rawArguments: string,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
): Record<string, unknown> {
  let args: { characterId?: unknown; kind?: unknown; summary?: unknown };
  try {
    args = JSON.parse(rawArguments || "{}");
  } catch {
    return { error: "Invalid arguments." };
  }
  const sheet = resolveSheetRef(
    typeof args.characterId === "string" ? args.characterId : undefined,
    sheets,
    sheetsById,
  );
  if (!sheet) {
    return { error: "Unknown characterId; use one from GAME STATE." };
  }
  const kind = String(args.kind ?? "story") as CharacterEventKind;
  if (!CHARACTER_EVENT_KINDS.includes(kind)) {
    return { error: `kind must be one of: ${CHARACTER_EVENT_KINDS.join(", ")}.` };
  }
  const summary = String(args.summary ?? "").trim().slice(0, 300);
  if (!summary) {
    return { error: "record_event needs a one-sentence summary." };
  }
  if (hasRecentIdenticalEvent(sheet.id, summary)) {
    return { ok: true, note: "Already recorded." };
  }
  const event = insertCharacterEvent({
    libraryCharacterId: sheet.libraryCharacterId,
    campaignCharacterId: sheet.id,
    campaignId: campaign.id,
    seq: allocateSeq(campaign.id),
    kind,
    summary,
  });
  publishPersisted(campaign.id, "character_event", { event, characterName: sheet.name });
  return { ok: true };
}

// move_party / update_location: record the structured area state, keep the
// campaign scene in sync, and kick off a map render when vision allows.
function handleLocationCall(
  campaign: Campaign,
  toolName: string,
  rawArguments: string,
): Record<string, unknown> {
  let args: {
    name?: unknown;
    layoutDescription?: unknown;
    connections?: unknown;
    visionClear?: unknown;
  };
  try {
    args = JSON.parse(rawArguments || "{}");
  } catch {
    return { error: "Invalid arguments." };
  }
  const layoutDescription =
    typeof args.layoutDescription === "string" ? args.layoutDescription : undefined;
  const connections = Array.isArray(args.connections)
    ? args.connections.map(String).slice(0, 12)
    : undefined;
  const visionClear = args.visionClear === true;

  let location;
  let previousLayout = "";
  let movedToNewLocation = false;
  if (toolName === "move_party") {
    const name = typeof args.name === "string" ? args.name.trim() : "";
    if (!name) {
      return { error: "move_party needs a location name." };
    }
    const previous = getCurrentLocation(campaign.id);
    location = upsertCurrentLocation({
      campaignId: campaign.id,
      name,
      layoutDescription,
      connections,
    });
    movedToNewLocation = !previous || previous.id !== location.id;
    // Keep the old area linked to the new one so routes stay consistent.
    if (previous && previous.id !== location.id) {
      const merged = [...new Set([...location.connections, previous.name])];
      if (merged.length !== location.connections.length) {
        location =
          updateCurrentLocationDetails(campaign.id, { connections: merged }) ?? location;
      }
    }
    setCampaignScene(campaign.id, location.name);
  } else {
    previousLayout = getCurrentLocation(campaign.id)?.layoutDescription ?? "";
    location = updateCurrentLocationDetails(campaign.id, { layoutDescription, connections });
    if (!location) {
      return { error: "No current location; call move_party first." };
    }
  }

  publishPersisted(campaign.id, "location_updated", { location });

  // Render when the area has no map yet, or when an update materially
  // changed the recorded layout.
  const layoutRevised =
    toolName === "update_location" && location.layoutDescription !== previousLayout;
  if (
    visionClear &&
    campaign.gameSettings.mapsEnabled &&
    campaign.settings.imageBackend === "comfyui" &&
    (!location.mapImage || layoutRevised)
  ) {
    void enqueueLocationMap(campaign, location.id);
  }

  return {
    ok: true,
    location: location.name,
    note: "Recorded. Continue the scene.",
    // Consumed by advance() as the chapter-break signal, then stripped
    // before the result reaches the model.
    ...(movedToNewLocation ? { movedToNewLocation: true } : {}),
  };
}

function parseSpotlightUserIds(
  rawArguments: string,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
): { userIds: string[]; prompt: string } | null {
  try {
    const parsed = JSON.parse(rawArguments || "{}") as {
      characterIds?: unknown;
      prompt?: unknown;
    };
    const ids = Array.isArray(parsed.characterIds) ? parsed.characterIds.map(String) : [];
    const userIds = [
      ...new Set(
        ids
          .map((requested) => resolveSheetRef(requested, sheets, sheetsById))
          .filter((sheet): sheet is CharacterSheet => sheet !== null)
          .map((sheet) => sheet.userId),
      ),
    ];
    return userIds.length ? { userIds, prompt: String(parsed.prompt ?? "") } : null;
  } catch {
    return null;
  }
}

function finalize(context: TurnContext, turn: DmTurn, failed: string) {
  const campaignId = context.campaign.id;

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
    turn.status = "failed";
    saveDmTurn(turn);
    return;
  }

  // Persist the turn: narration segments joined, roll markers appended so
  // the UI renders dice cards inline between narration and interpretation.
  const narrationParts = turn.narrationParts;
  let content = narrationParts.join("\n\n").trim();
  if (!content) {
    content = "The moment hangs there, waiting on the party's next move.";
  }
  if (turn.rollIds.length && narrationParts.length > 1) {
    const lastPart = narrationParts[narrationParts.length - 1];
    const earlier = narrationParts.slice(0, -1).join("\n\n");
    content = `${earlier}\n\n${turn.rollIds.map((id) => `[roll:${id}]`).join("\n")}\n\n${lastPart}`;
  } else if (turn.rollIds.length) {
    content = `${turn.rollIds.map((id) => `[roll:${id}]`).join("\n")}\n\n${content}`;
  }

  const imageEnabled =
    context.campaign.settings.imageGenerationEnabled && context.campaign.settings.autoImages;
  const seq = allocateSeq(campaignId);
  const message = insertCampaignMessage({
    campaignId,
    seq,
    authorType: "dm",
    content,
    imageRequest:
      imageEnabled && turn.imageArgs?.prompt
        ? {
            needed: true,
            prompt: turn.imageArgs.prompt,
            mode: context.campaign.settings.imageMode,
            backend: context.campaign.settings.imageBackend,
            aspect: context.campaign.settings.aspect,
            reason: turn.imageArgs.reason,
            characterIds: [],
          }
        : undefined,
  });
  publishWithSeq(campaignId, seq, "message_added", { message });
  publishEphemeral(campaignId, "dm_status", { state: "idle" });

  if (message.imageRequest && context.campaign.settings.imageBackend === "comfyui") {
    void fulfillMessageImage(campaignId, message.id, message.imageRequest, context.campaign.settings);
  }
  if (context.campaign.gameSettings.ttsEnabled) {
    void enqueueNarrationAudio(
      campaignId,
      message.id,
      content,
      context.campaign.gameSettings.ttsVoice,
    );
  }

  turn.status = "done";
  saveDmTurn(turn);
}
