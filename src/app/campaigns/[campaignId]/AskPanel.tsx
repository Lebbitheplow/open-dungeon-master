"use client";

import { ChevronDown, Loader2, Send, Users } from "lucide-react";
import { memo, useCallback, useState } from "react";
import type { FormEvent } from "react";
import { cn } from "@/lib/cn";
import { EmptyState } from "@/components/EmptyState";
import { GameIcon } from "@/components/ui/GameIcon";
import { SectionHead } from "@/components/ui/SectionHead";
import { PanelError, PanelLoading, panelRow } from "./PanelKit";
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

// The painted glyph for what a question was about.
const SCOPE_GLYPHS: Record<string, string> = { auto: "tab-reference", story: "tab-story", rules: "system-rules", sheet: "tab-characters" };

function AskEntry({ ask, meUserId }: { ask: CampaignAsk; meUserId: string }) {
  const mine = ask.userId === meUserId;
  return (
    <li className={panelRow}>
      <div className="mb-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-stone-400">
        <span className="pk-chip">
          <GameIcon icon={{ kind: "glyph", key: SCOPE_GLYPHS[ask.scope] ?? "tab-reference" }} size="size-4" />
          {SCOPE_LABELS[ask.scope] ?? ask.scope}
        </span>
        {ask.visibility === "table" ? (
          <span className="inline-flex items-center gap-1 text-stone-400">
            <Users className="size-3" /> {mine ? "Shared with the table" : "Asked by the table"}
          </span>
        ) : (
          <span className="text-stone-500">Only you</span>
        )}
      </div>
      <p className="mb-1.5 text-xs font-medium leading-5 text-stone-200">{ask.question}</p>
      {ask.status === "failed" ? (
        <p className="live-in text-xs italic text-red-400">The DM could not answer this one.</p>
      ) : (
        <p className="whitespace-pre-wrap font-serif text-xs leading-5 text-stone-300">
          {ask.answer}
        </p>
      )}
      {ask.citations.length ? (
        <div className="reveal mt-2 space-y-1">
          <SectionHead title="From the record" glyph="tab-log" level="h4" />
          {ask.citations.map((citation, index) => (
            <p
              key={index}
              className="rounded-md border border-stone-700/50 bg-stone-950/60 p-1.5 text-[11px] leading-4 text-stone-400"
            >
              <span className="eyebrow mr-1 rounded bg-stone-800 px-1 text-[9px] text-amber-300/80">
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
        data-tour="ask-dm"
        aria-expanded={open}
        className="pk-tap flex w-full items-center gap-1.5 px-3 py-1.5 text-xs text-stone-400 transition-colors hover:text-amber-100 motion-press"
      >
        <GameIcon icon={{ kind: "glyph", key: "tab-reference" }} size="size-5" />
        <span className="eyebrow text-[11px] text-amber-300/90">Ask the DM</span>
        {answered ? <span key={answered} className="count-pop text-stone-500">({answered})</span> : null}
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
          <p className="pb-2 text-xs leading-5 text-stone-500">
            Questions about the story, the world, the rules, or your sheet. Answers come from
            what the campaign has on record and never move the story forward.
          </p>
          {!loaded ? (
            <PanelLoading label="Loading..." rows={2} />
          ) : !asks.length && !pendingQuestion ? (
            <EmptyState size="sm" art="scrolls" title="Nothing asked yet. Put a question to the DM below." />
          ) : (
            <ul className="stagger space-y-2">
              {asks.map((ask) => (
                <AskEntry key={ask.id} ask={ask} meUserId={meUserId} />
              ))}
              {pendingQuestion ? (
                <li className={cn(panelRow, "live-in opacity-70")}>
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
            {/* Each choice row is its own group, so each gets its own sliding pill. */}
            <span data-pill-group="" role="group" aria-label="About" className="inline-flex flex-wrap items-center gap-1.5">
            {(["auto", "story", "rules", "sheet"] as const).map((option) => (
              <button data-on={scope === option ? "" : undefined}
                key={option}
                type="button"
                aria-pressed={scope === option}
                onClick={() => setScope(option)}
                className="pk-pill pk-tap motion-press"
              >
                <GameIcon icon={{ kind: "glyph", key: SCOPE_GLYPHS[option] }} size="size-4" />
                {SCOPE_PICKER_LABELS[option]}
              </button>
            ))}
            </span>
            <span className="ml-2">Seen by</span>
            <span data-pill-group="" role="group" aria-label="Seen by" className="inline-flex flex-wrap items-center gap-1.5">
            {(["private", "table"] as const).map((option) => (
              <Tooltip
                key={option}
                content={
                  option === "private"
                    ? "Only you see the question and the answer."
                    : "The whole table sees the question and the answer."
                }
              >
                <button data-on={visibility === option ? "" : undefined}
                  type="button"
                  aria-pressed={visibility === option}
                  onClick={() => setVisibility(option)}
                  className="pk-pill pk-tap motion-press"
                >
                  {option === "private" ? "Just me" : "The table"}
                </button>
              </Tooltip>
            ))}
            </span>
            <span className="ml-auto italic text-stone-500">The story does not move.</span>
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
              aria-label="Ask the DM about the story, the world, the rules, or your sheet"
              className={cn(ui.input, "resize-none text-xs leading-5")}
            />
            <button
              type="submit"
              disabled={!question.trim() || sending}
              className={cn(ui.btnPrimary, "pk-tap pk-display h-9 shrink-0 px-3 text-[12px]")}
            >
              {sending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Send className="size-3.5" />
              )}
              Ask
            </button>
          </div>
          {error ? <PanelError className="mt-1.5">{error}</PanelError> : null}
        </form>
      </div>
    </div>
  );
}

// Memoized for the same reason as SidePanel: its props do not change while
// the DM streams narration into the message list.
export const AskDock = memo(AskDockInner);
