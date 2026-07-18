"use client";

import { Loader2, Plus, Trash2, UserRound } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
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
};

function titleCase(value: string) {
  return value.replace(/[-_]/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export default function CharactersPage() {
  const [characters, setCharacters] = useState<LibraryCharacter[]>([]);
  const [loading, setLoading] = useState(true);
  const [authed, setAuthed] = useState(true);

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
      <main className="mx-auto w-full max-w-3xl flex-1 p-6">
        <p className="rounded-lg border border-stone-800 p-6 text-center text-stone-400">
          <Link href="/" className="text-amber-200 hover:text-amber-400">Log in</Link> to see your
          character library.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 p-6">
      <header className="mb-8 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <PixelTile src={PIXEL_ICONS.characters} />
          <div>
            <h1 className="font-serif text-xl text-stone-100">Your characters</h1>
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
        <ul className="grid gap-3 sm:grid-cols-2">
          {characters.map((character) => (
            <li
              key={character.id}
              className="group relative rounded-lg border border-stone-800 bg-stone-950/70 p-4 transition hover:border-amber-800/60 hover:bg-stone-900/70"
            >
              <a href={`/characters/${character.id}`} className="block">
                <div className="flex items-center gap-2">
                  <IconChip icon={UserRound} size="size-8" iconSize="size-4" />
                  <span className="font-medium text-stone-100">{character.name}</span>
                </div>
                <p className="mt-1 text-sm text-stone-400">
                  Level {character.level} {titleCase(character.race)}{" "}
                  {titleCase(character.class)}
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
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
