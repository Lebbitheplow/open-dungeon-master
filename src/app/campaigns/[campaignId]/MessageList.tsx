"use client";

import { Crown, ImageOff, Loader2, UserPlus, Volume2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { JOIN_NOTE_PREFIX, LEAD_NOTE_PREFIX, type CampaignMember } from "@/lib/campaign-types";
import { stripToolText } from "@/lib/dm/tool-text";
import type { CampaignMessage } from "@/lib/db/messages";
import type { StoredRoll } from "@/lib/db/rolls";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { RollCard } from "@/app/campaigns/[campaignId]/RollCard";
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

export function MessageList({
  messages,
  rolls,
  sheets,
  members = [],
  locations = [],
  dmStatus,
  dmDraft,
  mediaStatus = {},
  onReplayAudio,
}: {
  messages: CampaignMessage[];
  rolls: StoredRoll[];
  sheets: CharacterSheet[];
  members?: CampaignMember[];
  locations?: CampaignLocation[];
  dmStatus: DmStatus;
  dmDraft: string;
  mediaStatus?: Record<string, MediaStatus>;
  onReplayAudio?: (messageId: string) => void;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const rollsById = new Map(rolls.map((roll) => [roll.id, roll]));
  const sheetsById = new Map(sheets.map((sheet) => [sheet.id, sheet]));
  const membersById = new Map(members.map((member) => [member.userId, member]));
  const locationsById = new Map(locations.map((location) => [location.id, location]));

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, dmDraft, dmStatus]);

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-3xl space-y-8 px-4 py-6 sm:px-6">
      {messages.map((message) => {
        if (message.authorType === "system") {
          if (message.content.startsWith(LEAD_NOTE_PREFIX)) {
            return (
              <div
                key={message.id}
                className="mx-auto max-w-xl rounded-lg border border-amber-900/60 bg-amber-950/30 px-4 py-2.5"
              >
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
              <p
                key={message.id}
                className="mx-auto flex max-w-xl items-center justify-center gap-1.5 text-center font-serif text-sm italic text-stone-500"
              >
                <UserPlus className="size-3.5 shrink-0" />
                {message.content.slice(JOIN_NOTE_PREFIX.length)}
              </p>
            );
          }
          return (
            <p
              key={message.id}
              className="mx-auto max-w-xl text-center font-serif text-sm italic text-stone-500"
            >
              {message.content}
            </p>
          );
        }
        if (message.authorType === "dm") {
          return (
            <div key={message.id} className="group animate-fade-up">
              <p className="eyebrow mb-2 flex items-center gap-2 text-[10px] text-amber-300/80">
                <span className="h-px w-8 bg-gradient-to-r from-transparent to-amber-500/60" />
                Dungeon Master
                <span className="h-px flex-1 bg-gradient-to-r from-amber-500/40 to-transparent" />
                {onReplayAudio ? (
                  <button
                    type="button"
                    onClick={() => onReplayAudio(message.id)}
                    title="Replay narration"
                    className="text-stone-600 opacity-0 transition hover:text-amber-200 group-hover:opacity-100"
                  >
                    <Volume2 className="size-3.5" />
                  </button>
                ) : null}
              </p>
              <DmContent content={message.content} rollsById={rollsById} sheetsById={sheetsById} />
              {message.generatedImage ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
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
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={location.mapImage.url}
                        alt={`Map of ${location.name}`}
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
          <div key={message.id} className="ml-auto max-w-[92%] animate-fade-up sm:max-w-2xl">
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
      })}

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
        <p className="flex animate-pulse items-center gap-2 font-serif text-base italic text-stone-500">
          {dmStatus === "rolling"
            ? "The dice clatter across the table…"
            : dmStatus === "awaiting_rolls"
              ? "The table waits on real dice…"
              : dmStatus === "thinking"
                ? "The DM weighs the outcome…"
                : dmStatus === "writing_chapter"
                  ? "The DM writes the chapter into the record…"
                  : dmStatus === "plotting_arc"
                    ? "The DM plots the road ahead…"
                    : "The next passage is forming…"}
        </p>
      ) : null}

      <div ref={bottomRef} />
      </div>
    </div>
  );
}
