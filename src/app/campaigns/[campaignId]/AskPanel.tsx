"use client";

import { ChevronDown, Loader2, MessageCircleQuestion, Send, Users } from "lucide-react";
import { memo, useCallback, useState } from "react";
import type { FormEvent } from "react";
import { cn } from "@/lib/cn";
import { Tooltip } from "@/components/ui/Tooltip";
import type { CampaignAsk } from "@/lib/db/asks";
import type { AskScope, AskVisibility } from "@/lib/dm/ask-logic";
import { ui } from "@/lib/ui";

// The Ask thread: out-of-character questions to the DM and their grounded
// answers. Framed hard as an aside, because the one thing a player must
// never wonder is whether asking moved the story.
//
// This strip is the ONLY Ask surface in the app. It owns the whole feature,
// question box included. Ask used to be a composer mode as well, which meant
// the table was offered the same thing twice, inches apart in the same
// column; the composer no longer knows Ask exists and "ask" is no longer an
// InputKind (src/lib/campaign-types.ts). Anything that adds a second entry
// point is a regression.
//
// It is still an aside and never a transcript entry: an ask writes no
// campaign_messages row and no dm_turns row (src/lib/dm/ask.ts), and nothing
// here is rendered into MessageList.

const SCOPE_LABELS: Record<string, string> = {
  story: "Story",
  rules: "Rules",
  sheet: "Sheet",
};

// The picker offers "auto" on top of the stored scopes, and names the sheet
// scope from the asker's point of view.
const SCOPE_PICKER_LABELS: Record<AskScope | "auto", string> = {
  auto: "Auto",
  story: "Story",
  rules: "Rules",
  sheet: "My sheet",
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

// The one Ask surface: a collapsible strip directly above the composer,
// holding the thread and the question box.
//
// The toggle row below is the only place the words "Ask the DM" appear. The
// expanded body deliberately has no header of its own; it used to repeat the
// same title and icon one border down, which read as a second Ask feature
// stacked on the first.
//
// Collapsing HIDES rather than unmounts, so a half-typed question and the
// thread's scroll position both survive a collapse.
function AskDockInner({
  campaignId,
  asks,
  meUserId,
  loaded,
  open,
  onOpenChange,
  onAsked,
}: {
  campaignId: string;
  asks: CampaignAsk[];
  meUserId: string;
  loaded: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // Refetches the thread once an answer lands.
  onAsked: () => Promise<void>;
}) {
  const [question, setQuestion] = useState("");
  const [scope, setScope] = useState<AskScope | "auto">("auto");
  const [visibility, setVisibility] = useState<AskVisibility>("private");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  // The question in flight, echoed into the list because an ask answers here
  // rather than in the transcript and a local model can take a while; without
  // it the box just empties and nothing visibly happens.
  const [pendingQuestion, setPendingQuestion] = useState("");

  // No floor gating anywhere in here, by design. Asking never consumes the
  // floor and /ask runs no floor check (ask/route.ts), so this stays usable
  // during a hold, a spotlight, someone else's initiative turn, and while the
  // opening narration plays. That is the whole point of the feature.
  const submit = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      const text = question.trim();
      if (!text || sending) {
        return;
      }
      setSending(true);
      setError("");
      setPendingQuestion(text);
      try {
        const response = await fetch(`/api/campaigns/${campaignId}/ask`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question: text, scope, visibility }),
        });
        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          setError(data.error || "The DM could not answer.");
          return;
        }
        setQuestion("");
        await onAsked();
      } catch {
        setError("Could not reach the server.");
      } finally {
        setSending(false);
        setPendingQuestion("");
      }
    },
    [campaignId, question, scope, sending, visibility, onAsked],
  );

  const answered = asks.length;
  return (
    <div className="border-t border-stone-900">
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        className="flex w-full items-center gap-1.5 px-3 py-1.5 text-[11px] text-stone-500 transition-colors hover:text-stone-300"
      >
        <MessageCircleQuestion className="size-3.5 text-amber-300/70" />
        <span>Ask the DM</span>
        {answered ? <span className="text-stone-600">({answered})</span> : null}
        {pendingQuestion && !open ? (
          <Loader2 className="size-3 animate-spin text-stone-500" />
        ) : null}
        <ChevronDown
          className={cn("ml-auto size-3.5 transition-transform", open ? "" : "-rotate-90")}
        />
      </button>

      {/* The column needs a DEFINITE height, or the list's `min-h-0 flex-1
          overflow-y-auto` has nothing to scroll against and a long thread
          pushes the question box off screen. */}
      <div className={cn("max-h-[28rem] flex-col", open ? "flex" : "hidden")}>
        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3 pt-1">
          <p className="pb-2 text-[11px] leading-4 text-stone-500">
            Questions about the story, the world, the rules, or your sheet. Answers come from
            what the campaign has on record and never move the story forward.
          </p>
          {!loaded ? (
            <p className="flex items-center gap-2 text-xs text-stone-500">
              <Loader2 className="size-3.5 animate-spin" /> Loading...
            </p>
          ) : !asks.length && !pendingQuestion ? (
            <p className="text-xs leading-5 text-stone-600">
              Nothing asked yet. Put a question to the DM below.
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

        <form onSubmit={submit} className="border-t border-stone-800 px-3 py-2.5">
          <div className="mb-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-stone-500">
            <span>About</span>
            {(["auto", "story", "rules", "sheet"] as const).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setScope(option)}
                className={cn(
                  "rounded-full border px-2 py-1 transition-colors sm:py-0.5",
                  scope === option
                    ? "border-amber-700 bg-amber-950/40 text-amber-200"
                    : "border-stone-700 text-stone-400 hover:text-stone-200",
                )}
              >
                {SCOPE_PICKER_LABELS[option]}
              </button>
            ))}
            <span className="ml-2">Seen by</span>
            {(["private", "table"] as const).map((option) => (
              <Tooltip
                key={option}
                content={
                  option === "private"
                    ? "Only you see the question and the answer."
                    : "The whole table sees the question and the answer."
                }
              >
                <button
                  type="button"
                  onClick={() => setVisibility(option)}
                  className={cn(
                    "rounded-full border px-2 py-1 transition-colors sm:py-0.5",
                    visibility === option
                      ? "border-amber-700 bg-amber-950/40 text-amber-200"
                      : "border-stone-700 text-stone-400 hover:text-stone-200",
                  )}
                >
                  {option === "private" ? "Just me" : "The table"}
                </button>
              </Tooltip>
            ))}
            <span className="ml-auto italic text-stone-600">The story does not move.</span>
          </div>
          <div className="flex items-end gap-2">
            <textarea
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  submit(event);
                }
              }}
              rows={2}
              placeholder="Ask the DM about the story, the world, the rules, or your sheet"
              className={cn(ui.input, "resize-none text-xs leading-5")}
            />
            <button
              type="submit"
              disabled={!question.trim() || sending}
              className={cn(ui.btnSmall, "shrink-0 px-2 py-1 text-[11px]")}
            >
              {sending ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <Send className="size-3" />
              )}
              Ask
            </button>
          </div>
          {error ? <p className="mt-1.5 text-[11px] text-red-400">{error}</p> : null}
        </form>
      </div>
    </div>
  );
}

// Memoized for the same reason as SidePanel: its props do not change while
// the DM streams narration into the message list.
export const AskDock = memo(AskDockInner);
