"use client";

import {
  Bookmark,
  ChevronLeft,
  FastForward,
  Pencil,
  ChevronRight,
  Crown,
  ImageOff,
  Loader2,
  Pin,
  RefreshCw,
  ShieldQuestion,
  UserPlus,
  Volume2,
} from "lucide-react";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { DM_HALTED_PREFIX, JOIN_NOTE_PREFIX, LEAD_NOTE_PREFIX, type CampaignMember } from "@/lib/campaign-types";
import { HaltedTurnBanner } from "@/app/campaigns/[campaignId]/HaltedTurnBanner";
import { InlineMessageEditor } from "@/app/campaigns/[campaignId]/InlineMessageEditor";
import { stripToolText } from "@/lib/dm/tool-text";
import { ImageLightbox } from "@/components/ui/ImageLightbox";
import type { CampaignMessage } from "@/lib/db/messages";
import type { StoredRoll } from "@/lib/db/rolls";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { D20Spinner } from "@/components/ui/D20Spinner";
import { RollCard } from "@/app/campaigns/[campaignId]/RollCard";
import { DM_STATUS_PHRASES } from "@/app/campaigns/[campaignId]/dmStatusPhrases";
import type {
  CampaignLocation,
  DmStatus,
  MediaStatus,
} from "@/app/campaigns/[campaignId]/useCampaignStream";

