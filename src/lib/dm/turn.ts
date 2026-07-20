import {
  allocateSeq,
  getCampaignById,
  getCampaignSummaryState,
  getFloor,
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
  publicPendingRoll,
  saveDmTurn,
  type DmTurn,
} from "@/lib/db/dm-turns";
import { PC_ATTACK_PARKED } from "@/lib/dm/pc-attack";
import { normalizeEventKind } from "@/lib/dm/arg-coerce";
import { insertCampaignMessage, listRecentMessages } from "@/lib/db/messages";
import { getRoll, insertRoll, listRecentRolls } from "@/lib/db/rolls";
import { listSheets, patchSheet } from "@/lib/db/sheets";
import { removeConditions } from "@/lib/dm/condition-logic";
import { rollExpression } from "@/lib/dice";
import { publishEphemeral, publishPersisted, publishWithSeq } from "@/lib/events";
import { generateImageTool, parseGenerateImageToolCall } from "@/lib/image-tool";
import { createStreamingArtifactFilter, extractStoryText } from "@/lib/story-prompt";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { fulfillMessageImage } from "@/lib/dm/images";
import { enqueueNarrationAudio } from "@/lib/tts";
import { requestDmMessage } from "@/lib/dm/model";
import { setDmStatus } from "@/lib/dm/status";
import {
  extractToolCalls,
  resolveRollExpression,
  resolveSheetRef,
  rollArgsSchema,
  salvageProseRollAsks,
  salvageTextualToolCalls,
  salvageXmlToolCalls,
  type RollArgs,
} from "@/lib/dm/rolls";
import { fakeRollMarkerRegex } from "@/lib/dm/tool-text";
import {
  buildDmMessages,
  movePartyTool,
  recallStoryTool,
  recordEventTool,
  requestPlayerInputTool,
  requestRollTool,
  sendWhisperTool,
  updateLocationTool,
} from "@/lib/dm/prompt";
import { handleSendWhisper, WHISPER_CAP_PER_TURN } from "@/lib/dm/whispers";
import {
  listPendingPlayerWhispers,
  listRecentWhispersForPrompt,
  markPlayerWhispersAnswered,
} from "@/lib/db/dm-whispers";
import { listChapters } from "@/lib/db/chapters";
import { listPublicCampaignNotes } from "@/lib/db/notes";
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
import { createDeltaBatcher } from "@/lib/dm/delta-buffer";
import {
  applyDmMutation,
  MUTATION_CAP_PER_TURN,
  MUTATION_TOOL_NAMES,
  mutationTools,
} from "@/lib/dm/mutations";
import { describeBudget } from "@/lib/dm/action-budget";
import {
  advanceAfterTurn,
  applyEncounterCall,
  ENCOUNTER_CAP_PER_TURN,
  ENCOUNTER_TOOL_NAMES,
  encounterTools,
  ensureInitiativeProgress,
  recordInitiativeRoll,
} from "@/lib/dm/encounter-tools";
import { autoApplyDamageRoll } from "@/lib/dm/enemy-damage";
import { handleTakeRest, restTools } from "@/lib/dm/rest-tools";
import {
  checkTools,
  CHECK_TOOL_NAMES,
  handleCheckNotice,
  handleGroupCheck,
} from "@/lib/dm/check-tools";
import { hazardTools, HAZARD_TOOL_NAMES, handleApplyHazard } from "@/lib/dm/hazard-tools";
import {
  socialTools,
  SOCIAL_TOOL_NAMES,
  handleSetNpc,
  handleNpcReaction,
  handleSocialCheck,
  npcRosterForPrompt,
} from "@/lib/dm/social-tools";
import {
  worldTools,
  WORLD_TOOL_NAMES,
  handleRollTreasure,
  handleDamageObject,
  handleTravel,
} from "@/lib/dm/world-tools";
import {
  applyCompanionCall,
  COMPANION_TOOL_NAMES,
  companionTools,
} from "@/lib/dm/companion-tools";
import { getActiveEncounter, listEnemies } from "@/lib/db/encounters";
import { getBattleMapForEncounter, listTokens } from "@/lib/db/battle-maps";
import { serializeMapForPrompt } from "@/lib/battlemap/serialize";
import { suggestEnemies } from "@/lib/bestiary";

