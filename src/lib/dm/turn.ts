import { emptyTurnLine, type EmptyTurnPlayer } from "@/lib/dm/empty-turn";
import { manualTraits } from "@/lib/dm/monster-traits";
import { coordinationForPrompt } from "@/lib/dm/coordination";
import { clipKeepingEnds } from "@/lib/dm/ask-logic";
import { findSpellByName } from "@/lib/content";
import { allSpellNames, spellLevelOf } from "@/lib/srd/spell-lists";
import { notReadyReason } from "@/lib/srd/spell-prep";
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
  failStaleRunningTurns,
  getDmTurn,
  getLatestDmTurnId,
  listPendingForTurn,
  saveDmTurn,
  type DmTurn,
} from "@/lib/db/dm-turns";
import { haltDmTurn, haltUnbuiltTurn } from "@/lib/dm/turn-halt";
import { assertJobLive, bindJobTurn, DmJobStopped, jobAbandoned, setJobStage } from "@/lib/dm/job-control";
import { describeStage, unbuiltReason, type DmJobStage } from "@/lib/dm/job-stage-logic";
import { modelTuningFor } from "@/lib/dm/model-tuning";
import { noteTurnCall, turnCallFit, turnCallOptions, turnMinOutputTokens } from "@/lib/dm/turn-fit";
import {
  autoGroups,
  closedGroups,
  COMBAT_SPARE_TOOLS,
  ESSENTIAL_COMBAT_TOOLS,
  ESSENTIAL_TOOLS,
  compactTool,
  compactToolNames,
  MORE_TOOLS,
  moreToolsTool,
  readMoreToolsCall,
  TOOL_GROUPS,
  toolHelp,
  type ProfileSignals,
  type ToolDefLike,
  type ToolGroupId,
  type ToolProfile,
} from "@/lib/dm/tool-profiles";
import { casts, ruleContextFor } from "@/lib/dm/rule-context";
import { companionMode } from "@/lib/dm/companion-tools";
import { groupGuidance, tracksAmmunition, type RuleContext } from "@/lib/dm/prompt-rules";
import { getMounts } from "@/lib/db/mounts";
import { peakImportanceByChapter } from "@/lib/db/scene-chunks";
import { getSceneTracker } from "@/lib/db/scene-tracker";
import { listQuests } from "@/lib/db/quests";
import type { ModelTuning } from "@/lib/dm/model-tuning-logic";
import { PC_ATTACK_PARKED } from "@/lib/dm/pc-attack";
import { strictBooleanArgs } from "@/lib/dm/arg-coerce";
import { insertCampaignMessage, listMessagesPage, listRecentMessages, type CampaignMessage } from "@/lib/db/messages";
import { narrationShown, takeNarrationSeq } from "@/lib/dm/narration-slot";
import { getRoll, listRecentRolls } from "@/lib/db/rolls";
import { listSheets } from "@/lib/db/sheets";
import { describeConditionDuration } from "@/lib/dm/condition-logic";
import { heldRollUserIds } from "@/lib/dice/held-rolls";
import { publishEphemeral, publishPersisted, publishWithSeq } from "@/lib/events";
import { generateImageTool, parseGenerateImageToolCall } from "@/lib/image-tool";
import { createStreamingArtifactFilter, extractReplyText, extractStoryText } from "@/lib/story-prompt";
import { salvageJsonToolCalls } from "@/lib/dm/json-salvage";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { fulfillAutoImage } from "@/lib/dm/images";
import { imagesAvailable } from "@/lib/capabilities";
import { imageProducerReady } from "@/lib/image-generate";
import { enqueueNarrationAudio } from "@/lib/tts";
import { fitsStoryWindow, requestDmMessage } from "@/lib/dm/model";
import { requestTokens, sharedPrefixTokens } from "@/lib/dm/request-fit";
import { OOC_ANSWER_INSTRUCTION, OOC_UNANSWERED_PREFIX, oocAnswer, oocQuestionPending } from "@/lib/dm/ooc-question";
import { releaseHarnessConversation } from "@/lib/harness/bridge";
import { toMcpTools } from "@/lib/harness/render";
import { getDmStatus, setDmStatus } from "@/lib/dm/status";
import {
  extractToolCalls,
  resolveSheetRef,
  rollAsksFromClaims,
  salvageTextualToolCalls,
  salvageXmlToolCalls,
} from "@/lib/dm/rolls";
import { fakeRollMarkerRegex, stripToolText } from "@/lib/dm/tool-text";
import {
  collectExchanges,
  FAKE_ENCOUNTER_PROMPT,
  fightAnnounced,
  unrolledBlow,
  unrolledBlowPrompt,
  unrolledFigure,
  unrolledDamagePrompt,
} from "@/lib/dm/engine-boundary";
import { withoutAsides, type PartRead } from "@/lib/dm/claims-logic";
import { readAsides, readReply, registeringNames } from "@/lib/dm/claims";
import { modelTextLines } from "@/lib/dm/speech-lines";
import type { SpokenLine } from "@/lib/dm/speech";
import type { ToolResult } from "@/lib/dm/tool-errors";
import { dispatchAdjudication } from "@/lib/dm/invoke-dispatch";
import { gateAiCall } from "@/lib/dm/ai-gate";
import { characterAwaitingPlayer } from "@/lib/dm/player-word";
import { enemiesOwedTurn, personRunsTable } from "@/lib/dm/enemies-due";
import { intentAnswered, intentCorrection, intentNeedsTool, type MessageIntent } from "@/lib/dm/intent-logic";
import { handleCompleteBeat } from "@/lib/dm/arc";
import { tickWaypointsFromCalls } from "@/lib/dm/waypoint-tick";
import { enforceEngineBoundary } from "@/lib/dm/narration-guard";
import {
  buildDmMessages,
  type DmGameState,
  companionRules,
  relationshipRules,
  completeBeatTool,
  movePartyTool,
  recallStoryTool,
  recordEventTool,
  requestPlayerInputTool,
  requestRollTool,
  sendWhisperTool,
  updateLocationTool,
} from "@/lib/dm/prompt";
import {
  deliverWhisper,
  FALLBACK_WHISPER_MESSAGE,
  handleSendWhisper,
  WHISPER_CAP_PER_TURN,
} from "@/lib/dm/whispers";
import {
  listPendingPlayerWhispers,
  listRecentWhispersForPrompt,
  markPlayerWhispersAnswered,
} from "@/lib/db/dm-whispers";
import { listChapters } from "@/lib/db/chapters";
import { listDmPrepNotes, listPublicCampaignNotes } from "@/lib/db/notes";
import { listActiveFacts } from "@/lib/db/facts";
import { consumePendingSparks, tickWorldState } from "@/lib/dm/world-tick";
import { buildDirectorBlock } from "@/lib/dm/director-logic";
import { takeDirectorArm } from "@/lib/db/director-arms";
import { listPins } from "@/lib/db/pins";
import { isStageEnabled } from "@/lib/dm/stages";
import { renderVariantRules } from "@/lib/dm/rules-logic";
import { storyContextTokens } from "@/lib/model-client";
import { restoreMentionedNpcs } from "@/lib/dm/npc-archive";
import { handleRecallStory } from "@/lib/dm/recall";
import { handleSearchLore, searchLoreTool } from "@/lib/dm/lore-search";
import { handleReadCard, readCardTool } from "@/lib/dm/prep-card-tool";
import { countPrepCards } from "@/lib/db/prep-cards";
import { handleWriteCampaignNote, writeCampaignNoteTool } from "@/lib/dm/note-tools";
import { buildTurnRetrieval, probeStoryWindow } from "@/lib/dm/context-retrieval";
import { estimateTokens, promptWindowTokens, type ContextTrace } from "@/lib/dm/context-budget";
import { maybeProposeItemChange, offerLinesForPrompt } from "@/lib/dm/proposal-intercept";
import { maybeCloseChapter } from "@/lib/dm/chapter-close";
import {
  hasRecentIdenticalEvent,
  insertCharacterEvent,
  listRecentEventsForCampaign,
  CHARACTER_EVENT_KINDS,
} from "@/lib/db/character-events";
import { enqueueLocationMap } from "@/lib/dm/maps";
import {
  getCurrentLocation,
  getLocationByName,
  listLocations,
  setLocationLinks,
  updateCurrentLocationDetails,
  upsertCurrentLocation,
  withNewNames,
} from "@/lib/db/locations";
import { sceneIds } from "@/lib/ambience/catalog";
import { compactHistoryInBackground } from "@/lib/dm/compaction";
import { createDeltaBatcher } from "@/lib/dm/delta-buffer";
import {
  applyDmMutation,
  MUTATION_CAP_PER_TURN,
  MUTATION_CAP_REFUSAL,
  MUTATION_TOOL_NAMES,
  mutationTools,
} from "@/lib/dm/mutations";
import { describeBudget } from "@/lib/dm/action-budget";
import { castBuffTool } from "@/lib/dm/cast-tools";
import {
  advanceAfterTurn,
  fightOwnsFloor,
  settleTurn,
  turnHolder,
  applyEncounterCall,
  ENCOUNTER_CAP_PER_TURN,
  ENCOUNTER_CAP_REFUSAL,
  ENCOUNTER_TOOL_NAMES,
  encounterTools,
  ensureInitiativeProgress,
} from "@/lib/dm/encounter-tools";
import { handleRequestRoll } from "@/lib/dm/invoke-roll";
import { restTools } from "@/lib/dm/rest-tools";
import { checkTools, CHECK_TOOL_NAMES } from "@/lib/dm/check-tools";
import { hazardTools, HAZARD_TOOL_NAMES } from "@/lib/dm/hazard-tools";
import { splitDamageTool, SPLIT_DAMAGE_TOOL_NAMES } from "@/lib/dm/split-damage";
import { petTools, PET_TOOL_NAMES } from "@/lib/dm/pet-tools";
import { socialTools, SOCIAL_TOOL_NAMES, handleSetNpc, npcRosterForPrompt } from "@/lib/dm/social-tools";
import { worldForPrompt } from "@/lib/dm/world-prompt";
import { spellAuthorsFor } from "@/lib/dm/spell-authors";
import {
  relationshipTools,
  RELATIONSHIP_TOOL_NAMES,
  relationshipRosterForPrompt,
} from "@/lib/dm/relationship-tools";
import { PARTY_TOOL_NAMES, partyTools } from "@/lib/dm/party-tools";
import { SCENE_TOOL_NAMES, sceneTools } from "@/lib/dm/scene-tools";
import { AMBIENCE_TOOL_NAMES, ambienceTools, followSceneAmbience } from "@/lib/dm/ambience-tools";
import { MOUNT_TOOL_NAMES, mountTools } from "@/lib/dm/mount-tools";
import { effectTools, EFFECT_TOOL_NAMES } from "@/lib/dm/effect-tools";
import { worldTools, WORLD_TOOL_NAMES } from "@/lib/dm/world-tools";
import { exploreTools, EXPLORE_TOOL_NAMES } from "@/lib/dm/explore-tools";
import { betweenLinesBySheet } from "@/lib/dm/between-lines";
import { BINDER_TOOL_NAMES, binderTools } from "@/lib/dm/binder-tools";
import { FACTION_TOOL_NAMES, factionTools } from "@/lib/dm/faction-tools";
import { SHOP_TOOL_NAMES, shopTools, shopsBlock } from "@/lib/dm/shop-tools";
import { preparedEncounterTools, preparedFightsBlock } from "@/lib/dm/prepared-encounter-tool";
import { SETTLEMENT_TOOL_NAMES, settlementTools } from "@/lib/dm/settlement-tools";
import { placeIsWritten, populateSettlement } from "@/lib/dm/settlement";
import { listFactions } from "@/lib/db/factions";
import { getParty } from "@/lib/db/party";
import { renderFactionsForPrompt } from "@/lib/dm/faction-logic";
import {
  applyCompanionCall,
  COMPANION_TOOL_NAMES,
  companionTools,
} from "@/lib/dm/companion-tools";
import { getActiveEncounter, listEnemies, type Encounter } from "@/lib/db/encounters";
import { getBattleMapForEncounter, getTokenByRef, listTokens } from "@/lib/db/battle-maps";
import { pcMoveBudget } from "@/lib/battlemap/view";
import { serializeMapForPrompt } from "@/lib/battlemap/serialize";
import { suggestEnemies } from "@/lib/bestiary";
import { extraBlockLines } from "@/lib/bestiary/block-sections";

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
// Exported for the retry path (src/lib/dm/retry-turn.ts), which has to know
// where a resumed turn may re-enter the loop.
export const MAX_MODEL_CALLS = 4;

// Tools whose results decide an outcome the model cannot know yet (a hit, a
// save, a contest, damage or healing rolled): narration written in the same
// model call is a premature guess and is withheld from players. A plain
// request_roll is not here, because the prose beside it is the set-up (and,
// for a player on physical dice, the ask to roll); its damage kind is.
const OUTCOME_TOOLS = new Set([
  "pc_attack",
  "cast_at_enemy",
  "enemy_attack",
  "damage_enemy",
  "aoe_damage",
  "take_action",
  "cast_at_player",
  "legendary_action",
  "legendary_resist",
  "lair_action",
  "pet_attack",
  "apply_hazard",
  "use_reaction",
  "split_damage",
  "cast_buff",
  "heal",
  "apply_damage",
  "use_item",
  "use_resource",
  "stabilize",
]);

