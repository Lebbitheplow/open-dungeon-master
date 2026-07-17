"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/cn";
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
          <p key={index} className="whitespace-pre-wrap font-serif leading-relaxed text-stone-200">
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
}: {
  messages: CampaignMessage[];
  rolls: StoredRoll[];
  sheets: CharacterSheet[];
  dmStatus: DmStatus;
  dmDraft: string;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const rollsById = new Map(rolls.map((roll) => [roll.id, roll]));
  const sheetsById = new Map(sheets.map((sheet) => [sheet.id, sheet]));

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, dmDraft, dmStatus]);

  return (
    <div className="flex-1 space-y-4 overflow-y-auto px-4 py-6">
      {messages.map((message) => {
        if (message.authorType === "system") {
          return (
            <p key={message.id} className="text-center text-sm italic text-stone-500">
              {message.content}
            </p>
          );
        }
        if (message.authorType === "dm") {
          return (
            <div key={message.id} className="rounded-lg border border-stone-800 bg-stone-950/40 p-4">
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-amber-600">
                Dungeon Master
              </p>
              <DmContent content={message.content} rollsById={rollsById} sheetsById={sheetsById} />
              {message.generatedImage ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={message.generatedImage.url}
                  alt={message.imageRequest?.prompt || "Scene"}
                  className="mt-3 max-h-96 rounded-lg border border-stone-800"
                />
              ) : null}
            </div>
          );
        }
        const sheet = message.characterId ? sheetsById.get(message.characterId) : undefined;
        return (
          <div key={message.id} className="px-1">
            <p className="mb-0.5 text-xs font-medium text-sky-500">
              {sheet?.name ?? "Player"}
            </p>
            <p
              className={cn(
                "whitespace-pre-wrap text-stone-300",
                message.content.startsWith("(ooc)") && "italic text-stone-500",
              )}
            >
              {message.content}
            </p>
          </div>
        );
      })}

      {dmDraft ? (
        <div className="rounded-lg border border-stone-800 bg-stone-950/40 p-4">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-amber-600">
            Dungeon Master
          </p>
          <p className="whitespace-pre-wrap font-serif leading-relaxed text-stone-200">{dmDraft}</p>
        </div>
      ) : dmStatus !== "idle" ? (
        <p className="animate-pulse text-sm italic text-stone-500">
          {dmStatus === "rolling" ? "The DM rolls the dice..." : "The DM is thinking..."}
        </p>
      ) : null}

      <div ref={bottomRef} />
    </div>
  );
}
