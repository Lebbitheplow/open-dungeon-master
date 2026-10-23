"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, use, useEffect, useState } from "react";
import { PageSkeleton } from "@/components/PageSkeleton";
import { appConfirm } from "@/components/ui/ConfirmDialog";
import { GoldTitle } from "@/components/ui/GoldTitle";
import { cn } from "@/lib/cn";
import { navigateTo } from "@/lib/navigation";
import type { CreateSheetInput } from "@/lib/schemas/sheet";
import { PIXEL_ICONS, PixelTile, ui } from "@/lib/ui";
import CharacterBuilder, { type BuilderResult } from "@/app/characters/builder/CharacterBuilder";
import type { BuilderRole } from "@/app/characters/builder/steps/FinishStep";
import { refusalText } from "@/app/characters/builder/refusal";

type LibraryCharacter = {
  id: string;
  name: string;
  role?: BuilderRole;
  level: number;
  campaigns?: Array<{ campaignId: string; title: string }>;
  sheet: CreateSheetInput;
};

// The library's own build editor (issue 229): the creation wizard opened on
// a stored character, its level and every choice prefilled, saved back to the
// same library entry through the same rules check creation uses. A campaign
// copy is the table's: it keeps its own sheet, and the page says so.
// ?copyOf=<id> is "Duplicate and edit": the entry is the fresh copy, and the
// original it came from is named and left alone.
function EditCharacterInner({ characterId }: { characterId: string }) {
  const search = useSearchParams();
  const copyOf = search.get("copyOf") ?? "";
  // "Level up" on the character's page: the build opens one level up.
  const levelUp = search.get("levelUp") === "1";
  const [character, setCharacter] = useState<LibraryCharacter | null>(null);
  const [sourceName, setSourceName] = useState("");
  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState<BuilderRole>("pc");
  const [busy, setBusy] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch(`/api/characters/${characterId}`).then((response) => (response.ok ? response.json() : null)),
      copyOf
        ? fetch(`/api/characters/${copyOf}`).then((response) => (response.ok ? response.json() : null))
        : Promise.resolve(null),
    ])
      .then(([data, source]) => {
        if (cancelled) {
          return;
        }
        if (data?.character) {
          setCharacter(data.character);
          setRole(data.character.role === "companion" ? "companion" : "pc");
        }
        setSourceName(source?.character?.name ?? "");
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [characterId, copyOf]);

  const tables = character?.campaigns ?? [];
  const nextLevel = character && levelUp && character.level < 20 ? character.level + 1 : null;
  // Who plays them is settled once a table holds a copy: that copy came in
  // through the door its role opened (the server holds the same line).
  const roleEditable = tables.length === 0;

  async function save(result: BuilderResult) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/characters/${characterId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          level: result.level,
          sheet: result.sheet,
          ...(roleEditable ? { role } : {}),
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        // Refused whole: the stored character is as it was.
        setError(refusalText(data, "Could not save the character."));
        return;
      }
      navigateTo(`/characters/${characterId}`);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  // The copy was made when Duplicate and edit was pressed; leaving it
  // unwanted takes it away again and goes back to the original.
  async function discardCopy() {
    if (!character || !(await appConfirm(`Delete ${character.name}? ${sourceName || "The original"} stays as it is.`))) {
      return;
    }
    setDiscarding(true);
    setError("");
    try {
      const response = await fetch(`/api/characters/${characterId}`, { method: "DELETE" }).catch(() => null);
      if (!response?.ok) {
        setError(`${character.name} was not deleted. Check the connection and try again.`);
        return;
      }
      navigateTo(copyOf ? `/characters/${copyOf}` : "/characters");
    } finally {
      setDiscarding(false);
    }
  }

  if (loading) {
    return (
      <main className="mx-auto w-full max-w-3xl flex-1 p-4 sm:p-6">
        <PageSkeleton kind="flat" className="px-0 py-2" />
      </main>
    );
  }

  if (!character) {
    return (
      <main className="mx-auto w-full max-w-3xl flex-1 p-4 sm:p-6">
        <div className={cn(ui.card, "ornate texture-noise flex flex-col items-center gap-3 px-6 py-8 text-center")}>
          <p className="font-serif text-sm text-stone-300">Character not found.</p>
          <Link href="/characters" className={ui.btnSecondary}>
            Back to your library
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 p-4 sm:p-6">
      <header className="mb-5">
        <Link
          href={`/characters/${characterId}`}
          className="-my-1 inline-flex min-h-10 items-center gap-1.5 text-sm text-stone-400 hover:text-amber-200"
        >
          <ArrowLeft className="size-4" /> Back without saving
        </Link>
        <div className="mt-2 flex items-center gap-3">
          <PixelTile src={PIXEL_ICONS.characters} />
          <div className="min-w-0">
            <GoldTitle size="text-2xl">
              {nextLevel ? `${character.name} reaches level ${nextLevel}` : `Edit ${character.name}`}
            </GoldTitle>
            <p className="text-sm text-stone-400">
              Saved to your library. Every campaign you bring them to from now on starts from this build.
            </p>
          </div>
        </div>
        {nextLevel ? (
          <p className="reveal mt-3 rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-xs text-amber-100">
            The build opens at level {nextLevel}, on its summary. Hit points come with the level; anything it lets{" "}
            {character.name} choose (an ability score improvement, a subclass, new spells) is listed there as still
            to choose, with a Fix that goes to it. Save changes takes the build once nothing is owed.
          </p>
        ) : null}
        {copyOf ? (
          <div className="reveal mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2">
            <p className="min-w-0 flex-1 text-xs text-amber-100">
              A separate copy of {sourceName || "the original"}. Saving changes this copy only; {sourceName || "the original"} stays as it is.
            </p>
            <button
              type="button"
              onClick={() => void discardCopy()}
              disabled={discarding || busy}
              className={cn(ui.btnSmall, "text-xs")}
            >
              {discarding ? "Deleting..." : "Discard this copy"}
            </button>
          </div>
        ) : null}
        {tables.length ? (
          <p className="reveal mt-3 rounded-lg border border-stone-700/60 bg-stone-900/60 px-3 py-2 text-xs text-stone-300">
            The copies already at {tables.map((table) => table.title).join(", ")} keep their own sheets; this edit does not
            reach them. When one of those tables saves its progress to your library (Save to library, or the end of its
            campaign), what it carries back is written over this edit. While a table holds a copy, they stay{" "}
            {character.role === "companion" ? "an ally the DM plays" : "a character you play"}.
          </p>
        ) : null}
      </header>
      <CharacterBuilder
        // The builder takes its level once, as it mounts: a move between the
        // edit and its level-up (?levelUp=1) is the same page, so it starts
        // afresh at the level asked for.
        key={nextLevel ?? "stored"}
        initial={character.sheet}
        initialLevel={character.level}
        startLevel={nextLevel ?? undefined}
        submitLabel="Save changes"
        onSubmit={(result) => void save(result)}
        busy={busy}
        error={error}
        role={roleEditable ? { value: role, onChange: setRole } : undefined}
        onCancel={() => navigateTo(`/characters/${characterId}`)}
      />
    </main>
  );
}

// useSearchParams needs a Suspense boundary during prerender in Next 16.
export default function EditCharacterPage({ params }: { params: Promise<{ characterId: string }> }) {
  const { characterId } = use(params);
  return (
    <Suspense
      fallback={
        <main className="mx-auto w-full max-w-3xl flex-1 p-4 sm:p-6">
          <PageSkeleton kind="flat" className="px-0 py-2" />
        </main>
      }
    >
      <EditCharacterInner characterId={characterId} />
    </Suspense>
  );
}
