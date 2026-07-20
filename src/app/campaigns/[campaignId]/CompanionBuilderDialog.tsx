"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { Bot, X } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import CharacterBuilder, {
  type BuilderResult,
} from "@/app/characters/builder/CharacterBuilder";
import type { Genre } from "@/lib/schemas/game-settings";

// The party lead (or solo player) builds a lasting companion with the full
// character creator. The finished sheet POSTs to /companions/create, which
// owns it with a bot user and, mid-session, nudges the DM to write them in.
export function CompanionBuilderDialog({
  campaignId,
  genre,
  level,
  onClose,
  onCreated,
}: {
  campaignId: string;
  genre?: Genre;
  level: number;
  onClose: () => void;
  onCreated?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(result: BuilderResult) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/companions/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sheet: result.sheet }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error || "Could not create the companion.");
        return;
      }
      onCreated?.();
      onClose();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/70" />
        <Dialog.Content
          className={cn(
            ui.dialog,
            "fixed left-1/2 top-1/2 z-50 max-h-[88dvh] w-[min(48rem,94vw)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto",
          )}
        >
          <div className="mb-3 flex items-center justify-between">
            <Dialog.Title className="flex items-center gap-2 font-display text-lg tracking-wide text-amber-50">
              <Bot className="size-4 text-sky-300" /> Build a companion
            </Dialog.Title>
            <Dialog.Close className="text-stone-500 hover:text-stone-300">
              <X className="size-4" />
            </Dialog.Close>
          </div>
          <p className="mb-3 text-xs text-stone-500">
            This ally joins the party as an AI companion the DM plays. They start at the party&apos;s
            level.
          </p>
          <CharacterBuilder
            fixedLevel={level}
            genre={genre}
            submitLabel="Add companion"
            onSubmit={submit}
            busy={busy}
            error={error}
          />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
