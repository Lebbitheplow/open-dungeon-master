"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { Check, Loader2, ShieldQuestion, X } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import type { CampaignMessage } from "@/lib/db/messages";
import {
  LORE_CATEGORY_LABELS,
  LORE_CHECK_CATEGORIES,
  type LoreCheckCategory,
  type LoreCheckResult,
} from "@/lib/dm/lore-logic";

// The lore-check flow: pick a complaint category, the server cross-checks
// the flagged passage against its whole record (facts, chapters, verbatim
// scenes, NPC state) and returns a verdict with citations and a suggested
// rewrite. The party lead can accept the rewrite, replacing the message.

const VERDICT_STYLES: Record<LoreCheckResult["verdict"], string> = {
  consistent: "border-emerald-900 bg-emerald-950/40 text-emerald-300",
  unsupported: "border-amber-900 bg-amber-950/40 text-amber-300",
  contradicts: "border-red-900 bg-red-950/40 text-red-300",
};

const VERDICT_LABELS: Record<LoreCheckResult["verdict"], string> = {
  consistent: "Consistent with the record",
  unsupported: "Unsupported by the record",
  contradicts: "Contradicts the record",
};

export function LoreCheckDialog({
  campaignId,
  message,
  selection,
  isLead,
  onClose,
}: {
  campaignId: string;
  message: CampaignMessage;
  // The text the user had selected when opening the dialog ("" = whole message).
  selection: string;
  isLead: boolean;
  onClose: () => void;
}) {
  const [category, setCategory] = useState<LoreCheckCategory | null>(null);
  const [running, setRunning] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<LoreCheckResult | null>(null);

  const excerpt = (selection || message.content).trim();

  async function run(picked: LoreCheckCategory) {
    setCategory(picked);
    setRunning(true);
    setError("");
    setResult(null);
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/lore-check`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "run",
          messageId: message.id,
          selection: selection.slice(0, 2000),
          category: picked,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error || "The check failed; try again.");
        return;
      }
      setResult(data.result as LoreCheckResult);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setRunning(false);
    }
  }

  async function accept() {
    if (!result?.rewrite) {
      return;
    }
    setAccepting(true);
    setError("");
    try {
      // The rewrite covers the flagged passage; when only a selection was
      // flagged, splice it into the full message text.
      const content =
        selection && message.content.includes(selection)
          ? message.content.replace(selection, result.rewrite)
          : result.rewrite;
      const response = await fetch(`/api/campaigns/${campaignId}/lore-check`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "accept", messageId: message.id, content }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error || "Could not apply the rewrite.");
        return;
      }
      setAccepted(true);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setAccepting(false);
    }
  }

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/70" />
        <Dialog.Content
          className={cn(
            ui.dialog,
            "fixed left-1/2 top-1/2 z-50 max-h-[85vh] w-[min(92vw,30rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto",
          )}
        >
          <div className="mb-3 flex items-center justify-between">
            <Dialog.Title className="flex items-center gap-2 font-display text-lg tracking-wide text-amber-50">
              <ShieldQuestion className="size-4 text-amber-300" /> Lore check
            </Dialog.Title>
            <Dialog.Close className="text-stone-500 hover:text-stone-300">
              <X className="size-4" />
            </Dialog.Close>
          </div>

          <blockquote className="mb-3 max-h-32 overflow-y-auto rounded-lg border border-stone-800 bg-stone-950/40 p-2.5 font-serif text-xs italic leading-5 text-stone-400">
            {excerpt.slice(0, 600)}
            {excerpt.length > 600 ? "..." : ""}
          </blockquote>

          {!result ? (
            <div className="space-y-2">
              <p className="text-xs text-stone-400">
                What seems off? The server checks the passage against everything on
                record: facts, chapter archives, past scenes, and NPC states.
              </p>
              <div className="flex flex-wrap gap-1.5">
                {LORE_CHECK_CATEGORIES.map((value) => (
                  <button
                    key={value}
                    type="button"
                    disabled={running}
                    onClick={() => run(value)}
                    className={cn(
                      "rounded-full border px-2.5 py-1 text-[11px]",
                      category === value
                        ? "border-amber-700 bg-amber-950/40 text-amber-200"
                        : "border-stone-700 text-stone-400 hover:text-stone-200",
                    )}
                  >
                    {LORE_CATEGORY_LABELS[value]}
                  </button>
                ))}
              </div>
              {running ? (
                <p className="flex items-center gap-2 text-xs text-stone-500">
                  <Loader2 className="size-3.5 animate-spin" />
                  Cross-referencing the record (queued behind the DM)...
                </p>
              ) : null}
            </div>
          ) : (
            <div className="space-y-3">
              <p
                className={cn(
                  "rounded-lg border px-2.5 py-1.5 text-xs font-medium",
                  VERDICT_STYLES[result.verdict],
                )}
              >
                {VERDICT_LABELS[result.verdict]}
              </p>
              {result.explanation ? (
                <p className="text-xs leading-5 text-stone-300">{result.explanation}</p>
              ) : null}
              {result.citations.length ? (
                <div className="space-y-1">
                  <p className="text-[10px] font-medium uppercase tracking-wide text-stone-500">
                    Evidence
                  </p>
                  {result.citations.map((citation, index) => (
                    <p
                      key={index}
                      className="rounded border border-stone-800 bg-stone-950/40 p-2 text-[11px] leading-4 text-stone-400"
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
              {result.rewrite ? (
                <div className="space-y-1.5">
                  <p className="text-[10px] font-medium uppercase tracking-wide text-stone-500">
                    Suggested rewrite
                  </p>
                  <p className="whitespace-pre-wrap rounded-lg border border-stone-800 bg-stone-950/40 p-2.5 font-serif text-xs leading-5 text-stone-200">
                    {result.rewrite}
                  </p>
                  {accepted ? (
                    <p className="flex items-center gap-1.5 text-xs text-emerald-400">
                      <Check className="size-3.5" /> Applied; the message has been updated.
                    </p>
                  ) : isLead && message.authorType === "dm" ? (
                    <button
                      type="button"
                      disabled={accepting}
                      onClick={accept}
                      className="flex items-center gap-1.5 rounded border border-emerald-900 px-2.5 py-1 text-xs text-emerald-400 hover:bg-emerald-950/50 disabled:opacity-50"
                    >
                      {accepting ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <Check className="size-3.5" />
                      )}
                      Accept rewrite
                    </button>
                  ) : (
                    <p className="text-[11px] text-stone-600">
                      {message.authorType === "dm"
                        ? "The party lead can accept this rewrite."
                        : "Only DM narration can be rewritten."}
                    </p>
                  )}
                </div>
              ) : null}
              <button
                type="button"
                onClick={() => {
                  setResult(null);
                  setAccepted(false);
                  setCategory(null);
                }}
                className="text-[11px] text-stone-500 hover:text-stone-300"
              >
                Check a different category
              </button>
            </div>
          )}
          {error ? <p className="mt-2 text-xs text-red-400">{error}</p> : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