function resolvesOutcome(toolCall: { name: string; rawArguments: string }): boolean {
  if (toolCall.name === "request_roll") {
    try {
      return (JSON.parse(toolCall.rawArguments || "{}") as { kind?: unknown }).kind === "damage";
    } catch {
      return false;
    }
  }
  return OUTCOME_TOOLS.has(toolCall.name);
}

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
  const due = enemiesOwedTurn(encounter);
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
    movementLeft: encounter.orderReady ? movementLeft(campaignId, encounter, sheets) : null,
    awaitingPlayer: characterAwaitingPlayer(campaignId)?.name ?? null,
    ...(due.length
      ? {
          enemiesDue: {
            before: encounter.order[encounter.turnIndex].name,
            enemies: due.map((enemy) => ({ enemyId: enemy.id, name: enemy.displayName })),
          },
        }
      : {}),
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
          return `${condition} (${describeConditionDuration(meta.rounds)} left)`;
        }
        if (meta?.saveEnds) {
          return `${condition} (save ends: ${meta.saveEnds.ability.toUpperCase()} DC ${meta.saveEnds.dc})`;
        }
        return condition;
      }),
      attacks: enemy.stats.attacks,
      // The trait lines, then the printed half of the block (scores,
      // skills, senses, languages, spells) for blocks that carry one.
      traits: [...enemy.stats.traits, ...extraBlockLines(enemy.stats)],
      // What the engine does not resolve on this block: the DM's to apply
      // (src/lib/dm/monster-traits.ts).
      ...(manualTraits(enemy.stats).length ? { byHand: manualTraits(enemy.stats) } : {}),
      resist: enemy.stats.resist,
      immune: enemy.stats.immune,
      vulnerable: enemy.stats.vulnerable,
      concentration: enemy.concentration,
    })),
    map: buildMapText(encounter.id, sheets),
  };
}

// The acting character's movement left this turn, from the budget the
// board lights and the move route enforces, so a typed move is answered
// with the board's number rather than a guess.
function movementLeft(campaignId: string, encounter: Encounter, sheets: CharacterSheet[]): string | null {
  const entry = encounter.order[encounter.turnIndex];
  const sheet = entry.kind === "pc" ? sheets.find((candidate) => candidate.id === entry.characterId) : undefined;
  const map = sheet ? getBattleMapForEncounter(encounter.id) : null;
  const token = sheet && map ? getTokenByRef(map.id, sheet.id) : null;
  if (!sheet || !map || !token) {
    return null;
  }
  const { speed, tiles } = pcMoveBudget(campaignId, encounter, map, sheet, token);
  return `${sheet.name} ${tiles * 5} ft (speed ${speed} ft)`;
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
  // The drawn board, so the model sees the doors, with the shut ones named.
  return serializeMapForPrompt({ ...map, terrain: map.drawnTerrain }, listTokens(map.id), statuses);
}

function loadContext(campaign: Campaign): TurnContext {
  const sheets = listSheets(campaign.id);
  const members = listMembers(campaign.id);
  const realDiceUserIds = heldRollUserIds(campaign.gameSettings.dicePolicy, members);
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
    // A turn asked of a table that is not playing (back in the lobby, ended)
    // has nothing to answer, and the "thinking" its request raised goes.
    if (getDmStatus(campaignId) === "thinking") {
      setDmStatus(campaignId, "idle");
    }
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
  // Everything between here and the first model call used to run
  // unguarded: a throw anywhere in the prompt build left the table on "DM
  // at work" with no turn row, no notice and no Retry, and the next action
  // hit the same throw (issue #383). It now ends in the halted notice every
  // other failed turn writes.
  const opening: OpeningTurn = { stage: "setting_scene", turn: null };
  setJobStage("setting_scene");
  let opened: { context: TurnContext; turn: DmTurn } | null;
  try {
    opened = await openTurn(campaign, history, pendingWhispers, opening);
  } catch (error) {
    haltOpeningTurn(campaignId, opening, error);
    return;
  }
  if (opened) {
    await advance(opened.context, opened.turn);
  }
}

// How far a turn got before its first model call: the stage it was on, and
// its row once it has one.
type OpeningTurn = { stage: DmJobStage; turn: DmTurn | null };

// The turn up to its first model call: the prompt, built against the moment,
// and the row that carries it. Null when the turn was an out-of-character
// answer, which is finished here.
async function openTurn(
  campaign: Campaign,
  history: CampaignMessage[],
  pendingWhispers: ReturnType<typeof listPendingPlayerWhispers>,
  opening: OpeningTurn,
): Promise<{ context: TurnContext; turn: DmTurn } | null> {
  const campaignId = campaign.id;
  // Table talk put to the DM and nothing else since it last spoke: the turn
  // is an out-of-character answer, which spends nothing a real turn would
  // (src/lib/dm/ooc-question.ts).
  //
  // A spotlight still waiting on other players holds the moves already in
  // for the turn its last answer wakes, so a question asked meanwhile is
  // still only a question.
  const floor = getFloor(campaignId);
  const spotlightWaiting = floor.mode === "spotlight" && !floor.userIds.every((id) => floor.respondedUserIds.includes(id));
  const oocOnly = !pendingWhispers.length && oocQuestionPending(history, { heldMoves: spotlightWaiting });

  const context = loadContext(campaign);
  // Combat can never wedge on missing initiative: when nothing is pending,
  // stragglers are auto-rolled before the prompt is built.
  if (!oocOnly) {
    ensureInitiativeProgress(campaign);
  }
  const { summary, coveredCount } = getCampaignSummaryState(campaignId);
  const currentLocation = getCurrentLocation(campaignId);
  // Variant rules always ride; house rules and world lore are retrieved
  // against the current moment (one local embed, keyword fallback).
  // Naming an archived NPC brings them back before the prompt is built, so
  // the DM sees them on the very turn the party asks after them rather than
  // one turn late.
  restoreMentionedNpcs(campaignId, history.slice(-4).map((entry) => entry.content).join("\n"));

  // Optional stages (src/lib/dm/stages.ts): all default on, so this changes
  // nothing until an operator opts out.
  const stages = campaign.gameSettings.stages;
  // The tool definitions ride on every call of this turn and were never
  // budgeted (issue #120), so they come off the window before any block is
  // packed, here and in the retrieval budget.
  // The window decides the tool profile and every budget below, so the
  // endpoint is asked for it first: the first turn after a restart (or with
  // retrieval switched off) planned against the assumed default otherwise.
  await probeStoryWindow(campaign.settings);
  const toolTokens = dmTurnToolTokens(campaign);
  opening.stage = "searching_lore";
  setJobStage("searching_lore");
  const retrieval = isStageEnabled(stages, "retrieval")
    ? await buildTurnRetrieval(campaign, history, toolTokens)
    : { variantRulesBlock: renderVariantRules(campaign.gameSettings.variantRules), houseRulesBlock: "", loreBlock: "" };
  opening.stage = "setting_scene";
  setJobStage("setting_scene");
  // Taken (read and deleted in one statement) rather than read-then-clear, so
  // two turns racing cannot both fire the same directive. It is consumed here,
  // before the conversation is persisted below, which is what makes a retry
  // correct: retry-turn.ts replays that stored conversation, so the directive
  // is still in the prompt it re-runs, neither lost nor applied twice.
  const directorArm = oocOnly ? null : takeDirectorArm(campaignId);
  const directorBlock = buildDirectorBlock(directorArm);
  if (directorArm) {
    // Clear the armed badge for every client now that the steer is spent.
    publishPersisted(campaignId, "director_armed", {
      armed: false,
      oneShot: null,
      absoluteCommand: "",
    });
  }
  // The table's WorldForge: what it says of who and what the newest messages
  // and the scene put in play, then hidden truths, ties and secrets.
  const world = worldForPrompt(campaignId, {
    // The newest message whole (to a bound) and the end of each older one:
    // what a passage ends on is what is in play now, and the first 600
    // characters of each left out a figure the narration introduced last
    // (the same cut issue 250 found in Ask).
    text: [
      campaign.scene,
      ...history.slice(-6).map((entry, index, recent) =>
        clipKeepingEnds(entry.content, index === recent.length - 1 ? 2_400 : 600, 150, () => "..."),
      ),
    ]
      .filter(Boolean)
      .join("\n"),
  });
  // The tools this turn's calls are offered, and for the compact profile the
  // groups open from the start: the ones the table's state calls for and the
  // ones the players' newest words name (src/lib/dm/tool-profiles.ts). The
  // rules then carry only the lines those tools and this party need.
  const tuning = dmTurnTuning(campaign);
  const encounterNow = buildEncounterState(campaignId, context.sheets);
  let profileTrace: NonNullable<ContextTrace["profile"]> = { name: tuning.toolProfile };
  let ruleContext: RuleContext | null = null;
  if (tuning.toolProfile === "compact") {
    const playerText = history
      .slice(-6)
      .filter((message) => message.authorType === "player")
      .map((message) => message.content)
      .join("\n");
    const intent = [...autoGroups({ inEncounter: false, playerText })];
    const signals = profileSignals(campaign, context.sheets, Boolean(encounterNow));
    const offered = compactTurnTools(campaign, Boolean(encounterNow), campaign.settings.imageGenerationEnabled && campaign.settings.autoImages, signals, intent).offered;
    const groups = Object.keys(TOOL_GROUPS).filter((group) => TOOL_GROUPS[group as ToolGroupId].tools.some((name) => offered.has(name)));
    profileTrace = { name: "compact", intent, groups, opened: [] };
    ruleContext = ruleContextFor({
      sheets: context.sheets,
      inEncounter: Boolean(encounterNow),
      groups,
      arc: Boolean(campaign.storyArc),
      recall: isStageEnabled(stages, "recall"),
      map: Boolean(encounterNow?.map),
      legendary: Boolean(signals.legendary),
    });
  }
  const chapterImportance = peakImportanceByChapter(campaignId);
  const promptState: DmGameState = {
      campaign,
      ruleContext,
      // The window the prompt is actually being built against; without this
      // every budget silently fell back to the default rather than the
      // campaign's configured model. Less the tool definitions and the reply
      // reserve (promptWindowTokens), which the packer cannot see.
      contextLimitTokens: promptWindowTokens(storyContextTokens(campaign.settings), toolTokens),
      toolTokens,
      windowTokens: storyContextTokens(campaign.settings),
      variantRulesBlock: retrieval.variantRulesBlock,
      houseRulesBlock: retrieval.houseRulesBlock,
      loreBlock: retrieval.loreBlock,
      loreTrace: retrieval.loreTrace,
      rulesTrace: retrieval.rulesTrace,
      factionsBlock: renderFactionsForPrompt(listFactions(campaign.id), getParty(campaign.id).reputation, true),
      worldBlock: world.block,
      shopsBlock: shopsBlock(campaign),
      preparedFightsBlock: preparedFightsBlock(campaign),
      members: listMembers(campaignId),
      sheets: context.sheets,
      encounter: encounterNow,
      enemySuggestions: suggestEnemies(
        campaign.gameSettings,
        context.sheets.map((sheet) => sheet.level),
        10,
      ),
      recentRolls: listRecentRolls(campaignId, 5),
      storySummary: summary,
      // The newest message the summaries cover, by the compaction watermark's
      // own offset semantics. A watermark past the transcript (a hand-edited
      // or imported database) covers everything there is, and a turn is
      // never lost to it.
      summaryCoveredSeq: coveredCount
        ? (listMessagesPage(campaignId, coveredCount - 1, 1)[0]?.seq ?? history.at(-1)?.seq ?? null)
        : null,
      // Off unless asked: with the turn-to-turn state after the history, the
      // default local model (Qwen3.6-35B, llama-server) skipped the roll on an
      // explicit search in five of six scripted runs, narrating what was found
      // with no dice; with the state in the system message it rolled in three
      // of three, and on main in three of four. DM_MOMENT_AFTER_HISTORY=1
      // sends it after the history, so a server that caches the prompt's
      // start reuses the whole history from one turn to the next; an agent
      // program moves it itself (src/lib/harness/render.ts).
      momentAfterHistory: campaign.settings.textProvider !== "harness" && process.env.DM_MOMENT_AFTER_HISTORY === "1",
      currentLocation: currentLocation
        ? {
            name: currentLocation.name,
            layoutDescription: currentLocation.layoutDescription,
            connections: currentLocation.connections,
          }
        : null,
      recentPlayerLine: [...history].reverse().find((message) => message.authorType === "player")?.content.slice(0, 400) ?? "",
      npcMomentText: history.slice(-6).map((entry) => clipKeepingEnds(entry.content, 600, 150, () => " ")).join("\n"),
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
      // Afflictions, lifestyle and downtime (src/lib/dm/between-lines.ts).
      betweenBySheet: betweenLinesBySheet(campaignId, context.sheets),
      pins: listPins(campaignId).map((pin) => ({ text: pin.text })),
      chapters: listChapters(campaignId)
        .filter((chapter) => chapter.status === "closed")
        .map((chapter) => ({
          id: chapter.id,
          index: chapter.index,
          title: chapter.title,
          oneLiner: chapter.highlights[0] ?? "",
          // The full sealed summary; the LOD renderer decides per chapter
          // whether the prompt gets all of it or just its first sentence.
          summary: chapter.summary || chapter.highlights[0] || "",
          // Its scenes' peak importance, which keeps an eventful chapter in
          // full longer (src/lib/dm/chapter-lod.ts effectiveAge).
          importance: chapterImportance.get(chapter.id),
        })),
      publicNotes: listPublicCampaignNotes(campaignId, 10).map((note) => ({
        pinned: note.pinned,
        title: note.title,
        body: note.body,
      })),
      dmPrepNotes: listDmPrepNotes(campaignId, 8).map((note) => ({ title: note.title, body: note.body })),
      facts: listActiveFacts(campaignId).map((fact) => ({
        category: fact.category,
        subject: fact.subject,
        fact: fact.fact,
        pinned: fact.pinned,
        knownBy: fact.knownBy,
      })),
      directorNotes: oocOnly ? [] : consumePendingSparks(campaignId).map((spark) => spark.text),
      directorBlock,
      npcs: npcRosterForPrompt(campaignId).map((npc) => ({ ...npc, world: world.npcNotes.get(npc.name) })),
      relationships:
        campaign.gameSettings.relationships === "off"
          ? []
          : relationshipRosterForPrompt(campaignId),
      recentWhispers: listRecentWhispersForPrompt(campaignId, 10),
      pendingPlayerWhispers: pendingWhispers.map((whisper) => ({
        from: whisper.characterName,
        content: whisper.content,
      })),
      // What waits on a player's answer and what was settled lately
      // (issue 239), so an accepted offer is never asked about again.
      offers: offerLinesForPrompt(campaignId, context.sheetsById),
      coordinationBlock: coordinationForPrompt(campaignId),
  };
  const conversation = buildDmMessages(promptState, history);
  if (oocOnly) {
    await answerOutOfCharacter(campaign, conversation, promptState.contextTrace);
    return null;
  }

  // What this turn's prompt shares with the previous turn's from its first
  // token: the most a prompt cache could reuse (the context audit's F08).
  const previousId = getLatestDmTurnId(campaignId);
  const previous = previousId ? getDmTurn(previousId) : null;
  const prefix = previous
    ? {
        sharedTokens: sharedPrefixTokens(
          previous.conversation.slice(0, previous.contextTrace?.shape?.promptMessages || 1),
          conversation,
        ),
        promptTokens: requestTokens(conversation),
      }
    : null;

  // A stop asked for while the scene was being set ends the turn here,
  // before it has a row or a model call.
  assertJobLive();
  const turn = createDmTurn(campaignId, conversation);
  opening.turn = turn;
  bindJobTurn(turn.id);
  // The narration holds its place from the start, not only once words are on
  // screen: a move posted while the model is still thinking was not in this
  // prompt, so it belongs after this turn's narration, and it is still the
  // last message when the coalesced follow-up turn looks for something to
  // answer (src/lib/dm/narration-slot.ts).
  narrationShown(campaignId, turn.id);
  // buildDmMessages fills this in on the state object it was handed, so the
  // trace is carried onto the turn row rather than recomputed. What the turn
  // changed for the model rides with it, for the Context panel.
  turn.contextTrace = promptState.contextTrace
    ? { ...promptState.contextTrace, profile: profileTrace, ...(prefix ? { prefix } : {}), ...(tuning.notes.length ? { tuning: tuning.notes } : {}) }
    : null;
  // Remember which player whispers this turn's prompt carries; finalize()
  // marks them answered only when the turn succeeds.
  turn.playerWhisperIds = pendingWhispers.map((whisper) => whisper.id);
  saveDmTurn(turn);
  return { context, turn };
}

