"use client";

import { EmptyState } from "@/components/EmptyState";
import { appConfirm } from "@/components/ui/ConfirmDialog";
import { PageSkeleton } from "@/components/PageSkeleton";

import { FileUp, Loader2, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ContextMenu, type ContextMenuItem } from "@/components/ui/ContextMenu";
import { AvatarCropDialog } from "@/app/settings/AvatarCropDialog";
import { AppHeader } from "@/components/AppHeader";
import { KebabMenu } from "@/components/KebabMenu";
import { GameIcon } from "@/components/ui/GameIcon";
import { Ribbon } from "@/components/ui/Ribbon";
import { cn } from "@/lib/cn";
import { CharacterPortrait, ui } from "@/lib/ui";

// Where a character is playing. A library character is a template and each
// campaign holds its own copy, so one entry can be at several tables at once
// (src/lib/db/characters.ts).
type CharacterAssignment = {
  campaignId: string;
  title: string;
  kind: "campaign" | "workshop";
  status: string;
};

type LibraryCharacter = {
  id: string;
  name: string;
  race: string;
  class: string;
  subclass: string;
  background: string;
  level: number;
  updatedAt: string;
  portraitStatus?: "queued" | "generating" | "failed" | null;
  campaigns?: CharacterAssignment[];
  sheet?: { portrait?: { url: string } | null; gender?: string };
};

function portraitPending(character: LibraryCharacter) {
  return character.portraitStatus === "queued" || character.portraitStatus === "generating";
}

// Matches the ComfyUI generation timeout; polling stops even if the server
// never resolves the job.
const PORTRAIT_POLL_LIMIT = 240;

