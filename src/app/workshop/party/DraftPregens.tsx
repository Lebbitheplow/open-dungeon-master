"use client";

import { Loader2, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { SectionHead } from "@/components/ui/SectionHead";
import { Select } from "@/components/ui/Select";

// "Draft pregens" (src/lib/dm/pregen-draft.ts): the AI DM reads the
// workshop's adventure and proposes a party, and the builder's own rules
// build each hero. The drafts land on the roster unticked; nothing reaches a
// player until the DM ticks Offer to players. With no AI DM set up the
// button is off and says why.

export type DraftReadiness = { ready: boolean; reason: string; defaultCount: number; maxCount: number };

// Whether this workshop's AI DM can draft, or null while asking. A failed
// ask leaves the button off with a reason rather than guessing.
export function useDraftReadiness(workshopId: string, enabled = true): DraftReadiness | null {
  const [readiness, setReadiness] = useState<DraftReadiness | null>(null);
  useEffect(() => {
    if (!enabled || !workshopId) {
      return;
    }
    let cancelled = false;
    void fetch(`/api/workshops/${workshopId}/pregens/draft`)
      .then(async (response) => {
        const payload = (await response.json().catch(() => ({}))) as Partial<DraftReadiness> & { error?: string };
        if (cancelled) return;
        setReadiness(
          response.ok
            ? { ready: Boolean(payload.ready), reason: payload.reason ?? "", defaultCount: payload.defaultCount ?? 4, maxCount: payload.maxCount ?? 6 }
            : { ready: false, reason: payload.error ?? "Could not ask whether the AI DM can draft.", defaultCount: 4, maxCount: 6 },
        );
      })
      .catch(() => {
        if (!cancelled) setReadiness({ ready: false, reason: "Could not reach the server to ask whether the AI DM can draft.", defaultCount: 4, maxCount: 6 });
      });
    return () => {
      cancelled = true;
    };
  }, [workshopId, enabled]);
  return readiness;
}

export type DraftResult = { drafted: string[]; changes: string[]; level: number; pregens: unknown[] };

// One draft, as the route answers it: the result, or what went wrong.
export async function requestDraft(workshopId: string, body: { count: number; campaignId?: string }): Promise<{ ok: true; result: DraftResult } | { ok: false; error: string }> {
  try {
    const response = await fetch(`/api/workshops/${workshopId}/pregens/draft`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      return { ok: false, error: (payload as { error?: string }).error ?? "The pregens were not drafted." };
    }
    return { ok: true, result: payload as DraftResult };
  } catch {
    return { ok: false, error: "Could not reach the server, so nothing was drafted." };
  }
}

export function countOptions(max: number) {
  return Array.from({ length: max }, (_, index) => {
    const value = String(index + 1);
    return { value, label: `${value} ${index === 0 ? "hero" : "heroes"}` };
  });
}

export function DraftPregensCard({
  workshopId,
  onDrafted,
}: {
  workshopId: string;
  onDrafted: (result: DraftResult) => void;
}) {
  const readiness = useDraftReadiness(workshopId);
  const [count, setCount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<DraftResult | null>(null);
  const chosen = Number(count || readiness?.defaultCount || 4);

  async function draft() {
    setBusy(true);
    setError("");
    setDone(null);
    const outcome = await requestDraft(workshopId, { count: chosen });
    setBusy(false);
    if (!outcome.ok) {
      setError(outcome.error);
      return;
    }
    setDone(outcome.result);
    onDrafted(outcome.result);
  }

  const off = !readiness?.ready;
  return (
    <div className={cn(ui.card, "space-y-2 p-3")} data-pregen-draft data-tour="party-draft">
      <SectionHead title="Draft pregens with the AI DM" glyph="system-party" className="mb-0" />
      <p className="text-xs text-stone-400">
        The AI DM reads this adventure and proposes a balanced party, each with a backstory tied to it. Every
        sheet is built by the builder&apos;s own rules at level 1. Drafts are not offered to players until you
        tick Offer to players.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <span className="w-40">
          <Select
            value={String(chosen)}
            onChange={setCount}
            label="How many pregens to draft"
            disabled={busy || off}
            options={countOptions(readiness?.maxCount ?? 6)}
          />
        </span>
        <button type="button" disabled={busy || off} onClick={() => void draft()} className={ui.btnPrimary} data-pregen-draft-go>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />} Draft pregens
        </button>
      </div>
      {readiness === null ? <p className="text-xs text-stone-500">Asking whether the AI DM can draft...</p> : null}
      {readiness && !readiness.ready ? (
        <p className="text-xs text-amber-200/90" data-pregen-draft-reason>
          {readiness.reason}
        </p>
      ) : null}
      <div aria-live="polite" className="space-y-1">
        {busy ? <p className="text-xs text-stone-300">The AI DM is drafting {chosen} {chosen === 1 ? "hero" : "heroes"}. This can take a minute.</p> : null}
        {done ? (
          <div className="reveal space-y-1 text-xs text-stone-300" data-pregen-draft-done>
            <p>
              Drafted {done.drafted.length} {done.drafted.length === 1 ? "pregen" : "pregens"} at level {done.level}. Look them over, edit or
              take off any you do not want, and tick Offer to players on the ones you keep.
            </p>
            {done.changes.length ? (
              <ul className="list-disc space-y-0.5 pl-4 text-stone-400">
                {done.changes.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </div>
      {error ? (
        <p className="motion-shake text-xs text-red-400" role="alert" data-pregen-draft-error>
          {error}
        </p>
      ) : null}
    </div>
  );
}