// A turn that failed or was stopped before its first model call. A stop
// (the lead's button, a rewind, the watchdog) says why in its own words; an
// error is logged whole and the table reads which step it broke on. A turn
// the queue already gave up on has had its notice written there.
function haltOpeningTurn(campaignId: string, opening: OpeningTurn, error: unknown) {
  const stopped = error instanceof DmJobStopped ? error.reason : null;
  if (!stopped) {
    console.error(`[dm-turn] campaign ${campaignId}: the turn failed while ${describeStage(opening.stage).toLowerCase()}, before the model was asked`, error);
  }
  if (jobAbandoned()) {
    return;
  }
  const reason = stopped ?? unbuiltReason(opening.stage);
  if (opening.turn && opening.turn.status === "running") {
    haltDmTurn(campaignId, opening.turn, reason, takeNarrationSeq(campaignId, opening.turn.id));
    return;
  }
  haltUnbuiltTurn(campaignId, reason);
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
  // A person holds the seat now: the table switched from the AI while this
  // turn waited on a roll, or it was a pass delegated on the person's behalf.
  // The rolls already published and applied what they apply; there is no
  // model to hand them to, so the turn closes as a person's does rather than
  // narrating at a table the AI no longer runs.
  if (personRunsTable(campaign)) {
    if (takeNarrationSeq(campaignId, turn.id) !== null) {
      // A message posted while the turn waited reserved a place for its
      // narration, and nothing will fill it; the draft bubble lets it go.
      publishEphemeral(campaignId, "dm_draft_seq", { seq: null });
    }
    turn.status = "done";
    saveDmTurn(turn);
    setDmStatus(campaignId, "idle");
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
  // The place it held while parked, or a fresh one after a restart: a move
  // posted while the model reads the rolls sits after this narration.
  narrationShown(campaignId, turn.id);
  await advance(context, turn);
}

// Retry entry point (src/lib/dm/retry-turn.ts): re-enter a halted turn from
// its persisted conversation. Lives here because advance() and loadContext()
// are turn internals; the retry's own guards run before this is called.
export async function reenterDmTurn(campaign: Campaign, turn: DmTurn) {
  // A retried turn thinks again before it speaks; a move posted meanwhile
  // belongs after its narration, as on the turn's first run.
  narrationShown(campaign.id, turn.id);
  await advance(loadContext(campaign), turn);
}

// A throwing tool handler used to leave dm_turns stuck at 'running' until
// failStaleRunningTurns reaped it ten minutes later, with the table watching
// a DM that never speaks. Any unexpected throw now finalizes the turn at
// once. Parked turns return with status 'awaiting_rolls' and are left alone.
async function advance(context: TurnContext, turn: DmTurn) {
  bindJobTurn(turn.id);
  try {
    await runAdvance(context, turn);
  } catch (error) {
    // A stop (the lead's button, a rewind, the watchdog) halts the turn in
    // its own words. One the queue already gave up on had its notice
    // written there, and writes nothing more.
    const stopped = error instanceof DmJobStopped ? error.reason : null;
    if (!stopped) {
      console.error("[dm-turn] advance failed", error);
    }
    if (jobAbandoned()) {
      return;
    }
    if (turn.status === "running") {
      finalize(context, turn, stopped ?? "The Dungeon Master hit an internal error and had to stop this turn.", []);
    } else {
      setDmStatus(context.campaign.id, "idle");
    }
  } finally {
    // An agent program narrating this turn is stopped the moment the turn
    // is done, parked for dice or failed. A no-op for every other provider.
    releaseHarnessConversation(turn.conversation);
  }
}

// The tools one DM model call is offered. Rebuilt on every call in the loop:
// the moment start_encounter succeeds mid-turn, the combat tools must appear
// on the very next call. Encounter tools ignore DM_LEAN_TOOLS; they are the
// point of combat. Rest tools only exist outside combat.
export function dmTurnTools(
  campaign: Campaign,
  inEncounter: boolean,
  imageEnabled: boolean,
  leanTools: boolean,
): unknown[] {
  return [
    requestRollTool,
    requestPlayerInputTool,
    movePartyTool,
    updateLocationTool,
    recordEventTool,
    ...(isStageEnabled(campaign.gameSettings.stages, "recall") ? [recallStoryTool] : []),
    searchLoreTool,
    // Only a campaign with prep cards can answer it (issue #301).
    ...(countPrepCards(campaign.id) ? [readCardTool] : []),
    writeCampaignNoteTool,
    sendWhisperTool,
    ...(campaign.storyArc ? [completeBeatTool] : []),
    ...checkTools,
    ...hazardTools,
    ...(inEncounter ? [splitDamageTool] : []),
    ...petTools,
    ...socialTools,
    ...(inEncounter ? [] : relationshipTools(campaign)),
    ...(inEncounter ? [] : worldTools),
    // Lifting a load, lifestyles, downtime, diseases, madness and poisons
    // (src/lib/dm/explore-tools.ts); downtime refuses itself in a fight.
    ...exploreTools,
    // Handouts and the quest log are read at the table's pace, not mid-round.
    ...(inEncounter ? [] : binderTools),
    ...(inEncounter ? [] : factionTools),
    ...(inEncounter ? [] : shopTools),
    ...(inEncounter || !campaign.gameSettings.worldSimulation ? [] : settlementTools),
    // The party's shared pack and common purse. Out of combat only, like
    // the rest of the world tools: nobody rummages in the group kit while
    // initiative is running.
    ...(inEncounter ? [] : partyTools),
    // Effects are offered in and out of combat: a blessing lands mid-fight
    // as often as a curse lands in a throne room.
    ...effectTools,
    // Structured non-combat scenes and mounts are both out-of-combat
    // business: a chase clock and an initiative order are two answers to
    // the same question, and nobody saddles up mid-round.
    ...(inEncounter ? [] : sceneTools),
    // Sound is offered in and out of a fight: a sting lands mid-round as
    // often as a bed changes between them. Silent for a table that has
    // the library switched off, which is why it is gated here rather
    // than left to the handler to refuse.
    ...(campaign.gameSettings.ambienceEnabled ? ambienceTools : []),
    ...(inEncounter ? [] : mountTools),
    ...encounterTools(inEncounter),
    // The table's prepared fights, by name, when it has any (#154).
    ...(inEncounter ? [] : preparedEncounterTools(campaign)),
    castBuffTool,
    ...(inEncounter ? [] : restTools),
    ...companionTools(campaign),
    ...(leanTools ? [] : mutationTools),
    ...(imageEnabled ? [generateImageTool] : []),
    ];
}

// What the tool definitions cost on a call, by the same chars/4 proxy as
// every other block (the local tokenizer measures the JSON at ~4.3 chars a
// token, so the proxy errs slightly high). A fight can start mid-turn and
// swap the set offered, so the larger of the two sets is charged: the prompt
// is packed once, before the first call, and has to leave room for either.
// An agent program is handed the whole catalogue once, in and out of a fight
// alike (dmTurnToolCatalogue), so that is what it is charged.
export function dmTurnToolTokens(campaign: Campaign): number {
  return toolSetTokens(campaign, dmTurnTuning(campaign).toolProfile);
}

// What the turn changes for the table's model: the trimmed or the compact
// tool set on a window the full set would crowd, no thinking request for a
// model that does not reason (src/lib/dm/model-tuning-logic.ts). Judged
// against the full and the trimmed sets.
export function dmTurnTuning(campaign: Campaign): ModelTuning {
  return modelTuningFor(campaign, toolSetTokens(campaign, "full"), toolSetTokens(campaign, "lean"));
}

function toolSetTokens(campaign: Campaign, profile: ToolProfile): number {
  const imageEnabled = campaign.settings.imageGenerationEnabled && campaign.settings.autoImages;
  const leanTools = profile === "lean";
  if (campaign.settings.textProvider === "harness") {
    return estimateTokens(JSON.stringify(toMcpTools(dmTurnToolCatalogue(campaign, imageEnabled, leanTools))));
  }
  if (profile === "compact") {
    // The compact set the table's state offers now, and room for the largest
    // group a more_tools call could open. A fight that starts mid-turn grows
    // the set; the call after it is fitted again (src/lib/dm/turn-fit.ts),
    // so the transcript gives way then rather than on every quiet turn.
    const sheets = listSheets(campaign.id);
    const inEncounter = Boolean(getActiveEncounter(campaign.id));
    const set = compactTurnTools(campaign, inEncounter, imageEnabled, profileSignals(campaign, sheets, inEncounter), []).tools;
    return estimateTokens(JSON.stringify(set)) + largestGroupTokens(campaign, imageEnabled);
  }
  return Math.max(
    estimateTokens(JSON.stringify(dmTurnTools(campaign, false, imageEnabled, leanTools))),
    estimateTokens(JSON.stringify(dmTurnTools(campaign, true, imageEnabled, leanTools))),
  );
}

// ---- the compact profile (src/lib/dm/tool-profiles.ts) ----

// What the table holds now, for the groups a compact call opens unasked.
export function profileSignals(campaign: Campaign, sheets: readonly CharacterSheet[], inEncounter: boolean): ProfileSignals {
  const encounter = inEncounter ? getActiveEncounter(campaign.id) : null;
  return {
    inEncounter,
    shopOpen: !inEncounter && Boolean(shopsBlock(campaign)),
    mounts: Object.keys(getMounts(campaign.id)).length > 0,
    pets: sheets.some((sheet) => (sheet.pets?.length ?? 0) > 0),
    scene: !inEncounter && Boolean(getSceneTracker(campaign.id)),
    quests: !inEncounter && listQuests(campaign.id).length > 0,
    legendary: encounter
      ? listEnemies(encounter.id).some((enemy) => enemy.stats.traits.some((trait) => /\b(legendary|lair) actions?\b/i.test(trait)))
      : false,
    caster: sheets.some(casts),
  };
}

// The tools a compact call offers: the core and the open groups, with their
// descriptions cut to the first sentence, and more_tools for the rest.
export function compactTurnTools(
  campaign: Campaign,
  inEncounter: boolean,
  imageEnabled: boolean,
  signals: ProfileSignals,
  opened: Iterable<ToolGroupId>,
): { tools: unknown[]; offered: Set<string> } {
  const full = dmTurnTools(campaign, inEncounter, imageEnabled, false) as ToolDefLike[];
  const names = full.map((tool) => tool.function.name);
  const offered = compactToolNames(names, signals, opened);
  const closed = closedGroups(names, offered);
  return {
    tools: [...full.filter((tool) => offered.has(tool.function.name)).map(compactTool), ...(closed.length ? [moreToolsTool(closed)] : [])],
    offered,
  };
}

// The richest compact set this call's window holds: every open group; else
// only the group opened last (the players' words may have opened others);
// in a fight, else that set without what a round can spare; else the
// essentials beside that group and the tools this turn has already
// called (an Extra Attack's second pc_attack, a second roll), with every
// other group one more_tools call away. Asked of the window before the call
// (model.ts fitsStoryWindow), so a group opened on a small window is offered
// rather than refused for room. fits is false when not even the narrowest
// set leaves the reply its room.
function compactToolsThatFit(
  campaign: Campaign,
  turn: DmTurn,
  inEncounter: boolean,
  imageEnabled: boolean,
  sheets: readonly CharacterSheet[],
): { tools: unknown[]; fits: boolean } {
  const signals = profileSignals(campaign, sheets, inEncounter);
  const intent = (turn.contextTrace?.profile?.intent ?? []) as ToolGroupId[];
  const opened = (turn.contextTrace?.profile?.opened ?? []) as ToolGroupId[];
  const last = opened.at(-1);
  const variants: unknown[][] = [compactTurnTools(campaign, inEncounter, imageEnabled, signals, [...intent, ...opened]).tools];
  if (intent.length || opened.length > 1) {
    variants.push(compactTurnTools(campaign, inEncounter, imageEnabled, signals, last ? [last] : []).tools);
  }
  if (inEncounter) {
    const spare = new Set(COMBAT_SPARE_TOOLS);
    variants.push((variants.at(-1) as ToolDefLike[]).filter((tool) => !spare.has(tool.function.name)));
  }
  const called = turn.conversation.flatMap((message) =>
    message.role === "assistant" && Array.isArray(message.tool_calls)
      ? message.tool_calls.map((call) => (call as { function?: { name?: string } }).function?.name ?? "")
      : [],
  );
  const wanted = new Set([
    ...ESSENTIAL_TOOLS,
    ...(inEncounter ? ESSENTIAL_COMBAT_TOOLS : []),
    ...(last ? TOOL_GROUPS[last].tools : []),
    ...called,
  ]);
  wanted.delete(MORE_TOOLS);
  const full = dmTurnTools(campaign, inEncounter, imageEnabled, false) as ToolDefLike[];
  const names = full.map((tool) => tool.function.name);
  const offered = new Set(names.filter((name) => wanted.has(name)));
  variants.push([...full.filter((tool) => offered.has(tool.function.name)).map(compactTool), moreToolsTool(closedGroups(names, offered))]);
  const options = turnCallOptions(campaign, turn, "turn");
  const fitting = variants.find((tools) => fitsStoryWindow(campaign.settings, turn.conversation, { ...options, tools }));
  return { tools: fitting ?? variants.at(-1)!, fits: Boolean(fitting) };
}

function largestGroupTokens(campaign: Campaign, imageEnabled: boolean): number {
  const all = dmTurnToolCatalogue(campaign, imageEnabled, false) as ToolDefLike[];
  let largest = 0;
  for (const group of Object.values(TOOL_GROUPS)) {
    const tools = all.filter((tool, index) => group.tools.includes(tool.function.name) && all.findIndex((other) => other.function.name === tool.function.name) === index);
    largest = Math.max(largest, estimateTokens(JSON.stringify(tools.map(compactTool))));
  }
  return largest;
}

// A more_tools call: the group opened for the rest of the turn, with the
// rules that explain it, or one tool's full instructions.
function handleMoreTools(campaign: Campaign, turn: DmTurn, imageEnabled: boolean, rawArguments: string): ToolResult {
  const { group, tool } = readMoreToolsCall(rawArguments);
  if (!group && !tool) {
    return { error: `Name a group (${Object.keys(TOOL_GROUPS).join(", ")}) or a tool.`, retry: true };
  }
  const all = dmTurnToolCatalogue(campaign, imageEnabled, false) as ToolDefLike[];
  const result: Record<string, unknown> = { ok: true };
  if (group) {
    const profile = (turn.contextTrace ??= { limitTokens: 0, promptTokens: 0, blocks: [] }).profile ?? { name: "compact" as const };
    profile.opened = [...new Set([...(profile.opened ?? []), group])];
    turn.contextTrace.profile = profile;
    result.opened = group;
    result.tools = TOOL_GROUPS[group].tools.filter((name) => all.some((entry) => entry.function.name === name));
    result.note = "These are offered from your next reply on: call the one the moment needs now.";
    // The rules that explain the group ride with it: its lines of the core
    // rules, and the table's own companion or relationship rules.
    const companions = companionMode(campaign);
    const guidance = [
      groupGuidance(group, tracksAmmunition(campaign)),
      group === "companions" && companions !== "off" ? companionRules(campaign, companions) : "",
      group === "relationships" && campaign.gameSettings.relationships !== "off"
        ? relationshipRules(campaign.gameSettings.romance !== "off")
        : "",
    ]
      .filter(Boolean)
      .join("\n\n");
    if (guidance) {
      result.rules = guidance;
    }
  }
  if (tool) {
    const found = all.find((entry) => entry.function.name === tool);
    result.help = found ? toolHelp(found) : `There is no action called "${tool}".`;
  }
  return result;
}

// Every tool a turn could offer at any point, in or out of a fight. An agent
// program reads its tool list once, when it starts (src/lib/harness/bridge.ts),
// so a turn that starts a fight must already have the combat tools on it; the
// bridge refuses any call the loop is not offering at that moment.
export function dmTurnToolCatalogue(campaign: Campaign, imageEnabled: boolean, leanTools: boolean): unknown[] {
  return [
    ...dmTurnTools(campaign, false, imageEnabled, leanTools),
    ...dmTurnTools(campaign, true, imageEnabled, leanTools),
  ];
}

function offersTool(tools: unknown[], name: string): boolean {
  return tools.some((tool) => (tool as { function?: { name?: string } })?.function?.name === name);
}

const squashed = (text: string) => text.replace(/\s+/g, " ").trim();

// Each call's text reaches the table's draft bubble as it streams
// (dm_delta), before the turn has read it. Some of it is then withheld from
// the narration: the narrator's asides or a reply that was only a plan,
// text beside an attack, a fight or a blow told in prose alone and sent
// back, a card the prose played without its tool, a loop cut to its first
// copy, a call that failed partway. The draft would show that text, run
// into the next call's, until the turn ended. So when what a call streamed
// is not what it left in the narration (the parts from keptFrom on), the
// table is sent the narration kept so far to show in its place, possibly
// nothing. A client that does not know the event ignores it.
function resetDraftIfWithheld(campaignId: string, turn: DmTurn, shown: string, keptFrom: number) {
  if (!shown.trim() || squashed(turn.narrationParts.slice(keptFrom).join(" ")) === squashed(shown)) {
    return;
  }
  publishEphemeral(campaignId, "dm_draft_reset", { text: turn.narrationParts.join("\n\n").trim() });
}

async function runAdvance(context: TurnContext, turn: DmTurn) {
  const { campaign, sheets, sheetsById } = context;
  const campaignId = campaign.id;
  let failed = "";
  let spotlightSet = false;

  const imageEnabled =
    campaign.settings.imageGenerationEnabled && campaign.settings.autoImages;
  // The trimmed tool set and the thinking request follow the model
  // (dmTurnTuning); DM_LEAN_TOOLS and DM_THINKING in the environment still
  // decide when set.
  const tuning = dmTurnTuning(campaign);
  const leanTools = tuning.leanTools;
  // The compact profile: the groups the players' words opened when the turn
  // began, and the ones more_tools opened since (kept on the trace, so a
  // resumed turn keeps them). Two openings a run cost no call of the budget.
  const compact = tuning.toolProfile === "compact";
  let freeOpens = 2;
  // Chapters close on story progress, not message volume: the DM reports a
  // finished beat with complete_beat and that ends the chapter. One per
  // advance() run, so a single reply can never burn several beats.
  let beatCompleted = false;
  // Whether the beat that completed carried waypoints (a whole chapter's
  // worth of story, chapter-close.ts weighs it so), and whether the DM
  // claimed a beat the checklist refused (chapter-close.ts checks the
  // checklist against play right away instead of on its cadence).
  let beatGated = false;
  let beatClaimed = false;
  // Whisper cap is per advance() run, not persisted: a resumed turn simply
  // gets a fresh allowance, which the bounded call loop keeps small.
  let whisperCount = 0;
  // One suggested note per advance() run keeps the DM from papering the
  // lead's approval queue in a single reply.
  let noteCount = 0;
  // One shot at fixing a fight announced in prose without start_encounter; a
  // model that ignores the correction keeps its text rather than looping.
  let encounterNudged = false;
  // The same single shot for a blow landed in prose alone: a damage figure
  // that no tool rolled this turn (unrolledFigure).
  let damageNudged = false;
  // And for an attack resolved in prose alone during a fight: a hit or a
  // miss on an enemy no tool touched this turn (unrolledBlow).
  let attackNudged = false;
  // What each kept reply was read for, by its persisted text, so the guard
  // at the end of the turn reads only what no read covered.
  const partReads = new Map<string, PartRead>();
  // Whether the last call, sent with toolChoice "none", came back with tool
  // calls anyway (see narrateAfterToolLeak).
  let finalCallLeaked = false;
  // The card the player played, when their action came from the Hand as an
  // attack or a cast, and whether the one corrective call for it was spent.
  const card = cardPlayed(context);
  let intentNudged = false;
  // Whether an empty reply was already asked again, and whether the call
  // that ended the loop came back empty (see narrateAfterToolLeak).
  let emptyRetried = false;
  let lastReplyEmpty = false;
  // One shot at a reply that was only the model's plan, not narration (the
  // reader's aside claims: src/lib/dm/claims-logic.ts).
  let planNudged = false;
  // What the current call streamed to the draft, and how many narration
  // parts the turn held before it. Settled once the call's text is kept or
  // withheld for good: before the next call (a correction sends the model
  // straight back), before its tools run, and when the loop ends.
  let shown = "";
  let shownFrom = turn.narrationParts.length;
  const settleDraft = () => {
    resetDraftIfWithheld(campaignId, turn, shown, shownFrom);
    shown = "";
    shownFrom = turn.narrationParts.length;
  };

  while (turn.callIndex < MAX_MODEL_CALLS) {
    settleDraft();
    // A stopped turn makes no further call: it unwinds into its halted
    // notice (advance) with whatever it already applied kept.
    assertJobLive();
    // Rebuilt each iteration (see dmTurnTools).
    const inEncounter = Boolean(getActiveEncounter(campaignId));
    const fitted = compact
      ? compactToolsThatFit(campaign, turn, inEncounter, imageEnabled, sheets)
      : { tools: dmTurnTools(campaign, inEncounter, imageEnabled, leanTools), fits: true };
    // When the turn has already acted and not even the narrowest compact set
    // leaves the reply its room, the call narrates what those tools did with
    // none offered, as the last permitted call does, rather than halting the
    // turn for a few tokens. A first call that fits no set is refused for
    // room (model.ts): narrating without tools would decide what dice must.
    const toolsClosed = !fitted.fits && turn.callIndex > 0;
    const finalCall = turn.callIndex === MAX_MODEL_CALLS - 1 || toolsClosed;
    const tools = toolsClosed ? [] : fitted.tools;
    const callTask = toolsClosed ? "turn_without_tools" : "turn";
    if (toolsClosed) {
      console.warn(`[dm-turn] call ${turn.callIndex}: no compact tool set leaves the reply room in this window; this call narrates without tools.`);
    }
    // Fresh reasoning-artifact filter per model call; each call is its own
    // stream. Withheld trailing text is flushed after the call completes.
    const filter = createStreamingArtifactFilter();
    const batcher = createDeltaBatcher((text) => {
      shown += text;
      narrationShown(campaignId, turn.id);
      publishEphemeral(campaignId, "dm_delta", { text });
    });
    const reply = await requestDmMessage(campaign.settings, turn.conversation, {
      tools,
      harness: {
        campaignId,
        catalogue: dmTurnToolCatalogue(campaign, imageEnabled, leanTools),
        turn: true,
      },
      // Fitted again to the window before it goes: the prompt has grown by
      // every call and result so far (src/lib/dm/turn-fit.ts).
      ...turnCallOptions(campaign, turn, "turn"),
      // Force pure narration on the last permitted call so a tool-happy
      // model cannot loop forever.
      toolChoice: finalCall ? "none" : "auto",
      // Thinking mode on tool-decision calls only: without it qwen3.6-35b
      // narrates right past its tools (0/11 tool calls in live combat);
      // with it, rolls and encounters fire reliably. The forced-narration
      // final call skips it to keep turns snappy. DM_THINKING=0 disables.
      thinking: !finalCall && tuning.thinking,
      onDelta: (text) => {
        const visible = filter.push(text);
        if (visible) {
          batcher.push(visible);
        }
      },
    });

    const { message, error, finishReason } = reply;
    // The provider's own continuation items (the Responses API's encrypted
    // reasoning), echoed with the assistant turn they belong to.
    const carried = message?.provider_items?.length ? { provider_items: message.provider_items } : {};
    if (error) {
      batcher.flush();
      const payload = (await error.json().catch(() => null)) as { error?: string; detail?: string } | null;
      failed = payload?.error || "The Dungeon Master could not reach the model backend.";
      noteTurnCall(turn, callTask, tools, reply, failed);
      // The table reads one line; the server log keeps the status and what
      // the backend itself said (out of memory, a crash), so an operator can
      // tell a blip from a server that is down. The backend's words stay out
      // of the notice: they can name internal hosts.
      console.error(
        `[dm-turn] call ${turn.callIndex}: the model call failed (${error.status}): ${failed}${payload?.detail ? ` The backend said: ${payload.detail}` : ""}`,
      );
      break;
    }

    batcher.push(filter.flush());
    batcher.flush();
    noteTurnCall(turn, callTask, tools, reply);
    setJobStage("resolving");
    if (process.env.DM_DEBUG) {
      console.log(
        `[dm-debug] call ${turn.callIndex}: content=${JSON.stringify(String(message?.content ?? "").slice(0, 300))} tool_calls=${JSON.stringify(message?.tool_calls ?? null).slice(0, 500)}`,
      );
    }
    // gpt-oss on vLLM sometimes ends a call on its reasoning alone: no text
    // and no tool call (PR #53). Nothing was said or done, so the same call
    // is simply asked again, once a turn and outside the call budget. An
    // empty last call is caught after the loop instead.
    // A reply that is only an object of arguments no offered tool takes (a
    // small model's call written as JSON, with no name and a key the tool
    // lacks: Gemma4 e4b at 24K) says and does nothing either.
    const replyText = extractReplyText(message?.content);
    const onlyStrayJson = (text: string) => {
      const salvaged = salvageJsonToolCalls(text, tools);
      return !salvaged.calls.length && !extractStoryText(salvaged.text).trim();
    };
    lastReplyEmpty =
      !extractToolCalls(message?.tool_calls).length && (!replyText.trim() || onlyStrayJson(replyText));
    // An empty reply that stopped at the output cap is the window running
    // out, not the model declining to speak (issue #120: the prompt filled
    // the window and a thinking model hit the cap mid-thought). Named in the
    // log so an operator finds it without recording the requests.
    if (lastReplyEmpty && finishReason === "length") {
      const trace = turn.contextTrace;
      console.warn(
        `[dm-turn] call ${turn.callIndex}: the model hit its output cap before any text or tool call (finish_reason=length)` +
          (trace ? `; the prompt was packed at ~${trace.promptTokens} of ${trace.limitTokens} tokens` : "") +
          ". The context window is likely too small for the prompt plus a reply: raise it (OPENAI_COMPAT_CONTEXT) or set DM_LEAN_TOOLS=1.",
      );
    }
    if (lastReplyEmpty && !finalCall && !emptyRetried) {
      emptyRetried = true;
      continue;
    }
    turn.callIndex += 1;

    // Salvage tool calls the model wrote as literal text so they still run
    // (and never reach players as raw text), then merge them with the
    // structured calls under synthetic ids for tool-result pairing. Four
    // nets, in order: the model's native XML dialect (llama-server's
    // extraction intermittently misses it), bare JSON arguments (read before
    // extractStoryText, which takes a reply that is one JSON object for the
    // structured story format and would swallow it), bracket leaks, prose
    // roll-asks.
    const xmlSalvage = salvageXmlToolCalls(extractReplyText(message?.content));
    const jsonSalvage = salvageJsonToolCalls(xmlSalvage.text, tools);
    const salvage = salvageTextualToolCalls(extractStoryText(jsonSalvage.text));
    // The reply's prose, read once by the claims reader (src/lib/dm/claims.ts)
    // for the rolls it asks in words, a fight it announces, a blow it lands,
    // who speaks its quoted lines, the narrator's asides to itself and, with
    // the guard on, what it claims. Not read on the forced final call, where
    // nothing found could run (only its asides are read, below); nor when
    // the reply already rolls (no double dice); nor beside an attack, whose
    // text is dropped below. Kept prose left unread is read by the guard at
    // the end of the turn. So an aside beside request_roll stays: that text
    // is the line setting up the roll, and reading it would cost a call on
    // every roll for a sentence the follow-up narrates past.
    const structuredCalls = [
      ...extractToolCalls(message?.tool_calls),
      ...xmlSalvage.calls,
      ...jsonSalvage.calls,
      ...salvage.calls,
    ];
    const replyRead =
      !finalCall &&
      Boolean(salvage.text.trim()) &&
      !structuredCalls.some((toolCall) => toolCall.name === "request_roll" || resolvesOutcome(toolCall));
    const read = replyRead
      ? await readReply(campaign, sheets, turn, salvage.text, {
          inEncounter,
          encounterNudged,
          damageNudged,
          registering: registeringNames(structuredCalls),
        })
      : null;
    const claims = read?.claims ?? [];
    const proseRolls = rollAsksFromClaims(salvage.text, claims, sheets);
    const salvagedCalls = [...xmlSalvage.calls, ...jsonSalvage.calls, ...salvage.calls, ...proseRolls.calls];
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
    // Only an action this table's turn can be offered is run. The lists
    // below sort calls by name alone, so without this a model could reach a
    // tool the table's settings had taken off its list (pictures switched
    // off, a stage disabled, the lean set) simply by naming it. A call from
    // the other side of a fight still runs, as it always has: the model
    // often starts a fight and swings in one reply, and each action checks
    // the state it needs. A refused call is answered with an error below.
    const catalogue = dmTurnToolCatalogue(campaign, imageEnabled, leanTools);
    const runnable = toolCalls.filter((toolCall) => offersTool(catalogue, toolCall.name));
    if (finalCall && toolCalls.length) {
      finalCallLeaked = true;
    }
    // The foes as they stand before the calls run: end_encounter names
    // none of its own, and a fight waypoint needs them (waypoint-tick.ts).
    const foesBefore = (() => {
      const standing = getActiveEncounter(campaignId);
      return standing ? listEnemies(standing.id).map((enemy) => enemy.displayName) : [];
    })();
    // Text streamed alongside an attack-resolving tool call is the model
    // guessing the outcome before the dice exist ("the blade bites deep" on
    // what turns out to be a miss). Drop it from the persisted narration;
    // the tool result comes back this same turn and the follow-up call
    // narrates from the real numbers. It stays in the echoed assistant
    // message, so the model keeps its own context.
    const calledAttackTool = toolCalls.some(resolvesOutcome);
    // Hand-written "[roll:...]" markers rolled nothing (real markers are
    // appended by finalize() from actual roll ids); drop them before the
    // text is persisted so players never see dead bookkeeping tokens.
    const prose = (visibleText ?? "").replace(fakeRollMarkerRegex(), "").trim();
    // The narrator's asides ("I'll check how the table records that before
    // she answers") are the model talking to itself, not the story: the
    // sentences the reader quoted as asides are cut from what the table
    // reads, and the echoed message keeps the reply whole for the model's
    // own context. The final call's prose was not read above, so its asides
    // are read on their own: it goes to the table as it is.
    const narration = withoutAsides(
      prose,
      read ? claims : finalCall && prose ? await readAsides(campaign, sheets, turn, prose) : [],
    );
    // Nothing of the story left: the reply was only the model's plan. Beside
    // tool calls nothing of it is kept, and the turn owes the narration of
    // what those calls did (needsFollowUp below); with none, it is sent back
    // once (planNudged). On the final call it is simply not kept.
    const planOnly = Boolean(prose) && !narration;
    const planBesideCalls = planOnly && toolCalls.length > 0 && !finalCall;
    // On the last call the tools never run (toolChoice "none"; a leaked call
    // is dropped), so its prose is the only narration there will be.
    if (narration && (!calledAttackTool || finalCall)) {
      turn.narrationParts.push(narration);
      if (read) {
        partReads.set(narration, read);
      }
    }
    const rollCalls = runnable.filter((toolCall) => toolCall.name === "request_roll");
    const inputCalls = runnable.filter(
      (toolCall) => toolCall.name === "request_player_input",
    );
    const mutationCalls = runnable.filter((toolCall) => MUTATION_NAMES.has(toolCall.name));
    const encounterCalls = runnable.filter((toolCall) => ENCOUNTER_NAMES.has(toolCall.name));
    const castBuffCalls = runnable.filter((toolCall) => toolCall.name === "cast_buff");
    const restCalls = runnable.filter((toolCall) => toolCall.name === "take_rest");
    const companionCalls = runnable.filter((toolCall) =>
      COMPANION_TOOL_NAMES.has(toolCall.name),
    );
    const locationCalls = runnable.filter(
      (toolCall) => toolCall.name === "move_party" || toolCall.name === "update_location",
    );
    const eventCalls = runnable.filter((toolCall) => toolCall.name === "record_event");
    const beatCalls = runnable.filter((toolCall) => toolCall.name === "complete_beat");
    const recallCalls = runnable.filter((toolCall) => toolCall.name === "recall_story");
    const searchLoreCalls = runnable.filter((toolCall) => toolCall.name === "search_lore");
    const readCardCalls = runnable.filter((toolCall) => toolCall.name === "read_card");
    const noteCalls = runnable.filter((toolCall) => toolCall.name === "write_campaign_note");
    const whisperCalls = runnable.filter((toolCall) => toolCall.name === "send_whisper");
    const checkCalls = runnable.filter((toolCall) =>
      (CHECK_TOOL_NAMES as readonly string[]).includes(toolCall.name),
    );
    const hazardCalls = runnable.filter((toolCall) =>
      (HAZARD_TOOL_NAMES as readonly string[]).includes(toolCall.name),
    );
    const splitCalls = runnable.filter((toolCall) =>
      (SPLIT_DAMAGE_TOOL_NAMES as readonly string[]).includes(toolCall.name),
    );
    const petCalls = runnable.filter((toolCall) =>
      (PET_TOOL_NAMES as readonly string[]).includes(toolCall.name),
    );
    const socialCalls = runnable.filter((toolCall) =>
      (SOCIAL_TOOL_NAMES as readonly string[]).includes(toolCall.name),
    );
    // A social_check or npc_reaction produces a roll the model must narrate
    // from; a lone set_npc is bookkeeping like record_event.
    const socialRollCalls = socialCalls.filter((toolCall) => toolCall.name !== "set_npc");
    const setNpcCalls = socialCalls.filter((toolCall) => toolCall.name === "set_npc");
    const relationshipCalls = runnable.filter((toolCall) =>
      (RELATIONSHIP_TOOL_NAMES as readonly string[]).includes(toolCall.name),
    );
    const worldCalls = runnable.filter(
      (toolCall) =>
        (WORLD_TOOL_NAMES as readonly string[]).includes(toolCall.name) ||
        (EXPLORE_TOOL_NAMES as readonly string[]).includes(toolCall.name) ||
        (PARTY_TOOL_NAMES as readonly string[]).includes(toolCall.name) ||
        (EFFECT_TOOL_NAMES as readonly string[]).includes(toolCall.name) ||
        (SCENE_TOOL_NAMES as readonly string[]).includes(toolCall.name) ||
        (MOUNT_TOOL_NAMES as readonly string[]).includes(toolCall.name) ||
        (AMBIENCE_TOOL_NAMES as readonly string[]).includes(toolCall.name) ||
        (BINDER_TOOL_NAMES as readonly string[]).includes(toolCall.name) ||
        (FACTION_TOOL_NAMES as readonly string[]).includes(toolCall.name) ||
        (SHOP_TOOL_NAMES as readonly string[]).includes(toolCall.name) ||
        (SETTLEMENT_TOOL_NAMES as readonly string[]).includes(toolCall.name),
    );

    const accepted = new Set<(typeof toolCalls)[number]>();
    // Location bookkeeping is synchronous and cheap; maps render async on
    // the media queue when vision allows.
    const locationResults = new Map<string, Record<string, unknown>>();
    // Asked only when a map could be drawn at all, so a table with maps off
    // or no image backend never waits on a probe.
    const picturesAvailable =
      locationCalls.length > 0 &&
      campaign.gameSettings.mapsEnabled &&
      imageProducerReady(campaign.settings) &&
      (await imagesAvailable(campaign.settings));
    for (const locationCall of locationCalls) {
      const result = handleLocationCall(campaign, locationCall.name, locationCall.rawArguments, picturesAvailable);
      if (result.movedToNewLocation) {
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
      if (!("error" in result)) {
        accepted.add(locationCall);
      }
    }
    const moreToolsResults = new Map<string, ToolResult>();
    for (const moreCall of toolCalls.filter((toolCall) => toolCall.name === MORE_TOOLS)) {
      moreToolsResults.set(moreCall.id ?? MORE_TOOLS, handleMoreTools(campaign, turn, imageEnabled, moreCall.rawArguments));
    }
    // A reply that only asked for more actions spends none of the turn's
    // calls, twice a run: it is the compact profile's lookup, not a move.
    if (moreToolsResults.size && toolCalls.every((toolCall) => toolCall.name === MORE_TOOLS) && freeOpens > 0 && !finalCall) {
      freeOpens -= 1;
      turn.callIndex -= 1;
    }
    const recallResults = new Map<string, Record<string, unknown>>();
    for (const recallCall of recallCalls) {
      recallResults.set(
        recallCall.id ?? "recall_story",
        await handleRecallStory(campaign, recallCall.rawArguments),
      );
    }
    const searchLoreResults = new Map<string, Record<string, unknown>>();
    for (const searchLoreCall of searchLoreCalls) {
      searchLoreResults.set(
        searchLoreCall.id ?? "search_lore",
        await handleSearchLore(campaignId, searchLoreCall.rawArguments),
      );
    }
    const readCardResults = new Map<string, Record<string, unknown>>();
    for (const readCardCall of readCardCalls) {
      readCardResults.set(readCardCall.id ?? "read_card", handleReadCard(campaign, readCardCall.rawArguments));
    }
    // Notes deliver as pending suggestions immediately (like whispers); the
    // lead approves them in the notes panel.
    const noteResults = new Map<string, ToolResult>();
    for (const noteCall of noteCalls) {
      let result: ToolResult;
      if (noteCount >= 1) {
        result = { error: "Note limit reached for this turn.", refused: "limit" };
      } else {
        result = handleWriteCampaignNote(campaign, noteCall.rawArguments);
        if (!("error" in result)) {
          noteCount += 1;
        }
      }
      noteResults.set(noteCall.id ?? "write_campaign_note", result);
    }
    const eventResults = new Map<string, Record<string, unknown>>();
    for (const eventCall of eventCalls) {
      eventResults.set(
        eventCall.id ?? "record_event",
        handleRecordEvent(campaign, eventCall.rawArguments, sheets, sheetsById),
      );
    }
    // set_npc is bookkeeping like record_event: it runs here, before the
    // follow-up decision, so a roster entry sent beside narration is never
    // dropped for want of a follow-up call.
    const setNpcResults = new Map<string, Record<string, unknown>>();
    for (const npcCall of setNpcCalls) {
      const result = handleSetNpc(campaign, npcCall.rawArguments);
      setNpcResults.set(npcCall.id ?? "set_npc", result);
      if (!("error" in result)) {
        accepted.add(npcCall);
      }
    }
    // Waypoints tick before the beat is judged, so an arrival and the beat
    // it lands in the same reply resolve in order (issue #31). The location
    // calls above already ran; the rest of the tools tick again below.
    await tickWaypointsFromCalls(campaignId, toolCalls, { enemyNames: foesBefore, accepted });
    const beatResults = new Map<string, Record<string, unknown>>();
    for (const beatCall of beatCalls) {
      const outcome = handleCompleteBeat(campaignId, beatCall.rawArguments, beatCompleted);
      beatCompleted = beatCompleted || outcome.completed;
      beatGated = beatGated || (outcome.completed && outcome.gated);
      beatClaimed = beatClaimed || (!outcome.completed && outcome.gated);
      beatResults.set(beatCall.id ?? "complete_beat", outcome.result);
    }
    // Whispers deliver immediately (like events); recipients are notified
    // via a contentless ephemeral, so narration never carries the secret.
    const whisperResults = new Map<string, ToolResult>();
    for (const whisperCall of whisperCalls) {
      let result: ToolResult;
      if (whisperCount >= WHISPER_CAP_PER_TURN) {
        result = { error: "Whisper limit reached for this turn.", refused: "limit" };
      } else {
        result = handleSendWhisper(campaign, turn.id, whisperCall.rawArguments, sheets, sheetsById);
        if (!("error" in result)) {
          whisperCount += 1;
          // Track which senders were actually answered so finalize() (and the
          // reply backstop) never mark an unanswered player whisper as done.
          for (const characterId of (result.whisperedCharacterIds as string[] | undefined) ?? []) {
            if (!turn.answeredWhisperCharacterIds.includes(characterId)) {
              turn.answeredWhisperCharacterIds.push(characterId);
            }
          }
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

    // Spotlight: hand the floor to the named characters. Not during a
    // fight: the initiative order owns the floor there, and a spotlight
    // would block the player whose turn it is (issue 17).
    if (inputCalls.length && !spotlightSet && !fightOwnsFloor(campaignId)) {
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

    // What a bookkeeping call already returned above, before the follow-up
    // decision: these ran first because the beat check and the narration
    // link depend on them. Null for a call that resolves below.
    const ranAbove = (
      toolCall: { id?: string; name: string },
      inFight: boolean,
      narrateNow: boolean,
    ): ToolResult | null => {
      switch (toolCall.name) {
        case "request_player_input":
          return playerInputResult(spotlightSet, inFight, narrateNow);
        case "generate_image":
          return { ok: true, note: "The picture is queued with this turn." };
        case "move_party":
        case "update_location":
          return locationResults.get(toolCall.id ?? toolCall.name) ?? { ok: true };
        case "record_event":
          return eventResults.get(toolCall.id ?? "record_event") ?? { ok: true };
        case "complete_beat":
          return beatResults.get(toolCall.id ?? "complete_beat") ?? { ok: true };
        case "recall_story":
          return recallResults.get(toolCall.id ?? "recall_story") ?? { ok: true };
        case "search_lore":
          return searchLoreResults.get(toolCall.id ?? "search_lore") ?? { ok: true };
        case "read_card":
          return readCardResults.get(toolCall.id ?? "read_card") ?? { ok: true };
        case "write_campaign_note":
          return noteResults.get(toolCall.id ?? "write_campaign_note") ?? { ok: true };
        case "send_whisper":
          return whisperResults.get(toolCall.id ?? "send_whisper") ?? { ok: true };
        case "set_npc":
          return setNpcResults.get(toolCall.id ?? "set_npc") ?? { ok: true };
        case MORE_TOOLS:
          return moreToolsResults.get(toolCall.id ?? MORE_TOOLS) ?? { ok: true };
        default:
          return null;
      }
    };
    // Every echoed call gets its result: a strict endpoint (OpenAI) refuses
    // a history with an unanswered tool call.
    const answerRanAbove = (inFight: boolean, narrateNow: boolean) => {
      for (const toolCall of toolCalls) {
        turn.conversation.push({
          role: "tool",
          ...(toolCall.id ? { tool_call_id: toolCall.id } : {}),
          content: JSON.stringify(
            ranAbove(toolCall, inFight, narrateNow) ??
              (offersTool(tools, toolCall.name)
                ? { ok: true }
                : { error: `The engine has no action called "${toolCall.name}".`, retry: true }),
          ),
        });
      }
    };

    // Location-only calls with narration already in hand are pure
    // bookkeeping (applied above); the turn can end without another call.
    const needsFollowUp =
      rollCalls.length > 0 ||
      checkCalls.length > 0 ||
      hazardCalls.length > 0 ||
      petCalls.length > 0 ||
      socialRollCalls.length > 0 ||
      // Every relationship call reports an outcome (how the deed landed, a
      // yes, a refusal) the model must narrate from rather than guess at.
      relationshipCalls.length > 0 ||
      worldCalls.length > 0 ||
      mutationCalls.length > 0 ||
      encounterCalls.length > 0 ||
      restCalls.length > 0 ||
      companionCalls.length > 0 ||
      // A buff spends a slot and a split lands damage: both resolve in the
      // follow-up branch below, so without this they never ran at all.
      castBuffCalls.length > 0 ||
      splitCalls.length > 0 ||
      // The model asked for a chapter recall or lore search in order to
      // use the answer.
      recallCalls.length > 0 ||
      searchLoreCalls.length > 0 ||
      // more_tools was asked for actions the model means to use.
      moreToolsResults.size > 0 ||
      // A reply that was only a plan beside its calls told the table
      // nothing of them, whatever the turn already narrated.
      planBesideCalls ||
      ((locationCalls.length > 0 ||
        eventCalls.length > 0 ||
        whisperCalls.length > 0 ||
        noteCalls.length > 0 ||
        setNpcCalls.length > 0) &&
        !turn.narrationParts.length);

    if (!needsFollowUp) {
      saveDmTurn(turn);
      // A note to itself ("I will set the landing first") is not narration
      // and ends nothing; none of it was kept. Send the model once to do
      // what it planned and narrate. A model that plans again keeps no
      // narration, so the turn ends on the empty-turn line, not the plan.
      if (!finalCall && !planNudged && !toolCalls.length && planOnly) {
        planNudged = true;
        turn.conversation.push({ role: "assistant", content: visibleText || "", ...carried });
        turn.conversation.push({ role: "user", content: planCorrection(turn.callIndex === MAX_MODEL_CALLS - 1) });
        saveDmTurn(turn);
        continue;
      }
      // A fight announced in prose alone does not exist: no enemies, no
      // initiative, no HP. Hold the announcement back and send the model to
      // start_encounter for real; the follow-up narrates from tool results.
      if (
        !finalCall &&
        !encounterNudged &&
        !inEncounter &&
        narration &&
        turn.narrationParts[turn.narrationParts.length - 1] === narration &&
        fightAnnounced(claims)
      ) {
        encounterNudged = true;
        turn.narrationParts.pop();
        turn.conversation.push({
          role: "assistant",
          ...carried,
          content: visibleText || "",
          tool_calls: echoedToolCalls,
        });
        answerRanAbove(fightOwnsFloor(campaignId), false);
        turn.conversation.push({ role: "user", content: FAKE_ENCOUNTER_PROMPT });
        // Saved again: the save above still carried the withheld announcement.
        saveDmTurn(turn);
        continue;
      }
      // A blow that only the prose landed did not happen either: the sheet
      // keeps its hit points while the table reads "Hit! 8 damage." (issue
      // 91). Hold it back and send the model to the tool that resolves it.
      const unrolled =
        !finalCall && !damageNudged && narration && turn.narrationParts[turn.narrationParts.length - 1] === narration
          ? unrolledFigure(claims, turn.conversation, campaign.gameSettings.tableLanguage)
          : null;
      if (unrolled) {
        damageNudged = true;
        turn.narrationParts.pop();
        turn.conversation.push({
          role: "assistant",
          ...carried,
          content: visibleText || "",
          tool_calls: echoedToolCalls,
        });
        answerRanAbove(fightOwnsFloor(campaignId), false);
        turn.conversation.push({ role: "user", content: unrolledDamagePrompt(unrolled) });
        saveDmTurn(turn);
        continue;
      }
      // In a fight, a swing only the prose resolved did not happen either:
      // no dice, no hit points. Held back the same way, once a turn, and
      // the model is sent to the tool for the attack the player declared.
      const blow =
        !finalCall && !attackNudged && read && narration && turn.narrationParts[turn.narrationParts.length - 1] === narration
          ? unrolledBlow(claims, read.outcomes)
          : null;
      if (blow) {
        attackNudged = true;
        turn.narrationParts.pop();
        turn.conversation.push({
          role: "assistant",
          ...carried,
          content: visibleText || "",
          tool_calls: echoedToolCalls,
        });
        answerRanAbove(fightOwnsFloor(campaignId), false);
        turn.conversation.push({ role: "user", content: unrolledBlowPrompt(blow) });
        saveDmTurn(turn);
        continue;
      }
      // A card played from the Hand as an attack or a cast that no tool
      // resolved has not happened, however the prose tells it. The prose is
      // held back and the model is sent once to the tool the card names;
      // the follow-up narrates from its result (src/lib/dm/intent-logic.ts).
      if (
        !finalCall &&
        !intentNudged &&
        card &&
        !intentAnswered(card.intent, [...calledToolNames(turn.conversation), ...toolCalls.map((toolCall) => toolCall.name)])
      ) {
        intentNudged = true;
        if (narration && turn.narrationParts[turn.narrationParts.length - 1] === narration) {
          turn.narrationParts.pop();
        }
        turn.conversation.push({
          role: "assistant",
          ...carried,
          content: visibleText || "",
          tool_calls: echoedToolCalls,
        });
        answerRanAbove(fightOwnsFloor(campaignId), false);
        turn.conversation.push({
          role: "user",
          content: intentCorrection(card.intent, card.characterId, card.name),
        });
        saveDmTurn(turn);
        continue;
      }
      // A spotlight or a question with no narration yet gets one
      // forced-narration call so the turn never lands empty. That covers a
      // question put during a fight (no spotlight is set there, the
      // initiative order owns the floor) and one naming no player's
      // character (nobody was handed the floor), which used to close the
      // turn on the empty-turn line. A reply of other calls that need no
      // follow-up (complete_beat, generate_image, a tool that does not
      // exist) and no prose ended the same way, and is narrated the same way.
      if ((spotlightSet || toolCalls.length > 0) && !turn.narrationParts.length && !finalCall) {
        turn.conversation.push({
          role: "assistant",
          ...carried,
          content: visibleText || "",
          tool_calls: echoedToolCalls,
        });
        answerRanAbove(!spotlightSet && fightOwnsFloor(campaignId), true);
        continue;
      }
      break;
    }
    if (finalCall) {
      saveDmTurn(turn);
      break;
    }
    // Text beside an attack is withheld now, before the dice: a pc_attack
    // can park for a player's physical roll and leave the draft up for long.
    settleDraft();

    setDmStatus(campaignId, "rolling");

    // Echo the assistant turn (with its tool calls) then answer each call
    // with a tool result carrying the real dice outcome.
    turn.conversation.push({
      role: "assistant",
      ...carried,
      content: visibleText || "",
      tool_calls: echoedToolCalls,
    });

    // The calls resolve in the order the model sent them: a Rage, a Bless or
    // a Hunter's Mark called before the attack in the same reply is on the
    // sheet when the attack reads it. An error goes back with the kind its
    // handler stated (src/lib/dm/tool-errors.ts).
    // A pc_attack or roll for a physical-dice player parks instead: its
    // result arrives when the turn resumes with the adjudicated roll.
    const inputInFight = !spotlightSet && fightOwnsFloor(campaignId);
    let parkedAny = false;
    for (const toolCall of toolCalls) {
      const holder = turnHolder(campaignId);
      const outcome =
        ranAbove(toolCall, inputInFight, false) ??
        (offersTool(catalogue, toolCall.name)
          ? await resolveModelCall(context, turn, toolCall)
          : { error: `The engine has no action called "${toolCall.name}".`, retry: true });
      // A combatant who left the fight during the call takes no turn with them.
      settleTurn(context.campaign, holder);
      if (outcome[PARKED]) {
        parkedAny = true;
        continue;
      }
      if (!("error" in outcome)) {
        accepted.add(toolCall);
      }
      turn.conversation.push({
        role: "tool",
        ...(toolCall.id ? { tool_call_id: toolCall.id } : {}),
        content: JSON.stringify(outcome),
      });
    }

    // The NPC, item, objective and combat tools ran after the beat check:
    // their waypoints tick now, for the next reply's checklist, and before
    // a park so a resumed turn does not lose them.
    await tickWaypointsFromCalls(campaignId, toolCalls, { enemyNames: foesBefore, accepted });

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
  settleDraft();

  // A private exchange (whispers only) is allowed to end without narration
  // (finalize() writes nothing to the table for it), so an empty reply there
  // gets no call asking for some.
  if (
    !failed &&
    !turn.narrationParts.length &&
    (finalCallLeaked || (lastReplyEmpty && !turn.playerWhisperIds.length))
  ) {
    failed = await narrateAfterToolLeak(context, turn);
  }
  let spoken: SpokenLine[] = [];
  if (!failed) {
    await ensureWhisperReplies(context, turn);
    // Last stop before the narration is persisted: cross-check the prose
    // against the outcomes this turn's tools actually resolved and against
    // the encounter as it now stands, and spend the one call held in
    // reserve for it (outside MAX_MODEL_CALLS) on a rewrite when they
    // disagree. Its reads also say who speaks the narration's lines.
    spoken = await enforceEngineBoundary(campaign, turn, sheets, partReads);
  }
  // A turn the queue gave up on writes nothing if it ever wakes: its notice
  // is already in the transcript (src/lib/dm/turn-halt.ts).
  if (jobAbandoned()) {
    throw new DmJobStopped("the turn was abandoned.");
  }
  finalize(context, turn, failed, spoken);
  if (!failed) {
    setJobStage("closing_chapter");
    await maybeCloseChapter(campaignId, { beatCompleted, beatGated, beatClaimed });
    if (isStageEnabled(context.campaign.gameSettings.stages, "compaction")) {
      compactHistoryInBackground(campaignId, undefined, Date.now(), { evicted: turn.contextTrace?.historyEvicted ?? 0 });
    }
    // The world-simulation heartbeat: pure dice, sparks land in the NEXT
    // turn's prompt, so background clocks never trigger model calls.
    tickWorldState(campaignId);
  }
}

// Marks a call that parked for a player's physical dice: its tool result
// arrives when the turn resumes, so none is written now.
const PARKED = "__turnParked";

// One model call that did not run above, resolved against the engine with
// the loop's own rails: the per-turn caps, the item-approval offers, the
// companion roster refresh, and parking for physical dice. Everything else
// goes through the same dispatch the DM console uses
// (src/lib/dm/invoke-dispatch.ts), so the two callers cannot drift.
async function resolveModelCall(
  context: TurnContext,
  turn: DmTurn,
  toolCall: { id?: string; name: string; rawArguments: string },
): Promise<ToolResult> {
  const { campaign, sheets, sheetsById, realDiceUserIds } = context;
  const { name } = toolCall;
  // "false" sent as a string is false (src/lib/dm/arg-coerce.ts).
  const rawArguments = strictBooleanArgs(toolCall.rawArguments);
  // The model's damage, healing and binding conditions are the server's to
  // roll (src/lib/dm/ai-gate.ts). The encounter and mutation calls and
  // request_roll below run their handlers directly, so they are held to it
  // here, a capped call once it is past its cap (the gate may roll dice or a
  // save the table sees); the rest reach the gate in dispatchAdjudication,
  // and are not gated twice.
  const gate = () => gateAiCall(name, rawArguments, { campaign, turn, sheetsById });
  if (ENCOUNTER_NAMES.has(name)) {
    if (turn.encounterCount >= ENCOUNTER_CAP_PER_TURN) {
      return ENCOUNTER_CAP_REFUSAL;
    }
    const gated = gate();
    if ("result" in gated) {
      return gated.result;
    }
    const result = applyEncounterCall(campaign, turn, name, gated.args, sheets, sheetsById, {
      realDiceUserIds,
      toolCallId: toolCall.id ?? null,
    }).result;
    if (!("error" in result)) {
      turn.encounterCount += 1;
    }
    return result[PC_ATTACK_PARKED] ? { [PARKED]: true } : result;
  }
  // Companion recruit/dismiss resolves synchronously: the sheet, order
  // slot, and token exist before the model narrates the arrival. The shared
  // snapshot is refreshed in place so a pc_attack later in the same reply
  // resolves the new (or removed) companion.
  if (COMPANION_TOOL_NAMES.has(name)) {
    const result = applyCompanionCall(campaign, name, rawArguments, listSheets(campaign.id));
    if (!("error" in result)) {
      const fresh = listSheets(campaign.id);
      sheets.length = 0;
      sheets.push(...fresh);
      sheetsById.clear();
      for (const freshSheet of fresh) {
        sheetsById.set(freshSheet.id, freshSheet);
      }
    }
    return result;
  }
  // Stat mutations resolve synchronously under a hard per-turn cap. With
  // inventoryApprovals, item and gold changes to player characters stage as
  // offers the owning player answers.
  if (MUTATION_NAMES.has(name)) {
    if (turn.mutationCount >= MUTATION_CAP_PER_TURN) {
      return MUTATION_CAP_REFUSAL;
    }
    const gated = gate();
    if ("result" in gated) {
      return gated.result;
    }
    const result =
      maybeProposeItemChange(campaign, turn.id, name, gated.args, sheetsById) ??
      applyDmMutation(campaign, turn.id, name, gated.args, sheets, sheetsById).result;
    if (!("error" in result)) {
      turn.mutationCount += 1;
    }
    return result;
  }
  // One request_roll for both callers (src/lib/dm/invoke-roll.ts); the
  // model's parks remember the call they answer. Held to the gate here, as
  // dispatchAdjudication holds the console's path.
  if (name === "request_roll") {
    const gated = gate();
    if ("result" in gated) {
      return gated.result;
    }
    const result = handleRequestRoll(campaign, turn, gated.args, sheets, sheetsById, realDiceUserIds, {
      toolCallId: toolCall.id ?? null,
    });
    if (result.parked) {
      return { [PARKED]: true };
    }
    return typeof result.total === "number"
      ? { ...result, note: "Narrate this real result. Do not roll again for the same action." }
      : result;
  }
  return dispatchAdjudication(name, rawArguments, { campaign, turn, sheets, sheetsById, realDiceUserIds });
}

// Every tool the turn has called so far, from its conversation.
function calledToolNames(conversation: DmTurn["conversation"]): string[] {
  return collectExchanges(conversation).map((exchange) => exchange.name).filter(Boolean);
}

// The card behind the action this turn answers: the last player message,
// when it came from the Hand as an attack or a cast.
function cardPlayed(
  context: TurnContext,
): { intent: MessageIntent; characterId: string | null; name: string } | null {
  const last = [...listRecentMessages(context.campaign.id, 20)]
    .reverse()
    .find((message) => message.authorType !== "system");
  if (!last || last.authorType !== "player" || !last.intent || !intentNeedsTool(last.intent)) {
    return null;
  }
  const sheet = last.characterId ? context.sheetsById.get(last.characterId) : undefined;
  return { intent: last.intent, characterId: last.characterId, name: sheet?.name ?? "The player" };
}

// The out-of-character answer to table talk put to the DM: one call with
// the turn's whole prompt and no tools, written as table talk. It is not a
// turn (no dm_turns row, nothing to reroll or retry) and runs none of a
// turn's after-effects. Its place is taken before the call, so a move posted
// while the DM is answering lands after the answer and is still the newest
// line for the turn it wakes.
async function answerOutOfCharacter(campaign: Campaign, conversation: DmTurn["conversation"], trace: DmTurn["contextTrace"] | undefined) {
  const campaignId = campaign.id;
  const seq = allocateSeq(campaignId);
  try {
    const { message, error } = await requestDmMessage(
      campaign.settings,
      [...conversation, { role: "user", content: OOC_ANSWER_INSTRUCTION }],
      {
        tools: [],
        toolChoice: "none",
        harness: { campaignId, turn: true },
        thinking: false,
        fit: turnCallFit({ contextTrace: trace ?? null }),
        minOutputTokens: turnMinOutputTokens(campaign),
        meta: { task: "ooc_answer" },
      },
    );
    const answer = error ? "" : stripToolText(extractStoryText(message?.content)).trim();
    if (answer) {
      // No speech: an aside is not read aloud as narration.
      const inserted = insertCampaignMessage({ campaignId, seq, authorType: "dm", content: oocAnswer(answer).slice(0, 4_000), speech: [] });
      publishWithSeq(campaignId, allocateSeq(campaignId), "message_added", { message: inserted });
      return;
    }
    // A question that got no answer says so, rather than leaving the player
    // waiting on one that never comes.
    const failure = error ? ((await error.json().catch(() => null)) as { error?: string } | null)?.error : "";
    const notice = insertCampaignMessage({
      campaignId,
      seq,
      authorType: "system",
      glyph: "cue-bell",
      content: `${OOC_UNANSWERED_PREFIX}${failure ? ` (${failure.slice(0, 300)})` : ""}. Ask again, or carry on.`,
    });
    publishWithSeq(campaignId, allocateSeq(campaignId), "message_added", { message: notice });
  } finally {
    setDmStatus(campaignId, "idle");
  }
}

// The last call goes out with toolChoice "none", yet some servers still
// answer it with a tool call and no text (vLLM serving gpt-oss; Ollama has
// no tool_choice at all), and the turn closed on the empty-turn line. One
// more call with no tools offered asks for the narration. The leaked calls
// never ran and are not echoed, so the history stays well-formed. The same
// call answers a turn whose last reply came back empty after its one retry.
const TOOLS_CLOSED_PROMPT =
  "[System] Tools are closed for this turn: nothing you call now will run. Narrate the moment to the table in prose, from what has already resolved, and do not describe the outcome of anything that did not. If you need something from a player, ask it in the narration.";

// Sent once a turn when a reply was only a plan. It was streamed, so it
// does not claim the players never saw it, and it leaves the table's tone
// to the system prompt. When the next call is the last one its tools are
// closed, so it does not send the model to them.
function planCorrection(toolsClosed: boolean): string {
  return `[System] That reply was a note about what you plan to do, not narration for the table. ${
    toolsClosed
      ? "Tools are closed for this turn: narrate the moment to the players from what has already resolved"
      : "Do it now: call the tools the scene needs, then narrate the moment to the players"
  }, ending on what they decide next. Never describe your own next steps to the table.`;
}

async function narrateAfterToolLeak(context: TurnContext, turn: DmTurn) {
  const { campaign, sheets } = context;
  const campaignId = campaign.id;
  const filter = createStreamingArtifactFilter();
  let shown = "";
  const shownFrom = turn.narrationParts.length;
  const batcher = createDeltaBatcher((text) => {
    shown += text;
    narrationShown(campaignId, turn.id);
    publishEphemeral(campaignId, "dm_delta", { text });
  });
  const rescue = await requestDmMessage(
    campaign.settings,
    [...turn.conversation, { role: "user", content: TOOLS_CLOSED_PROMPT }],
    {
      tools: [],
      toolChoice: "none",
      harness: { campaignId, turn: true },
      thinking: false,
      ...turnCallOptions(campaign, turn, "tools_closed_rescue"),
      onDelta: (text) => {
        const visible = filter.push(text);
        if (visible) {
          batcher.push(visible);
        }
      },
    },
  );
  const { message, error } = rescue;
  batcher.push(filter.flush());
  batcher.flush();
  noteTurnCall(turn, "tools_closed_rescue", [], rescue);
  turn.callIndex += 1;
  if (process.env.DM_DEBUG) {
    console.log(
      `[dm-debug] tool-leak rescue: content=${JSON.stringify(String(message?.content ?? "").slice(0, 300))} error=${Boolean(error)}`,
    );
  }
  const failure = error
    ? ((await error.json().catch(() => null)) as { code?: string; error?: string } | null)
    : null;
  const prose = error ? "" : stripToolText(extractStoryText(message?.content)).trim();
  // Read for the narrator's asides like the final call: a reply that was
  // only a plan keeps nothing, and finalize writes the empty-turn line
  // rather than the plan. There is no second rescue.
  const narration = prose ? withoutAsides(prose, await readAsides(campaign, sheets, turn, prose)) : "";
  if (narration) {
    turn.narrationParts.push(narration);
  }
  saveDmTurn(turn);
  resetDraftIfWithheld(campaignId, turn, shown, shownFrom);
  // Other rescue errors retain the existing empty-turn fallback. A stopped
  // repetition is different: the model produced a harmful partial stream,
  // so finalize must leave this turn failed and available for retry. (A
  // loop in the narration comes back as its first copy, since this call may
  // only narrate; the error is a loop with nothing to keep, inside the
  // model's reasoning.)
  return failure?.code === "stream_repetition"
    ? failure.error || "The model repeated its narration and this turn was stopped."
    : "";
}

// Guarantees every private player message this turn carried gets a private
// reply. The model often narrates instead of calling send_whisper (or does
// nothing), which used to silently consume the message; here we nudge it once
// with an explicit whisper prompt, then fall back to a canned whisper so the
// player is never left in silence.
async function ensureWhisperReplies(context: TurnContext, turn: DmTurn) {
  if (!turn.playerWhisperIds.length) {
    return;
  }
  const { campaign, sheets, sheetsById } = context;
  const pending = listPendingPlayerWhispers(campaign.id).filter((whisper) =>
    turn.playerWhisperIds.includes(whisper.id),
  );
  const unanswered = () =>
    pending.filter(
      (whisper) =>
        whisper.characterId && !turn.answeredWhisperCharacterIds.includes(whisper.characterId),
    );
  if (!unanswered().length) {
    return;
  }

  // One forced follow-up call: name the messages still owed a reply and ask
  // for send_whisper explicitly. toolChoice stays "auto" (the llama.cpp /v1
  // path only exercises auto/none) with a strong nudge instead.
  const owed = unanswered()
    .map((whisper) => `- ${whisper.characterName}: "${whisper.content}"`)
    .join("\n");
  const backstop = await requestDmMessage(
    campaign.settings,
    [
      ...turn.conversation,
      {
        role: "user",
        content: `[System] You have not yet privately answered these player messages. Reply to each one now using the send_whisper tool addressed to that character. Refuse any out-of-character request for levels, XP, perks, items, or abilities in-fiction, but resolve legitimate secret actions. Do not narrate anything to the shared table.\n${owed}`,
      },
    ],
    { tools: [sendWhisperTool], toolChoice: "auto", thinking: true, ...turnCallOptions(campaign, turn, "whisper_backstop") },
  );
  noteTurnCall(turn, "whisper_backstop", [sendWhisperTool], backstop);
  const { message } = backstop;
  const xmlSalvage = salvageXmlToolCalls(extractReplyText(message?.content));
  const jsonSalvage = salvageJsonToolCalls(xmlSalvage.text, [sendWhisperTool]);
  const salvage = salvageTextualToolCalls(extractStoryText(jsonSalvage.text));
  const whisperCalls = [
    ...extractToolCalls(message?.tool_calls),
    ...xmlSalvage.calls,
    ...jsonSalvage.calls,
    ...salvage.calls,
  ].filter((toolCall) => toolCall.name === "send_whisper");
  for (const whisperCall of whisperCalls) {
    const result = handleSendWhisper(
      campaign,
      turn.id,
      whisperCall.rawArguments,
      sheets,
      sheetsById,
    );
    if (!("error" in result)) {
      for (const characterId of (result.whisperedCharacterIds as string[] | undefined) ?? []) {
        if (!turn.answeredWhisperCharacterIds.includes(characterId)) {
          turn.answeredWhisperCharacterIds.push(characterId);
        }
      }
    }
  }

  // Anyone still unanswered gets a deterministic fallback whisper so the
  // private line never goes silent.
  for (const whisper of unanswered()) {
    if (!whisper.characterId) {
      continue;
    }
    deliverWhisper(
      campaign.id,
      turn.id,
      [
        {
          userId: whisper.userId,
          characterId: whisper.characterId,
          characterName: whisper.characterName,
        },
      ],
      FALLBACK_WHISPER_MESSAGE,
    );
    turn.answeredWhisperCharacterIds.push(whisper.characterId);
  }
  saveDmTurn(turn);
}

// request_player_input: hands the floor to named players and waits for them.
// Exported for the adjudication façade, which is why the parsing lives in
// parseSpotlightUserIds rather than inline in the turn loop: the AI sets this
// spotlight from a tool call and a person sets the same one from the console,
// and they must land on the identical floor state.
export function handleRequestPlayerInput(
  campaign: Campaign,
  rawArguments: string,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
): ToolResult {
  // Initiative owns the floor while a fight runs, exactly as the floor route
  // refuses there. Handing it to someone out of turn would break the order.
  if (fightOwnsFloor(campaign.id)) {
    return { error: "The initiative order has the floor while the fight runs.", retry: true };
  }
  const parsed = parseSpotlightUserIds(rawArguments, sheets, sheetsById);
  if (!parsed) {
    return { error: "Name at least one player character to give the floor to.", retry: true };
  }
  const floor = {
    mode: "spotlight" as const,
    userIds: parsed.userIds,
    prompt: parsed.prompt,
    respondedUserIds: [],
  };
  setFloor(campaign.id, floor);
  publishPersisted(campaign.id, "floor_changed", { floor });
  return { ok: true, waitingOn: parsed.userIds.length };
}

// record_event: a lasting milestone on the character's permanent record
// (feeds the profile "story so far" and future GAME STATE blocks).
// Exported for the adjudication façade (src/lib/dm/invoke.ts): a human DM
// records the same milestones through the same path the model uses.
export function handleRecordEvent(
  campaign: Campaign,
  rawArguments: string,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
): ToolResult {
  let args: { characterId?: unknown; kind?: unknown; summary?: unknown };
  try {
    args = JSON.parse(rawArguments || "{}");
  } catch {
    return { error: "Invalid arguments.", retry: true };
  }
  const sheet = resolveSheetRef(
    typeof args.characterId === "string" ? args.characterId : undefined,
    sheets,
    sheetsById,
  );
  if (!sheet) {
    return { error: "Unknown characterId; use one from GAME STATE.", retry: true };
  }
  // A kind off the list is "story", never an error: a milestone is always
  // worth recording under some kind. Its words are not read for one.
  const kind = CHARACTER_EVENT_KINDS.find((entry) => entry === args.kind) ?? "story";
  const summary = String(args.summary ?? "").trim().slice(0, 300);
  if (!summary) {
    return { error: "record_event needs a one-sentence summary.", retry: true };
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
// Exported for the adjudication façade (src/lib/dm/invoke.ts).
//
// picturesAvailable is the caller's answer to imagesAvailable(), asked before
// the call because this bookkeeping stays synchronous. A server whose setup
// said "no pictures" still has ComfyUI as its fallback backend, so without it
// every new area queued a map that could only fail, in front of the table.
export function handleLocationCall(
  campaign: Campaign,
  toolName: string,
  rawArguments: string,
  picturesAvailable: boolean,
): ToolResult {
  let args: {
    name?: unknown;
    layoutDescription?: unknown;
    connections?: unknown;
    visionClear?: unknown;
    scene?: unknown;
  };
  try {
    args = JSON.parse(rawArguments || "{}");
  } catch {
    return { error: "Invalid arguments.", retry: true };
  }
  const beds = sceneIds();
  if (args.scene !== undefined && !beds.includes(String(args.scene))) {
    return { error: `Unknown scene "${String(args.scene)}"; use one of: ${beds.join(", ")}.`, retry: true };
  }
  const scene = args.scene === undefined ? undefined : String(args.scene);
  const layoutDescription =
    typeof args.layoutDescription === "string" ? args.layoutDescription : undefined;
  const connections = Array.isArray(args.connections)
    ? args.connections.map(String).slice(0, 12)
    : undefined;
  const visionClear = args.visionClear === true;

  let location;
  let previousLayout = "";
  let movedToNewLocation = false;
  // A return that left out the layout, as the location rule asks, to a place
  // that has one on record: the model is told how the place was left, since
  // away from it GAME STATE shows only the current place's layout and its
  // narration of the return would otherwise invent the room anew. (A place
  // known only as somebody's route has a row but no layout yet.)
  let returnedTo = false;
  if (toolName === "move_party") {
    const name = typeof args.name === "string" ? args.name.trim() : "";
    if (!name) {
      return { error: "move_party needs a location name.", retry: true };
    }
    const previous = getCurrentLocation(campaign.id);
    const onRecord = getLocationByName(campaign.id, name);
    location = upsertCurrentLocation({
      campaignId: campaign.id,
      name,
      layoutDescription,
      connections,
    });
    movedToNewLocation = !previous || previous.id !== location.id;
    returnedTo =
      movedToNewLocation &&
      onRecord?.id === location.id &&
      onRecord.layoutDescription.trim() !== "" &&
      !layoutDescription?.trim();
    // Somewhere unwritten, with the world simulation on, gets its people
    // before the model narrates it (docs/vtt-parity-implementation-plan.md
    // 12.1). Anywhere already peopled is left as it was.
    if (movedToNewLocation && campaign.gameSettings.worldSimulation && !location.layoutDescription.trim() && !placeIsWritten(campaign, location)) {
      populateSettlement(campaign, location, {});
      location = getCurrentLocation(campaign.id) ?? location;
    }
    // Keep the old area linked to the new one so routes stay consistent.
    if (previous && previous.id !== location.id) {
      const merged = withNewNames(location.connections, [previous.name]);
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
      return { error: "No current location; call move_party first.", retry: true };
    }
  }

  // The kind of place is its sound: stored as the place's bed, so the
  // battle map and the stand-in picture read the same value.
  if (scene !== undefined) {
    const ambience = { bed: scene, music: location.ambience?.music ?? "" };
    setLocationLinks(location.id, { ambience });
    location = { ...location, ambience };
  }

  publishPersisted(campaign.id, "location_updated", { location });

  // The place is what the room should be hearing, so a DM who never touches
  // the sound controls still gets a cave that sounds like one; a held layer
  // and a table with scene following switched off are both left alone
  // inside the helper.
  followSceneAmbience(campaign, location.ambience?.bed || null);

  // Render when the area has no map yet, or when an update materially
  // changed the recorded layout.
  const layoutRevised =
    toolName === "update_location" && location.layoutDescription !== previousLayout;
  const mapEnqueued =
    visionClear &&
    campaign.gameSettings.mapsEnabled &&
    picturesAvailable &&
    imageProducerReady(campaign.settings) &&
    (!location.mapImage || layoutRevised);
  if (mapEnqueued) {
    void enqueueLocationMap(campaign, location.id);
  }

  const recorded = location.layoutDescription.trim();
  return {
    ok: true,
    location: location.name,
    note:
      returnedTo && recorded
        ? `Recorded. The party is back at ${location.name}, as it was left: ${recorded} Continue the scene.`
        : "Recorded. Continue the scene.",
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

// What request_player_input reports back. Only a spotlight hands the floor
// over and shows its prompt; in a fight the initiative order keeps the
// floor, and a call naming no player's character hands it to nobody. In
// both of those the question reaches the table only if the narration asks it.
function playerInputResult(
  spotlightSet: boolean,
  inFight: boolean,
  narrateNow: boolean,
): { ok: boolean; note: string } {
  const stop = narrateNow ? " Narrate the moment and stop." : "";
  if (spotlightSet) {
    return { ok: true, note: narrateNow ? "The floor is theirs. Narrate the moment and stop." : "Floor updated." };
  }
  if (inFight) {
    return {
      ok: true,
      note: `The initiative order keeps the floor and nobody sees this prompt: put the question in your narration.${stop}`,
    };
  }
  return {
    ok: false,
    note: `No player's character was named (AI companions never take the floor), so nobody sees this prompt: put the question in your narration.${stop}`,
  };
}

// The last thing a player said and what their sheet can cast, so an empty
// turn can tell them what their message was missing (src/lib/dm/empty-turn.ts).
function emptyTurnPlayer(context: TurnContext): EmptyTurnPlayer | null {
  const last = [...listRecentMessages(context.campaign.id, 20)]
    .reverse()
    .find((message) => message.authorType !== "system");
  if (!last || last.authorType !== "player") {
    return null;
  }
  const sheet = last.characterId ? context.sheetsById.get(last.characterId) : undefined;
  const casting = sheet?.spellcasting ?? null;
  return {
    text: last.content,
    spells: casting
      ? [...allSpellNames(casting), ...(casting.pending ?? []), ...(casting.spellbook ?? [])]
      : [],
    levelOf: (spell) =>
      spellLevelOf(spell) ?? findSpellByName(spell, spellAuthorsFor(context.campaign))?.level ?? null,
    notReady: (spell) => notReadyReason(casting, spell)?.error ?? null,
  };
}

// The halted notice lives beside the queue's own halts
// (src/lib/dm/turn-halt.ts); restart recovery still reaches it here.
export { haltDmTurn };

function finalize(context: TurnContext, turn: DmTurn, failed: string, spoken: readonly SpokenLine[]) {
  const campaignId = context.campaign.id;
  // The place a player's reply made this narration take, if one arrived
  // while it was on screen (src/lib/dm/narration-slot.ts). The message sits
  // in that slot; its event still takes a fresh seq, since every client has
  // already seen events past the slot and would drop an older one.
  const claimed = takeNarrationSeq(campaignId, turn.id);

  if (failed) {
    haltDmTurn(campaignId, turn, failed, claimed);
    return;
  }

  // Mark a player whisper answered only when its sender actually received a
  // reply this turn (ensureWhisperReplies guarantees one, real or fallback),
  // or when it is unanswerable (its character is gone). A whisper with no
  // reply stays pending so the next turn retries instead of it vanishing.
  // Failed turns return above, so they stay pending too.
  if (turn.playerWhisperIds.length) {
    const answeredWhisperIds = listPendingPlayerWhispers(campaignId)
      .filter(
        (whisper) =>
          turn.playerWhisperIds.includes(whisper.id) &&
          (!whisper.characterId ||
            turn.answeredWhisperCharacterIds.includes(whisper.characterId)),
      )
      .map((whisper) => whisper.id);
    markPlayerWhispersAnswered(answeredWhisperIds, turn.id);
  }

  // A purely private exchange (whispers in, send_whisper out, no narration,
  // no rolls) writes nothing to the shared chat; the fallback line below
  // would leak that a secret exchange happened at all.
  if (turn.playerWhisperIds.length && !turn.narrationParts.join("").trim() && !turn.rollIds.length) {
    if (claimed !== null) {
      // Nothing takes the slot a player's message reserved; the draft
      // bubble stops pointing at it.
      publishEphemeral(campaignId, "dm_draft_seq", { seq: null });
    }
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
    // A refused player action says why instead of the bare fallback line.
    content = emptyTurnLine(turn.conversation, emptyTurnPlayer(context));
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
  const seq = claimed ?? allocateSeq(campaignId);
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
    // Links the narration back to the conversation it came from so the lead
    // can reroll its prose (src/lib/dm/renarrate.ts) without re-running the
    // turn's tools.
    dmTurnId: turn.id,
    speech: modelTextLines(context.campaign, content, spoken),
  });
  publishWithSeq(campaignId, claimed === null ? seq : allocateSeq(campaignId), "message_added", { message });
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

  if (message.imageRequest && imageProducerReady(context.campaign.settings)) {
    void fulfillAutoImage(campaignId, message.id, message.imageRequest, context.campaign.settings);
  }
  if (context.campaign.gameSettings.ttsEnabled) {
    void enqueueNarrationAudio(
      campaignId,
      message.id,
      content,
      message.speech,
      context.campaign.gameSettings,
    );
  }

  turn.status = "done";
  saveDmTurn(turn);
}