function formatElapsed(fromIso: string, now: number): string {
  const seconds = Math.max(0, Math.floor((now - Date.parse(fromIso)) / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

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

// Placeholder for media still on the render queue. The durable pending
// signal is the message's unanswered imageRequest, so this survives
// reloads; the ephemeral media_status refines the label.
export function MediaPlaceholder({
  label,
  status,
  fallbackStartedAt,
}: {
  label: string;
  status?: MediaStatus;
  fallbackStartedAt: string;
}) {
  const [now, setNow] = useState(() => Date.now());
  const failed = status?.state === "failed";
  useEffect(() => {
    if (failed) {
      return;
    }
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [failed]);

  if (failed) {
    return (
      <p className="mt-3 flex items-center gap-1.5 text-xs text-stone-600">
        <ImageOff className="size-3.5" /> Illustration failed; the story carries on.
      </p>
    );
  }
  return (
    <div className="mt-3 flex aspect-video max-h-56 w-full max-w-md flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-stone-800 bg-stone-950/40">
      <Loader2 className="size-5 animate-spin text-amber-700" />
      <p className="text-xs text-stone-400">
        {status?.state === "queued" ? "Waiting for the render queue..." : label}
      </p>
      <p className="font-mono text-[11px] text-stone-600">
        {formatElapsed(status?.startedAt ?? fallbackStartedAt, now)}
      </p>
    </div>
  );
}

const ROLL_MARKER = /\[roll:([0-9a-f-]{36})\]/g;

function DmContent({ content, rollsById, sheetsById }: {
  content: string;
  rollsById: Map<string, StoredRoll>;
  sheetsById: Map<string, CharacterSheet>;
}) {
  // Older messages may still carry leaked "[request_roll ...]" tool text;
  // never render it.
  const cleaned = stripToolText(content);
  const parts: Array<{ kind: "text"; text: string } | { kind: "roll"; roll: StoredRoll }> = [];
  let lastIndex = 0;
  for (const match of cleaned.matchAll(ROLL_MARKER)) {
    if (match.index! > lastIndex) {
      parts.push({ kind: "text", text: cleaned.slice(lastIndex, match.index) });
    }
    const roll = rollsById.get(match[1]);
    if (roll) {
      parts.push({ kind: "roll", roll });
    }
    lastIndex = match.index! + match[0].length;
  }
  if (lastIndex < cleaned.length) {
    parts.push({ kind: "text", text: cleaned.slice(lastIndex) });
  }

  return (
    <div className="narration space-y-2">
      {parts.map((part, index) =>
        part.kind === "text" ? (
          <p
            key={index}
            className="whitespace-pre-wrap text-pretty font-serif text-base leading-relaxed text-stone-100"
          >
            {part.text.trim()}
          </p>
        ) : (
          <RollCard
            key={index}
            roll={part.roll}
            characterName={
              part.roll.characterId
                ? sheetsById.get(part.roll.characterId)?.name
                : undefined
            }
          />
        ),
      )}
    </div>
  );
}

// One chat entry. Memoized so the per-token dm_delta re-renders of the list
// (dmDraft grows on every streamed token) skip the whole back-catalog; only
// props that actually changed re-render their row.
const MessageItem = memo(function MessageItem({
  message,
  campaignId,
  canRetryTurn,
  rollsById,
  sheetsById,
  membersById,
  locationsById,
  sheets,
  mediaStatus,
  onReplayAudio,
  onPinCanon,
  onPinMemory,
  onEditSave,
  onLoreCheck,
  onRenarrate,
  onContinueScene,
  onSelectVariant,
}: {
  message: CampaignMessage;
  campaignId: string;
  canRetryTurn: boolean;
  rollsById: Map<string, StoredRoll>;
  sheetsById: Map<string, CharacterSheet>;
  membersById: Map<string, CampaignMember>;
  locationsById: Map<string, CampaignLocation>;
  sheets: CharacterSheet[];
  mediaStatus: Record<string, MediaStatus>;
  onReplayAudio?: (messageId: string) => void;
  onPinCanon?: (message: CampaignMessage) => void;
  // Pin the current selection (or the whole message) into every future prompt.
  onPinMemory?: (message: CampaignMessage) => void;
  // Lead-only correction of this narration's text. Resolves to an error
  // string when the server refuses (a dropped roll marker), or null on save.
  onEditSave?: (message: CampaignMessage, content: string) => Promise<string | null>;
  onLoreCheck?: (message: CampaignMessage) => void;
  // Reroll this narration's prose (lead only, latest DM message only).
  onRenarrate?: (message: CampaignMessage) => void;
  onContinueScene?: (message: CampaignMessage) => void;
  // Browse the rerolled takes; the picked one is what the table reads.
  onSelectVariant?: (message: CampaignMessage, index: number) => void;
}) {
  // Local to the row: only one narration is ever being corrected at a time,
  // and the draft should not survive the row unmounting.
  const [editing, setEditing] = useState(false);

  if (message.authorType === "system") {
    // A halted turn whose dm_turns row is still retryable. Both halves of the
    // test matter: the link is cleared once a retry is claimed, and the
    // prefix keeps any other turn-linked message out of this branch.
    if (message.dmTurnId && message.content.startsWith(DM_HALTED_PREFIX)) {
      return (
        <HaltedTurnBanner
          campaignId={campaignId}
          turnId={message.dmTurnId}
          content={message.content}
          canRetry={canRetryTurn}
        />
      );
    }
    if (message.content.startsWith(LEAD_NOTE_PREFIX)) {
      return (
        <div className="mx-auto max-w-xl rounded-lg border border-amber-900/60 bg-amber-950/30 px-4 py-2.5">
          <p className="mb-0.5 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-amber-300">
            <Crown className="size-3.5" /> Party Lead
          </p>
          <p className="text-sm text-amber-100/90">
            {message.content.slice(LEAD_NOTE_PREFIX.length)}
          </p>
        </div>
      );
    }
    if (message.content.startsWith(JOIN_NOTE_PREFIX)) {
      return (
        <p className="mx-auto flex max-w-xl items-center justify-center gap-1.5 text-center font-serif text-sm italic text-stone-500">
          <UserPlus className="size-3.5 shrink-0" />
          {message.content.slice(JOIN_NOTE_PREFIX.length)}
        </p>
      );
    }
    return (
      <p className="mx-auto max-w-xl text-center font-serif text-sm italic text-stone-500">
        {message.content}
      </p>
    );
  }
  if (message.authorType === "dm") {
    return (
      <div className="group animate-fade-up">
        <p className="eyebrow mb-2 flex items-center gap-2 text-[10px] text-amber-300/80">
          <span className="h-px w-8 bg-gradient-to-r from-transparent to-amber-500/60" />
          Dungeon Master
          <span className="h-px flex-1 bg-gradient-to-r from-amber-500/40 to-transparent" />
          {(() => {
            // Reroll takes: the counter only appears once a second one exists.
            const variants = message.variants ?? [];
            const index = message.variantIndex ?? 0;
            if (variants.length < 2 || !onSelectVariant) {
              return null;
            }
            return (
              <span className="flex items-center gap-0.5 font-mono text-[10px] normal-case tracking-normal text-stone-500">
                <button
                  type="button"
                  onClick={() => onSelectVariant(message, index - 1)}
                  disabled={index <= 0}
                  aria-label="Previous take"
                  className={cn(ui.iconAction, "-my-1.5 p-1 disabled:opacity-30")}
                >
                  <ChevronLeft className="size-3.5" />
                </button>
                {index + 1} / {variants.length}
                <button
                  type="button"
                  onClick={() => onSelectVariant(message, index + 1)}
                  disabled={index >= variants.length - 1}
                  aria-label="Next take"
                  className={cn(ui.iconAction, "-my-1.5 p-1 disabled:opacity-30")}
                >
                  <ChevronRight className="size-3.5" />
                </button>
              </span>
            );
          })()}
          {onRenarrate ? (
            <button
              type="button"
              onClick={() => onRenarrate(message)}
              aria-label="Reroll this narration"
              title="Reroll: have the DM write this moment again, with the same dice and outcome"
              className={cn(ui.iconAction, "-my-1.5")}
            >
              <RefreshCw className="size-3.5" />
            </button>
          ) : null}
          {onContinueScene ? (
            <button
              type="button"
              onClick={() => onContinueScene(message)}
              aria-label="Continue this scene"
              title="Continue: have the DM keep writing from where this stopped, without moving the story on"
              className={cn(ui.iconAction, "-my-1.5")}
            >
              <FastForward className="size-3.5" />
            </button>
          ) : null}
          {onEditSave ? (
            <button
              type="button"
              onClick={() => setEditing(true)}
              aria-label="Edit this narration"
              title="Edit: fix what the DM said. Mechanics are untouched, and every dice marker must survive"
              className={cn(ui.iconAction, "-my-1.5")}
            >
              <Pencil className="size-3.5" />
            </button>
          ) : null}
          {onPinMemory ? (
            <button
              type="button"
              onClick={() => onPinMemory(message)}
              aria-label="Pin this to the DM's memory"
              title="Remember: keep your selected text (or this whole message) in front of the DM every turn"
              className={cn(ui.iconAction, "-my-1.5")}
            >
              <Bookmark className="size-3.5" />
            </button>
          ) : null}
          {onLoreCheck ? (
            <button
              type="button"
              onClick={() => onLoreCheck(message)}
              aria-label="Lore check this passage"
              title="Lore check: flag this passage (or your selected text) against the campaign record"
              className={cn(ui.iconAction, "-my-1.5")}
            >
              <ShieldQuestion className="size-3.5" />
            </button>
          ) : null}
          {onPinCanon ? (
            <button
              type="button"
              onClick={() => onPinCanon(message)}
              aria-label="Pin this passage as canon"
              title="Pin as canon: keep this passage (or your selected text) in front of the DM permanently"
              className={cn(ui.iconAction, "-my-1.5")}
            >
              <Pin className="size-3.5" />
            </button>
          ) : null}
          {onReplayAudio ? (
            <button
              type="button"
              onClick={() => onReplayAudio(message.id)}
              aria-label="Replay narration"
              title="Replay narration"
              className={cn(ui.iconAction, "-my-1.5")}
            >
              <Volume2 className="size-3.5" />
            </button>
          ) : null}
        </p>
        {editing && onEditSave ? (
          <InlineMessageEditor
            initial={message.content}
            onCancel={() => setEditing(false)}
            onSave={async (content) => {
              const failure = await onEditSave(message, content);
              if (!failure) {
                setEditing(false);
              }
              return failure;
            }}
          />
        ) : (
          <DmContent content={message.content} rollsById={rollsById} sheetsById={sheetsById} />
        )}
        {message.generatedImage ? (
          <ImageLightbox
            src={message.generatedImage.url}
            alt={message.imageRequest?.prompt || "Scene"}
            className="mt-3 max-h-96 rounded-xl border border-stone-800"
          />
        ) : message.imageRequest?.needed ? (
          <MediaPlaceholder
            label="Illustrating the scene..."
            status={mediaStatus[message.id]}
            fallbackStartedAt={message.createdAt}
          />
        ) : null}
        {(() => {
          // The message that introduced an area shows its map inline.
          // The map lives on the location row, so lead redraws and
          // layout revisions refresh here automatically.
          const location = message.locationId
            ? locationsById.get(message.locationId)
            : undefined;
          if (!location) {
            return null;
          }
          if (location.mapImage) {
            return (
              <figure className="mt-3 max-w-md">
                <ImageLightbox
                  src={location.mapImage.url}
                  alt={`Map of ${location.name}`}
                  caption={location.name}
                  className="max-h-96 rounded-xl border border-stone-800"
                />
                <figcaption className="mt-1 text-xs text-stone-500">
                  {location.name}
                </figcaption>
              </figure>
            );
          }
          return (
            <MediaPlaceholder
              label="Charting the area..."
              status={mediaStatus[location.id]}
              fallbackStartedAt={message.createdAt}
            />
          );
        })()}
      </div>
    );
  }
  // Older messages predate characterId, so fall back to the author's
  // sheet in this campaign before giving up on a character identity.
  const sheet =
    (message.characterId ? sheetsById.get(message.characterId) : undefined) ??
    (message.userId
      ? sheets.find((candidate) => candidate.userId === message.userId)
      : undefined);
  // Character portrait first; the player's own avatar as a fallback.
  const portraitUrl =
    sheet?.portrait?.url ??
    (message.userId ? membersById.get(message.userId)?.avatar?.url : undefined);
  return (
    <div className="ml-auto max-w-[92%] animate-fade-up sm:max-w-2xl">
      <p className="mb-1 flex items-center justify-end gap-1.5 text-right text-xs font-medium text-amber-200/80">
        {portraitUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={portraitUrl}
            alt=""
            className="size-6 rounded-full border border-amber-500/30 object-cover"
          />
        ) : null}
        {sheet?.name ?? "Player"}
      </p>
      <div
        className={cn(
          "rounded-2xl rounded-br-md border border-stone-700/50 bg-stone-900/70 px-4 py-3 text-sm leading-6 text-stone-200 shadow-elev-1",
          message.content.startsWith("(ooc)") && "italic text-stone-500",
        )}
      >
        <p className="whitespace-pre-wrap text-pretty">{message.content}</p>
      </div>
    </div>
  );
});

export function MessageList({
  messages,
  campaignId,
  canRetryTurn = false,
  rolls,
  sheets,
  members = [],
  locations = [],
  dmStatus,
  dmDraft,
  mediaStatus = {},
  onReplayAudio,
  onPinCanon,
  onPinMemory,
  onEditSave,
  onLoreCheck,
  onRenarrate,
  onContinueScene,
  onSelectVariant,
}: {
  messages: CampaignMessage[];
  campaignId: string;
  // The party lead may send a halted DM turn back in. Plain booleans and
  // strings rather than a callback: the memoized rows stay cheap without the
  // stable-identity dance the callback props above need.
  canRetryTurn?: boolean;
  rolls: StoredRoll[];
  sheets: CharacterSheet[];
  members?: CampaignMember[];
  locations?: CampaignLocation[];
  dmStatus: DmStatus;
  dmDraft: string;
  mediaStatus?: Record<string, MediaStatus>;
  onReplayAudio?: (messageId: string) => void;
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

  // The parent passes an inline closure; route it through a ref so the
  // memoized rows keep a stable identity and skip re-renders per token.
  const replayRef = useRef(onReplayAudio);
  useEffect(() => {
    replayRef.current = onReplayAudio;
  });
  const hasReplay = Boolean(onReplayAudio);
  const stableReplay = useMemo(
    () => (hasReplay ? (messageId: string) => replayRef.current?.(messageId) : undefined),
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
  // streaming this effect fires per token, so scrolling is instant and
  // coalesced through rAF instead of stacking smooth-scroll animations
  // (a real jank source in Firefox).
  useEffect(() => {
    if (!nearBottomRef.current || scrollPendingRef.current) {
      return;
    }
    scrollPendingRef.current = true;
    const behavior: ScrollBehavior = dmDraft ? "auto" : "smooth";
    requestAnimationFrame(() => {
      scrollPendingRef.current = false;
      bottomRef.current?.scrollIntoView({ behavior });
    });
  }, [messages.length, dmDraft, dmStatus]);

  function handleScroll() {
    const el = containerRef.current;
    if (el) {
      nearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    }
  }

  return (
    <div ref={containerRef} onScroll={handleScroll} className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-3xl space-y-8 px-4 py-6 sm:px-6">
      {messages.map((message) => (
        <MessageItem
          key={message.id}
          message={message}
          campaignId={campaignId}
          canRetryTurn={canRetryTurn}
          rollsById={rollsById}
          sheetsById={sheetsById}
          membersById={membersById}
          locationsById={locationsById}
          sheets={sheets}
          mediaStatus={mediaStatus}
          onReplayAudio={stableReplay}
          onPinCanon={stablePin}
          onLoreCheck={stableLore}
          onPinMemory={stablePinMemory}
          onEditSave={onEditSave}
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

      {dmDraft ? (
        <div>
          <p className="eyebrow mb-2 flex items-center gap-2 text-[10px] text-amber-300/80">
            <span className="h-px w-8 bg-gradient-to-r from-transparent to-amber-500/60" />
            Dungeon Master
            <span className="h-px flex-1 bg-gradient-to-r from-amber-500/40 to-transparent" />
          </p>
          <p className="whitespace-pre-wrap text-pretty font-serif text-base leading-relaxed text-stone-100">
            {dmDraft}
          </p>
        </div>
      ) : dmStatus !== "idle" ? (
        <p className="flex items-center gap-2 font-serif text-base italic text-stone-500">
          <D20Spinner className="size-5 shrink-0 text-amber-600" />
          <span className="animate-pulse">{statusPhrase}</span>
        </p>
      ) : null}

      <div ref={bottomRef} />
      </div>
    </div>
  );
}
