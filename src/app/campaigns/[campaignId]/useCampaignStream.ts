"use client";

import { useCallback, useEffect, useReducer, useRef } from "react";
import type { CampaignMember, SessionUser } from "@/lib/campaign-types";
import type { OneShotEventId } from "@/lib/dm/director-logic";
import { sortCalls, type UtilityCall } from "@/lib/dm/call-tracker-logic";
import type { Campaign } from "@/lib/db/campaigns";
import type { Chapter } from "@/lib/db/chapters";
import type { CharacterEvent } from "@/lib/db/character-events";
import type { PublicEncounter } from "@/lib/db/encounter-view";
import type { CampaignMessage } from "@/lib/db/messages";
import type { DmBeat } from "@/lib/db/dm-beats";
import type { Note } from "@/lib/db/notes";
import type { StoredRoll } from "@/lib/db/rolls";
import type { DmWhisper } from "@/lib/db/dm-whispers";
import type { CampaignAsk } from "@/lib/db/asks";
import type { WorldFact } from "@/lib/db/facts";
import type { SideThread } from "@/lib/db/side-chat";
import { EMPTY_AMBIENCE, type AmbienceState } from "@/lib/ambience/logic";
import type { PlayerMapView } from "@/lib/battlemap/view";
import type { MapPing } from "@/lib/dm/board-logic";
import { capsForRole, type ViewerCaps } from "@/lib/dm/viewer";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import type { VoiceRosterEntry } from "@/lib/voice/types";

export type DmStatus =
  | "idle"
  | "thinking"
  | "rolling"
  | "narrating"
  | "awaiting_rolls"
  | "writing_chapter"
  | "plotting_arc";

export type MediaStatus = {
  kind: "image" | "map" | "tts";
  state: "queued" | "generating" | "failed";
  startedAt: string;
};

export type PendingRoll = {
  id: string;
  userId: string;
  characterId: string | null;
  kind: string;
  detail: string;
  expression: string;
  advantage: string;
  dc: number | null;
  reason: string;
  createdAt: string;
};

export type AuditEntry = {
  id: string;
  characterId: string;
  characterName?: string;
  actor?: string;
  turnId?: string | null;
  kind: string;
  delta: Record<string, unknown>;
  reason: string;
  seq: number;
  createdAt: string;
  // Whether the party lead can undo this entry (a pre-image was recorded).
  undoable?: boolean;
  revertedAt?: string | null;
};

export type LevelUpNotice = {
  characterId: string;
  characterName: string;
  level: number;
};

// A DM item/gold offer awaiting the owning player (inventoryApprovals).
export type ItemProposal = {
  id: string;
  characterId: string;
  userId: string;
  toolName: string;
  summary: string;
  reason: string;
  status: string;
  createdAt: string;
};

export type CampaignLocation = {
  id: string;
  name: string;
  layoutDescription: string;
  connections: string[];
  visited: boolean;
  isCurrent: boolean;
  mapImage: { url: string } | null;
  updatedAt: string;
};

