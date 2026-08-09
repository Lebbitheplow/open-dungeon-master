"use client";

import { Loader2, MessageCircleQuestion, Send, Sparkles, Users, X } from "lucide-react";
import { memo, useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import type { CampaignAsk } from "@/lib/db/asks";
import type { StoredAskBrief } from "@/lib/db/ask-briefs";
import { MAX_BRIEF_CHARS } from "@/lib/dm/ask-brief-logic";
import { ui } from "@/lib/ui";

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

// Hand what you worked out here to the DM for one turn.
//
// The editable box is the feature, not a convenience. Ask is read-only by
// design and this is its only bridge into the story context, so the draft
// button proposes text and nothing more: what reaches the DM is whatever
// string is sitting in this textarea when the player presses Arm.
function AskBriefBar({
  campaignId,
  hasThread,
}: {
  campaignId: string;
  hasThread: boolean;
}) {
  const [armed, setArmed] = useState<StoredAskBrief | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState<"draft" | "arm" | null>(null);
  const [error, setError] = useState("");
  const [shareWithTable, setShareWithTable] = useState(false);

  const base = `/api/campaigns/${campaignId}/ask/brief`;

  useEffect(() => {
    let cancelled = false;
    fetch(base)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!cancelled && data) {
          setArmed(data.brief ?? null);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [base]);

  const summarize = useCallback(async () => {
    setBusy("draft");
    setError("");
    try {
      const response = await fetch(base, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "draft" }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error ?? "Could not draft a note.");
        return;
      }
      setDraft(data.brief ?? "");
    } catch {
      setError("Could not draft a note.");
    } finally {
      setBusy(null);
    }
  }, [base]);

  const arm = useCallback(async () => {
    const text = draft.trim();
    if (!text) {
      return;
    }
    setBusy("arm");
    setError("");
    try {
      const response = await fetch(base, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          visibility: shareWithTable ? "table" : "private",
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error ?? "Could not arm that note.");
        return;
      }
      setArmed(data.brief ?? null);
      setDraft("");
    } catch {
      setError("Could not arm that note.");
    } finally {
      setBusy(null);
    }
  }, [base, draft, shareWithTable]);

  const disarm = useCallback(async () => {
    setError("");
    await fetch(base, { method: "DELETE" }).catch(() => {});
    setArmed(null);
  }, [base]);

  if (armed) {
    return (
      <div className="border-t border-stone-800 px-3 py-2.5">
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-2.5">
          <Send className="mt-0.5 size-3.5 shrink-0 text-amber-300" />
          <div className="min-w-0 flex-1">
            <p className="text-[10px] uppercase tracking-wide text-amber-300/80">
              Armed for the next turn
              {armed.visibility === "table" ? " (the table can see it)" : " (only you)"}
            </p>
            <p className="mt-1 whitespace-pre-wrap text-xs leading-5 text-stone-200">
              {armed.text}
            </p>
          </div>
          <button
            type="button"
            onClick={disarm}
            className={ui.iconAction}
            aria-label="Disarm this note"
            title="Disarm"
          >
            <X className="size-3.5" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="border-t border-stone-800 px-3 py-2.5">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <p className="text-[10px] uppercase tracking-wide text-stone-500">
          Pass a note to the DM
        </p>
        <button
          type="button"
          onClick={summarize}
          disabled={!hasThread || busy !== null}
          className={cn(ui.btnSmall, "px-2 py-1 text-[11px]")}
          title={
            hasThread
              ? "Draft a note from your recent questions"
              : "Ask something first"
          }
        >
          {busy === "draft" ? (
            <Loader2 className="size-3 animate-spin" />
          ) : (
            <Sparkles className="size-3" />
          )}
          Summarize
        </button>
      </div>
      <textarea
        value={draft}
        onChange={(event) => setDraft(event.target.value.slice(0, MAX_BRIEF_CHARS))}
        rows={2}
        maxLength={MAX_BRIEF_CHARS}
        placeholder="What you worked out, in a line or two. The DM reads this as context on the next turn, not as an order."
        className={cn(ui.input, "resize-none text-xs leading-5")}
      />
      <div className="mt-1.5 flex items-center justify-between gap-2">
        <label className="flex items-center gap-1.5 text-[11px] text-stone-500">
          <input
            type="checkbox"
            checked={shareWithTable}
            onChange={(event) => setShareWithTable(event.target.checked)}
            className="size-3 accent-amber-400"
          />
          Show the table
        </label>
        <div className="flex items-center gap-2">
          <span className="text-[10px] tabular-nums text-stone-600">
            {draft.trim().length}/{MAX_BRIEF_CHARS}
          </span>
          <button
            type="button"
            onClick={arm}
            disabled={!draft.trim() || busy !== null}
            className={cn(ui.btnSmall, "px-2 py-1 text-[11px]")}
          >
            {busy === "arm" ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <Send className="size-3" />
            )}
            Arm for next turn
          </button>
        </div>
      </div>
      {error ? <p className="mt-1.5 text-[11px] text-red-400">{error}</p> : null}
    </div>
  );
}

function AskPanelInner({
  campaignId,
  asks,
  meUserId,
  loaded,
  pendingQuestion,
}: {
  campaignId: string;
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

      <AskBriefBar
        campaignId={campaignId}
        hasThread={asks.some((ask) => ask.userId === meUserId && ask.status === "answered")}
      />
    </div>
  );
}

// Memoized for the same reason as SidePanel: its props do not change while
// the DM streams narration into the message list.
export const AskPanel = memo(AskPanelInner);

export const askPanelClass = cn("h-full");