const MUTATION_NAMES = new Set<string>(MUTATION_TOOL_NAMES);
const ENCOUNTER_NAMES = new Set<string>(ENCOUNTER_TOOL_NAMES);

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

// Tools whose results decide an attack/damage outcome: narration written in
// the same model call is a premature guess and is withheld from players.
const ATTACK_OUTCOME_TOOLS = new Set([
  "pc_attack",
  "cast_at_enemy",
  "enemy_attack",
  "damage_enemy",
  "aoe_damage",
]);

type TurnContext = {
  campaign: Campaign;
  sheets: CharacterSheet[];
  sheetsById: Map<string, CharacterSheet>;
  realDiceUserIds: Set<string>;
};

// Compact snapshot of the active encounter for the GAME STATE block. Exact
// HP is model-facing only; clients get vague health states elsewhere.
function buildEncounterState(campaignId: string, sheets: CharacterSheet[]) {
  const encounter = getActiveEncounter(campaignId);
  if (!encounter) {
    return null;
  }
  const enemies = listEnemies(encounter.id);
  const staged = new Set(
    encounter.order
      .filter((entry) => entry.kind === "pc")
      .map((entry) => (entry.kind === "pc" ? entry.characterId : "")),
  );
  return {
    round: encounter.round,
    orderReady: encounter.orderReady,
    order: encounter.orderReady
      ? encounter.order.map((entry, index) => ({
          name: entry.name,
          current: index === encounter.turnIndex,
        }))
      : [],
    awaitingInitiative: encounter.orderReady
      ? []
      : sheets.filter((sheet) => !staged.has(sheet.id)).map((sheet) => sheet.name),
    turnBudget: encounter.turnBudget ? describeBudget(encounter.turnBudget) : null,
    enemies: enemies.map((enemy) => ({
      enemyId: enemy.id,
      name: enemy.displayName,
      hp: `${enemy.currentHp}/${enemy.maxHp}`,
      ac: enemy.ac,
      status: enemy.status,
      // Durations render inline so the model sees "stunned (2 more rounds)".
      conditions: enemy.conditions.map((condition) => {
        const meta = enemy.conditionMeta[condition];
        if (meta?.rounds) {
          return `${condition} (${meta.rounds} more round${meta.rounds === 1 ? "" : "s"})`;
        }
        if (meta?.saveEnds) {
          return `${condition} (save ends: ${meta.saveEnds.ability.toUpperCase()} DC ${meta.saveEnds.dc})`;
        }
        return condition;
      }),
      attacks: enemy.stats.attacks,
      traits: enemy.stats.traits,
      resist: enemy.stats.resist,
      immune: enemy.stats.immune,
      vulnerable: enemy.stats.vulnerable,
    })),
    map: buildMapText(encounter.id, sheets),
  };
}

