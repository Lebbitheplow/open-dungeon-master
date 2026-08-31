"use client";

import Link from "next/link";
import { useState } from "react";
import { PIXEL_ICONS, PixelTile } from "@/lib/ui";
import CharacterBuilder, { type BuilderResult } from "../builder/CharacterBuilder";

export default function NewCharacterPage() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // The same sheet either way, and the same adaptation on the way into a
  // campaign (src/lib/characters/adapt.ts). What the role decides is which
  // door they come through: a player character joins a table as yours, a
  // companion joins it as an ally the DM plays.
  const [role, setRole] = useState<"pc" | "companion">("pc");

  async function submit(result: BuilderResult) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/characters", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...result, role }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error || "Could not save the character.");
        return;
      }
      window.location.href = "/characters";
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 p-4 sm:p-6">
      <header className="mb-6">
        <Link href="/characters" className="text-sm text-stone-500 hover:text-stone-300">
          &larr; Back to your characters
        </Link>
        <div className="mt-2 flex items-center gap-3">
          <PixelTile src={PIXEL_ICONS.characters} />
          <h1 className="font-display text-2xl tracking-wide text-amber-50">Create a character</h1>
        </div>
        <p className="mt-1 text-sm text-stone-400">
          Saved to your library; bring them into any campaign later.
        </p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {(
            [
              ["pc", "A character I play"],
              ["companion", "An ally the DM plays"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setRole(value)}
              className={
                role === value
                  ? "rounded-md border border-amber-700 bg-amber-950/50 px-2.5 py-1 text-xs text-amber-100"
                  : "rounded-md border border-stone-700 px-2.5 py-1 text-xs text-stone-400 hover:text-stone-200"
              }
            >
              {label}
            </button>
          ))}
        </div>
        {role === "companion" ? (
          <p className="mt-1.5 text-xs text-stone-500">
            Companions are offered when a party adds one, at whatever level that table plays at.
            Nobody has to roll them up again.
          </p>
        ) : null}
      </header>
      <CharacterBuilder submitLabel="Save to library" onSubmit={submit} busy={busy} error={error} />
    </main>
  );
}
