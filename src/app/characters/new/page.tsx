"use client";

import Link from "next/link";
import { useState } from "react";
import { PIXEL_ICONS, PixelTile } from "@/lib/ui";
import CharacterBuilder, { type BuilderResult } from "../builder/CharacterBuilder";

export default function NewCharacterPage() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(result: BuilderResult) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/characters", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(result),
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
    <main className="mx-auto w-full max-w-3xl flex-1 p-6">
      <header className="mb-6">
        <Link href="/characters" className="text-sm text-stone-500 hover:text-stone-300">
          &larr; Back to your characters
        </Link>
        <div className="mt-2 flex items-center gap-3">
          <PixelTile src={PIXEL_ICONS.characters} />
          <h1 className="font-serif text-2xl text-stone-100">Create a character</h1>
        </div>
        <p className="mt-1 text-sm text-stone-400">
          Saved to your library; bring them into any campaign later.
        </p>
      </header>
      <CharacterBuilder submitLabel="Save to library" onSubmit={submit} busy={busy} error={error} />
    </main>
  );
}
