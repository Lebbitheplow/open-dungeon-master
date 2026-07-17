"use client";

import { useCallback, useEffect, useReducer, useRef } from "react";
import type { CampaignMember, SessionUser } from "@/lib/campaign-types";
import type { Campaign } from "@/lib/db/campaigns";
import type { CampaignMessage } from "@/lib/db/messages";
import type { StoredRoll } from "@/lib/db/rolls";
import type { CharacterSheet } from "@/lib/schemas/sheet";

export type DmStatus = "idle" | "thinking" | "rolling" | "narrating";

export type CampaignState = {
  loading: boolean;
  error: string;
  campaign: Campaign | null;
  me: SessionUser | null;
  members: CampaignMember[];
  sheets: CharacterSheet[];
  messages: CampaignMessage[];
  rolls: StoredRoll[];
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
          return next;
        case "member_joined": {
          const member: CampaignMember = {
            userId: String(payload.userId),
            username: String(payload.username),
            role: "player",
            ready: false,
            joinedAt: new Date().toISOString(),
          };
          next.members = upsertBy(state.members, member, (entry) => entry.userId);
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
          return next;
        }
        case "campaign_updated":
          next.campaign = state.campaign
            ? { ...state.campaign, ...(payload as Partial<Campaign>) }
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
  "member_joined",
  "member_ready",
  "sheet_updated",
  "campaign_updated",
  "image_ready",
];
const EPHEMERAL_EVENTS = ["dm_status", "dm_delta"];

export function useCampaignStream(campaignId: string) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const lastSeqRef = useRef(0);
  lastSeqRef.current = state.lastSeq;

  const refresh = useCallback(async () => {
    try {
      const response = await fetch(`/api/campaigns/${campaignId}`);
      if (response.status === 401) {
        window.location.href = "/";
        return;
      }
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        dispatch({ type: "error", error: data.error || "Could not load the campaign." });
        return;
      }
      const data = await response.json();
      dispatch({
        type: "snapshot",
        payload: {
          campaign: data.campaign,
          me: data.me,
          members: data.members,
          sheets: data.sheets,
          messages: data.messages,
          rolls: data.rolls,
          lastSeq: data.latestSeq ?? 0,
        },
      });
    } catch {
      dispatch({ type: "error", error: "Could not reach the server." });
    }
  }, [campaignId]);

  useEffect(() => {
    let source: EventSource | null = null;
    let cancelled = false;

    refresh().then(() => {
      if (cancelled) {
        return;
      }
      source = new EventSource(
        `/api/campaigns/${campaignId}/events?lastSeq=${lastSeqRef.current}`,
      );
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
