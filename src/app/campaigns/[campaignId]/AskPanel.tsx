"use client";

import { Loader2, MessageCircleQuestion, Users } from "lucide-react";
import { memo } from "react";
import { cn } from "@/lib/cn";
import type { CampaignAsk } from "@/lib/db/asks";

// The Ask thread: out-of-character questions to the DM and their grounded
// answers. Framed hard as an aside, because the one thing a player must
// never wonder is whether asking moved the story.

const SCOPE_LABELS: Record<string, string> = {
  story: "Story",
  rules: "Rules",
  sheet: "Sheet",
};

function AskEntry({ ask, meUserId }: { ask: CampaignAsk; meUserId: string }) {
  const mine = ask.userId === meUserId;
  return (
    <li className="rounded-lg border border-stone-800 bg-stone-950/40 p-2.5">
      <div className="mb-1.5 flex flex-wrap items-center gap-1.5 text-[10px] uppercase tracking-wide text-stone-500">
        <span className="rounded bg-stone-800 px-1 text-stone-400">
          {SCOPE_LABELS[ask.scope] ?? ask.scope}
        </span>
        {ask.visibility === "table" ? (
          <span className="inline-flex items-center gap-1 text-stone-500">
            <Users className="size-3" /> {mine ? "Shared with the table" : "Asked by the table"}
          </span>
        ) : (
          <span className="text-stone-600">Only you</span>
        )}
      </div>
      <p className="mb-1.5 text-xs font-medium leading-5 text-stone-200">{ask.question}</p>
      {ask.status === "failed" ? (
        <p className="text-xs italic text-red-400">The DM could not answer this one.</p>
      ) : (
        <p className="whitespace-pre-wrap font-serif text-xs leading-5 text-stone-300">
          {ask.answer}
        </p>
      )}
      {ask.citations.length ? (
        <div className="mt-2 space-y-1">
          <p className="text-[10px] font-medium uppercase tracking-wide text-stone-600">
            From the record
          </p>
          {ask.citations.map((citation, index) => (
            <p
              key={index}
              className="rounded border border-stone-800/80 bg-stone-950/60 p-1.5 text-[11px] leading-4 text-stone-500"
            >
              <span className="mr-1 rounded bg-stone-800 px-1 text-[9px] uppercase text-stone-500">
                {citation.kind}
                {citation.ref ? ` ${citation.ref}` : ""}
              </span>
              {citation.quote}
            </p>
          ))}
        </div>
      ) : null}
    </li>
  );
}

function AskPanelInner({
  asks,
  meUserId,
  loaded,
  pendingQuestion,
}: {
  asks: CampaignAsk[];
  meUserId: string;
  loaded: boolean;
  // The question currently in flight, echoed so a slow local model does not
  // look like nothing happened.
  pendingQuestion: string;
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-stone-800 px-3 py-2">
        <p className="flex items-center gap-1.5 text-xs font-medium text-stone-300">
          <MessageCircleQuestion className="size-3.5 text-amber-300" /> Ask the DM
        </p>
        <p className="mt-1 text-[11px] leading-4 text-stone-500">
          Questions about the story, the world, the rules, or your sheet. Answers come from
          what the campaign has on record and never move the story forward.
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {!loaded ? (
          <p className="flex items-center gap-2 text-xs text-stone-500">
            <Loader2 className="size-3.5 animate-spin" /> Loading...
          </p>
        ) : !asks.length && !pendingQuestion ? (
          <p className="text-xs leading-5 text-stone-600">
            Nothing asked yet. Pick <span className="text-stone-400">Ask</span> in the composer
            and put a question to the DM.
          </p>
        ) : (
          <ul className="space-y-2">
            {asks.map((ask) => (
              <AskEntry key={ask.id} ask={ask} meUserId={meUserId} />
            ))}
            {pendingQuestion ? (
              <li className="rounded-lg border border-stone-800 bg-stone-950/40 p-2.5 opacity-70">
                <p className="mb-1.5 text-xs font-medium leading-5 text-stone-200">
                  {pendingQuestion}
                </p>
                <p className="flex items-center gap-2 text-xs text-stone-500">
                  <Loader2 className="size-3.5 animate-spin" />
                  Checking the record (queued behind the DM)...
                </p>
              </li>
            ) : null}
          </ul>
        )}
      </div>
    </div>
  );
}

// Memoized for the same reason as SidePanel: its props do not change while
// the DM streams narration into the message list.
export const AskPanel = memo(AskPanelInner);

export const askPanelClass = cn("h-full");
