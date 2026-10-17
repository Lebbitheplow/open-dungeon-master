"use client";

import { EmptyState } from "@/components/EmptyState";
import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { SectionHead } from "@/components/ui/SectionHead";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import type { BlockKind, ContextTrace } from "@/lib/dm/context-budget";

// "What the DM was actually sent." Lead only, because the underlying prompt
// carries DM-only facts and the secret story arc; see the route for why even
// the token counts stay behind that gate.
//
// The point of this panel is answering one question after a bad turn: was the
// thing the DM forgot even in the prompt? A dropped block with a reason is a
// far better answer than guessing at the model.

const KIND_LABEL: Record<BlockKind, string> = {
  safety: "Lines and veils",
  contract: "Engine boundary",
  rules: "Rules",
  sky: "Sky and hour",
  state: "Game state",
  factions: "Factions",
  quests: "Quests",
  shop: "Shop",
  retrieval: "Lore and house rules",
  chapters: "Chapters",
  history: "Transcript",
  tools: "Tool definitions",
};

// Palette is stone, amber and ember only (src/app/globals.css remaps the
// Tailwind names); anything outside it renders as raw Tailwind and clashes
// with the indigo-and-gold theme.
const KIND_COLOR: Record<BlockKind, string> = {
  safety: "text-ember-300",
  contract: "text-amber-300",
  rules: "text-stone-300",
  sky: "text-stone-300",
  state: "text-amber-200",
  factions: "text-amber-200",
  quests: "text-amber-200",
  shop: "text-amber-200",
  retrieval: "text-ember-300",
  chapters: "text-ember-400",
  history: "text-stone-200",
  tools: "text-stone-400",
};