// The DM is omniscient on the battle map: full grid, all positions, plus
// per-combatant status notes (downed PCs, enemy conditions).
function buildMapText(encounterId: string, sheets: CharacterSheet[]): string | null {
  const map = getBattleMapForEncounter(encounterId);
  if (!map) {
    return null;
  }
  const statuses = new Map<string, string>();
  for (const sheet of sheets) {
    if (sheet.deathSaves?.dead) {
      statuses.set(sheet.id, "DEAD");
    } else if (sheet.deathSaves?.stable) {
      statuses.set(sheet.id, "STABLE at 0 HP");
    } else if (sheet.currentHp <= 0) {
      statuses.set(sheet.id, "DYING at 0 HP");
    }
  }
  for (const enemy of listEnemies(encounterId)) {
    if (enemy.status === "alive" && enemy.conditions.length) {
      statuses.set(enemy.id, enemy.conditions.join(", "));
    }
  }
  return serializeMapForPrompt(map, listTokens(map.id), statuses);
}

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

  // 400 recent messages always over-covers the prompt builder's 100k-char
  // budget; the full transcript stays in the DB for compaction and chapters.
  const history = listRecentMessages(campaignId, 400);
  // Coalesced follow-up turn with nothing new to answer (the previous turn
  // already covered every message): skip instead of narrating into silence.
  // Pending player whispers count as new input: they never appear in the
  // message history, so without this check a whisper-triggered turn would
  // wrongly skip itself.
  const pendingWhispers = listPendingPlayerWhispers(campaignId);
  if (
    history.length &&
    history[history.length - 1].authorType === "dm" &&
    !pendingWhispers.length
  ) {
    setDmStatus(campaignId, "idle");
    return;
  }

  setDmStatus(campaignId, "thinking");

  const context = loadContext(campaign);
  // Combat can never wedge on missing initiative: when nothing is pending,
  // stragglers are auto-rolled before the prompt is built.
  ensureInitiativeProgress(campaign);
  const { summary } = getCampaignSummaryState(campaignId);
  const currentLocation = getCurrentLocation(campaignId);
  const conversation = buildDmMessages(
    {
      campaign,
      members: listMembers(campaignId),
      sheets: context.sheets,
      encounter: buildEncounterState(campaignId, context.sheets),
      enemySuggestions: suggestEnemies(
        campaign.gameSettings.genre,
        context.sheets.map((sheet) => sheet.level),
        10,
      ),
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
      publicNotes: listPublicCampaignNotes(campaignId, 10).map((note) => ({
        pinned: note.pinned,
        title: note.title,
        body: note.body,
      })),
      npcs: npcRosterForPrompt(campaignId),
      recentWhispers: listRecentWhispersForPrompt(campaignId, 10),
      pendingPlayerWhispers: pendingWhispers.map((whisper) => ({
        from: whisper.characterName,
        content: whisper.content,
      })),
    },
    history,
  );

  const turn = createDmTurn(campaignId, conversation);
  // Remember which player whispers this turn's prompt carries; finalize()
  // marks them answered only when the turn succeeds.
  turn.playerWhisperIds = pendingWhispers.map((whisper) => whisper.id);
  saveDmTurn(turn);
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
        // What the server already did with this roll (initiative locked,
        // damage applied); the model must narrate from it, not repeat it.
        ...(pending.combatNote ? { combat: pending.combatNote } : {}),
      }),
    });
  }

  // Positions may have changed while the turn was parked (the mover's own
  // click-to-move never wakes the DM), so the map snapshot baked into the
  // turn's GAME STATE can be stale. Hand the model a fresh one.
  const context = loadContext(campaign);
  const encounter = getActiveEncounter(campaignId);
  if (encounter) {
    const mapText = buildMapText(encounter.id, context.sheets);
    if (mapText) {
      turn.conversation.push({
        role: "user",
        content: `[GAME STATE UPDATE] Combatants may have moved while you waited on rolls. Current battle map (authoritative, replaces the one above):\n${mapText}`,
      });
    }
  }

  turn.status = "running";
  saveDmTurn(turn);
  setDmStatus(campaignId, "narrating");
  await advance(context, turn);
}

// A throwing tool handler used to leave dm_turns stuck at 'running' until
// failStaleRunningTurns reaped it ten minutes later, with the table watching
// a DM that never speaks. Any unexpected throw now finalizes the turn at
// once. Parked turns return with status 'awaiting_rolls' and are left alone.
async function advance(context: TurnContext, turn: DmTurn) {
  try {
    await runAdvance(context, turn);
  } catch (error) {
    console.error("[dm-turn] advance failed", error);
    if (turn.status === "running") {
      finalize(context, turn, "The Dungeon Master hit an internal error and had to stop this turn.");
    } else {
      setDmStatus(context.campaign.id, "idle");
    }
  }
}

