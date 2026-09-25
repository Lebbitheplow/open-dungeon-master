"use client";

import { PageSkeleton } from "@/components/PageSkeleton";
import { ArrowLeft, Loader2 } from "lucide-react";
import Link from "next/link";
import { use, useEffect, useRef, useState } from "react";
import { AvatarCropDialog } from "@/app/settings/AvatarCropDialog";
import { AppHeader } from "@/components/AppHeader";
import { KebabMenu, type KebabItem } from "@/components/KebabMenu";
import { ContextMenu } from "@/components/ui/ContextMenu";
import { GameIcon } from "@/components/ui/GameIcon";
import { ImageLightbox } from "@/components/ui/ImageLightbox";
import { cn } from "@/lib/cn";
import { downloadBlob, filenameSlug } from "@/lib/download";
import { downloadCharacterSheetPdf } from "@/lib/pdf/download";
import type { CreateSheetInput } from "@/lib/schemas/sheet";
import { CharacterPortrait, ui } from "@/lib/ui";
import { offersImages, useCapabilities } from "@/lib/use-capabilities";
import { SheetSections, StorySoFar, type CharacterEvent } from "./SheetSections";
import { navigateTo } from "@/lib/navigation";
import { UseInCampaignDialog } from "./UseInCampaignDialog";

// Where this character is playing; see src/lib/db/characters.ts.
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
  xp: number;
  portraitStatus?: "queued" | "generating" | "failed" | null;
  campaigns?: CharacterAssignment[];
  sheet: CreateSheetInput;
  updatedAt: string;
};

// Matches the ComfyUI generation timeout; polling stops even if the server
// never resolves the job.
const PORTRAIT_POLL_LIMIT = 240;