export type CampaignState = {
  loading: boolean;
  error: string;
  campaign: Campaign | null;
  // What this seat may see and do, decided by the server
  // (src/lib/dm/viewer.ts). The client never re-derives it from ids, so a
  // control the server would refuse is never rendered in the first place.
  caps: ViewerCaps;
  me: SessionUser | null;
  members: CampaignMember[];
  sheets: CharacterSheet[];
  messages: CampaignMessage[];
  rolls: StoredRoll[];
  pendingRolls: PendingRoll[];
  auditLog: AuditEntry[];
  levelUps: LevelUpNotice[];
  locations: CampaignLocation[];
  chapters: Chapter[];
  notes: Note[];
  sideThreads: SideThread[];
  // True once the first side-chat fetch landed; the chime baseline waits
  // for it so a page load with backlog stays silent.
  sideChatLoaded: boolean;
  whispers: DmWhisper[];
  whisperUnread: number;
  whispersLoaded: boolean;
  // Ask: the caller's own questions plus every table-visible one.
  asks: CampaignAsk[];
  asksLoaded: boolean;
  // World-state facts visible to this member (facts_updated is contentless;
  // each member pulls their own scoped view).
  facts: WorldFact[];
  // Bumped by the contentless relationships_updated ephemeral; the Bonds
  // panel fetches its own tier-scoped view when this changes.
  relationshipsVersion: number;
  characterEvents: CharacterEvent[];
  encounter: PublicEncounter | null;
  // Open DM item/gold offers (inventoryApprovals).
  itemProposals: ItemProposal[];
  // The caller's fogged battle-map projection; null outside combat.
  battleMap: PlayerMapView | null;
  // The last person to point at the board. Ephemeral by nature: a ping is
  // only true while somebody is making it, so it is never replayed and the
  // panel drops it after its animation (src/lib/dm/board.ts).
  mapPing: MapPing | null;
  // What the table is hearing: the ambience bed and music cue the DM, the
  // model or the engine last set (src/lib/ambience/logic.ts). Persisted, so
  // a player who reloads mid-scene lands back in the same room rather than
  // in silence until something changes.
  ambience: AmbienceState;
  // The last one-shot sting. Ephemeral by nature, like a map ping: a sting
  // is only true while it is happening, so it is never replayed and the
  // player hook drops it once it has sounded.
  ambienceSting: { cue: string; at: number } | null;
  narrationAudio: Record<string, string>;
  latestTts: { messageId: string; url: string; seq: number } | null;
  latestRoll: { roll: StoredRoll; source: string; seq: number } | null;
  lastSeq: number;
  dmStatus: DmStatus;
  // Background utility work in flight (compaction, chapter seal, world tick,
  // lore check, Ask). Separate from dmStatus, which describes the TURN: these
  // run outside one, several can overlap, and each carries its own label.
  utilityCalls: UtilityCall[];
  dmDraft: string;
  // The one-turn director steer the party lead has armed, if any. Null until
  // the first director_armed event or the panel's own fetch lands.
  directorArm: {
    armed: boolean;
    oneShot: OneShotEventId | null;
    absoluteCommand: string;
  } | null;
  // Ephemeral progress per media target (message/location id).
  mediaStatus: Record<string, MediaStatus>;
  // Human-DM mode: story the DM has written down, newest first. Only the DM
  // seat is served these; every other seat gets an empty list, because the
  // beats panel is a DM tool (the text itself is public, in the transcript).
  beats: DmBeat[];
  // Human-DM mode: player actions the DM has not answered yet, oldest first.
  // Cleared when the DM narrates, which is what "answered" means until the
  // console can resolve them one at a time.
  dmIntents: Array<{ messageId: string; userId: string; characterId: string; seq: number }>;
  // Who is on the voice call. Null until the first roster event, so the voice
  // hook can tell "nobody has joined" from "we have not heard yet" and only
  // re-subscribes once it has real data. Unlike most per-seat state this rides
  // the stream directly: the roster is small, identical for every seat, and
  // contains nothing private.
  voiceRoster: VoiceRosterEntry[] | null;
  // Who mediasoup's dominant-speaker detection last named, and when. The
  // timestamp is what lets the indicator fade: the event says who started
  // talking, never who stopped.
  voiceSpeaking: { userId: string; at: number } | null;
  // Bumped by the contentless voice_audibility_changed ephemeral. Gains are
  // per-listener, so like the fogged battle map each client fetches its own
  // row rather than the stream carrying everyone's.
  voiceAudibilityVersion: number;
  // Mesh voice signaling nudge: `to` names whose mailbox has mail; the
  // payload itself waits server-side for that user's authenticated drain.
  voiceMeshSignal: { to: string; version: number };
  // Bumped by the contentless schedule_updated ephemeral; the schedule
  // section refetches its list.
  scheduleVersion: number;
  // Who has the campaign open in a live tab right now. Rides the stream
  // directly for the same reason the voice roster does: small, identical
  // for every seat, and nothing private.
  online: string[];
};

const initialState: CampaignState = {
  loading: true,
  error: "",
  campaign: null,
  // A plain player until the snapshot says otherwise: the safe default is
  // the one that shows the fewest controls and no secrets.
  caps: capsForRole("player", "ai"),
  me: null,
  members: [],
  sheets: [],
  messages: [],
  rolls: [],
  pendingRolls: [],
  auditLog: [],
  levelUps: [],
  locations: [],
  chapters: [],
  notes: [],
  sideThreads: [],
  sideChatLoaded: false,
  whispers: [],
  whisperUnread: 0,
  whispersLoaded: false,
  asks: [],
  asksLoaded: false,
  facts: [],
  relationshipsVersion: 0,
  characterEvents: [],
  encounter: null,
  itemProposals: [],
  battleMap: null,
  mapPing: null,
  ambience: EMPTY_AMBIENCE,
  ambienceSting: null,
  narrationAudio: {},
  latestTts: null,
  latestRoll: null,
  lastSeq: 0,
  dmStatus: "idle",
  utilityCalls: [],
  dmDraft: "",
  directorArm: null,
  mediaStatus: {},
  beats: [],
  dmIntents: [],
  voiceRoster: null,
  voiceSpeaking: null,
  voiceAudibilityVersion: 0,
  voiceMeshSignal: { to: "", version: 0 },
  online: [],
  scheduleVersion: 0,
};

