"use client";

import { Camera, Loader2, Plus, Trash2, UserRound } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { AvatarCropDialog } from "@/app/settings/AvatarCropDialog";
import { IconChip, PIXEL_ICONS, PixelTile, ui } from "@/lib/ui";

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
  sheet?: { portrait?: { url: string } | null };
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
  const cropping = characters.find((character) => character.id === croppingId);
  const pollCount = useRef(0);

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

  async function remove(id: string, name: string) {
    if (!window.confirm(`Delete ${name} from your library? This cannot be undone.`)) {
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
        <p className="rounded-lg border border-stone-800 p-6 text-center text-stone-400">
          <Link href="/" className="text-amber-200 hover:text-amber-400">Log in</Link> to see your
          character library.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 p-4 sm:p-6">
      <header className="mb-8 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <PixelTile src={PIXEL_ICONS.characters} />
          <div>
            <h1 className="font-display text-xl tracking-wide text-amber-50">Your characters</h1>
            <p className="text-sm text-stone-500">
              Saved to your profile; bring them into any campaign.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/" className={ui.btnSmall}>
            Campaigns
          </Link>
          <Link href="/characters/new" className={ui.btnPrimary}>
            <Plus className="size-4" /> New character
          </Link>
        </div>
      </header>

      {loading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="size-5 animate-spin text-stone-500" />
        </div>
      ) : characters.length === 0 ? (
        <div className="flex flex-col items-center gap-4 rounded-xl border border-stone-800 bg-stone-950/40 px-6 py-10 text-center">
          <IconChip icon={UserRound} size="size-12" iconSize="size-5" />
          <div className="max-w-sm">
            <p className="text-balance font-serif text-2xl text-stone-200">
              No heroes in the roster yet.
            </p>
            <p className="mt-2 text-pretty text-sm text-stone-500">
              Create one here, or one is saved automatically when you join a campaign.
            </p>
          </div>
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {characters.map((character) => (
            <li
              key={character.id}
              className={`group relative ${ui.cardHover} p-4`}
            >
              <a href={`/characters/${character.id}`} className="block">
                <div className="flex items-center gap-3">
                  {character.sheet?.portrait?.url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={character.sheet.portrait.url}
                      alt={character.name}
                      className="size-12 shrink-0 rounded-lg border border-amber-500/30 object-cover"
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
                        character.portraitStatus === "failed"
                          ? "Portrait generation failed"
                          : undefined
                      }
                    >
                      <IconChip icon={UserRound} size="size-12" iconSize="size-5" />
                    </span>
                  )}
                  <div className="min-w-0">
                    <span className="block truncate font-medium text-stone-100">
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
                  <p className="text-xs text-stone-500">{titleCase(character.background)}</p>
                ) : null}
              </a>
              <button
                type="button"
                onClick={() => remove(character.id, character.name)}
                className="absolute right-3 top-3 hidden text-stone-600 hover:text-red-400 group-hover:block"
                title="Delete"
              >
                <Trash2 className="size-4" />
              </button>
              <button
                type="button"
                onClick={() => setCroppingId(character.id)}
                className="absolute right-3 top-10 hidden text-stone-600 hover:text-amber-300 group-hover:block"
                title="Upload portrait"
              >
                <Camera className="size-4" />
              </button>
            </li>
          ))}
        </ul>
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
