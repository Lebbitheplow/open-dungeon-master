"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { Bot, Users, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import CharacterBuilder, {
  type BuilderResult,
} from "@/app/characters/builder/CharacterBuilder";
import type { Genre } from "@/lib/schemas/game-settings";
import type { CreateSheetInput } from "@/lib/schemas/sheet";
import { refusalText } from "@/app/characters/builder/refusal";
import { builderDraftKey, clearBuilderDraft } from "@/app/characters/builder/builderDraft";

// Whoever steers the story (the party lead in an AI campaign, the DM in a
// human-run one) builds a lasting companion with the full character creator.
// The finished sheet POSTs to /companions/create, which owns it with a bot
// user and, mid-session, nudges the DM to write them in.
export function CompanionBuilderDialog({
  campaignId,
  genre,
  worldPackId,
  level,
  humanDm = false,
  onClose,
  onCreated,
}: {
  campaignId: string;
  genre?: Genre;
  // The table's world pack, so the ally is built from the same peoples and
  // callings, under the same names, the players see on the join page.
  worldPackId?: string;
  level: number;
  // A person is running this table, so the ally is theirs to play through the
  // DM console rather than an AI's to voice. Only the sentence below changes;
  // the sheet is the same object either way.
  humanDm?: boolean;
  onClose: () => void;
  onCreated?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Companions filed in this user's own library. An ally worth writing once
  // is worth using twice, and the level adaptation that makes that safe is
  // the same one player characters go through (src/lib/characters/adapt.ts).
  const [library, setLibrary] = useState<Array<{ id: string; name: string; level: number; class: string }>>([]);
  // A library companion opened in the builder to change before it joins.
  // What is built from it is a new sheet for this table; the library copy
  // stays as it was.
  const [tweaking, setTweaking] = useState<{ id: string; sheet: CreateSheetInput; level: number } | null>(null);
  const [opening, setOpening] = useState("");
  // The library companion waiting on "Add to the party?". A tap on a name
  // used to seat them at once, and a stray tap is not a decision.
  const [confirming, setConfirming] = useState<string | null>(null);
  const pending = library.find((companion) => companion.id === confirming) ?? null;

  async function tweak(id: string) {
    setOpening(id);
    setConfirming(null);
    setError("");
    try {
      const response = await fetch(`/api/characters/${encodeURIComponent(id)}`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data?.character?.sheet) {
        setError(refusalText(data, "Could not open that companion."));
        return;
      }
      setTweaking({ id, sheet: data.character.sheet, level: data.character.level });
    } catch {
      setError("Could not reach the server.");
    } finally {
      setOpening("");
    }
  }

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
        setError(refusalText(data, "Could not create the companion."));
        return;
      }
      clearBuilderDraft(builderDraftKey("companion", campaignId));
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
        <Dialog.Overlay className="dialog-overlay fixed inset-0 z-50 bg-[#05030d]/70 backdrop-blur-sm" />
        {/* Full screen on a phone, as the join page's builder is: the
            builder's steps need the whole height, and a card floating in a
            margin wasted it. From a tablet up, the centred card as before. */}
        <Dialog.Content
          data-companion-builder=""
          className={cn(
            ui.dialog,
            "fixed inset-0 z-50 h-dvh w-full overflow-y-auto rounded-none border-0 pb-[max(1.25rem,env(safe-area-inset-bottom))]",
            "sm:inset-auto sm:left-1/2 sm:top-1/2 sm:h-auto sm:max-h-[88dvh] sm:w-[min(48rem,94vw)] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl sm:border",
          )}
        >
          <div className="mb-3 flex items-center justify-between">
            <Dialog.Title className="flex items-center gap-2 font-display text-lg tracking-wide text-amber-50">
              {humanDm ? (
                <Users className="size-4 text-sky-300" />
              ) : (
                <Bot className="size-4 text-sky-300" />
              )}{" "}
              Build a companion
            </Dialog.Title>
            <Dialog.Close aria-label="Close" className="-m-2 p-2 text-stone-500 hover:text-stone-300">
              <X className="size-5 sm:size-4" aria-hidden="true" />
            </Dialog.Close>
          </div>
          <p className="mb-3 text-xs text-stone-500">
            {humanDm
              ? "This ally joins the party as a character you play from the DM console. In combat their turn waits for you: act for them, then end the turn. They start at the party's level."
              : "This ally joins the party as an AI companion the DM plays. They start at the party's level."}
          </p>

          {library.length && !tweaking ? (
            <div className="reveal mb-4 space-y-1.5 rounded-lg border border-stone-800 bg-stone-950/40 px-2.5 py-2">
              <p className="text-[11px] uppercase tracking-wide text-stone-500">
                From your library
              </p>
              <div className="stagger-pop flex flex-wrap gap-1">
                {library.map((companion) => (
                  <span key={companion.id} className="inline-flex overflow-hidden rounded-md border border-stone-700">
                    <button
                      type="button"
                      disabled={busy || Boolean(opening)}
                      aria-pressed={confirming === companion.id}
                      onClick={() => setConfirming(confirming === companion.id ? null : companion.id)}
                      className="px-2 py-1 text-xs text-stone-300 hover:bg-stone-900 disabled:opacity-50 aria-pressed:bg-stone-900"
                    >
                      {companion.name}
                      <span className="ml-1 text-stone-600">level {companion.level}</span>
                    </button>
                    <button
                      type="button"
                      disabled={busy || Boolean(opening)}
                      aria-busy={opening === companion.id}
                      aria-label={`Change ${companion.name} before adding`}
                      onClick={() => void tweak(companion.id)}
                      className="border-l border-stone-700 px-2 py-1 text-xs text-stone-400 hover:bg-stone-900 hover:text-stone-200 disabled:opacity-50"
                    >
                      Change first
                    </button>
                  </span>
                ))}
              </div>
              {pending ? (
                <div role="group" aria-label={`Add ${pending.name}`} className="reveal flex flex-wrap items-center gap-2 rounded-md border border-sky-500/30 bg-sky-500/5 px-2.5 py-2">
                  <p className="min-w-0 flex-1 text-xs text-stone-300">
                    Add {pending.name} to the party at level {level}?
                  </p>
                  <button type="button" onClick={() => setConfirming(null)} disabled={busy} className={ui.btnSmall}>
                    Not yet
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    aria-busy={busy}
                    onClick={() => void post({ libraryCharacterId: pending.id })}
                    className={cn(ui.btnSmall, "border-sky-500/50 text-sky-100")}
                  >
                    Add {pending.name}
                  </button>
                  {/* The builder shows its error on its last step; a refused
                      add from here is said here, where it was asked for. */}
                  {error ? (
                    <p role="alert" className="w-full text-xs text-red-400">
                      {error}
                    </p>
                  ) : null}
                </div>
              ) : null}
              <p className="text-[10px] text-stone-600">
                They arrive at level {level}, adapted the same way a player character is. Change first
                opens one in the builder; your library copy stays as it is.
              </p>
            </div>
          ) : null}
          {tweaking ? (
            <button type="button" onClick={() => setTweaking(null)} className={cn(ui.btnSmall, "mb-3")}>
              Build a new one instead
            </button>
          ) : null}
          <CharacterBuilder
            // A fresh builder for each start, so one companion's picks never
            // carry into a new build or another companion's.
            key={tweaking?.id ?? "new"}
            campaignId={campaignId}
            fixedLevel={level}
            genre={genre}
            worldPackId={worldPackId}
            initial={tweaking?.sheet}
            initialLevel={tweaking?.level}
            // A companion built from scratch is kept on this device until it
            // is added, so an Escape or a stray click on the overlay costs
            // nothing; one changed from the library is not.
            draftKey={tweaking ? undefined : builderDraftKey("companion", campaignId)}
            submitLabel="Add companion"
            onSubmit={submit}
            busy={busy}
            error={error}
            onCancel={onClose}
          />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