function titleCase(value: string) {
  return value.replace(/[-_]/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export default function CharacterDetailPage({
  params,
}: {
  params: Promise<{ characterId: string }>;
}) {
  const { characterId } = use(params);
  const [character, setCharacter] = useState<LibraryCharacter | null>(null);
  const [events, setEvents] = useState<CharacterEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [cloning, setCloning] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const [cropping, setCropping] = useState(false);
  const [seating, setSeating] = useState(false);
  const [painting, setPainting] = useState(false);
  const [portraitError, setPortraitError] = useState("");
  // "Paint one" only where the server has an image model to paint with.
  const canPaint = offersImages(useCapabilities());
  const pollCount = useRef(0);

  async function handleDownloadPdf() {
    if (!character) {
      return;
    }
    setPdfBusy(true);
    try {
      // The PDF builder (pdf-lib) loads on demand; see lib/pdf/download.
      const { libraryToPdfCharacter } = await import("@/lib/pdf/character-sheet-pdf");
      await downloadCharacterSheetPdf(libraryToPdfCharacter(character));
    } finally {
      setPdfBusy(false);
    }
  }

  // The whole character as one JSON file, portrait inlined, for carrying to
  // another device or server (see src/lib/character-bundle.ts).
  async function handleExport() {
    if (!character) {
      return;
    }
    setExporting(true);
    setExportError("");
    try {
      const response = await fetch(`/api/characters/${characterId}/export`);
      if (!response.ok) {
        setExportError("Export failed.");
        return;
      }
      downloadBlob(`${filenameSlug(character.name)}.odm-character.json`, await response.blob());
    } catch {
      setExportError("Export failed.");
    } finally {
      setExporting(false);
    }
  }

  // Same portrait-only PATCH the library list uses; a manual upload is
  // authoritative and replaces whatever was painted.
  async function handlePortraitUploaded(portrait: {
    id: string;
    name: string;
    type: string;
    url: string;
  }) {
    setCropping(false);
    const response = await fetch(`/api/characters/${characterId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ portrait }),
    });
    if (response.ok) {
      setCharacter((current) =>
        current
          ? { ...current, portraitStatus: null, sheet: { ...current.sheet, portrait } }
          : current,
      );
    }
  }

  // The third choice beside upload and paint: no picture at all, which shows
  // the stand-in plate for the class or race (src/lib/placeholders.ts).
  async function clearToPlaceholder() {
    setPortraitError("");
    const response = await fetch(`/api/characters/${characterId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ portrait: null }),
    });
    if (response.ok) {
      setCharacter((current) =>
        current
          ? { ...current, portraitStatus: null, sheet: { ...current.sheet, portrait: null } }
          : current,
      );
    }
  }

  // Queues a fresh render; the poll that watches creation renders picks up
  // the result the same way.
  async function paintPortrait() {
    setPortraitError("");
    setPainting(true);
    try {
      const response = await fetch(`/api/characters/${characterId}/portrait`, { method: "POST" });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        setPortraitError(data.error ?? "Could not queue the portrait.");
        return;
      }
      setCharacter((current) =>
        current
          ? { ...current, portraitStatus: "queued", sheet: { ...current.sheet, portrait: null } }
          : current,
      );
    } finally {
      setPainting(false);
    }
  }

  // A second copy under a numbered name, sheet and portrait verbatim. The
  // roster is where copies live, so that is where this lands.
  async function handleDuplicate() {
    setCloning(true);
    try {
      const response = await fetch(`/api/characters/${characterId}/clone`, { method: "POST" });
      if (response.ok) {
        navigateTo("/characters");
      }
    } finally {
      setCloning(false);
    }
  }

  useEffect(() => {
    fetch(`/api/characters/${characterId}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (data?.character) {
          setCharacter(data.character);
          setEvents(data.events ?? []);
        }
      })
      .finally(() => setLoading(false));
  }, [characterId]);

  // While the portrait renders in the background, re-fetch until it lands.
  const portraitPending =
    character?.portraitStatus === "queued" || character?.portraitStatus === "generating";
  useEffect(() => {
    if (!portraitPending || pollCount.current >= PORTRAIT_POLL_LIMIT) {
      return;
    }
    const id = setTimeout(() => {
      pollCount.current += 1;
      fetch(`/api/characters/${characterId}`)
        .then((response) => (response.ok ? response.json() : null))
        .then((data) => {
          if (data?.character) {
            setCharacter(data.character);
          }
        });
    }, 2500);
    return () => clearTimeout(id);
  }, [portraitPending, character, characterId]);

  if (loading) {
    return (
      <main className="mx-auto w-full max-w-3xl flex-1 p-4 sm:p-6">
        <AppHeader />
        <PageSkeleton kind="sheet" className="px-0 py-2" />
      </main>
    );
  }

  if (!character) {
    return (
      <main className="mx-auto w-full max-w-3xl flex-1 p-4 sm:p-6">
        <AppHeader />
        <div className={cn(ui.card, "ornate texture-noise flex flex-col items-center gap-3 px-6 py-8 text-center")}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/assets/ui/empty-notice-board.webp" alt="" className="h-24 w-32 object-contain opacity-90" />
          <p className="font-serif text-sm text-stone-300">Character not found.</p>
          <Link href="/characters" className={ui.btnSecondary}>
            Back to your library
          </Link>
        </div>
      </main>
    );
  }

  const sheet = character.sheet;

  // Everything but the primary action, once, for the kebab and for the
  // right-click or long press on the header. Each hint is the sentence the
  // old button carried as its tooltip.
  const actions: KebabItem[] = [
    {
      id: "pdf",
      label: pdfBusy ? "Preparing..." : "Download PDF",
      hint: "Download this character sheet as a fillable PDF",
      glyph: "tab-journal",
      disabled: pdfBusy,
      onSelect: () => void handleDownloadPdf(),
    },
    {
      id: "export",
      label: exporting ? "Exporting..." : "Export",
      hint: "Save this character as a file you can import on another device or server",
      glyph: "system-share",
      disabled: exporting,
      onSelect: () => void handleExport(),
    },
    {
      id: "duplicate",
      label: cloning ? "Copying..." : "Duplicate",
      hint: "Save a second copy of this character to your library",
      glyph: "tab-notes",
      disabled: cloning,
      onSelect: () => void handleDuplicate(),
    },
    {
      id: "portrait",
      label: sheet.portrait ? "Replace portrait" : "Upload portrait",
      hint: sheet.portrait ? "Replace the portrait with a photo" : "Upload a portrait",
      glyph: "tab-handout",
      separated: true,
      onSelect: () => setCropping(true),
    },
    ...(canPaint
      ? [
          {
            id: "paint",
            label: portraitPending ? "Painting..." : "Paint one",
            hint: "Paint a new portrait on this server's image model",
            glyph: "sense-truesight",
            disabled: painting || portraitPending,
            onSelect: () => void paintPortrait(),
          },
        ]
      : []),
    ...(sheet.portrait
      ? [
          {
            id: "placeholder",
            label: "Use placeholder",
            hint: "Take the picture away and show the stand-in for this class or race",
            glyph: "quest-hidden",
            onSelect: () => void clearToPlaceholder(),
          },
        ]
      : []),
  ];
  const working = pdfBusy || exporting || cloning || painting;

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 p-4 sm:p-6">
      <AppHeader />
      <ContextMenu items={actions} label={character.name} className={cn(ui.card, "ornate texture-noise mb-4 p-4 sm:p-5")}>
        <Link href="/characters" className="-my-1 inline-flex min-h-10 items-center gap-1.5 text-sm text-stone-400 hover:text-amber-200">
          <ArrowLeft className="size-4" /> Back to your characters
        </Link>
        <div className="mt-2 flex items-start gap-4">
          <span className="relative shrink-0">
            {sheet.portrait?.url ? (
              <ImageLightbox
                src={sheet.portrait.url}
                alt={character.name}
                caption={character.name}
                className="size-20 shrink-0 rounded-xl border border-amber-500/30 object-cover shadow-glow-gold sm:size-24"
              />
            ) : portraitPending ? (
              <span
                title="Painting portrait..."
                className="flex size-20 shrink-0 items-center justify-center rounded-xl border border-amber-500/30 bg-stone-900 sm:size-24"
              >
                <Loader2 className="size-5 animate-spin text-amber-200" />
              </span>
            ) : (
              <CharacterPortrait
                look={{ race: character.race, class: character.class, gender: sheet.gender }}
                alt={character.name}
                size="size-20 sm:size-24"
                rounded="rounded-xl"
                className="border-amber-500/30 shadow-glow-gold"
              />
            )}
            <GameIcon
              icon={{ kind: "family", key: `class-${character.class}` }}
              size="size-8"
              className="pointer-events-none absolute -bottom-2 -right-2"
            />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="gold-title font-display text-2xl tracking-wide sm:text-3xl">
              {character.name}
            </h1>
            <p className="mt-1 text-sm text-stone-400">
              <span className="mr-1.5 inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-400/10 py-0.5 pl-0.5 pr-2 text-[11px] text-amber-200">
                <GameIcon icon={{ kind: "glyph", key: "rest-level-up" }} size="size-5" />
                Level {character.level}
              </span>
              {titleCase(character.race)} {titleCase(character.class)}
              {character.subclass ? ` (${character.subclass})` : ""}
              {character.background ? ` · ${titleCase(character.background)}` : ""}
            </p>
            {!sheet.portrait && character.portraitStatus === "failed" ? (
              <p className="reveal mt-1 text-xs text-stone-500">Portrait couldn&apos;t be generated.</p>
            ) : null}
            {/* Each campaign holds its own copy of this sheet, so one library
                entry can be at several tables at once. Naming them is what
                makes "which game is this one in?" answerable. */}
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {character.campaigns?.length ? (
                character.campaigns.map((assignment) => (
                  <Link
                    key={assignment.campaignId}
                    href={
                      assignment.kind === "workshop"
                        ? `/workshop/${assignment.campaignId}`
                        : `/campaigns/${assignment.campaignId}`
                    }
                    className="motion-press inline-flex min-h-8 max-w-full items-center gap-1 rounded-full border border-stone-600/60 bg-stone-900/60 py-0.5 pl-1 pr-2.5 text-xs text-stone-300 transition-colors hover:border-amber-500/40 hover:text-amber-100"
                  >
                    <GameIcon
                      icon={{ kind: "glyph", key: assignment.kind === "workshop" ? "system-storyboard" : "tab-campaigns" }}
                      size="size-6"
                    />
                    <span className="truncate">{assignment.title}</span>
                  </Link>
                ))
              ) : (
                <span className="text-xs text-stone-500">Not in a campaign yet.</span>
              )}
            </div>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-amber-500/15 pt-3">
          <button type="button" onClick={() => setSeating(true)} className={cn(ui.btnPrimary, "min-w-0 flex-1 sm:flex-none")}>
            <GameIcon icon={{ kind: "glyph", key: "tab-campaigns" }} size="size-6" /> Use in a campaign
          </button>
          <KebabMenu
            items={actions}
            label={`More actions for ${character.name}`}
            heading={character.name}
            busy={working}
          />
          {working || portraitPending ? (
            <span role="status" className="live-in text-xs text-stone-400">
              {pdfBusy
                ? "Preparing the PDF..."
                : exporting
                  ? "Exporting..."
                  : cloning
                    ? "Copying..."
                    : "Painting the portrait..."}
            </span>
          ) : null}
        </div>
        {exportError ? <p role="alert" className="motion-shake mt-2 text-sm text-red-400">{exportError}</p> : null}
        {portraitError ? <p role="alert" className="motion-shake mt-2 text-sm text-red-400">{portraitError}</p> : null}
      </ContextMenu>

      <SheetSections sheet={sheet} level={character.level} />
      <div className="mt-4">
        <StorySoFar events={events} />
      </div>

      {seating ? (
        <UseInCampaignDialog
          characterId={characterId}
          characterName={character.name}
          characterLevel={character.level}
          seatedIn={(character.campaigns ?? []).map((assignment) => assignment.campaignId)}
          onClose={() => setSeating(false)}
        />
      ) : null}

      {cropping ? (
        <AvatarCropDialog
          title={`Portrait for ${character.name}`}
          onUploaded={(image) => void handlePortraitUploaded(image)}
          onClose={() => setCropping(false)}
        />
      ) : null}
    </main>
  );
}
