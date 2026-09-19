"use client";

import { ImageOff, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { stripToolText } from "@/lib/dm/tool-text";
import { attributeSpeech, type Speaker } from "@/lib/dm/speech";
import type { CastMember } from "@/lib/dm/cast";
import { SpeechLine } from "@/app/campaigns/[campaignId]/SpeechLine";
import { Prose } from "@/app/campaigns/[campaignId]/Prose";
import { RollCard } from "@/app/campaigns/[campaignId]/RollCard";
import type { StoredRoll } from "@/lib/db/rolls";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import type { MediaStatus } from "@/app/campaigns/[campaignId]/useCampaignStream";

// What a DM passage is made of: the prose (with its inline roll cards and
// speech lines) and the placeholder shown while a picture is on the render
// queue. Lifted out of MessageList.tsx to keep that file about the list.

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

export function DmContent({ content, rollsById, sheetsById, cast = [], speaker }: {
  content: string;
  rollsById: Map<string, StoredRoll>;
  sheetsById: Map<string, CharacterSheet>;
  // The cast, so a quoted line near a known name gets that face
  // (docs/vtt-parity-implementation-plan.md 8.1).
  cast?: CastMember[];
  // The whole passage spoken as one person.
  speaker?: Speaker;
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

  const speakers: Speaker[] = cast.map((member) => ({ kind: "npc", id: member.id, name: member.name }));
  if (speaker) {
    return (
      <div className="narration space-y-2">
        {parts.map((part, index) =>
          part.kind === "text" ? (
            <SpeechLine key={index} speaker={speaker} cast={cast}>
              <Prose text={part.text.trim()} />
            </SpeechLine>
          ) : (
            <RollCard key={index} roll={part.roll} characterName={part.roll.characterId ? sheetsById.get(part.roll.characterId)?.name : undefined} />
          ),
        )}
      </div>
    );
  }
  return (
    <div className="narration space-y-2">
      {parts.map((part, index) =>
        part.kind === "text" ? (
          <div key={index} className="space-y-2">
            {attributeSpeech(part.text.trim(), speakers).map((segment, at) =>
              segment.kind === "speech" ? (
                <SpeechLine key={at} speaker={segment.speaker} cast={cast}>
                  <Prose text={segment.text} />
                </SpeechLine>
              ) : (
                <p key={at} className="whitespace-pre-wrap text-pretty font-serif text-base leading-relaxed text-stone-100">
                  <Prose text={segment.text.trim()} />
                </p>
              ),
            )}
          </div>
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
