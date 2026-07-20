"use client";

import { Loader2, Plus, UserRound } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense, use, useEffect, useState } from "react";
import { IconChip, PIXEL_ICONS, PixelTile } from "@/lib/ui";
import CharacterBuilder, {
  type BuilderResult,
} from "@/app/characters/builder/CharacterBuilder";
import type { Genre } from "@/lib/schemas/game-settings";
import type { CreateSheetInput } from "@/lib/schemas/sheet";

type LibraryCharacter = {
  id: string;
  name: string;
  race: string;
  class: string;
  subclass: string;
  level: number;
  sheet?: CreateSheetInput;
};

function titleCase(value: string) {
  return value.replace(/[-_]/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

// Join a campaign with a character: pick one from your library (adapted to
// the campaign's starting level) or build a new one (also saved to your
// library). ?mode=edit reopens the builder prefilled with the current
// character; ?mode=replace swaps it for another (both lobby-only, both
// clearing the ready flag; editing re-renders the portrait).
function CampaignCharacterPageInner({ campaignId }: { campaignId: string }) {
  // join = first character; edit = rebuild the current one in place;
  // replace = switch to another or a brand-new one.
  const requested = useSearchParams().get("mode");
  const flow: "join" | "edit" | "replace" =
    requested === "edit" || requested === "replace" ? requested : "join";
  const [level, setLevel] = useState<number | null>(null);
  const [genre, setGenre] = useState<Genre | undefined>(undefined);
  const [library, setLibrary] = useState<LibraryCharacter[]>([]);
  const [mode, setMode] = useState<"choose" | "create">(
    flow === "edit" ? "create" : "choose",
  );
  const [currentLibraryId, setCurrentLibraryId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch(`/api/campaigns/${campaignId}`).then((response) =>
        response.ok ? response.json() : null,
      ),
      fetch("/api/characters").then((response) => (response.ok ? response.json() : null)),
      fetch(`/api/campaigns/${campaignId}/sheet`).then((response) =>
        response.ok ? response.json() : null,
      ),
    ])
      .then(([campaignData, charactersData, sheetData]) => {
        if (cancelled) {
          return;
        }
        setLevel(campaignData?.campaign?.startingLevel ?? 1);
        setGenre(campaignData?.campaign?.gameSettings?.genre ?? undefined);
        const characters = charactersData?.characters ?? [];
        setLibrary(characters);
        setCurrentLibraryId(sheetData?.sheet?.libraryCharacterId ?? null);
        if (!characters.length) {
          setMode("create");
        }
      })
      .catch(() => setLevel(1));
    return () => {
      cancelled = true;
    };
  }, [campaignId]);

  const editCharacter =
    flow === "edit" && currentLibraryId
      ? (library.find((character) => character.id === currentLibraryId) ?? null)
      : null;

  async function send(body: unknown, method: "POST" | "PUT") {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/sheet`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error || "Could not save the character.");
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
    send({ libraryCharacterId: characterId }, flow === "join" ? "POST" : "PUT");
  }

  function submitNew(result: BuilderResult) {
    if (flow === "edit" && editCharacter) {
      send({ editLibraryCharacterId: editCharacter.id, sheet: result.sheet }, "PUT");
      return;
    }
    send(result.sheet, flow === "join" ? "POST" : "PUT");
  }

  if (level === null) {
    return (
      <main className="mx-auto w-full max-w-3xl flex-1 p-4 sm:p-6">
        <div className="flex justify-center py-10">
          <Loader2 className="size-5 animate-spin text-stone-500" />
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 p-4 sm:p-6">
      <header className="mb-6">
        <a href={`/campaigns/${campaignId}`} className="text-sm text-stone-500 hover:text-stone-300">
          &larr; Back to the lobby
        </a>
        <div className="mt-2 flex items-center gap-3">
          <PixelTile src={PIXEL_ICONS.characters} />
          <h1 className="font-display text-2xl tracking-wide text-amber-50">
            {flow === "edit"
              ? "Edit your character"
              : flow === "replace"
                ? "Switch your character"
                : mode === "choose"
                  ? "Choose your character"
                  : "Create your character"}
          </h1>
        </div>
        <p className="mt-1 text-sm text-stone-400">
          This campaign starts at level {level}.
          {flow !== "join"
            ? " Changing your character clears your ready status, and edits repaint the portrait."
            : ""}
        </p>
      </header>

      {mode === "choose" ? (
        <section className="space-y-4">
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {library.map((character) => (
              <li key={character.id}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => pickFromLibrary(character.id)}
                  className="w-full rounded-lg border border-stone-800 bg-stone-950/70 p-4 text-left transition hover:border-amber-800/60 hover:bg-stone-900/70 disabled:opacity-50"
                >
                  <div className="flex items-center gap-2">
                    {character.sheet?.portrait?.url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={character.sheet.portrait.url}
                        alt={character.name}
                        className="size-8 shrink-0 rounded-lg border border-amber-500/30 object-cover"
                      />
                    ) : (
                      <IconChip icon={UserRound} size="size-8" iconSize="size-4" />
                    )}
                    <span className="font-medium text-stone-100">{character.name}</span>
                    {character.id === currentLibraryId ? (
                      <span className="rounded-full bg-amber-950 px-2 py-0.5 text-xs text-amber-300">
                        current
                      </span>
                    ) : null}
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
            genre={genre}
            initial={flow === "edit" ? editCharacter?.sheet : undefined}
            submitLabel={
              flow === "edit"
                ? "Save changes"
                : flow === "replace"
                  ? "Replace your character"
                  : "Join the party"
            }
            onSubmit={submitNew}
            busy={busy}
            error={error}
          />
        </>
      )}
    </main>
  );
}

// useSearchParams needs a Suspense boundary during prerender in Next 16.
export default function CampaignCharacterPage({
  params,
}: {
  params: Promise<{ campaignId: string }>;
}) {
  const { campaignId } = use(params);
  return (
    <Suspense
      fallback={
        <main className="mx-auto w-full max-w-3xl flex-1 p-4 sm:p-6">
          <div className="flex justify-center py-10">
            <Loader2 className="size-5 animate-spin text-stone-500" />
          </div>
        </main>
      }
    >
      <CampaignCharacterPageInner campaignId={campaignId} />
    </Suspense>
  );
}
