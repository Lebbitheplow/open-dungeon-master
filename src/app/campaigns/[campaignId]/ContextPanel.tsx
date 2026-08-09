"use client";

import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
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
  contract: "Engine boundary",
  rules: "Rules",
  state: "Game state",
  retrieval: "Lore and house rules",
  chapters: "Chapters",
  history: "Transcript",
};

// Palette is stone, amber and ember only (src/app/globals.css remaps the
// Tailwind names); anything outside it renders as raw Tailwind and clashes
// with the indigo-and-gold theme.
const KIND_COLOR: Record<BlockKind, string> = {
  contract: "text-amber-300",
  rules: "text-stone-300",
  state: "text-amber-200",
  retrieval: "text-ember-300",
  chapters: "text-ember-400",
  history: "text-stone-200",
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
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="text-[10px] font-medium uppercase tracking-wide text-stone-500">
            What the DM was sent
          </h3>
          <p className="text-[11px] text-stone-500">
            Last turn{at ? `, ${new Date(at).toLocaleTimeString()}` : ""}. Token counts are
            estimates.
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          className={cn(ui.iconAction, "-my-1")}
          aria-label="Refresh"
        >
          <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
        </button>
      </div>

      {error ? <p className="text-xs text-red-400">{error}</p> : null}

      {!error && !loading && !trace ? (
        <p className="text-xs text-stone-500">
          No turn has been taken yet. Play a round and this will show every block the DM
          received, what it cost, and anything the budget cut.
        </p>
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
                className={cn("h-full rounded-full", over ? "bg-red-500" : "bg-amber-500/70")}
                style={{ width: `${Math.max(2, pct)}%` }}
              />
            </div>
          </div>

          <ul className="space-y-1">
            {trace.blocks.map((block) => (
              <li
                key={`${block.position}-${block.id}`}
                className={cn(
                  "rounded-lg border px-2 py-1.5 text-xs shadow-elev-1",
                  block.included
                    ? "border-stone-700/60 bg-stone-900/50"
                    : "border-red-900/50 bg-red-950/20",
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
