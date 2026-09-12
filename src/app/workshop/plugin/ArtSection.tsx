"use client";

import { ImagePlus, Loader2, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import {
  MAX_PACK_ART_BYTES,
  MAX_PACK_ART_KEYS,
  PACK_ART_ASPECT,
  packArtSlots,
  type PackArtKind,
  type PackArtSlot,
} from "@/lib/worlds/art";
import { resizePackArt } from "@/lib/worlds/art-resize";
import { BACKGROUND_OPTIONS, CLASS_OPTIONS, RACE_OPTIONS, catalogLabel } from "@/lib/worlds/catalog";
import type { WorldPackDraft } from "@/lib/worlds/draft";
import type { SectionProps } from "@/app/workshop/plugin/types";

// The pack's pictures: a cover, and a tile for everything it names. The
// slots are derived from the draft (src/lib/worlds/art.ts), never chosen,
// so a picture can only ever be for something the pack has. Uploads are a
// plain file input, which works in the desktop and Android shells alike;
// nothing here needs drag-and-drop. The file is resized in the browser to
// the slot's shape and held in the draft as a data URL.

const KIND_LABEL: Record<PackArtKind, string> = {
  cover: "Cover",
  race: "Species",
  class: "Calling",
  background: "Background",
  monster: "Monster",
  location: "Place",
  faction: "Faction",
};

function slotLabel(slot: PackArtSlot, draft: WorldPackDraft): string {
  switch (slot.kind) {
    case "cover":
      return draft.name.trim() || "The world";
    case "race":
      return draft.races.find((entry) => entry.id === slot.ref)?.name.trim() || catalogLabel(RACE_OPTIONS, slot.ref);
    case "class":
      return draft.classes.find((entry) => entry.id === slot.ref)?.name.trim() || catalogLabel(CLASS_OPTIONS, slot.ref);
    case "background":
      return (
        draft.backgrounds.find((entry) => entry.id === slot.ref)?.name.trim() || catalogLabel(BACKGROUND_OPTIONS, slot.ref)
      );
    case "monster":
      return draft.monsters.find((entry) => entry.slug === slot.ref)?.name.trim() || slot.ref;
    default:
      return slot.ref;
  }
}

function dataUrlBytes(dataUrl: string): number {
  return Math.floor((dataUrl.length - dataUrl.indexOf(",") - 1) * 0.75);
}

function ArtSlot({
  slot,
  label,
  dataUrl,
  onPicture,
  onRemove,
}: {
  slot: PackArtSlot;
  label: string;
  dataUrl: string | undefined;
  onPicture: (dataUrl: string) => void;
  onRemove: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const landscape = PACK_ART_ASPECT[slot.kind] === "landscape";

  async function choose(file: File) {
    setBusy(true);
    setError("");
    try {
      onPicture(await resizePackArt(file, slot.kind));
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : "That picture would not load.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className={cn(ui.card, "flex flex-col gap-2 p-2", landscape && "sm:col-span-2")}>
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        disabled={busy}
        aria-label={`${dataUrl ? "Replace" : "Upload"} the picture for ${label}`}
        className={cn(
          "relative flex w-full items-center justify-center overflow-hidden rounded-lg border border-dashed border-stone-700 bg-stone-950/60 text-stone-500 hover:border-amber-500/50 hover:text-amber-200",
          landscape ? "aspect-[704/400]" : "aspect-square",
        )}
      >
        {dataUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={dataUrl} alt="" className="size-full object-cover" />
        ) : busy ? (
          <Loader2 className="size-5 animate-spin" />
        ) : (
          <ImagePlus className="size-5" />
        )}
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void choose(file);
        }}
      />
      <div className="flex items-start justify-between gap-1">
        <div className="min-w-0">
          <p className="truncate text-xs text-stone-200">{label}</p>
          <p className="text-[10px] text-stone-500">
            {KIND_LABEL[slot.kind]}
            {dataUrl ? `, ${Math.max(1, Math.round(dataUrlBytes(dataUrl) / 1024))} KB` : ""}
          </p>
        </div>
        {dataUrl ? (
          <button
            type="button"
            onClick={onRemove}
            aria-label={`Remove the picture for ${label}`}
            className="rounded-md p-1 text-stone-600 hover:text-red-300"
          >
            <Trash2 className="size-3.5" />
          </button>
        ) : null}
      </div>
      {error ? <p className="text-[11px] text-red-300">{error}</p> : null}
    </li>
  );
}

export function ArtSection({ draft, onDraft }: SectionProps) {
  const slots = packArtSlots({
    races: draft.races.filter((entry) => entry.id),
    classes: draft.classes.filter((entry) => entry.id),
    backgrounds: draft.backgrounds.filter((entry) => entry.id),
    monsters: draft.monsters.filter((entry) => entry.slug),
    locations: draft.locations.filter((entry) => entry.name.trim()),
    factions: draft.factions.filter((entry) => entry.name.trim()),
  });
  const slotKeys = new Set(slots.map((slot) => slot.key));
  const orphans = Object.keys(draft.art).filter((key) => !slotKeys.has(key));
  const filled = Object.keys(draft.art).length;
  const bytes = Object.values(draft.art).reduce((sum, dataUrl) => sum + dataUrlBytes(dataUrl), 0);

  const setArt = (key: string, dataUrl: string | null) => {
    const art = { ...draft.art };
    if (dataUrl) {
      art[key] = dataUrl;
    } else {
      delete art[key];
    }
    onDraft({ ...draft, art });
  };

  return (
    <div className="space-y-4">
      <p className="text-[11px] text-stone-500">
        {filled} of {slots.length} pictures, {Math.round(bytes / 1024)} KB in all. Each is resized on the way in: squares to 256 px, the cover and places to 704 by 400, under {MAX_PACK_ART_BYTES / 1024} KB apiece, at most {MAX_PACK_ART_KEYS} in a pack. Every slot is optional and falls back to the default plate.
      </p>
      {slots.length === 1 ? (
        <p className="text-[11px] italic text-stone-600">
          Name a species, calling, monster, place or faction and its slot appears here.
        </p>
      ) : null}
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
        {slots.map((slot) => (
          <ArtSlot
            key={slot.key}
            slot={slot}
            label={slotLabel(slot, draft)}
            dataUrl={draft.art[slot.key]}
            onPicture={(dataUrl) => setArt(slot.key, dataUrl)}
            onRemove={() => setArt(slot.key, null)}
          />
        ))}
      </ul>
      {orphans.length ? (
        <div className="rounded-lg border border-amber-500/20 p-3 text-[11px] text-amber-200/80">
          <p>
            {orphans.length} picture{orphans.length === 1 ? " is" : "s are"} for something the pack no longer names ({orphans.join(", ")}). They are left out of the export.
          </p>
          <button
            type="button"
            onClick={() => {
              const art = { ...draft.art };
              for (const key of orphans) delete art[key];
              onDraft({ ...draft, art });
            }}
            className={cn(ui.btnSmall, "mt-2 text-xs")}
          >
            <Trash2 className="size-3.5" /> Forget them
          </button>
        </div>
      ) : null}
    </div>
  );
}
