"use client";

import { Dices, Loader2 } from "lucide-react";
import { useMemo, useState } from "react";
import { cn } from "@/lib/cn";
import { expressionDice } from "@/lib/dice";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import type { PendingRoll } from "@/app/campaigns/[campaignId]/useCampaignStream";

const OWNER_FALLBACK_AFTER_MS = 3 * 60 * 1000;

// A parked physical roll. The rolling player enters each die; everyone else
// sees a waiting card. The roller can always fall back to a digital roll;
// the owner can too once the card has sat unanswered for a few minutes.
export function PendingRollCard({
  campaignId,
  pending,
  sheets,
  meUserId,
  isLead,
}: {
  campaignId: string;
  pending: PendingRoll;
  sheets: CharacterSheet[];
  meUserId: string;
  isLead: boolean;
}) {
  const [values, setValues] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Sampled once on mount; the fallback affordance appearing on the next
  // re-render after the threshold is fine for a courtesy button.
  const [mountedAt] = useState(() => Date.now());

  const faces = useMemo(() => {
    try {
      return expressionDice(pending.expression);
    } catch {
      return [];
    }
  }, [pending.expression]);

  const mine = pending.userId === meUserId;
  const character = sheets.find((sheet) => sheet.id === pending.characterId);
  const label = `${character?.name ?? "Someone"}: ${pending.kind.replaceAll("_", " ")}${
    pending.detail ? ` (${pending.detail.replaceAll("_", " ")})` : ""
  }`;
  const advantageNote =
    pending.advantage === "advantage"
      ? "advantage: roll both, highest counts"
      : pending.advantage === "disadvantage"
        ? "disadvantage: roll both, lowest counts"
        : "";
  const stale = mountedAt - new Date(pending.createdAt).getTime() > OWNER_FALLBACK_AFTER_MS;
  const complete = faces.length > 0 && faces.every((_, index) => values[index]?.trim());

  async function submit(body: unknown) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(
        `/api/campaigns/${campaignId}/pending-rolls/${pending.id}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setError(data.error || "Could not submit the roll.");
      }
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  if (!mine) {
    return (
      <div className="mb-2 flex items-center justify-between rounded-md border border-amber-900/60 bg-amber-950/20 px-3 py-2 text-xs text-amber-200/90">
        <span className="flex items-center gap-2">
          <Dices className="size-4 animate-pulse text-amber-200" />
          Waiting for {character?.name ?? "a player"} to roll {pending.expression} with real dice
        </span>
        {isLead && stale ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => submit({ fallback: "digital" })}
            className="shrink-0 text-amber-200 hover:text-amber-300 disabled:opacity-50"
          >
            Roll digitally
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="mb-2 rounded-md border border-amber-700/70 bg-amber-950/30 px-3 py-2.5">
      <div className="flex items-center justify-between text-sm">
        <span className="flex items-center gap-2 text-amber-100">
          <Dices className="size-4 text-amber-200" />
          Your roll: {label}
        </span>
        <span className="font-mono text-xs text-amber-400">{pending.expression}</span>
      </div>
      {pending.reason ? (
        <p className="mt-0.5 text-xs text-amber-200/70">{pending.reason}</p>
      ) : null}
      {advantageNote ? (
        <p className="mt-0.5 text-xs text-amber-200/90">{advantageNote}</p>
      ) : null}

      <div className="mt-2 flex flex-wrap items-end gap-2">
        {faces.map((sides, index) => (
          <label key={index} className="block">
            <span className="mb-0.5 block text-center text-[10px] text-amber-400/80">
              d{sides}
            </span>
            <input
              type="number"
              min={1}
              max={sides}
              inputMode="numeric"
              value={values[index] ?? ""}
              onChange={(event) =>
                setValues((current) => ({ ...current, [index]: event.target.value }))
              }
              className="w-14 rounded-md border border-amber-800 bg-stone-900 px-2 py-1.5 text-center text-sm outline-none focus:border-amber-500"
            />
          </label>
        ))}
        <button
          type="button"
          disabled={busy || !complete}
          onClick={() =>
            submit({ dice: faces.map((_, index) => Number(values[index])) })
          }
          className={cn(
            "rounded-lg bg-amber-200 px-3 py-1.5 text-sm font-medium text-stone-950",
            "hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-40",
          )}
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : "Submit roll"}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => submit({ fallback: "digital" })}
          className="text-xs text-stone-400 hover:text-stone-200 disabled:opacity-50"
        >
          Roll digitally instead
        </button>
      </div>
      {error ? <p className="mt-1.5 text-xs text-red-400">{error}</p> : null}
    </div>
  );
}