function titleCase(value: string) {
  return value.replace(/[-_]/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export default function CharactersPage() {
  const [characters, setCharacters] = useState<LibraryCharacter[]>([]);
  const [loading, setLoading] = useState(true);
  const [authed, setAuthed] = useState(true);
  const [croppingId, setCroppingId] = useState("");
  const [cloningId, setCloningId] = useState("");
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState("");
  const cropping = characters.find((character) => character.id === croppingId);
  const pollCount = useRef(0);
  const importInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/characters")
      .then((response) => {
        if (response.status === 401) {
          setAuthed(false);
          return null;
        }
        return response.ok ? response.json() : null;
      })
      .then((data) => {
        if (data?.characters) {
          setCharacters(data.characters);
        }
      })
      .finally(() => setLoading(false));
  }, []);

  // While a portrait renders in the background, re-fetch until it lands (or
  // fails); the finished image then appears without a reload.
  useEffect(() => {
    if (!characters.some(portraitPending) || pollCount.current >= PORTRAIT_POLL_LIMIT) {
      return;
    }
    const id = setTimeout(() => {
      pollCount.current += 1;
      fetch("/api/characters")
        .then((response) => (response.ok ? response.json() : null))
        .then((data) => {
          if (data?.characters) {
            setCharacters(data.characters);
          }
        });
    }, 2500);
    return () => clearTimeout(id);
  }, [characters]);

  async function setPortrait(id: string, url: string) {
    const response = await fetch(`/api/characters/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ portrait: { url } }),
    });
    if (response.ok) {
      setCharacters((current) =>
        current.map((character) =>
          character.id === id
            ? { ...character, sheet: { ...character.sheet, portrait: { url } } }
            : character,
        ),
      );
    }
  }

  // A second copy under a numbered name, sheet and portrait verbatim. The
  // copy belongs to no campaign, which is why it starts with no assignments.
  async function duplicate(id: string) {
    setCloningId(id);
    try {
      const response = await fetch(`/api/characters/${id}/clone`, { method: "POST" });
      if (!response.ok) {
        return;
      }
      const data = await response.json().catch(() => ({}));
      if (data.character) {
        setCharacters((current) => [data.character, ...current]);
      }
    } finally {
      setCloningId("");
    }
  }

  // A character file from this or another server (see
  // src/lib/character-bundle.ts) becomes a new roster entry. The file is
  // parsed here only to fail fast on something that is not JSON; the server
  // does the real validation and reports the first problem it finds.
  async function importFile(file: File) {
    setImporting(true);
    setImportError("");
    try {
      let parsed: unknown;
      try {
        parsed = JSON.parse(await file.text());
      } catch {
        setImportError(`${file.name} is not a JSON file.`);
        return;
      }
      const response = await fetch("/api/characters/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setImportError(data.error || "Import failed.");
        return;
      }
      if (data.character) {
        setCharacters((current) => [data.character, ...current]);
      }
    } catch {
      setImportError("Import failed.");
    } finally {
      setImporting(false);
      if (importInput.current) {
        importInput.current.value = "";
      }
    }
  }

  async function remove(id: string, name: string) {
    if (!await appConfirm(`Delete ${name} from your library? This cannot be undone.`)) {
      return;
    }
    const response = await fetch(`/api/characters/${id}`, { method: "DELETE" });
    if (response.ok) {
      setCharacters((current) => current.filter((character) => character.id !== id));
    }
  }

  if (!authed) {
    return (
      <main className="mx-auto w-full max-w-3xl flex-1 p-4 sm:p-6">
        <div className={cn(ui.card, "ornate texture-noise flex flex-col items-center gap-3 px-6 py-8 text-center")}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/assets/ui/empty-notice-board.webp" alt="" className="h-24 w-32 object-contain opacity-90" />
          <p className="font-serif text-sm text-stone-300">
            <Link href="/" className="text-amber-200 hover:text-amber-400">Log in</Link> to see your
            character library.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 p-4 sm:p-6">
      <AppHeader />
      <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <GameIcon icon={{ kind: "glyph", key: "tab-characters" }} size="size-12" className="page-glyph" />
          <div>
            <h1 className="gold-title animate-fade-up font-display text-2xl">Your characters</h1>
            <p className="text-sm text-stone-500">
              Saved to your profile; bring them into any campaign.
            </p>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2 sm:flex-nowrap">
          <input
            ref={importInput}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) {
                void importFile(file);
              }
            }}
          />
          <button
            type="button"
            onClick={() => importInput.current?.click()}
            disabled={importing}
            className={ui.btnSecondary}
            title="Import a character file exported from this or another server"
          >
            {importing ? <Loader2 className="size-4 animate-spin" /> : <FileUp className="size-4" />}
            Import character
          </button>
          <Link href="/characters/new" className={ui.btnPrimary}>
            <Plus className="size-4" /> New character
          </Link>
        </div>
      </header>
      {importError ? (
        <p role="alert" className="motion-shake mb-4 rounded-lg border border-red-500/30 bg-red-950/30 px-3 py-2 text-sm text-red-300">
          {importError}
        </p>
      ) : null}

      {loading ? (
        <PageSkeleton kind="roster" className="px-0 py-2" />
      ) : characters.length === 0 ? (
        <div className={cn(ui.tile, "px-6 py-6")}>
          <EmptyState
            art="board"
            title="No heroes in the roster yet."
            hint="Create one here, or one is saved automatically when you join a campaign."
            action={
              <Link href="/characters/new" className={ui.btnSecondary}>
                <Plus className="size-4" /> New character
              </Link>
            }
          />
        </div>
      ) : (
        <>
          <Ribbon className="mb-3">
            Roster · {characters.length}
          </Ribbon>
          <ul className="stagger-up grid grid-cols-1 gap-3 sm:grid-cols-2">
            {characters.map((character) => (
              <CharacterCard
                key={character.id}
                character={character}
                cloning={cloningId === character.id}
                onDelete={() => remove(character.id, character.name)}
                onUploadPortrait={() => setCroppingId(character.id)}
                onDuplicate={() => duplicate(character.id)}
              />
            ))}
          </ul>
        </>
      )}
      {cropping ? (
        <AvatarCropDialog
          title={`Portrait for ${cropping.name}`}
          onUploaded={(image) => {
            setCroppingId("");
            void setPortrait(cropping.id, image.url);
          }}
          onClose={() => setCroppingId("")}
        />
      ) : null}
    </main>
  );
}

// One roster card: portrait (painted, painting, failed or none), name and
// class chip with the class emblem on the portrait's corner, race and
// background, the tables it sits at, and one menu in the corner holding what
// used to be three hover icons (the same list a right-click or long press
// raises).
function CharacterCard({
  character,
  cloning,
  onDelete,
  onUploadPortrait,
  onDuplicate,
}: {
  character: LibraryCharacter;
  cloning: boolean;
  onDelete: () => void;
  onUploadPortrait: () => void;
  onDuplicate: () => void;
}) {
  const router = useRouter();
  // Everything the card can do, once: the kebab in its corner, a right-click
  // and a long press all raise this list.
  const menu: ContextMenuItem[] = [
    { id: "open", label: "Open", glyph: "tab-characters", onSelect: () => router.push(`/characters/${character.id}`) },
    { id: "portrait", label: "Upload portrait", glyph: "tab-handout", onSelect: onUploadPortrait },
    { id: "duplicate", label: "Duplicate", glyph: "tab-notes", disabled: cloning, onSelect: onDuplicate },
    ...(character.campaigns ?? []).map((assignment, index) => ({
      id: `go-${assignment.campaignId}`,
      label: `Go to ${assignment.title}`,
      glyph: assignment.kind === "workshop" ? "system-storyboard" : "tab-campaigns",
      separated: index === 0,
      onSelect: () =>
        router.push(
          assignment.kind === "workshop" ? `/workshop/${assignment.campaignId}` : `/campaigns/${assignment.campaignId}`,
        ),
    })),
    { id: "delete", label: "Delete", glyph: "quest-failed", tone: "danger", separated: true, onSelect: onDelete },
  ];
  return (
    <ContextMenu as="li" items={menu} label={character.name} className={cn("group relative", ui.cardHover, "p-4")}>
      <Link href={`/characters/${character.id}`} className="block">
        <div className="flex items-center gap-3">
          <span className="relative shrink-0">
          {character.sheet?.portrait?.url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={character.sheet.portrait.url}
              alt={character.name}
              className="size-12 shrink-0 rounded-lg border border-amber-500/30 object-cover shadow-glow-gold"
            />
          ) : portraitPending(character) ? (
            <span
              title="Painting portrait..."
              className="flex size-12 shrink-0 items-center justify-center rounded-lg border border-amber-500/30 bg-stone-900"
            >
              <Loader2 className="size-4 animate-spin text-amber-200" />
            </span>
          ) : (
            <span
              title={
                character.portraitStatus === "failed" ? "Portrait generation failed" : undefined
              }
            >
              <CharacterPortrait
                look={{
                  race: character.race,
                  class: character.class,
                  gender: character.sheet?.gender,
                }}
                alt={character.name}
                size="size-12"
                className="border-amber-500/30 shadow-glow-gold"
              />
            </span>
          )}
            <GameIcon
              icon={{ kind: "family", key: `class-${character.class}` }}
              size="size-6"
              className="pointer-events-none absolute -bottom-1.5 -right-1.5"
            />
          </span>
          <div className="min-w-0 pr-10">
            <span className="block truncate font-display text-base tracking-wide text-amber-50">
              {character.name}
            </span>
            <span className="inline-flex rounded-full border border-amber-500/30 bg-amber-400/10 px-2 py-0.5 text-[11px] text-amber-200">
              Level {character.level} {titleCase(character.class)}
            </span>
          </div>
        </div>
        <p className="mt-2 text-sm text-stone-400">
          {titleCase(character.race)}
          {character.subclass ? ` (${character.subclass})` : ""}
        </p>
        {character.background ? (
          <p className="reveal text-xs text-stone-500">{titleCase(character.background)}</p>
        ) : null}
      </Link>
      {character.campaigns?.length ? (
        <div className="reveal mt-2 flex flex-wrap gap-1.5 border-t border-stone-700/40 pt-2">
          {character.campaigns.map((assignment) => (
            <Link
              key={assignment.campaignId}
              href={
                assignment.kind === "workshop"
                  ? `/workshop/${assignment.campaignId}`
                  : `/campaigns/${assignment.campaignId}`
              }
              className="inline-flex min-h-7 max-w-full items-center gap-1 rounded-full border border-stone-600/60 bg-stone-900/60 py-0.5 pl-0.5 pr-2 text-[11px] text-stone-300 transition-colors hover:border-amber-500/40 hover:text-amber-100"
            >
              <GameIcon
                icon={{ kind: "glyph", key: assignment.kind === "workshop" ? "system-storyboard" : "tab-campaigns" }}
                size="size-5"
              />
              <span className="truncate">{assignment.title}</span>
            </Link>
          ))}
        </div>
      ) : (
        <p className="mt-2 border-t border-stone-700/40 pt-2 text-xs text-stone-500">
          Not in a campaign yet.
        </p>
      )}
      <KebabMenu
        items={menu}
        label={`Actions for ${character.name}`}
        heading={character.name}
        busy={cloning}
        className="absolute right-2 top-2 border-transparent bg-transparent"
      />
    </ContextMenu>
  );
}
