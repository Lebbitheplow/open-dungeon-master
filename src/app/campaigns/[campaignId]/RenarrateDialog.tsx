"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { Loader2, RefreshCw, X } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import type { CampaignMessage } from "@/lib/db/messages";
import { MAX_GUIDANCE_LENGTH, MAX_VARIANTS } from "@/lib/dm/renarrate-logic";

// Reroll the DM's latest narration. The server replays only the final
// narration call of that turn, so the dice, the damage and the world state
// stay exactly as they landed; the guidance line steers this take alone and
// is never remembered. Party lead only.

const GUIDANCE_PRESETS = ["darker", "more dialogue", "shorter", "more sensory detail"];

export function RenarrateDialog({
  campaignId,
  message,
  onClose,
}: {
  campaignId: string;
  message: CampaignMessage;
  onClose: () => void;
}) {
  const [guidance, setGuidance] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const taken = message.variants?.length ?? 1;
  const capped = taken >= MAX_VARIANTS;

  async function reroll() {
    setRunning(true);
    setError("");
    try {
      const response = await fetch(
        `/api/campaigns/${campaignId}/messages/${message.id}/renarrate`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "reroll", guidance }),
        },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error || "The reroll failed; try again.");
        return;
      }
      onClose();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setRunning(false);
    }
  }

  return (
    <Dialog.Root open onOpenChange={(open) => !open && !running && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/70" />
        <Dialog.Content
          className={cn(
            ui.dialog,
            "fixed left-1/2 top-1/2 z-50 max-h-[85vh] w-[min(92vw,28rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto",
          )}
        >
          <div className="mb-3 flex items-center justify-between">
            <Dialog.Title className="flex items-center gap-2 font-display text-lg tracking-wide text-amber-50">
              <RefreshCw className="size-4 text-amber-300" /> Reroll the narration
            </Dialog.Title>
            <Dialog.Close className="text-stone-500 hover:text-stone-300">
              <X className="size-4" />
            </Dialog.Close>
          </div>

          <p className="mb-3 text-xs leading-5 text-stone-400">
            The DM says the same moment in different words. Nothing else moves: the
            same rolls, the same damage, the same outcome. Take {taken} of{" "}
            {MAX_VARIANTS}.
            {capped ? " That is every take; browse them and pick one." : ""}
          </p>

          <label className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-stone-500">
            Guidance for this take (optional)
          </label>
          <input
            value={guidance}
            onChange={(event) => setGuidance(event.target.value)}
            maxLength={MAX_GUIDANCE_LENGTH}
            disabled={running}
            placeholder="darker, more dialogue, shorter..."
            className={ui.input}
          />
          <div className="mt-2 flex flex-wrap gap-1.5">
            {GUIDANCE_PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                disabled={running}
                onClick={() => setGuidance(preset)}
                className={cn(
                  "rounded-full border px-2.5 py-1 text-[11px]",
                  guidance === preset
                    ? "border-amber-700 bg-amber-950/40 text-amber-200"
                    : "border-stone-700 text-stone-400 hover:text-stone-200",
                )}
              >
                {preset}
              </button>
            ))}
          </div>

          {error ? <p className="mt-3 text-xs text-red-400">{error}</p> : null}

          <div className="mt-4 flex justify-end gap-2">
            <button type="button" onClick={onClose} disabled={running} className={ui.btnSmall}>
              Cancel
            </button>
            <button
              type="button"
              onClick={reroll}
              disabled={running || capped}
              className={ui.btnPrimary}
            >
              {running ? (
                <>
                  <Loader2 className="size-4 animate-spin" /> Writing...
                </>
              ) : (
                "Reroll"
              )}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
