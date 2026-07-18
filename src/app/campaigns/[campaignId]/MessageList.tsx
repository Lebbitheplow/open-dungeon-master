"use client";

import { Crown, Volume2 } from "lucide-react";
import { useEffect, useRef } from "react";
import { cn } from "@/lib/cn";
import { LEAD_NOTE_PREFIX } from "@/lib/campaign-types";
import type { CampaignMessage } from "@/lib/db/messages";
import type { StoredRoll } from "@/lib/db/rolls";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { RollCard } from "@/app/campaigns/[campaignId]/RollCard";
import type { DmStatus } from "@/app/campaigns/[campaignId]/useCampaignStream";

const ROLL_MARKER = /\[roll:([0-9a-f-]{36})\]/g;

function DmContent({ content, rollsById, sheetsById }: {
  content: string;
  rollsById: Map<string, StoredRoll>;
  sheetsById: Map<string, CharacterSheet>;
}) {
  const parts: Array<{ kind: "text"; text: string } | { kind: "roll"; roll: StoredRoll }> = [];
  let lastIndex = 0;
  for (const match of content.matchAll(ROLL_MARKER)) {
    if (match.index! > lastIndex) {
      parts.push({ kind: "text", text: content.slice(lastIndex, match.index) });
    }
    const roll = rollsById.get(match[1]);
    if (roll) {
      parts.push({ kind: "roll", roll });
    }
    lastIndex = match.index! + match[0].length;
  }
  if (lastIndex < content.length) {
    parts.push({ kind: "text", text: content.slice(lastIndex) });
  }

  return (
    <div className="space-y-2">
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
  dmStatus,
  dmDraft,
  onReplayAudio,
}: {
  messages: CampaignMessage[];
  rolls: StoredRoll[];
  sheets: CharacterSheet[];
  dmStatus: DmStatus;
  dmDraft: string;
  onReplayAudio?: (messageId: string) => void;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const rollsById = new Map(rolls.map((roll) => [roll.id, roll]));
  const sheetsById = new Map(sheets.map((sheet) => [sheet.id, sheet]));

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, dmDraft, dmStatus]);

  return (
    <div className="flex-1 space-y-7 overflow-y-auto px-4 py-6">
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
            <div key={message.id} className="group">
              <p className="mb-1.5 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-amber-200/70">
                Dungeon Master
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
              ) : null}
            </div>
          );
        }
        const sheet = message.characterId ? sheetsById.get(message.characterId) : undefined;
        return (
          <div key={message.id} className="ml-auto max-w-[92%] sm:max-w-2xl">
            <p className="mb-0.5 flex items-center justify-end gap-1.5 text-right text-xs font-medium text-amber-200/60">
              {sheet?.portrait ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={sheet.portrait.url}
                  alt=""
                  className="size-5 rounded-full border border-stone-700 object-cover"
                />
              ) : null}
              {sheet?.name ?? "Player"}
            </p>
            <div
              className={cn(
                "rounded-2xl rounded-br-md border border-stone-800/70 bg-stone-900/60 px-4 py-3 text-sm leading-6 text-stone-300",
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
          <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-amber-200/70">
            Dungeon Master
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
              : "The next passage is forming…"}
        </p>
      ) : null}

      <div ref={bottomRef} />
    </div>
  );
}