export function ContextPanel({ campaignId }: { campaignId: string }) {
  const [trace, setTrace] = useState<ContextTrace | null>(null);
  const [at, setAt] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Every state write happens after the await, never synchronously while the
  // effect is running. `reload` is a counter rather than a direct call so the
  // refresh button re-runs the same effect instead of duplicating its logic.
  const [reload, setReload] = useState(0);
  const load = useCallback(() => setReload((count) => count + 1), []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(`/api/campaigns/${campaignId}/context-trace`);
        if (cancelled) {
          return;
        }
        if (!response.ok) {
          setError(response.status === 403 ? "Party lead only." : "Could not load the context.");
          setLoading(false);
          return;
        }
        const data = (await response.json()) as { trace: ContextTrace | null; at?: string };
        if (cancelled) {
          return;
        }
        setError("");
        setTrace(data.trace);
        setAt(data.at ?? "");
      } catch {
        if (!cancelled) {
          setError("Could not load the context.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [campaignId, reload]);

  const pct = trace ? Math.min(100, Math.round((trace.promptTokens / trace.limitTokens) * 100)) : 0;
  const over = trace ? trace.promptTokens > trace.limitTokens : false;

  return (
    <div className="space-y-3 p-3">
      <SectionHead
        title="What the DM was sent"
        glyph="tab-context"
        aside={
          <button type="button" onClick={load} className={cn(ui.iconAction, "pk-tap pk-always -my-1 inline-flex items-center justify-center")} aria-label="Refresh">
            <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
          </button>
        }
      />
      <p className="-mt-1 text-xs text-stone-500">
        Last turn{at ? `, ${new Date(at).toLocaleTimeString()}` : ""}. Token counts are estimates.
      </p>

      {error ? <p className="motion-shake text-xs text-red-400">{error}</p> : null}

      {!error && !loading && !trace ? (
        <EmptyState size="sm" art="scrolls" title="No turn has been taken yet. Play a round and this will show every block the DM received, what it cost, and anything the budget cut." />
      ) : null}

      {trace ? (
        <>
          <div>
            <div className="mb-1 flex justify-between font-mono text-[11px] text-stone-400">
              <span>
                {trace.promptTokens.toLocaleString()} / {trace.limitTokens.toLocaleString()} tokens
              </span>
              <span className={over ? "text-red-400" : "text-stone-500"}>{pct}%</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-stone-800">
              <div
                className={cn("bar-ease h-full rounded-full", over ? "bg-red-500" : "bg-amber-500/70")}
                style={{ width: `${Math.max(2, pct)}%` }}
              />
            </div>
          </div>

          {trace.tuning?.length ? (
            <div className="panel rounded-lg px-2.5 py-1.5 text-xs" data-testid="tuning-trace">
              <span className="whitespace-nowrap font-medium text-amber-200">Fitted to this model</span>
              <ul className="mt-1 space-y-0.5">
                {trace.tuning.map((line) => (
                  <li key={line} className="text-[11px] text-stone-400">
                    {line}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {trace.profile && trace.profile.name !== "full" ? (
            <div className="panel rounded-lg px-2.5 py-1.5 text-xs" data-testid="profile-trace">
              <span className="whitespace-nowrap font-medium text-amber-200">
                {trace.profile.name === "compact" ? "Compact tool set" : "Trimmed tool set"}
              </span>
              {trace.profile.name === "compact" ? (
                <p className="mt-0.5 text-[11px] text-stone-400">
                  Groups offered: {trace.profile.groups?.length ? trace.profile.groups.join(", ") : "the core only"}
                  {trace.profile.opened?.length ? `; opened during the turn: ${trace.profile.opened.join(", ")}` : ""}. The rest are one more_tools call away.
                </p>
              ) : null}
            </div>
          ) : null}

          {trace.calls?.length ? (
            <div className="panel rounded-lg px-2.5 py-1.5 text-xs" data-testid="calls-trace">
              <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                <span className="whitespace-nowrap font-medium text-amber-200">Calls</span>
                {trace.prefix ? (
                  <span className="shrink-0 font-mono text-[11px] text-stone-400" title="How much of this turn's prompt matched the last turn's from its start: the most a prompt cache could reuse.">
                    {trace.prefix.sharedTokens.toLocaleString()}/{trace.prefix.promptTokens.toLocaleString()} shared with the last turn
                  </span>
                ) : null}
              </div>
              <ul className="mt-1 space-y-0.5">
                {trace.calls.map((call, index) => (
                  <li key={`${index}-${call.task}`} className={cn("text-[11px]", call.error ? "text-red-300/90" : "text-stone-400")}>
                    <span className="font-mono text-stone-500">{call.task}</span>{" "}
                    {call.windowTokens
                      ? call.windowAssumed
                        ? `about ${call.promptTokens.toLocaleString()} sent past an assumed ${call.windowTokens.toLocaleString()} window (the endpoint reports none), reply uncapped`
                        : `${call.promptTokens.toLocaleString()}/${call.windowTokens.toLocaleString()} sent`
                      : "sent unmeasured"}
                    {call.toolCount ? `, ${call.toolCount} tools` : ""}
                    {call.windowTokens && !call.windowAssumed ? `, reply up to ${call.outputTokens.toLocaleString()}` : ""}
                    {call.reportedInputTokens !== undefined ? `; backend counted ${call.reportedInputTokens.toLocaleString()} in` : ""}
                    {call.cachedInputTokens !== undefined ? ` (${call.cachedInputTokens.toLocaleString()} cached)` : ""}
                    {call.outputTokensUsed !== undefined ? `, ${call.outputTokensUsed.toLocaleString()} out` : ""}
                    {call.reasoningTokens !== undefined ? ` (${call.reasoningTokens.toLocaleString()} reasoning)` : ""}
                    {call.durationMs !== undefined ? `, ${(call.durationMs / 1000).toFixed(1)}s` : ""}
                    {call.firstTokenMs !== undefined ? ` (first words ${(call.firstTokenMs / 1000).toFixed(1)}s)` : ""}
                    {call.dropped || call.clipped ? `; fitted: ${call.dropped} older line(s) left out, ${call.clipped} cut short` : ""}
                    {call.finishReason && call.finishReason !== "stop" && call.finishReason !== "tool_calls" ? `; ended: ${call.finishReason}` : ""}
                    {call.error ? `; failed: ${call.error}` : ""}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {trace.houseRules ? (
            <div className="panel rounded-lg px-2.5 py-1.5 text-xs" data-testid="house-rules-trace">
              <span className="whitespace-nowrap font-medium text-amber-200">House rules</span>
              <p className="mt-0.5 text-[11px] text-stone-400">
                {trace.houseRules.shown.length ? `Shown: ${trace.houseRules.shown.join("; ")}.` : "None shown."}
              </p>
              {trace.houseRules.omitted.length ? (
                <p className="mt-0.5 text-[11px] text-red-300/90">Left out for room (named to the DM): {trace.houseRules.omitted.join("; ")}.</p>
              ) : null}
            </div>
          ) : null}

          {trace.arc ? (
            <div className="panel rounded-lg px-2.5 py-1.5 text-xs" data-testid="arc-trace">
              <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                <span className="whitespace-nowrap font-medium text-amber-200">Story arc</span>
                <span className="shrink-0 font-mono text-[11px] text-stone-400">
                  {trace.arc.beats.shown}/{trace.arc.beats.total} beats, {trace.arc.chars.toLocaleString()}/{trace.arc.budgetChars.toLocaleString()} event chars
                </span>
              </div>
              {trace.arc.events.length ? (
                <ul className="mt-1 space-y-0.5">
                  {trace.arc.events.map((pick) => (
                    <li key={pick.id} className={cn("text-[11px]", pick.included ? "text-stone-400" : "text-red-300/90")}>
                      <span className="font-mono text-stone-500">{pick.id}</span> {pick.name}
                      <span className="text-stone-500">: {pick.included ? pick.reason : `held back (${pick.reason.replace(/^held back: /, "")})`}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-0.5 text-[11px] text-stone-500">No planned events pending.</p>
              )}
            </div>
          ) : null}

          {trace.lore ? (
            <div className="panel rounded-lg px-2.5 py-1.5 text-xs" data-testid="lore-trace">
              <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                <span className="whitespace-nowrap font-medium text-amber-200">World lore</span>
                <span className="shrink-0 font-mono text-[11px] text-stone-400">
                  {trace.lore.picks.filter((pick) => pick.included).length}/{trace.lore.picks.filter((pick) => !pick.weak).length} entries, {trace.lore.chars.toLocaleString()}/{trace.lore.budgetChars.toLocaleString()} chars
                </span>
              </div>
              {trace.lore.picks.length ? (
                <ul className="mt-1 space-y-0.5">
                  {trace.lore.picks.map((pick) => (
                    <li
                      key={pick.id}
                      title={pick.id}
                      data-lore-pick={pick.included ? "kept" : pick.weak ? "near" : "held"}
                      className={cn("text-[11px]", pick.included ? "text-stone-400" : pick.weak ? "text-stone-500" : "text-red-300/90")}
                    >
                      {pick.title}
                      {pick.secret ? <span className="text-ember-300"> (secret)</span> : null}
                      <span className="text-stone-500">: {pick.reason}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-0.5 text-[11px] text-stone-500">No entry matched this moment.</p>
              )}
            </div>
          ) : null}

          <ul className="stagger space-y-1">
            {trace.blocks.map((block) => (
              <li
                key={`${block.position}-${block.id}`}
                className={cn(
                  "panel rounded-lg px-2.5 py-1.5 text-xs",
                  !block.included && "border-red-900/50 bg-red-950/20",
                )}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className={cn("font-medium", KIND_COLOR[block.kind])}>
                    {KIND_LABEL[block.kind]}
                    <span className="ml-1 font-normal text-stone-500">{block.id}</span>
                  </span>
                  <span className="shrink-0 font-mono text-[11px] text-stone-400">
                    {block.tokens.toLocaleString()}
                  </span>
                </div>
                <p
                  className={cn(
                    "mt-0.5 text-[11px]",
                    block.included ? "text-stone-500" : "text-red-300",
                  )}
                >
                  {block.included ? block.reason : `dropped: ${block.reason}`}
                </p>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}