type Action =
  | { type: "snapshot"; payload: Partial<CampaignState> & { lastSeq: number } }
  | { type: "notes"; notes: Note[] }
  | { type: "sideThreads"; sideThreads: SideThread[] }
  | { type: "whispers"; whispers: DmWhisper[]; unread: number }
  | { type: "asks"; asks: CampaignAsk[] }
  | { type: "facts"; facts: WorldFact[] }
  | { type: "battleMap"; view: PlayerMapView | null }
  | { type: "mapPing"; ping: MapPing }
  | { type: "encounter"; encounter: PublicEncounter | null }
  | { type: "rolls"; rolls: StoredRoll[] }
  | { type: "error"; error: string }
  | { type: "event"; eventType: string; seq: number | null; payload: Record<string, unknown> };

function withoutKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  if (!key || !(key in record)) {
    return record;
  }
  const next = { ...record };
  delete next[key];
  return next;
}

function upsertBy<T>(list: T[], item: T, key: (entry: T) => string): T[] {
  const index = list.findIndex((entry) => key(entry) === key(item));
  if (index < 0) {
    return [...list, item];
  }
  const next = [...list];
  next[index] = item;
  return next;
}

function reducer(state: CampaignState, action: Action): CampaignState {
  switch (action.type) {
    case "snapshot":
      return { ...state, ...action.payload, loading: false, error: "" };
    case "notes":
      return { ...state, notes: action.notes };
    case "sideThreads":
      return { ...state, sideThreads: action.sideThreads, sideChatLoaded: true };
    case "encounter":
      return { ...state, encounter: action.encounter };
    case "asks":
      return { ...state, asks: action.asks, asksLoaded: true };
    case "whispers":
      return {
        ...state,
        whispers: action.whispers,
        whisperUnread: action.unread,
        whispersLoaded: true,
      };
    case "facts":
      return { ...state, facts: action.facts };
    case "battleMap":
      return { ...state, battleMap: action.view };
    case "mapPing":
      return { ...state, mapPing: action.ping };
    case "error":
      return { ...state, loading: false, error: action.error };
    case "event": {
      // Persisted events are idempotent by seq; ephemeral ones (seq null)
      // always apply.
      if (action.seq !== null && action.seq <= state.lastSeq) {
        return state;
      }
      const next = action.seq !== null ? { ...state, lastSeq: action.seq } : { ...state };
      const payload = action.payload;

      switch (action.eventType) {
        case "message_added": {
          const message = payload.message as CampaignMessage;
          // Long sessions accumulate thousands of messages otherwise; cap
          // like rolls/auditLog so render cost stays flat (the snapshot
          // reload window is 100, so 200 keeps scrollback beyond it).
          next.messages = upsertBy(state.messages, message, (entry) => entry.id).slice(-200);
          // A halted-turn notice (system, linked to its dm_turns row) ends the
          // turn just like narration does. Without this the abandoned partial
          // draft stays on screen and a retry streams on top of it.
          if (
            message.authorType === "dm" ||
            (message.authorType === "system" && message.dmTurnId)
          ) {
            next.dmDraft = "";
            next.dmStatus = "idle";
            // A narration answers everything the party had said up to it, so
            // the queue clears with the same event that clears the draft.
            // Actions that land mid-narration keep their own later seq and
            // are re-queued by their own event.
            //
            // A beat is the exception. It arrives as a DM passage too, but it
            // records play that already happened rather than answering the
            // party, so it must not tick off actions still waiting on a
            // ruling (src/lib/dm/beats.ts).
            if (!payload.beat) {
              next.dmIntents = state.dmIntents.filter((intent) => intent.seq > message.seq);
            }
          }
          return next;
        }
        case "roll_result":
          next.rolls = [...state.rolls.slice(-30), payload.roll as StoredRoll];
          next.latestRoll = {
            roll: payload.roll as StoredRoll,
            source: String(payload.source ?? "digital"),
            seq: action.seq ?? 0,
          };
          if (payload.pendingRollId) {
            next.pendingRolls = state.pendingRolls.filter(
              (pending) => pending.id !== payload.pendingRollId,
            );
          }
          return next;
        case "beat_recorded": {
          const beat = payload.beat as DmBeat | undefined;
          // Only the DM seat is given a beat list to append to; for everyone
          // else this stays empty and the beat is simply the DM passage they
          // already saw arrive.
          if (beat && state.caps.adjudicates) {
            next.beats = [beat, ...state.beats].slice(0, 20);
          }
          return next;
        }
        case "roll_pending": {
          const pending = payload.pendingRoll as PendingRoll | undefined;
          if (pending) {
            next.pendingRolls = upsertBy(state.pendingRolls, pending, (entry) => entry.id);
          }
          return next;
        }
        case "sheet_audit": {
          const entry = payload.entry as AuditEntry | undefined;
          if (entry) {
            next.auditLog = [
              ...state.auditLog.slice(-80),
              { ...entry, characterName: payload.characterName as string | undefined },
            ];
          }
          return next;
        }
        case "level_up_available": {
          const notice = payload as unknown as LevelUpNotice;
          if (notice.characterId) {
            next.levelUps = upsertBy(state.levelUps, notice, (entry) => entry.characterId);
          }
          return next;
        }
        case "location_updated": {
          const location = payload.location as CampaignLocation | undefined;
          if (location) {
            next.locations = upsertBy(
              location.isCurrent
                ? state.locations.map((entry) => ({ ...entry, isCurrent: false }))
                : state.locations,
              location,
              (entry) => entry.id,
            );
          }
          return next;
        }
        case "tts_ready": {
          const messageId = String(payload.messageId ?? "");
          const url = String(payload.url ?? "");
          if (messageId && url) {
            next.narrationAudio = { ...state.narrationAudio, [messageId]: url };
            next.latestTts = { messageId, url, seq: action.seq ?? 0 };
            next.mediaStatus = withoutKey(state.mediaStatus, messageId);
          }
          return next;
        }
        case "ambience_changed":
          next.ambience = payload.ambience as AmbienceState;
          return next;
        case "ambience_sting":
          next.ambienceSting = {
            cue: String(payload.cue ?? ""),
            at: Number(payload.at ?? Date.now()),
          };
          return next;
        case "location_map_ready":
          next.locations = state.locations.map((location) =>
            location.id === payload.locationId
              ? { ...location, mapImage: payload.image as CampaignLocation["mapImage"] }
              : location,
          );
          next.mediaStatus = withoutKey(state.mediaStatus, String(payload.locationId ?? ""));
          return next;
        // Contentless: standing is scoped per member (players see tier
        // words, the lead sees numbers), so the panel refetches its own view.
        case "relationships_updated":
          next.relationshipsVersion = state.relationshipsVersion + 1;
          return next;
        case "media_status": {
          const targetId = String(payload.targetId ?? "");
          if (targetId) {
            next.mediaStatus = {
              ...state.mediaStatus,
              [targetId]: {
                kind: payload.kind as MediaStatus["kind"],
                state: payload.state as MediaStatus["state"],
                startedAt: String(payload.startedAt ?? new Date().toISOString()),
              },
            };
          }
          return next;
        }
        case "member_joined": {
          const member: CampaignMember = {
            userId: String(payload.userId),
            username: String(payload.username),
            role: "player",
            ready: false,
            useRealDice: false,
            joinedAt: new Date().toISOString(),
          };
          next.members = upsertBy(state.members, member, (entry) => entry.userId);
          return next;
        }
        case "member_updated": {
          const member = payload.member as CampaignMember | undefined;
          if (member) {
            next.members = upsertBy(state.members, member, (entry) => entry.userId);
          }
          return next;
        }
        case "member_ready":
          next.members = state.members.map((member) =>
            member.userId === payload.userId ? { ...member, ready: Boolean(payload.ready) } : member,
          );
          return next;
        case "sheet_updated": {
          const sheet = payload.sheet as CharacterSheet;
          // One sheet per user per campaign: a lobby switch changes the
          // sheet id, so any other sheet of the same user is stale.
          const pruned = state.sheets.filter(
            (entry) => entry.id === sheet.id || entry.userId !== sheet.userId,
          );
          next.sheets = upsertBy(pruned, sheet, (entry) => entry.id);
          // A completed level-up clears its notice.
          next.levelUps = state.levelUps.filter(
            (notice) => !(notice.characterId === sheet.id && sheet.level >= notice.level),
          );
          return next;
        }
        case "sheet_deleted":
          next.sheets = state.sheets.filter((entry) => entry.id !== payload.sheetId);
          return next;
        case "chapter_closed": {
          const closed = payload.chapter as Chapter | undefined;
          const opened = payload.opened as Chapter | undefined;
          let chapters = state.chapters;
          if (closed) {
            chapters = upsertBy(chapters, closed, (entry) => entry.id);
          }
          if (opened) {
            chapters = upsertBy(chapters, opened, (entry) => entry.id);
          }
          next.chapters = [...chapters].sort((a, b) => a.index - b.index);
          return next;
        }
        case "chapter_updated": {
          const chapter = payload.chapter as Chapter | undefined;
          if (chapter) {
            next.chapters = upsertBy(state.chapters, chapter, (entry) => entry.id);
          }
          return next;
        }
        case "note_updated": {
          const note = payload.note as Note | undefined;
          if (note) {
            next.notes = upsertBy(state.notes, note, (entry) => entry.id);
          }
          return next;
        }
        case "note_deleted":
          next.notes = state.notes.filter((note) => note.id !== payload.noteId);
          return next;
        case "character_event": {
          const event = payload.event as CharacterEvent | undefined;
          if (event) {
            next.characterEvents = upsertBy(
              state.characterEvents.slice(-60),
              event,
              (entry) => entry.id,
            );
          }
          return next;
        }
        case "audit_reverted":
          next.auditLog = state.auditLog.map((entry) =>
            entry.id === payload.entryId
              ? { ...entry, revertedAt: String(payload.revertedAt ?? "") }
              : entry,
          );
          return next;
        case "campaign_updated":
          next.campaign = state.campaign
            ? { ...state.campaign, ...(payload as Partial<Campaign>) }
            : state.campaign;
          return next;
        case "item_proposal_added": {
          const proposal = payload.proposal as ItemProposal | undefined;
          if (proposal) {
            next.itemProposals = upsertBy(state.itemProposals, proposal, (entry) => entry.id);
          }
          return next;
        }
        case "item_proposal_resolved": {
          const proposal = payload.proposal as ItemProposal | undefined;
          if (proposal) {
            next.itemProposals = state.itemProposals.filter((entry) => entry.id !== proposal.id);
          }
          return next;
        }
        case "encounter_updated": {
          const shared = (payload.encounter as PublicEncounter | null) ?? null;
          // The stream carries the player-safe projection. A DM sees real hit
          // points, so taking this payload would silently downgrade their view
          // mid-fight; they keep what they have until their own fetch lands.
          // The fight ending is not a downgrade, so null always applies.
          next.encounter = state.caps.enemyNumbers && shared ? state.encounter : shared;
          return next;
        }
        case "dm_intent_queued":
          next.dmIntents = [
            ...state.dmIntents,
            {
              messageId: String(payload.messageId ?? ""),
              userId: String(payload.userId ?? ""),
              characterId: String(payload.characterId ?? ""),
              seq: Number(payload.seq ?? 0),
            },
          ];
          return next;
        case "floor_changed":
          next.campaign = state.campaign
            ? { ...state.campaign, floor: payload.floor as Campaign["floor"] }
            : state.campaign;
          return next;
        // Assisted mode: the DM stepped away, came back, or the AI spent one
        // of the answers they handed over. Rides on the campaign for the same
        // reason the floor does: every seat renders it and none should be
        // reading a second copy.
        case "dm_cover_changed":
          next.campaign = state.campaign
            ? { ...state.campaign, dmCover: (payload.cover as Campaign["dmCover"]) ?? null }
            : state.campaign;
          return next;
        case "message_updated": {
          const updated = payload.message as CampaignMessage | undefined;
          if (updated) {
            next.messages = state.messages.map((message) =>
              message.id === updated.id ? updated : message,
            );
          }
          return next;
        }
        case "image_ready":
          next.messages = state.messages.map((message) =>
            message.id === payload.messageId
              ? { ...message, generatedImage: payload.image as CampaignMessage["generatedImage"] }
              : message,
          );
          next.mediaStatus = withoutKey(state.mediaStatus, String(payload.messageId ?? ""));
          return next;
        case "dm_status":
          next.dmStatus = payload.state as DmStatus;
          return next;
        case "utility_calls":
          // The server sends the whole in-flight set each time, so a dropped
          // event self-heals on the next one rather than leaving a stuck chip.
          next.utilityCalls = sortCalls((payload.calls as UtilityCall[]) ?? []);
          return next;
        case "director_armed":
          next.directorArm = {
            armed: Boolean(payload.armed),
            oneShot: (payload.oneShot as OneShotEventId | null) ?? null,
            absoluteCommand: String(payload.absoluteCommand ?? ""),
          };
          return next;
        case "dm_delta":
          next.dmDraft = state.dmDraft + String(payload.text ?? "");
          next.dmStatus = "narrating";
          return next;
        // The whole roster each time, so a dropped event self-heals on the
        // next one rather than leaving a ghost on the call.
        case "voice_roster":
          next.voiceRoster = (payload.peers as VoiceRosterEntry[]) ?? [];
          return next;
        // The whole online set each time, like the voice roster, so a
        // dropped event self-heals on the next join or leave.
        case "presence":
          next.online = (payload.online as string[]) ?? [];
          return next;
        case "voice_speaking":
          next.voiceSpeaking = { userId: String(payload.userId ?? ""), at: Date.now() };
          return next;
        case "voice_audibility_changed":
          next.voiceAudibilityVersion = state.voiceAudibilityVersion + 1;
          return next;
        case "voice_mesh_signal":
          next.voiceMeshSignal = {
            to: String(payload.to ?? ""),
            version: state.voiceMeshSignal.version + 1,
          };
          return next;
        case "schedule_updated":
          next.scheduleVersion = state.scheduleVersion + 1;
          return next;
        default:
          return next;
      }
    }
    default:
      return state;
  }
}

