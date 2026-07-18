"use client";

import { useCallback, useEffect, useReducer } from "react";
import type { CampaignMember, SessionUser } from "@/lib/campaign-types";
import type { Campaign } from "@/lib/db/campaigns";
import type { CampaignMessage } from "@/lib/db/messages";
import type { StoredRoll } from "@/lib/db/rolls";
import type { CharacterSheet } from "@/lib/schemas/sheet";

export type DmStatus = "idle" | "thinking" | "rolling" | "narrating" | "awaiting_rolls";

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
  kind: string;
  delta: Record<string, unknown>;
  reason: string;
  seq: number;
  createdAt: string;
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
  narrationAudio: Record<string, string>;
  latestTts: { messageId: string; url: string; seq: number } | null;
  lastSeq: number;
  dmStatus: DmStatus;
  dmDraft: string;
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
  narrationAudio: {},
  latestTts: null,
  lastSeq: 0,
  dmStatus: "idle",
  dmDraft: "",
};

type Action =
  | { type: "snapshot"; payload: Partial<CampaignState> & { lastSeq: number } }
  | { type: "error"; error: string }
  | { type: "event"; eventType: string; seq: number | null; payload: Record<string, unknown> };

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
          next.messages = upsertBy(state.messages, message, (entry) => entry.id);
          if (message.authorType === "dm") {
            next.dmDraft = "";
            next.dmStatus = "idle";
          }
          return next;
        }
        case "roll_result":
          next.rolls = [...state.rolls.slice(-30), payload.roll as StoredRoll];
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
          }
          return next;
        }
        case "location_map_ready":
          next.locations = state.locations.map((location) =>
            location.id === payload.locationId
              ? { ...location, mapImage: payload.image as CampaignLocation["mapImage"] }
              : location,
          );
          return next;
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
          next.sheets = upsertBy(state.sheets, sheet, (entry) => entry.id);
          // A completed level-up clears its notice.
          next.levelUps = state.levelUps.filter(
            (notice) => !(notice.characterId === sheet.id && sheet.level >= notice.level),
          );
          return next;
        }
        case "campaign_updated":
          next.campaign = state.campaign
            ? { ...state.campaign, ...(payload as Partial<Campaign>) }
            : state.campaign;
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
  "sheet_audit",
  "level_up_available",
  "campaign_updated",
  "floor_changed",
  "image_ready",
  "location_updated",
  "location_map_ready",
  "tts_ready",
];
const EPHEMERAL_EVENTS = ["dm_status", "dm_delta"];

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
          lastSeq,
        },
      });
      return lastSeq;
    } catch {
      dispatch({ type: "error", error: "Could not reach the server." });
      return 0;
    }
  }, [campaignId]);

  useEffect(() => {
    let source: EventSource | null = null;
    let cancelled = false;

    refresh().then((lastSeq) => {
      if (cancelled) {
        return;
      }
      source = new EventSource(`/api/campaigns/${campaignId}/events?lastSeq=${lastSeq}`);
      const handle = (eventType: string) => (event: MessageEvent) => {
        try {
          const payload = JSON.parse(event.data);
          const seq = event.lastEventId ? Number(event.lastEventId) : null;
          dispatch({ type: "event", eventType, seq, payload });
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
  }, [campaignId, refresh]);

  return { state, refresh };
}
