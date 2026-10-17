"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { PageSkeleton } from "@/components/PageSkeleton";
import { GoldTitle } from "@/components/ui/GoldTitle";
import { PIXEL_ICONS, PixelTile } from "@/lib/ui";
import CharacterBuilder, { type BuilderResult } from "../builder/CharacterBuilder";
import { navigateTo } from "@/lib/navigation";
import { refusalText } from "@/app/characters/builder/refusal";
import { builderDraftKey, clearBuilderDraft } from "@/app/characters/builder/builderDraft";
import { readBuilderDoor } from "@/app/characters/builder/door";

const DRAFT_KEY = builderDraftKey("library");

function NewCharacterInner() {
  // What the link that opened the builder already decided (door.ts): it is
  // set here and not asked again.
  const door = readBuilderDoor(useSearchParams());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // The same sheet either way, and the same adaptation on the way into a
  // campaign (src/lib/characters/adapt.ts). What the role decides is which
  // door they come through: a player character joins a table as yours, a
  // companion joins it as an ally the DM plays. A new character starts as
  // a player character; the Finish step holds the toggle, unless the door
  // already said which.
  const [role, setRole] = useState<"pc" | "companion">(door.role ?? "pc");

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
        setError(refusalText(data, "Could not save the character."));
        return;
      }
      clearBuilderDraft(DRAFT_KEY);
      navigateTo("/characters");
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 p-4 sm:p-6">
      <header className="mb-5">
        <Link href="/characters" className="text-sm text-stone-500 hover:text-stone-300">
          &larr; Back to your characters
        </Link>
        <div className="mt-2 flex items-center gap-3">
          <PixelTile src={PIXEL_ICONS.characters} />
          <div>
            <GoldTitle size="text-2xl">Create a character</GoldTitle>
            <p className="text-sm text-stone-400">
              Saved to your library; bring them into any campaign later.
            </p>
          </div>
        </div>
      </header>
      <CharacterBuilder
        submitLabel="Save to library"
        onSubmit={submit}
        busy={busy}
        error={error}
        role={door.role ? undefined : { value: role, onChange: setRole }}
        startLevel={door.level}
        levelNote={door.levelNote}
        draftKey={DRAFT_KEY}
        onCancel={() => navigateTo("/characters")}
      />
    </main>
  );
}

// useSearchParams needs a Suspense boundary during prerender in Next 16.
export default function NewCharacterPage() {
  return (
    <Suspense
      fallback={
        <main className="mx-auto w-full max-w-3xl flex-1 p-4 sm:p-6">
          <PageSkeleton kind="flat" className="px-0 py-2" />
        </main>
      }
    >
      <NewCharacterInner />
    </Suspense>
  );
}