const PERSISTED_EVENTS = [
  "message_added",
  "message_updated",
  "roll_result",
  "roll_pending",
  "member_joined",
  "member_ready",
  "member_updated",
  "sheet_updated",
  "sheet_deleted",
  "sheet_audit",
  "level_up_available",
  "campaign_updated",
  "chapter_closed",
  "chapter_updated",
  "note_updated",
  "note_deleted",
  "note_suggested",
  "character_event",
  "audit_reverted",
  "encounter_updated",
  "floor_changed",
  "image_ready",
  "location_updated",
  "location_map_ready",
  "tts_ready",
  "ambience_changed",
  "campaign_rewound",
  "item_proposal_added",
  "item_proposal_resolved",
  // A player acted at a human-DM table: the message already arrived through
  // message_added, so this only tells the DM's console there is something
  // waiting. Persisted so a DM who reconnects still sees the backlog.
  "dm_intent_queued",
  // The AI is standing in for the human DM, or has stopped. Persisted so a
  // player joining mid-stretch is told, rather than quietly talking to a
  // stand-in they cannot see.
  "dm_cover_changed",
];
const EPHEMERAL_EVENTS = [
  "dm_status",
  "utility_calls",
  "dm_delta",
  "media_status",
  "side_activity",
  "whisper_activity",
  "ask_activity",
  "facts_updated",
  "relationships_updated",
  "battle_map_updated",
  "map_ping",
  // One sound, once. Worthless after the fact, so never replayed.
  "ambience_sting",
  // Who is on the call right now. Worthless after the fact, so it is never
  // replayed to a reconnecting client.
  "voice_roster",
  // Who is talking. Even more so.
  "voice_speaking",
  // Contentless: each listener pulls their own gains.
  "voice_audibility_changed",
  // Mesh signaling nudge; the payload stays in a per-user server mailbox.
  "voice_mesh_signal",
  // Contentless: the schedule section refetches.
  "schedule_updated",
  // Who has the campaign open right now. Worthless after the fact, like the
  // voice roster, so it is never replayed.
  "presence",
];
const EPHEMERAL_EVENT_SET = new Set(EPHEMERAL_EVENTS);

