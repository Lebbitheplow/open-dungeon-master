"use client";

import { Loader2, Plus, UserRound } from "lucide-react";
import { use, useEffect, useState } from "react";
import { IconChip, PIXEL_ICONS, PixelTile } from "@/lib/ui";
import CharacterBuilder, {
  type BuilderResult,
} from "@/app/characters/builder/CharacterBuilder";

type LibraryCharacter = {
  id: string;
  name: string;
  race: string;
  class: string;
  subclass: string;
  level: number;
};

function titleCase(value: string) {
  return value.replace(/[-_]/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

// Join a campaign with a character: pick one from your library (adapted to
// the campaign's starting level) or build a new one (also saved to your
// library).
export default function CampaignCharacterPage({
  params,
}: {
  params: Promise<{ campaignId: string }>;
}) {
  const { campaignId } = use(params);
  const [level, setLevel] = useState<number | null>(null);
  const [library, setLibrary] = useState<LibraryCharacter[]>([]);
  const [mode, setMode] = useState<"choose" | "create">("choose");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch(`/api/campaigns/${campaignId}`).then((response) =>
        response.ok ? response.json() : null,
      ),
      fetch("/api/characters").then((response) => (response.ok ? response.json() : null)),
    ])
      .then(([campaignData, charactersData]) => {
        if (cancelled) {
          return;
        }
        setLevel(campaignData?.campaign?.startingLevel ?? 1);
        const characters = charactersData?.characters ?? [];
        setLibrary(characters);
        if (!characters.length) {
          setMode("create");
        }
      })
      .catch(() => setLevel(1));
    return () => {
      cancelled = true;
    };
  }, [campaignId]);

  async function post(body: unknown) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/sheet`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error || "Could not create the character.");
        return;
      }
      window.location.assign(`/campaigns/${campaignId}`);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  function pickFromLibrary(characterId: string) {
    post({ libraryCharacterId: characterId });
  }

  function submitNew(result: BuilderResult) {
    post(result.sheet);
  }

  if (level === null) {
    return (
      <main className="mx-auto w-full max-w-3xl flex-1 p-6">
        <div className="flex justify-center py-10">
          <Loader2 className="size-5 animate-spin text-stone-500" />
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 p-6">
      <header className="mb-6">
        <a href={`/campaigns/${campaignId}`} className="text-sm text-stone-500 hover:text-stone-300">
          &larr; Back to the lobby
        </a>
        <div className="mt-2 flex items-center gap-3">
          <PixelTile src={PIXEL_ICONS.characters} />
          <h1 className="font-display text-2xl tracking-wide text-amber-50">
            {mode === "choose" ? "Choose your character" : "Create your character"}
          </h1>
        </div>
        <p className="mt-1 text-sm text-stone-400">
          This campaign starts at level {level}.
        </p>
      </header>

      {mode === "choose" ? (
        <section className="space-y-4">
          <ul className="grid gap-3 sm:grid-cols-2">
            {library.map((character) => (
              <li key={character.id}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => pickFromLibrary(character.id)}
                  className="w-full rounded-lg border border-stone-800 bg-stone-950/70 p-4 text-left transition hover:border-amber-800/60 hover:bg-stone-900/70 disabled:opacity-50"
                >
                  <div className="flex items-center gap-2">
                    <IconChip icon={UserRound} size="size-8" iconSize="size-4" />
                    <span className="font-medium text-stone-100">{character.name}</span>
                  </div>
                  <p className="mt-1 text-sm text-stone-400">
                    Level {character.level} {titleCase(character.race)}{" "}
                    {titleCase(character.class)}
                    {character.subclass ? ` (${character.subclass})` : ""}
                  </p>
                  {character.level !== level ? (
                    <p className="mt-1 text-xs text-amber-200">
                      Will be adapted to level {level}
                    </p>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => setMode("create")}
            className="flex w-full items-center justify-center gap-2 rounded-md border border-dashed border-stone-700 px-3 py-3 text-sm text-stone-300 hover:border-stone-500 hover:bg-stone-900"
          >
            <Plus className="size-4" /> Create a new character instead
          </button>
          {error ? <p className="text-sm text-red-400">{error}</p> : null}
        </section>
      ) : (
        <>
          {library.length ? (
            <button
              type="button"
              onClick={() => setMode("choose")}
              className="mb-4 text-sm text-amber-200 hover:text-amber-400"
            >
              &larr; Or pick one from your library
            </button>
          ) : null}
          <CharacterBuilder
            fixedLevel={level}
            submitLabel="Join the party"
            onSubmit={submitNew}
            busy={busy}
            error={error}
          />
        </>
      )}
    </main>
  );
}