async function runAdvance(context: TurnContext, turn: DmTurn) {
  const { campaign, sheets, sheetsById, realDiceUserIds } = context;
  const campaignId = campaign.id;
  let failed = "";
  let spotlightSet = false;

  const imageEnabled =
    campaign.settings.imageGenerationEnabled && campaign.settings.autoImages;
  // DM_LEAN_TOOLS=1 trims the mutation tools if the model's tool fidelity
  // suffers under the full set.
  const leanTools = process.env.DM_LEAN_TOOLS === "1";
  let movedParty = false;
  // Whisper cap is per advance() run, not persisted: a resumed turn simply
  // gets a fresh allowance, which the bounded call loop keeps small.
  let whisperCount = 0;

  while (turn.callIndex < MAX_MODEL_CALLS) {
    const finalCall = turn.callIndex === MAX_MODEL_CALLS - 1;
    // Rebuilt each iteration: the moment start_encounter succeeds mid-turn,
    // the combat tools must appear on the very next model call. Encounter
    // tools ignore DM_LEAN_TOOLS; they are the point of combat. Rest tools
    // only exist outside combat.
    const inEncounter = Boolean(getActiveEncounter(campaignId));
    const tools = [
      requestRollTool,
      requestPlayerInputTool,
      movePartyTool,
      updateLocationTool,
      recordEventTool,
      recallStoryTool,
      sendWhisperTool,
      ...checkTools,
      ...hazardTools,
      ...socialTools,
      ...(inEncounter ? [] : worldTools),
      ...encounterTools(inEncounter),
      ...(inEncounter ? [] : restTools),
      ...companionTools(campaign),
      ...(leanTools ? [] : mutationTools),
      ...(imageEnabled ? [generateImageTool] : []),
    ];
    // Fresh reasoning-artifact filter per model call; each call is its own
    // stream. Withheld trailing text is flushed after the call completes.
    const filter = createStreamingArtifactFilter();
    const batcher = createDeltaBatcher((text) =>
      publishEphemeral(campaignId, "dm_delta", { text }),
    );
    const { message, error } = await requestDmMessage(campaign.settings, turn.conversation, {
      tools,
      // Force pure narration on the last permitted call so a tool-happy
      // model cannot loop forever.
      toolChoice: finalCall ? "none" : "auto",
      // Thinking mode on tool-decision calls only: without it qwen3.6-35b
      // narrates right past its tools (0/11 tool calls in live combat);
      // with it, rolls and encounters fire reliably. The forced-narration
      // final call skips it to keep turns snappy. DM_THINKING=0 disables.
      thinking: !finalCall && process.env.DM_THINKING !== "0",
      onDelta: (text) => {
        const visible = filter.push(text);
        if (visible) {
          batcher.push(visible);
        }
      },
    });

    if (error) {
      batcher.flush();
      const payload = (await error.json().catch(() => null)) as { error?: string } | null;
      failed = payload?.error || "The Dungeon Master could not reach the model backend.";
      break;
    }

    batcher.push(filter.flush());
    batcher.flush();
    if (process.env.DM_DEBUG) {
      console.log(
        `[dm-debug] call ${turn.callIndex}: content=${JSON.stringify(String(message?.content ?? "").slice(0, 300))} tool_calls=${JSON.stringify(message?.tool_calls ?? null).slice(0, 500)}`,
      );
    }
    turn.callIndex += 1;

    // Salvage tool calls the model wrote as literal text so they still run
    // (and never reach players as raw text), then merge them with the
    // structured calls under synthetic ids for tool-result pairing. Three
    // nets, in order: the model's native XML dialect (llama-server's
    // extraction intermittently misses it), bracket leaks, prose roll-asks.
    const xmlSalvage = salvageXmlToolCalls(extractStoryText(message?.content));
    const salvage = salvageTextualToolCalls(xmlSalvage.text);
    // Prose roll-asks ("Avery, make an Investigation check, DC 15.")
    // become real request_roll calls. Skipped when the reply already rolls
    // (no double dice) and on the forced-narration final call, where a
    // synthesized roll could never resolve.
    const alreadyRolls = [
      ...extractToolCalls(message?.tool_calls),
      ...xmlSalvage.calls,
      ...salvage.calls,
    ].some((toolCall) => toolCall.name === "request_roll");
    const proseRolls =
      finalCall || alreadyRolls
        ? { text: salvage.text, calls: [] }
        : salvageProseRollAsks(salvage.text, sheets);
    const salvagedCalls = [...xmlSalvage.calls, ...salvage.calls, ...proseRolls.calls];
    const visibleText = proseRolls.text;
    const echoedToolCalls = salvagedCalls.length
      ? [
          ...(Array.isArray(message?.tool_calls) ? message.tool_calls : []),
          ...salvagedCalls.map((call) => ({
            id: call.id,
            type: "function",
            function: { name: call.name, arguments: call.rawArguments },
          })),
        ]
      : message?.tool_calls;
    const toolCalls = [...extractToolCalls(message?.tool_calls), ...salvagedCalls];
    // Text streamed alongside an attack-resolving tool call is the model
    // guessing the outcome before the dice exist ("the blade bites deep" on
    // what turns out to be a miss). Drop it from the persisted narration;
    // the tool result comes back this same turn and the follow-up call
    // narrates from the real numbers. It stays in the echoed assistant
    // message, so the model keeps its own context.
    const calledAttackTool = toolCalls.some((toolCall) =>
      ATTACK_OUTCOME_TOOLS.has(toolCall.name),
    );
    // Hand-written "[roll:...]" markers rolled nothing (real markers are
    // appended by finalize() from actual roll ids); drop them before the
    // text is persisted so players never see dead bookkeeping tokens.
    const narration = (visibleText ?? "").replace(fakeRollMarkerRegex(), "").trim();
    if (narration && !calledAttackTool) {
      turn.narrationParts.push(narration);
    }
    const rollCalls = toolCalls.filter((toolCall) => toolCall.name === "request_roll");
    const inputCalls = toolCalls.filter(
      (toolCall) => toolCall.name === "request_player_input",
    );
    const mutationCalls = toolCalls.filter((toolCall) => MUTATION_NAMES.has(toolCall.name));
    const encounterCalls = toolCalls.filter((toolCall) => ENCOUNTER_NAMES.has(toolCall.name));
    const restCalls = toolCalls.filter((toolCall) => toolCall.name === "take_rest");
    const companionCalls = toolCalls.filter((toolCall) =>
      COMPANION_TOOL_NAMES.has(toolCall.name),
    );
    const locationCalls = toolCalls.filter(
      (toolCall) => toolCall.name === "move_party" || toolCall.name === "update_location",
    );
    const eventCalls = toolCalls.filter((toolCall) => toolCall.name === "record_event");
    const recallCalls = toolCalls.filter((toolCall) => toolCall.name === "recall_story");
    const whisperCalls = toolCalls.filter((toolCall) => toolCall.name === "send_whisper");
    const checkCalls = toolCalls.filter((toolCall) =>
      (CHECK_TOOL_NAMES as readonly string[]).includes(toolCall.name),
    );
    const hazardCalls = toolCalls.filter((toolCall) =>
      (HAZARD_TOOL_NAMES as readonly string[]).includes(toolCall.name),
    );
    const socialCalls = toolCalls.filter((toolCall) =>
      (SOCIAL_TOOL_NAMES as readonly string[]).includes(toolCall.name),
    );
    // A social_check or npc_reaction produces a roll the model must narrate
    // from; a lone set_npc is bookkeeping like record_event.
    const socialRollCalls = socialCalls.filter((toolCall) => toolCall.name !== "set_npc");
    const setNpcCalls = socialCalls.filter((toolCall) => toolCall.name === "set_npc");
    const worldCalls = toolCalls.filter((toolCall) =>
      (WORLD_TOOL_NAMES as readonly string[]).includes(toolCall.name),
    );

    // Location bookkeeping is synchronous and cheap; maps render async on
    // the media queue when vision allows.
    const locationResults = new Map<string, Record<string, unknown>>();
    for (const locationCall of locationCalls) {
      const result = handleLocationCall(campaign, locationCall.name, locationCall.rawArguments);
      if (result.movedToNewLocation) {
        movedParty = true;
        delete result.movedToNewLocation;
        // Link the narration message finalize() writes to the new area so
        // the chat can show its map inline; only when a map exists or one
        // was just enqueued, so the placeholder can never dangle forever.
        if (result._mapAvailable && typeof result._locationId === "string") {
          turn.locationId = result._locationId;
        }
      }
      delete result._locationId;
      delete result._mapAvailable;
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
    // Whispers deliver immediately (like events); recipients are notified
    // via a contentless ephemeral, so narration never carries the secret.
    const whisperResults = new Map<string, Record<string, unknown>>();
    for (const whisperCall of whisperCalls) {
      let result: Record<string, unknown>;
      if (whisperCount >= WHISPER_CAP_PER_TURN) {
        result = { error: "Whisper limit reached for this turn." };
      } else {
        result = handleSendWhisper(campaign, turn.id, whisperCall.rawArguments, sheets, sheetsById);
        if (!("error" in result)) {
          whisperCount += 1;
        }
      }
      whisperResults.set(whisperCall.id ?? "send_whisper", result);
    }
    if (!turn.imageArgs) {
      const parsedImage = parseGenerateImageToolCall(echoedToolCalls);
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
          respondedUserIds: [],
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
      checkCalls.length > 0 ||
      hazardCalls.length > 0 ||
      socialRollCalls.length > 0 ||
      worldCalls.length > 0 ||
      mutationCalls.length > 0 ||
      encounterCalls.length > 0 ||
      restCalls.length > 0 ||
      companionCalls.length > 0 ||
      // The model asked for a chapter recall in order to use the answer.
      recallCalls.length > 0 ||
      ((locationCalls.length > 0 ||
        eventCalls.length > 0 ||
        whisperCalls.length > 0 ||
        setNpcCalls.length > 0) &&
        !turn.narrationParts.length);

    if (!needsFollowUp) {
      saveDmTurn(turn);
      // A spotlight with no narration yet gets one forced-narration call so
      // the turn never lands empty.
      if (spotlightSet && !turn.narrationParts.length && !finalCall) {
        turn.conversation.push({
          role: "assistant",
          content: visibleText || "",
          tool_calls: echoedToolCalls,
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

    setDmStatus(campaignId, "rolling");

    // Echo the assistant turn (with its tool calls) then answer each call
    // with a tool result carrying the real dice outcome.
    turn.conversation.push({
      role: "assistant",
      content: visibleText || "",
      tool_calls: echoedToolCalls,
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

    for (const whisperCall of whisperCalls) {
      turn.conversation.push({
        role: "tool",
        ...(whisperCall.id ? { tool_call_id: whisperCall.id } : {}),
        content: JSON.stringify(
          whisperResults.get(whisperCall.id ?? "send_whisper") ?? { ok: true },
        ),
      });
    }

    // Encounter tools resolve synchronously against server-authoritative
    // enemy state; the model narrates from the compact results. A pc_attack
    // for a physical-dice player parks instead: its tool result arrives when
    // the turn resumes with the adjudicated roll.
    let parkedAny = false;
    for (const encounterCall of encounterCalls) {
      let result: Record<string, unknown>;
      if (turn.encounterCount >= ENCOUNTER_CAP_PER_TURN) {
        result = { error: "Encounter action limit reached for this turn." };
      } else {
        result = applyEncounterCall(
          campaign,
          turn,
          encounterCall.name,
          encounterCall.rawArguments,
          sheets,
          sheetsById,
          { realDiceUserIds, toolCallId: encounterCall.id ?? null },
        ).result;
        if (!("error" in result)) {
          turn.encounterCount += 1;
        }
      }
      if (result[PC_ATTACK_PARKED]) {
        parkedAny = true;
        continue;
      }
      turn.conversation.push({
        role: "tool",
        ...(encounterCall.id ? { tool_call_id: encounterCall.id } : {}),
        content: JSON.stringify(result),
      });
    }

    // Companion recruit/dismiss resolves synchronously: the sheet, order
    // slot, and token exist before the model narrates the arrival. The
    // fresh sheet list matters (the shared `sheets` snapshot predates it),
    // so later tools in this turn resolve the new characterId via the DB.
    for (const companionCall of companionCalls) {
      const result = applyCompanionCall(
        campaign,
        companionCall.name,
        companionCall.rawArguments,
        listSheets(campaignId),
      );
      if (!("error" in result)) {
        // Refresh the shared snapshot in place so pc_attack and friends can
        // resolve the new (or removed) companion later this same turn.
        const fresh = listSheets(campaignId);
        sheets.length = 0;
        sheets.push(...fresh);
        sheetsById.clear();
        for (const freshSheet of fresh) {
          sheetsById.set(freshSheet.id, freshSheet);
        }
      }
      turn.conversation.push({
        role: "tool",
        ...(companionCall.id ? { tool_call_id: companionCall.id } : {}),
        content: JSON.stringify(result),
      });
    }

    // Rests resolve synchronously: hit dice roll server-side and every
    // sheet write is audited; the model narrates from the results.
    for (const restCall of restCalls) {
      const result = handleTakeRest(campaign, turn.id, restCall.rawArguments, sheets, sheetsById);
      turn.conversation.push({
        role: "tool",
        ...(restCall.id ? { tool_call_id: restCall.id } : {}),
        content: JSON.stringify(result),
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

    // Group checks and passive-notice gates resolve synchronously against the
    // sheets: group_check rolls every participant and applies the half-succeed
    // rule, check_notice compares passive scores with no dice.
    for (const checkCall of checkCalls) {
      const result =
        checkCall.name === "group_check"
          ? handleGroupCheck(campaign, turn, checkCall.rawArguments, sheets, sheetsById)
          : handleCheckNotice(campaign, checkCall.rawArguments, sheets, sheetsById);
      turn.conversation.push({
        role: "tool",
        ...(checkCall.id ? { tool_call_id: checkCall.id } : {}),
        content: JSON.stringify(result),
      });
    }

    // Traps, falls, and environmental hazards resolve synchronously: the
    // server owns the save DC and damage dice and applies them per victim.
    for (const hazardCall of hazardCalls) {
      const result = handleApplyHazard(campaign, turn, hazardCall.rawArguments, sheets, sheetsById);
      turn.conversation.push({
        role: "tool",
        ...(hazardCall.id ? { tool_call_id: hazardCall.id } : {}),
        content: JSON.stringify(result),
      });
    }

    // NPC bookkeeping and social checks resolve synchronously against the
    // persisted NPC roster: attitude drives the check DC and shifts on a
    // decisive result, at most once per exchange.
    for (const socialCall of socialCalls) {
      let result: Record<string, unknown>;
      if (socialCall.name === "set_npc") {
        result = handleSetNpc(campaign, socialCall.rawArguments);
      } else if (socialCall.name === "npc_reaction") {
        result = handleNpcReaction(campaign, turn, socialCall.rawArguments);
      } else {
        result = handleSocialCheck(campaign, turn, socialCall.rawArguments, sheets, sheetsById);
      }
      turn.conversation.push({
        role: "tool",
        ...(socialCall.id ? { tool_call_id: socialCall.id } : {}),
        content: JSON.stringify(result),
      });
    }

    // Treasure, object-breaking, and travel resolve synchronously: coins move
    // through modify_gold, forced-march failures apply exhaustion, and an
    // object break is read from the DMG table.
    for (const worldCall of worldCalls) {
      let result: Record<string, unknown>;
      if (worldCall.name === "roll_treasure") {
        result = handleRollTreasure(campaign, turn, worldCall.rawArguments, sheets, sheetsById);
      } else if (worldCall.name === "travel") {
        result = handleTravel(campaign, turn, worldCall.rawArguments, sheets, sheetsById);
      } else {
        result = handleDamageObject(worldCall.rawArguments);
      }
      turn.conversation.push({
        role: "tool",
        ...(worldCall.id ? { tool_call_id: worldCall.id } : {}),
        content: JSON.stringify(result),
      });
    }

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
      // In combat, character attacks belong to the pc_attack engine: the
      // server derives the bonus, adjudicates vs AC, and applies damage.
      if (parsedArgs.kind === "attack" && sheet && getActiveEncounter(campaignId)) {
        turn.conversation.push({
          role: "tool",
          ...(rollCall.id ? { tool_call_id: rollCall.id } : {}),
          content: JSON.stringify({
            error:
              "Character attacks in combat go through pc_attack: call it with characterId, targetEnemyId, and the weapon (or spell + damage dice). The server rolls to-hit from their sheet, adjudicates against the enemy's AC, and applies damage itself.",
          }),
        });
        continue;
      }
      const resolved = resolveRollExpression(parsedArgs, sheet);
      if ("error" in resolved) {
        turn.conversation.push({
          role: "tool",
          ...(rollCall.id ? { tool_call_id: rollCall.id } : {}),
          content: JSON.stringify({ error: resolved.error }),
        });
        continue;
      }
      // Conditions can decide a save outright (paralyzed auto-fails STR and
      // DEX saves): no dice, the result is a failure the model narrates.
      if ("autoFail" in resolved) {
        turn.conversation.push({
          role: "tool",
          ...(rollCall.id ? { tool_call_id: rollCall.id } : {}),
          content: JSON.stringify({
            success: false,
            autoFailed: true,
            note: `${sheet?.name ?? "The character"} automatically fails: ${resolved.notes.join("; ")}. No dice are rolled; narrate the failure.`,
          }),
        });
        continue;
      }

      // The inspiration die and a held Help are baked into the expression
      // above, so they are spent whether the dice are digital or physical:
      // clear them now. The field carries one or both, "|"-separated.
      if (sheet && resolved.spendInspiration) {
        const { conditions, meta } = removeConditions(
          sheet.conditions,
          sheet.conditionMeta,
          resolved.spendInspiration.split("|"),
        );
        const updated = patchSheet(sheet.id, { conditions, conditionMeta: meta });
        if (updated) {
          publishPersisted(campaignId, "sheet_updated", { sheet: updated });
        }
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
          targetEnemyId:
            parsedArgs.kind === "damage" ? parsedArgs.targetEnemyId ?? null : null,
        });
        publishPersisted(campaignId, "roll_pending", { pendingRoll: publicPendingRoll(pending) });
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
        publishWithSeq(campaignId, allocateSeq(campaignId), "roll_result", {
          roll,
          source: "digital",
        });
        // Combat initiative: feed the roll into the active encounter; the
        // last one in locks the order and begins combat.
        const combatNote =
          parsedArgs.kind === "initiative"
            ? recordInitiativeRoll(campaignId, sheet?.id ?? null, roll.total)
            : null;
        // Damage rolls aimed at an enemy apply server-side the moment the
        // dice land, so the enemy card can never lag the narration.
        const appliedDamage =
          parsedArgs.kind === "damage" && parsedArgs.targetEnemyId
            ? autoApplyDamageRoll(
                campaign,
                turn,
                parsedArgs.targetEnemyId,
                roll,
                sheets,
                sheetsById,
                parsedArgs.damageType,
              )
            : null;
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
            ...(resolved.conditionNotes ? { conditionEffects: resolved.conditionNotes } : {}),
            note: "Narrate this real result. Do not roll again for the same action.",
            ...(combatNote ? { combat: combatNote } : {}),
            ...(appliedDamage ? { applied: appliedDamage } : {}),
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
      setDmStatus(campaignId, "awaiting_rolls");
      return;
    }

    saveDmTurn(turn);
    setDmStatus(campaignId, "narrating");
  }

  finalize(context, turn, failed);
  if (!failed) {
    await maybeCloseChapter(campaignId, { movedParty });
    await maybeCompactHistory(campaignId);
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
  // Unknown kinds fall back to "story" instead of erroring: a milestone is
  // always worth recording under some kind.
  const kind = normalizeEventKind(args.kind, CHARACTER_EVENT_KINDS) as CharacterEventKind;
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
  const mapEnqueued =
    visionClear &&
    campaign.gameSettings.mapsEnabled &&
    campaign.settings.imageBackend === "comfyui" &&
    (!location.mapImage || layoutRevised);
  if (mapEnqueued) {
    void enqueueLocationMap(campaign, location.id);
  }

  return {
    ok: true,
    location: location.name,
    note: "Recorded. Continue the scene.",
    // Consumed by advance() as the chapter-break and inline-map signals,
    // then stripped before the result reaches the model.
    ...(movedToNewLocation
      ? {
          movedToNewLocation: true,
          _locationId: location.id,
          _mapAvailable: mapEnqueued || Boolean(location.mapImage),
        }
      : {}),
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
          // A spotlight on an AI companion would hand the floor to a user
          // nobody controls and freeze the table; only humans get it.
          .filter((sheet): sheet is CharacterSheet => sheet !== null && !sheet.isCompanion)
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
    setDmStatus(campaignId, "idle");
    turn.status = "failed";
    saveDmTurn(turn);
    return;
  }

  // Player whispers this turn's prompt carried are now answered. Failed
  // turns return above, so they stay pending and the next turn retries.
  markPlayerWhispersAnswered(turn.playerWhisperIds, turn.id);

  // A purely private exchange (whispers in, send_whisper out, no narration,
  // no rolls) writes nothing to the shared chat; the fallback line below
  // would leak that a secret exchange happened at all.
  if (turn.playerWhisperIds.length && !turn.narrationParts.join("").trim() && !turn.rollIds.length) {
    setDmStatus(campaignId, "idle");
    turn.status = "done";
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
    locationId: turn.locationId ?? undefined,
  });
  publishWithSeq(campaignId, seq, "message_added", { message });
  setDmStatus(campaignId, "idle");

  // Combat bookkeeping: if the current PC's turn was adjudicated, hand the
  // initiative pointer to the next living PC now, after the narration
  // landed, so the server's next-turn note follows it in the transcript.
  // Runs before the hold below so a hold wraps the NEW turn's floor.
  advanceAfterTurn(context.campaign, turn);

  // Held responses: after a successful narration the table is locked for
  // discussion until the lead releases. A spotlight set this turn becomes
  // the floor that takes effect on release.
  if (context.campaign.gameSettings.holdSubmissions) {
    const current = getFloor(campaignId);
    if (current.mode !== "hold") {
      const held = { mode: "hold" as const, next: current };
      setFloor(campaignId, held);
      publishPersisted(campaignId, "floor_changed", { floor: held });
    }
  }

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
