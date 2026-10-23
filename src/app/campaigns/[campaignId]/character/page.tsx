"use client";

import { ChevronLeft } from "lucide-react";
import { GameIcon } from "@/components/ui/GameIcon";
import { PageSkeleton } from "@/components/PageSkeleton";
import { useSearchParams } from "next/navigation";
import { Suspense, use, useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { PIXEL_ICONS, PixelTile, ui } from "@/lib/ui";
import CharacterBuilder, {
  type BuilderResult,
} from "@/app/characters/builder/CharacterBuilder";
import type { Genre } from "@/lib/schemas/game-settings";
import { navigateTo } from "@/lib/navigation";
import { refusalText } from "@/app/characters/builder/refusal";
import { builderDraftKey, clearBuilderDraft } from "@/app/characters/builder/builderDraft";
import { PregenPicker } from "@/app/campaigns/[campaignId]/PregenPicker";
import { HeroChooser, type ChooserCharacter } from "@/app/campaigns/[campaignId]/HeroChooser";
import { JoinConfirmDialog, type JoinHero } from "@/app/campaigns/[campaignId]/JoinConfirmDialog";

// A hero in the player's library, as the chooser lists it.
type LibraryCharacter = ChooserCharacter;

// Join a campaign with a character: pick one on the hero chooser (your
// library adapted to the campaign's starting level, an adventure's pregens,
// the ready-made heroes), confirmed before it seats, or build a new one
// (also saved to your library). "Help me build" opens the builder on its
// quiz, and the hero it makes is confirmed on the same sheet before it
// seats. ?mode=edit reopens the builder prefilled with the current
// character; ?mode=replace swaps it for another (both lobby-only, both
// clearing the ready flag; an edit keeps the existing portrait unless the
// builder's regenerate control cleared it).
function CampaignCharacterPageInner({ campaignId }: { campaignId: string }) {
  // join = first character; edit = rebuild the current one in place;
  // replace = switch to another or a brand-new one.
  const search = useSearchParams();
  const requested = search.get("mode");
  // "Or build a new one" in the lobby comes straight to the builder.
  const startNew = search.get("start") === "new";
  const flow: "join" | "edit" | "replace" =
    requested === "edit" || requested === "replace" ? requested : "join";
  const [level, setLevel] = useState<number | null>(null);
  const [genre, setGenre] = useState<Genre | undefined>(undefined);
  const [worldPackId, setWorldPackId] = useState("");
  const [library, setLibrary] = useState<LibraryCharacter[]>([]);
  // How many of the library's entries are allies the DM plays: they are not
  // offered here, and the page says where they go instead.
  const [companionCount, setCompanionCount] = useState(0);
  const [mode, setMode] = useState<"choose" | "create">(
    flow === "edit" || startNew ? "create" : "choose",
  );
  const [currentLibraryId, setCurrentLibraryId] = useState<string | null>(null);
  // The linked library character's level, from a host that keeps an edit at
  // a table of another level to that table; null from one that does not.
  const [libraryLevel, setLibraryLevel] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // The ready-made heroes, opened from above the builder.
  const [quick, setQuick] = useState(false);
  // The builder was opened by "Help me build": what it makes goes through
  // the confirm sheet (backlog F1 and F6), held here until it seats.
  const [helped, setHelped] = useState(false);
  const [built, setBuilt] = useState<JoinHero | null>(null);

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
        setWorldPackId(campaignData?.campaign?.gameSettings?.worldPack ?? "");
        const all: LibraryCharacter[] = charactersData?.characters ?? [];
        // An ally the DM plays is brought in by whoever runs the story,
        // through the party panel, never as a player's own character; the
        // server refuses the id either way (issue 192).
        const characters = all.filter((character) => character.role !== "companion");
        setLibrary(characters);
        setCompanionCount(all.length - characters.length);
        setCurrentLibraryId(sheetData?.sheet?.libraryCharacterId ?? null);
        setLibraryLevel(typeof sheetData?.libraryLevel === "number" ? sheetData.libraryLevel : null);
        // An empty library still opens on the chooser when joining: the
        // ready-made heroes are there (backlog F5). A switch has nothing to
        // switch to but a new build.
        if (!characters.length && flow === "replace") {
          setMode("create");
        }
      })
      .catch(() => setLevel(1));
    return () => {
      cancelled = true;
    };
  }, [campaignId, flow]);

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
        setError(refusalText(data, "Could not save the character."));
        return;
      }
      // Seated: an unfinished character kept for this table is done with.
      clearBuilderDraft(builderDraftKey("table", campaignId));
      navigateTo(`/campaigns/${campaignId}`);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  // A hero from the chooser has taken its seat (JoinConfirmDialog.tsx).
  function seated() {
    clearBuilderDraft(builderDraftKey("table", campaignId));
    navigateTo(`/campaigns/${campaignId}`);
  }

  function submitNew(result: BuilderResult) {
    if (helped && flow !== "edit") {
      setBuilt({ kind: "built", id: String(Date.now()), name: result.sheet.name, sheet: result.sheet });
      return;
    }
    if (flow === "edit" && editCharacter) {
      send({ editLibraryCharacterId: editCharacter.id, sheet: result.sheet }, "PUT");
      return;
    }
    send(result.sheet, flow === "join" ? "POST" : "PUT");
  }

  if (level === null) {
    return (
      <main className="mx-auto w-full max-w-3xl flex-1 p-4 sm:p-6">
        <PageSkeleton kind="flat" className="px-0 py-2" />
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 p-4 sm:p-6">
      <header className="mb-5">
        <a href={`/campaigns/${campaignId}`} className={cn(ui.btnSmall, "text-xs")}>
          <ChevronLeft className="size-3.5" /> Back to the lobby
        </a>
        <div className="mt-2 flex items-center gap-3">
          <PixelTile src={PIXEL_ICONS.characters} />
          <div>
            <h1 className="gold-title font-display text-2xl">
              {flow === "edit"
                ? "Edit your character"
                : flow === "replace"
                  ? "Switch your character"
                  : mode === "choose"
                    ? "Choose your character"
                    : "Create your character"}
            </h1>
            <p className="text-sm text-stone-400">
              This campaign starts at level {level}.
              {flow !== "join" ? " Changing your character clears your ready status." : ""}
            </p>
            {flow === "edit" && editCharacter && libraryLevel !== null && libraryLevel !== level ? (
              <p className="reveal mt-1 text-xs text-amber-200">
                {editCharacter.name} stays level {libraryLevel} in your library; these changes are for this table.
              </p>
            ) : null}
          </div>
        </div>
      </header>

      {mode === "choose" ? (
        <>
          {companionCount > 0 ? (
            <p className="reveal mb-4 text-xs text-stone-400">
              {companionCount === 1 ? "One ally the DM plays is" : `${companionCount} allies the DM plays are`} not listed here: whoever runs the story brings them in from the party panel, under Build a companion.
            </p>
          ) : null}
          {/* Every hero this seat can take, on one screen, each through the
              confirm sheet before it seats (backlog F5 and F6). */}
          <HeroChooser
            campaignId={campaignId}
            flow={flow === "replace" ? "replace" : "join"}
            level={level}
            characters={library}
            genre={genre}
            worldPackId={worldPackId}
            currentLibraryId={currentLibraryId}
            onBuildNew={() => {
              setHelped(false);
              setMode("create");
            }}
            onHelpMeBuild={() => {
              setHelped(true);
              setMode("create");
            }}
            onSeated={seated}
          />
        </>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            {flow !== "edit" ? (
              <button type="button" onClick={() => setMode("choose")} className={ui.btnSmall}>
                <ChevronLeft className="size-3.5" /> Back to every hero
              </button>
            ) : null}
            {/* Building is the long way to a seat: the short one stays a tap
                away for someone who came here by default. */}
            {flow === "join" ? (
              <button
                type="button"
                onClick={() => setQuick(!quick)}
                aria-expanded={quick}
                className={ui.btnSmall}
              >
                <GameIcon icon={{ kind: "glyph", key: "ui-quickstart" }} size="size-5" /> In a hurry? Take a ready-made hero
              </button>
            ) : null}
          </div>
          {flow === "join" && quick ? (
            <div key="quick" className="reveal-height mb-4">
              <PregenPicker campaignId={campaignId} heading={null} onSeated={() => navigateTo(`/campaigns/${campaignId}`)} />
            </div>
          ) : null}
          <CharacterBuilder
            campaignId={campaignId}
            fixedLevel={level}
            genre={genre}
            worldPackId={worldPackId}
            initial={flow === "edit" ? editCharacter?.sheet : undefined}
            initialLevel={flow === "edit" ? editCharacter?.level : undefined}
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
            draftKey={flow === "edit" ? undefined : builderDraftKey("table", campaignId)}
            onCancel={() => navigateTo(`/campaigns/${campaignId}`)}
            openQuiz={helped}
          />
          <JoinConfirmDialog
            campaignId={campaignId}
            hero={built}
            flow={flow === "replace" ? "replace" : "join"}
            onClose={() => setBuilt(null)}
            onSeated={seated}
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
          <PageSkeleton kind="flat" className="px-0 py-2" />
        </main>
      }
    >
      <CampaignCharacterPageInner campaignId={campaignId} />
    </Suspense>
  );
}
