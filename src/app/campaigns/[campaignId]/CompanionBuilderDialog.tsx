"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { Bot, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
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
  // Companions filed in this user's own library. An ally worth writing once
  // is worth using twice, and the level adaptation that makes that safe is
  // the same one player characters go through (src/lib/characters/adapt.ts).
  const [library, setLibrary] = useState<Array<{ id: string; name: string; level: number; class: string }>>([]);

  // The state lands in a .then callback rather than after an await, so the
  // fetch reads as "subscribe to an external system" to React and to the
  // effect linter, which is what it is.
  const loadLibrary = useCallback(
    () =>
      fetch("/api/characters?role=companion")
        .then((response) => (response.ok ? response.json() : null))
        .then((data) => setLibrary(data?.characters ?? []))
        .catch(() => {
          // An empty library is a valid state; the section explains itself.
        }),
    [],
  );

  useEffect(() => {
    void loadLibrary();
  }, [loadLibrary]);

  async function post(body: Record<string, unknown>) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/companions/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
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

  async function submit(result: BuilderResult) {
    await post({ sheet: result.sheet });
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

          {library.length ? (
            <div className="mb-4 space-y-1.5 rounded-lg border border-stone-800 bg-stone-950/40 px-2.5 py-2">
              <p className="text-[11px] uppercase tracking-wide text-stone-500">
                From your library
              </p>
              <div className="flex flex-wrap gap-1">
                {library.map((companion) => (
                  <button
                    key={companion.id}
                    type="button"
                    disabled={busy}
                    onClick={() => void post({ libraryCharacterId: companion.id })}
                    className="rounded-md border border-stone-700 px-2 py-1 text-xs text-stone-300 hover:bg-stone-900 disabled:opacity-50"
                  >
                    {companion.name}
                    <span className="ml-1 text-stone-600">level {companion.level}</span>
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-stone-600">
                They arrive at level {level}, adapted the same way a player character is.
              </p>
            </div>
          ) : null}
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
