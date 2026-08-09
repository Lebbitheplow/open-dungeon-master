"use client";

import { Loader2, RotateCcw, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { DM_HALTED_PREFIX } from "@/lib/campaign-types";

// A DM turn that threw. Everything the turn had (its conversation, tool calls
// and tool results) is still on the dm_turns row, so the lead can send the DM
// back in where it stopped instead of retyping the action, which would leave
// the same action in the transcript twice.
//
// The retry itself is durable server state: the moment it is claimed the
// notice loses its dmTurnId and this banner disappears for every client via
// message_updated. Local state here only covers the request in flight.
export function HaltedTurnBanner({
  campaignId,
  turnId,
  content,
  canRetry,
}: {
  campaignId: string;
  turnId: string;
  content: string;
  canRetry: boolean;
}) {
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState("");
  const reason = content.startsWith(DM_HALTED_PREFIX)
    ? content.slice(DM_HALTED_PREFIX.length)
    : content;

  async function retry() {
    if (retrying) {
      return;
    }
    setRetrying(true);
    setError("");
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/dm-turn/retry`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ turnId }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(payload?.error || "Could not restart that turn.");
      }
      // On success nothing is done here: the banner goes away when the
      // message_updated event lands, and the narration streams in as usual.
    } catch {
      setError("Could not reach the server.");
    } finally {
      setRetrying(false);
    }
  }

  return (
    <div className="mx-auto max-w-xl rounded-lg border border-amber-900/60 bg-amber-950/20 px-4 py-2.5">
      <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-amber-300">
        <TriangleAlert className="size-3.5 shrink-0" /> DM halted, context preserved
      </p>
      <p className="mt-0.5 text-sm text-stone-400">{reason}</p>
      {canRetry ? (
        <button
          type="button"
          onClick={retry}
          disabled={retrying}
          title="Send the DM back into this turn with everything it already had"
          className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-amber-800/70 px-2.5 py-1 text-xs text-amber-200 hover:border-amber-600 hover:text-amber-100 disabled:opacity-50"
        >
          {retrying ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <RotateCcw className="size-3.5" />
          )}
          {retrying ? "Picking the thread back up..." : "Retry the turn"}
        </button>
      ) : (
        <p className="mt-1 text-xs text-stone-600">
          The party lead can send the DM back in from here.
        </p>
      )}
      {error ? <p className="mt-1 text-xs text-red-400">{error}</p> : null}
    </div>
  );
}