export function useCampaignStream(campaignId: string) {
  const [state, dispatch] = useReducer(reducer, initialState);
  // The SSE handlers are registered once, so they cannot close over `state`.
  // Caps are set by the snapshot and never change for a mounted session, but
  // the handlers still need to read them after that first load.
  const capsRef = useRef(state.caps);
  useEffect(() => {
    capsRef.current = state.caps;
  }, [state.caps]);

  // Loads the snapshot and returns its latestSeq so the event stream can
  // start exactly where the snapshot left off.
  const refresh = useCallback(async (): Promise<number> => {
    try {
      const response = await fetch(`/api/campaigns/${campaignId}`);
      if (response.status === 401) {
        window.location.href = "/";
        return 0;
      }
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        dispatch({ type: "error", error: data.error || "Could not load the campaign." });
        return 0;
      }
      const data = await response.json();
      const lastSeq = data.latestSeq ?? 0;
      dispatch({
        type: "snapshot",
        payload: {
          campaign: data.campaign,
          caps: data.caps ?? capsForRole("player", "ai"),
          me: data.me,
          members: data.members,
          sheets: data.sheets,
          messages: data.messages,
          rolls: data.rolls,
          pendingRolls: data.pendingRolls ?? [],
          auditLog: data.auditLog ?? [],
          locations: data.locations ?? [],
          chapters: data.chapters ?? [],
          notes: data.notes ?? [],
          characterEvents: data.characterEvents ?? [],
          encounter: data.encounter ?? null,
          itemProposals: data.itemProposals ?? [],
          beats: data.beats ?? [],
          dmStatus: data.dmStatus ?? "idle",
          utilityCalls: sortCalls(data.utilityCalls ?? []),
          narrationAudio: data.narrationAudio ?? {},
          ambience: data.ambience ?? EMPTY_AMBIENCE,
          lastSeq,
        },
      });
      return lastSeq;
    } catch {
      dispatch({ type: "error", error: "Could not reach the server." });
      return 0;
    }
  }, [campaignId]);

  // Re-fetches just the caller's visible notes. Suggestion events carry no
  // content (privacy), so clients pull their own filtered list instead.
  const refreshNotes = useCallback(async () => {
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/notes`);
      if (!response.ok) {
        return;
      }
      const data = await response.json();
      dispatch({ type: "notes", notes: data.notes ?? [] });
    } catch {
      // transient; the next snapshot refresh catches up
    }
  }, [campaignId]);

  // Side-chat threads follow the same privacy pattern, one step stricter:
  // the side_activity event is ephemeral and empty, and each member pulls
  // only their own threads.
  const refreshSideChat = useCallback(async () => {
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/side-chat`);
      if (!response.ok) {
        return;
      }
      const data = await response.json();
      dispatch({ type: "sideThreads", sideThreads: data.threads ?? [] });
    } catch {
      // transient; the next side_activity event retries
    }
  }, [campaignId]);

  // The battle map is per-character fogged, so even token positions never
  // ride the shared stream; the ping-and-self-fetch pattern applies.
  const refreshBattleMap = useCallback(async () => {
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/battle-map`);
      if (!response.ok) {
        return;
      }
      const data = await response.json();
      dispatch({ type: "battleMap", view: data.view ?? null });
    } catch {
      // transient; the next battle_map_updated event retries
    }
  }, [campaignId]);

  // Same pattern for the DM's encounter view: the shared stream is
  // player-safe, so the seat allowed real numbers pulls its own projection.
  const refreshEncounter = useCallback(async () => {
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/encounter`);
      if (!response.ok) {
        return;
      }
      const data = await response.json();
      dispatch({ type: "encounter", encounter: data.encounter ?? null });
    } catch {
      // transient; the next encounter_updated event retries
    }
  }, [campaignId]);

  // A blind or DM-only roll reaches the shared stream with its number
  // stripped, because the stream is one payload for every seat. Whoever is
  // allowed to read it pulls their own copy, the same way the DM pulls their
  // own enemy numbers.
  const refreshRolls = useCallback(async () => {
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/rolls`);
      if (!response.ok) {
        return;
      }
      const data = await response.json();
      dispatch({ type: "rolls", rolls: data.rolls ?? [] });
    } catch {
      // transient; the next roll retries
    }
  }, [campaignId]);

  // DM whispers follow the side-chat privacy pattern: the whisper_activity
  // event is ephemeral and empty; each member pulls only their own rows.
  const refreshWhispers = useCallback(async () => {
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/whispers`);
      if (!response.ok) {
        return;
      }
      const data = await response.json();
      dispatch({ type: "whispers", whispers: data.whispers ?? [], unread: data.unread ?? 0 });
    } catch {
      // transient; the next whisper_activity event retries
    }
  }, [campaignId]);

  // Ask uses the same privacy pattern: ask_activity is contentless and
  // fires only for table-visible asks; each member pulls the rows they may
  // read (their own, plus anything shared with the table).
  const refreshAsks = useCallback(async () => {
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/ask`);
      if (!response.ok) {
        return;
      }
      const data = await response.json();
      dispatch({ type: "asks", asks: data.asks ?? [] });
    } catch {
      // transient; the next ask_activity event retries
    }
  }, [campaignId]);

  // World facts follow the same privacy pattern: facts_updated is
  // contentless and each member fetches their own known_by-scoped view.
  const refreshFacts = useCallback(async () => {
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/facts`);
      if (!response.ok) {
        return;
      }
      const data = await response.json();
      dispatch({ type: "facts", facts: data.facts ?? [] });
    } catch {
      // transient; the next facts_updated event retries
    }
  }, [campaignId]);

  useEffect(() => {
    let source: EventSource | null = null;
    let cancelled = false;

    refresh().then((lastSeq) => {
      if (cancelled) {
        return;
      }
      void refreshSideChat();
      void refreshWhispers();
      void refreshAsks();
      void refreshFacts();
      void refreshBattleMap();
      source = new EventSource(`/api/campaigns/${campaignId}/events?lastSeq=${lastSeq}`);
      const handle = (eventType: string) => (event: MessageEvent) => {
        try {
          const payload = JSON.parse(event.data);
          // Ephemeral events carry no SSE id, but the browser's lastEventId
          // persists from the previous id-bearing event, so trusting it here
          // would make the seq guard drop every ephemeral event.
          const seq =
            EPHEMERAL_EVENT_SET.has(eventType) || !event.lastEventId
              ? null
              : Number(event.lastEventId);
          dispatch({ type: "event", eventType, seq, payload });
          if (eventType === "note_suggested") {
            void refreshNotes();
          }
          // A rewind mass-deletes state that incremental events cannot
          // express; reload everything from the snapshot endpoint.
          if (eventType === "campaign_rewound") {
            void refresh();
            void refreshNotes();
            void refreshSideChat();
            void refreshWhispers();
            void refreshAsks();
            void refreshFacts();
            void refreshBattleMap();
          }
          if (eventType === "side_activity") {
            void refreshSideChat();
          }
          if (eventType === "whisper_activity") {
            void refreshWhispers();
          }
          if (eventType === "ask_activity") {
            void refreshAsks();
          }
          if (eventType === "facts_updated") {
            void refreshFacts();
          }
          // encounter_updated too: the map exists the moment
          // start_encounter lands, before any battle_map_updated ping.
          if (eventType === "battle_map_updated" || eventType === "encounter_updated") {
            void refreshBattleMap();
          }
          if (eventType === "map_ping") {
            const ping = payload as unknown as MapPing;
            if (typeof ping?.x === "number" && typeof ping?.y === "number") {
              dispatch({ type: "mapPing", ping });
            }
          }
          // Only the seats allowed real numbers need their own projection;
          // for everyone else the stream payload already applied above.
          if (eventType === "encounter_updated" && capsRef.current.enemyNumbers) {
            void refreshEncounter();
          }
          if (
            eventType === "roll_result" &&
            (payload.roll as { hidden?: boolean } | undefined)?.hidden &&
            (capsRef.current.adjudicates || capsRef.current.steersStory)
          ) {
            void refreshRolls();
          }
        } catch {
          // malformed event; ignore
        }
      };
      for (const type of [...PERSISTED_EVENTS, ...EPHEMERAL_EVENTS]) {
        source.addEventListener(type, handle(type));
      }
    });

    return () => {
      cancelled = true;
      source?.close();
    };
  }, [
    campaignId,
    refresh,
    refreshNotes,
    refreshSideChat,
    refreshWhispers,
    refreshAsks,
    refreshFacts,
    refreshBattleMap,
    refreshEncounter,
    refreshRolls,
  ]);

  return {
    state,
    refresh,
    refreshNotes,
    refreshSideChat,
    refreshWhispers,
    refreshAsks,
    refreshFacts,
    refreshBattleMap,
    refreshEncounter,
  };
}
