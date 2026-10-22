"use client";

import { LoadFailed } from "@/app/campaigns/[campaignId]/PanelKit";
import { readLoad, useLoadStatus } from "@/lib/load-state";
import { EmptyState } from "@/components/EmptyState";
import { appConfirm } from "@/components/ui/ConfirmDialog";
import { PageSkeleton } from "@/components/PageSkeleton";

import { FileUp, Loader2, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ContextMenu, type ContextMenuItem } from "@/components/ui/ContextMenu";
import { AvatarCropDialog } from "@/app/settings/AvatarCropDialog";
import { AppHeader } from "@/components/AppHeader";
import { KebabMenu } from "@/components/KebabMenu";
import { GameIcon } from "@/components/ui/GameIcon";
import { Ribbon } from "@/components/ui/Ribbon";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { navigateTo } from "@/lib/navigation";
import { prefersReducedMotion, useLowEffects } from "@/lib/effects-mode";
import { PortraitToast, RosterPortraitSlot, RosterPortraitStatus } from "@/app/characters/RosterPortrait";
import {
  PORTRAIT_TOAST_MS,
  portraitPhases,
  portraitsReady,
  type PortraitPhase,
} from "@/app/characters/portrait-arrival";

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
  // A workshop class's name (the class holds its id).
  className?: string;
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
  // A refused or failed read is shown in the server's words with a way to
  // ask again, never as "nothing here yet" (issue 140).
  const { loadError, settle } = useLoadStatus();
  const [reloads, setReloads] = useState(0);
  const [croppingId, setCroppingId] = useState("");
  const [cloningId, setCloningId] = useState("");
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState("");
  // What a file's Homebrew did on arrival (src/lib/db/character-file.ts):
  // copied onto this shelf, the same as one already here, or kept beside
  // one of the same name.
  const [importShelf, setImportShelf] = useState("");
  // A portrait, copy or delete that did not go through.
  const [actionError, setActionError] = useState("");
  // A file older than a rule that asks for a pick comes in without it; the
  // library says what is still to choose and where (issue #430).
  const [importOwed, setImportOwed] = useState<{ id: string; name: string; owed: string[] } | null>(null);
  const cropping = characters.find((character) => character.id === croppingId);
  const pollCount = useRef(0);
  const importInput = useRef<HTMLInputElement>(null);
  // F25: each portrait's phase at the last read, so a painting that lands
  // between two reads fades in and is announced once, by the toast.
  const phases = useRef<Record<string, PortraitPhase>>({});
  const [arriving, setArriving] = useState<string[]>([]);
  const [toasts, setToasts] = useState<{ id: string; name: string }[]>([]);
  const [retryingId, setRetryingId] = useState("");
  const [retryErrors, setRetryErrors] = useState<Record<string, string>>({});
  const lowEffects = useLowEffects();
  const still = lowEffects || prefersReducedMotion();

  // A fresh read of the library: what finished painting since the last one.
  const receive = useCallback((next: LibraryCharacter[]) => {
    const ready = portraitsReady(phases.current, next);
    phases.current = portraitPhases(next);
    if (ready.length) {
      setArriving((current) => [...current, ...ready.map((entry) => entry.id)]);
      setToasts((current) => [...current, ...ready]);
    }
    setCharacters(next);
  }, []);

  const toast = toasts[0] ?? null;
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToasts((current) => current.slice(1)), PORTRAIT_TOAST_MS);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    readLoad<{ characters?: LibraryCharacter[] }>(fetch("/api/characters"), "Your characters").then((outcome) => {
      // Signed out: the page says so itself, not as a failed load.
      if (outcome.error && /answered 401/.test(outcome.error)) {
        setAuthed(false);
        setLoading(false);
        return;
      }
      settle(outcome);
      if (outcome.payload?.characters) {
        receive(outcome.payload.characters);
      }
      setLoading(false);
    });
  }, [reloads, settle, receive]);

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
            receive(data.characters);
          }
        })
        .catch(() => {
          // The next tick asks again.
        });
    }, 2500);
    return () => clearTimeout(id);
  }, [characters, receive]);

  // "Try again" on a failed painting: the same route as the sheet's "Paint
  // one". The card waits on the new painting as it did on the first.
  async function repaint(id: string) {
    setRetryingId(id);
    setRetryErrors((current) => ({ ...current, [id]: "" }));
    try {
      const response = await fetch(`/api/characters/${id}/portrait`, { method: "POST" });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setRetryErrors((current) => ({ ...current, [id]: data.error || "The portrait could not be queued." }));
        return;
      }
      phases.current = { ...phases.current, [id]: "painting" };
      pollCount.current = 0;
      setCharacters((current) =>
        current.map((character) =>
          character.id === id
            ? { ...character, portraitStatus: "queued", sheet: { ...character.sheet, portrait: null } }
            : character,
        ),
      );
    } catch {
      setRetryErrors((current) => ({ ...current, [id]: "Could not reach the server." }));
    } finally {
      setRetryingId("");
    }
  }

  async function setPortrait(id: string, url: string) {
    setActionError("");
    const response = await fetch(`/api/characters/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ portrait: { url } }),
    }).catch(() => null);
    if (!response?.ok) {
      setActionError("The portrait was not saved. Check the connection and try again.");
      return;
    }
    setCharacters((current) =>
      current.map((character) =>
        character.id === id
          ? { ...character, sheet: { ...character.sheet, portrait: { url } } }
          : character,
      ),
    );
  }

  // A second copy under a numbered name, sheet and portrait verbatim. The
  // copy belongs to no campaign, which is why it starts with no assignments.
  // "Duplicate and edit" opens the copy in the build editor (issue 229).
  async function duplicate(id: string, edit = false) {
    setCloningId(id);
    setActionError("");
    try {
      const response = await fetch(`/api/characters/${id}/clone`, { method: "POST" }).catch(() => null);
      if (!response?.ok) {
        const data = (await response?.json().catch(() => null)) as { error?: string } | null;
        setActionError(data?.error ?? "No copy was made. Check the connection and try again.");
        return;
      }
      const data = await response.json().catch(() => ({}));
      if (data.character && edit) {
        navigateTo(`/characters/${data.character.id}/edit?copyOf=${id}`);
        return;
      }
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
    setImportOwed(null);
    setImportShelf("");
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
        if (Array.isArray(data.owed) && data.owed.length) {
          setImportOwed({ id: data.character.id, name: data.character.name, owed: data.owed });
        }
        setImportShelf(importShelfNote(data.character.name, data.homebrew));
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
    setActionError("");
    const response = await fetch(`/api/characters/${id}`, { method: "DELETE" }).catch(() => null);
    if (!response?.ok) {
      const data = (await response?.json().catch(() => null)) as { error?: string } | null;
      setActionError(data?.error ?? `${name} was not deleted. Check the connection and try again.`);
      return;
    }
    setCharacters((current) => current.filter((character) => character.id !== id));
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
      {importError || actionError ? (
        <p role="alert" className="motion-shake mb-4 rounded-lg border border-red-500/30 bg-red-950/30 px-3 py-2 text-sm text-red-300">
          {importError || actionError}
        </p>
      ) : null}
      {importShelf ? (
        <p role="status" className="reveal mb-4 rounded-lg border border-stone-700/60 bg-stone-950/40 px-3 py-2 text-sm text-stone-300">
          {importShelf}
        </p>
      ) : null}
      {importOwed ? (
        <div role="status" className="reveal mb-4 rounded-lg border border-amber-500/30 bg-amber-950/20 px-3 py-2 text-sm text-amber-100">
          <p>
            {importOwed.name} came from a file made before these choices were asked for, so they are still to make:
          </p>
          <ul className="mt-1 list-disc pl-5 text-amber-200/90">
            {importOwed.owed.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <p className="mt-2 flex flex-wrap items-center gap-2">
            <Link
              href={`/characters/${importOwed.id}/edit`}
              className="inline-flex min-h-10 items-center rounded-lg border border-amber-600/60 px-3 font-medium text-amber-100 hover:bg-amber-900/30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400"
            >
              Choose them now
            </Link>
            <button
              type="button"
              onClick={() => setImportOwed(null)}
              className="inline-flex min-h-10 items-center rounded-lg px-3 text-stone-400 hover:text-stone-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400"
            >
              Later
            </button>
          </p>
        </div>
      ) : null}

      {loading ? (
        <PageSkeleton kind="roster" className="px-0 py-2" />
      ) : loadError ? (
        <LoadFailed error={loadError} onRetry={() => { setLoading(true); setReloads((current) => current + 1); }} />
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
                arriving={arriving.includes(character.id)}
                still={still}
                retrying={retryingId === character.id}
                retryError={retryErrors[character.id] ?? ""}
                onRetryPortrait={() => void repaint(character.id)}
                onDelete={() => remove(character.id, character.name)}
                onUploadPortrait={() => setCroppingId(character.id)}
                onDuplicate={() => duplicate(character.id)}
                onDuplicateEdit={() => duplicate(character.id, true)}
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
      <PortraitToast toast={toast} />
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
  arriving,
  still,
  retrying,
  retryError,
  onRetryPortrait,
  onDelete,
  onUploadPortrait,
  onDuplicate,
  onDuplicateEdit,
}: {
  character: LibraryCharacter;
  cloning: boolean;
  arriving: boolean;
  still: boolean;
  retrying: boolean;
  retryError: string;
  onRetryPortrait: () => void;
  onDelete: () => void;
  onUploadPortrait: () => void;
  onDuplicate: () => void;
  onDuplicateEdit: () => void;
}) {
  const router = useRouter();
  // Everything the card can do, once: the kebab in its corner, a right-click
  // and a long press all raise this list.
  const menu: ContextMenuItem[] = [
    { id: "open", label: "Open", glyph: "tab-characters", onSelect: () => router.push(`/characters/${character.id}`) },
    { id: "edit", label: "Edit build", glyph: "ui-edit", onSelect: () => router.push(`/characters/${character.id}/edit`) },
    { id: "portrait", label: "Upload portrait", glyph: "ui-upload", onSelect: onUploadPortrait },
    { id: "duplicate", label: "Duplicate", glyph: "ui-duplicate", disabled: cloning, onSelect: onDuplicate },
    { id: "duplicate-edit", label: "Duplicate and edit", glyph: "ui-duplicate", disabled: cloning, onSelect: onDuplicateEdit },
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
    { id: "delete", label: "Delete", glyph: "ui-delete", tone: "danger", separated: true, onSelect: onDelete },
  ];
  return (
    <ContextMenu as="li" items={menu} label={character.name} className={cn("group relative", ui.cardHover, "p-4")}>
      <Link href={`/characters/${character.id}`} className="block">
        <div className="flex items-center gap-3">
          <span className="relative shrink-0">
            <RosterPortraitSlot character={character} arriving={arriving} still={still} />
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
              Level {character.level} {character.className ?? titleCase(character.class)}
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
      <RosterPortraitStatus
        character={character}
        retrying={retrying}
        retryError={retryError}
        onRetry={onRetryPortrait}
      />
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

// What a character file's Homebrew did on arrival, in one line.
function importShelfNote(name: string, shelf: { copied?: number; reused?: string[]; renamed?: string[] } | undefined): string {
  if (!shelf) {
    return "";
  }
  const lines = [
    shelf.copied ? `${name}'s Homebrew came with the file and is on your shelf now (${shelf.copied} entr${shelf.copied === 1 ? "y" : "ies"}).` : "",
    shelf.reused?.length ? `Already on your shelf, the same: ${shelf.reused.join(", ")}.` : "",
    ...(shelf.renamed ?? []),
  ];
  return lines.filter(Boolean).join(" ");
}
