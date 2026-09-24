"use client";

import { memo, useCallback, useEffect, useMemo, useRef } from "react";
import { SectionHead } from "@/components/ui/SectionHead";
import { D20Spinner } from "@/components/ui/D20Spinner";
import type { CampaignMember } from "@/lib/campaign-types";
import type { CastMember } from "@/lib/dm/cast";
import type { CampaignMessage } from "@/lib/db/messages";
import type { StoredRoll } from "@/lib/db/rolls";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { MessageItem } from "@/app/campaigns/[campaignId]/MessageItem";
import { Prose } from "@/app/campaigns/[campaignId]/Prose";
import { DM_STATUS_PHRASES } from "@/app/campaigns/[campaignId]/dmStatusPhrases";
import { useDmDraft } from "@/app/campaigns/[campaignId]/liveStore";
import type {
  CampaignLocation,
  DmStatus,
  MediaStatus,
} from "@/app/campaigns/[campaignId]/useCampaignStream";

// FNV-1a plus a murmur-style finalizer. The avalanche matters: a weaker mix
// leaves the six-entry pools reachable only at half their entries.
function hashString(value: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 2246822507);
  h ^= h >>> 13;
  h = Math.imul(h, 3266489909);
  h ^= h >>> 16;
  return h >>> 0;
}

// Flavor line shown while the DM works. Picked deterministically from the
// latest message id rather than with Math.random, so it stays put through the
// animate-pulse re-renders and survives hydration, while still varying from
// one turn to the next. Keyed on the id (not the message count, which the
// 200-message cap pins in long sessions) and salted with the status, so the
// beats within a single turn read differently too.
function dmStatusPhrase(status: DmStatus, turnKey: string): string {
  if (status === "idle") {
    return "";
  }
  const pool = DM_STATUS_PHRASES[status];
  return pool[hashString(turnKey + status) % pool.length];
}

// The DM's passage as it streams in, or the flavour line while the DM
// works. The only part of the transcript that subscribes to the draft
// store, so a narration flush repaints this and nothing above it. The
// follow-scroll used to key on the draft from MessageList; it moved here
// with the draft, through the parent's follow() so the two share one
// coalesced scroll.
const DmDraftBubble = memo(function DmDraftBubble({
  dmStatus,
  statusPhrase,
  follow,
}: {
  dmStatus: DmStatus;
  statusPhrase: string;
  follow: (behavior: ScrollBehavior) => void;
}) {
  const dmDraft = useDmDraft();
  useEffect(() => {
    follow(dmDraft ? "auto" : "smooth");
  }, [dmDraft, dmStatus, follow]);

  if (dmDraft) {
    return (
      <div className="session-dm animate-fade-up">
        <SectionHead title="Dungeon Master" glyph="tab-dm" level="h4" />
        <p className="session-dm-body whitespace-pre-wrap text-pretty font-serif text-base leading-relaxed text-stone-100">
          <Prose text={dmDraft} />
          <span className="stream-caret" aria-hidden="true" />
        </p>
      </div>
    );
  }
  if (dmStatus !== "idle") {
    return (
      <p className="live-in flex items-center gap-2.5 font-serif text-base italic text-stone-400">
        <D20Spinner className="size-6 shrink-0 text-amber-500" />
        <span className="breathe">{statusPhrase}</span>
      </p>
    );
  }
  return null;
});

