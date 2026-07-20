"use client";

import { useCallback, useEffect, useReducer } from "react";
import type { CampaignMember, SessionUser } from "@/lib/campaign-types";
import type { Campaign } from "@/lib/db/campaigns";
import type { Chapter } from "@/lib/db/chapters";
import type { CharacterEvent } from "@/lib/db/character-events";
import type { PublicEncounter } from "@/lib/db/encounters";
import type { CampaignMessage } from "@/lib/db/messages";
import type { Note } from "@/lib/db/notes";
import type { StoredRoll } from "@/lib/db/rolls";
import type { DmWhisper } from "@/lib/db/dm-whispers";
import type { SideThread } from "@/lib/db/side-chat";
import type { PlayerMapView } from "@/lib/battlemap/view";
import type { CharacterSheet } from "@/lib/schemas/sheet";

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
  characterEvents: CharacterEvent[];
  encounter: PublicEncounter | null;
  // The caller's fogged battle-map projection; null outside combat.
  battleMap: PlayerMapView | null;
  narrationAudio: Record<string, string>;
  latestTts: { messageId: string; url: string; seq: number } | null;
  latestRoll: { roll: StoredRoll; source: string; seq: number } | null;
  lastSeq: number;
  dmStatus: DmStatus;
  dmDraft: string;
  // Ephemeral progress per media target (message/location id).
  mediaStatus: Record<string, MediaStatus>;
};

const initialState: CampaignState = {
  loading: true,
  error: "",
  campaign: null,
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
  characterEvents: [],
  encounter: null,
  battleMap: null,
  narrationAudio: {},
  latestTts: null,
  latestRoll: null,
  lastSeq: 0,
  dmStatus: "idle",
  dmDraft: "",
  mediaStatus: {},
};

type Action =
  | { type: "snapshot"; payload: Partial<CampaignState> & { lastSeq: number } }
  | { type: "notes"; notes: Note[] }
  | { type: "sideThreads"; sideThreads: SideThread[] }
  | { type: "whispers"; whispers: DmWhisper[]; unread: number }
  | { type: "battleMap"; view: PlayerMapView | null }
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
    case "whispers":
      return {
        ...state,
        whispers: action.whispers,
        whisperUnread: action.unread,
        whispersLoaded: true,
      };
    case "battleMap":
      return { ...state, battleMap: action.view };
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
          if (message.authorType === "dm") {
            next.dmDraft = "";
            next.dmStatus = "idle";
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
        case "location_map_ready":
          next.locations = state.locations.map((location) =>
            location.id === payload.locationId
              ? { ...location, mapImage: payload.image as CampaignLocation["mapImage"] }
              : location,
          );
          next.mediaStatus = withoutKey(state.mediaStatus, String(payload.locationId ?? ""));
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
        case "encounter_updated":
          next.encounter = (payload.encounter as PublicEncounter | null) ?? null;
          return next;
        case "floor_changed":
          next.campaign = state.campaign
            ? { ...state.campaign, floor: payload.floor as Campaign["floor"] }
            : state.campaign;
          return next;
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
        case "dm_delta":
          next.dmDraft = state.dmDraft + String(payload.text ?? "");
          next.dmStatus = "narrating";
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
];
const EPHEMERAL_EVENTS = [
  "dm_status",
  "dm_delta",
  "media_status",
  "side_activity",
  "whisper_activity",
  "battle_map_updated",
];
const EPHEMERAL_EVENT_SET = new Set(EPHEMERAL_EVENTS);

export function useCampaignStream(campaignId: string) {
  const [state, dispatch] = useReducer(reducer, initialState);

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
          dmStatus: data.dmStatus ?? "idle",
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

  useEffect(() => {
    let source: EventSource | null = null;
    let cancelled = false;

    refresh().then((lastSeq) => {
      if (cancelled) {
        return;
      }
      void refreshSideChat();
      void refreshWhispers();
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
          if (eventType === "side_activity") {
            void refreshSideChat();
          }
          if (eventType === "whisper_activity") {
            void refreshWhispers();
          }
          // encounter_updated too: the map exists the moment
          // start_encounter lands, before any battle_map_updated ping.
          if (eventType === "battle_map_updated" || eventType === "encounter_updated") {
            void refreshBattleMap();
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
  }, [campaignId, refresh, refreshNotes, refreshSideChat, refreshWhispers, refreshBattleMap]);

  return { state, refresh, refreshNotes, refreshSideChat, refreshWhispers, refreshBattleMap };
}