export function MessageList({
  messages,
  cast = [],
  campaignId,
  canRetryTurn = false,
  canIllustrate = false,
  rolls,
  sheets,
  members = [],
  locations = [],
  dmStatus,
  mediaStatus = {},
  onReplayAudio,
  onPinCanon,
  onPinMemory,
  onEditSave,
  onLoreCheck,
  onRenarrate,
  onContinueScene,
  onSelectVariant,
  meUserId = "",
  blockedUserIds = [],
  onReport,
}: {
  messages: CampaignMessage[];
  campaignId: string;
  meUserId?: string;
  // Players the viewer has blocked; their rows fold away.
  blockedUserIds?: string[];
  onReport?: (message: CampaignMessage) => void;
  // The party lead may send a halted DM turn back in. Plain booleans and
  // strings rather than a callback: the memoized rows stay cheap without the
  // stable-identity dance the callback props above need.
  canRetryTurn?: boolean;
  // Same shape and same reason: whoever runs the story may upload a picture
  // under any DM passage.
  canIllustrate?: boolean;
  rolls: StoredRoll[];
  sheets: CharacterSheet[];
  members?: CampaignMember[];
  locations?: CampaignLocation[];
  // Names and faces of the cast, for speech lines.
  cast?: CastMember[];
  dmStatus: DmStatus;
  mediaStatus?: Record<string, MediaStatus>;
  onReplayAudio?: (messageId: string) => Promise<string | null>;
  onPinCanon?: (message: CampaignMessage) => void;
  // Pin the current selection (or the whole message) into every future prompt.
  onPinMemory?: (message: CampaignMessage) => void;
  onEditSave?: (message: CampaignMessage, content: string) => Promise<string | null>;
  onLoreCheck?: (message: CampaignMessage) => void;
  onRenarrate?: (message: CampaignMessage) => void;
  onContinueScene?: (message: CampaignMessage) => void;
  onSelectVariant?: (message: CampaignMessage, index: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const nearBottomRef = useRef(true);
  const scrollPendingRef = useRef(false);
  const statusPhrase = dmStatusPhrase(dmStatus, messages[messages.length - 1]?.id ?? "");
  const rollsById = useMemo(() => new Map(rolls.map((roll) => [roll.id, roll])), [rolls]);
  const sheetsById = useMemo(
    () => new Map(sheets.map((sheet) => [sheet.id, sheet])),
    [sheets],
  );
  const membersById = useMemo(
    () => new Map(members.map((member) => [member.userId, member])),
    [members],
  );
  const locationsById = useMemo(
    () => new Map(locations.map((location) => [location.id, location])),
    [locations],
  );
  const blockedSet = useMemo(() => new Set(blockedUserIds), [blockedUserIds]);

  // The parent passes an inline closure; route it through a ref so the
  // memoized rows keep a stable identity and skip re-renders per token.
  const replayRef = useRef(onReplayAudio);
  useEffect(() => {
    replayRef.current = onReplayAudio;
  });
  const hasReplay = Boolean(onReplayAudio);
  const stableReplay = useMemo(
    () =>
      hasReplay
        ? (messageId: string) =>
            replayRef.current?.(messageId) ?? Promise.resolve<string | null>(null)
        : undefined,
    [hasReplay],
  );
  const pinRef = useRef(onPinCanon);
  useEffect(() => {
    pinRef.current = onPinCanon;
  });
  const hasPin = Boolean(onPinCanon);
  const stablePin = useMemo(
    () => (hasPin ? (message: CampaignMessage) => pinRef.current?.(message) : undefined),
    [hasPin],
  );
  const loreRef = useRef(onLoreCheck);
  useEffect(() => {
    loreRef.current = onLoreCheck;
  });
  const hasLore = Boolean(onLoreCheck);
  const stableLore = useMemo(
    () => (hasLore ? (message: CampaignMessage) => loreRef.current?.(message) : undefined),
    [hasLore],
  );
  const renarrateRef = useRef(onRenarrate);
  useEffect(() => {
    renarrateRef.current = onRenarrate;
  });
  const continueRef = useRef(onContinueScene);
  useEffect(() => {
    continueRef.current = onContinueScene;
  });
  const hasContinue = Boolean(onContinueScene);
  const stableContinue = useMemo(
    () =>
      hasContinue ? (message: CampaignMessage) => continueRef.current?.(message) : undefined,
    [hasContinue],
  );
  const pinMemoryRef = useRef(onPinMemory);
  useEffect(() => {
    pinMemoryRef.current = onPinMemory;
  });
  const hasPinMemory = Boolean(onPinMemory);
  const stablePinMemory = useMemo(
    () =>
      hasPinMemory ? (message: CampaignMessage) => pinMemoryRef.current?.(message) : undefined,
    [hasPinMemory],
  );
  const hasRenarrate = Boolean(onRenarrate);
  const stableRenarrate = useMemo(
    () =>
      hasRenarrate ? (message: CampaignMessage) => renarrateRef.current?.(message) : undefined,
    [hasRenarrate],
  );
  const selectVariantRef = useRef(onSelectVariant);
  useEffect(() => {
    selectVariantRef.current = onSelectVariant;
  });
  const hasSelectVariant = Boolean(onSelectVariant);
  const stableSelectVariant = useMemo(
    () =>
      hasSelectVariant
        ? (message: CampaignMessage, index: number) =>
            selectVariantRef.current?.(message, index)
        : undefined,
    [hasSelectVariant],
  );
  const reportRef = useRef(onReport);
  useEffect(() => {
    reportRef.current = onReport;
  });
  const hasReport = Boolean(onReport);
  const stableReport = useMemo(
    () => (hasReport ? (message: CampaignMessage) => reportRef.current?.(message) : undefined),
    [hasReport],
  );
  const editSaveRef = useRef(onEditSave);
  useEffect(() => {
    editSaveRef.current = onEditSave;
  });
  const hasEditSave = Boolean(onEditSave);
  const stableEditSave = useMemo(
    () =>
      hasEditSave
        ? (message: CampaignMessage, content: string) =>
            editSaveRef.current?.(message, content) ?? Promise.resolve<string | null>(null)
        : undefined,
    [hasEditSave],
  );
  // Only the newest DM message can be rerolled; the server enforces the same
  // rule, this just keeps the button off every older passage.
  const latestDmMessageId = useMemo(() => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index].authorType === "dm") {
        return messages[index].id;
      }
    }
    return "";
  }, [messages]);

  // Follow the conversation only while the reader is already at the bottom;
  // scrolling up to reread must not be yanked back. During narration
  // streaming the draft bubble calls this per token, so scrolling is
  // instant and coalesced through rAF instead of stacking smooth-scroll
  // animations (a real jank source in Firefox).
  const follow = useCallback((behavior: ScrollBehavior) => {
    if (!nearBottomRef.current || scrollPendingRef.current) {
      return;
    }
    scrollPendingRef.current = true;
    requestAnimationFrame(() => {
      scrollPendingRef.current = false;
      bottomRef.current?.scrollIntoView({ behavior });
    });
  }, []);
  useEffect(() => {
    follow("smooth");
  }, [messages.length, dmStatus, follow]);

  function handleScroll() {
    const el = containerRef.current;
    if (el) {
      nearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    }
  }

  return (
    <div ref={containerRef} onScroll={handleScroll} className="session-transcript flex-1 overflow-y-auto">
      <div className="mx-auto max-w-3xl space-y-8 px-4 py-6 sm:px-6">
      {messages.map((message) => (
        <MessageItem
          key={message.id}
          mine={Boolean(message.userId) && message.userId === meUserId}
          blocked={Boolean(message.userId && blockedSet.has(message.userId))}
          onReport={stableReport}
          message={message}
          campaignId={campaignId}
          canRetryTurn={canRetryTurn}
          canIllustrate={canIllustrate}
          rollsById={rollsById}
          sheetsById={sheetsById}
          membersById={membersById}
          locationsById={locationsById}
          cast={cast}
          sheets={sheets}
          mediaStatus={mediaStatus}
          onReplayAudio={stableReplay}
          onPinCanon={stablePin}
          onLoreCheck={stableLore}
          onPinMemory={stablePinMemory}
          onEditSave={stableEditSave}
          onRenarrate={
            // No turn link, no reroll: messages narrated before this feature
            // shipped have no stored conversation to replay.
            message.id === latestDmMessageId && message.dmTurnId
              ? stableRenarrate
              : undefined
          }
          onContinueScene={
            // Same gate as a reroll: only the newest narration, and only when
            // a stored turn conversation exists to continue from.
            message.id === latestDmMessageId && message.dmTurnId
              ? stableContinue
              : undefined
          }
          onSelectVariant={stableSelectVariant}
        />
      ))}

      <DmDraftBubble dmStatus={dmStatus} statusPhrase={statusPhrase} follow={follow} />

      <div ref={bottomRef} />
      </div>
    </div>
  );
}
