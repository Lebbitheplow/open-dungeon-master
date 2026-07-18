"use client";

import { BookOpen, Loader2 } from "lucide-react";
import Link from "next/link";
import { use, useEffect, useState } from "react";
import { PIXEL_ICONS, PixelTile } from "@/lib/ui";
import type { CreateSheetInput } from "@/lib/schemas/sheet";
import { abilityMod, formatModifier } from "@/lib/srd";

type LibraryCharacter = {
  id: string;
  name: string;
  race: string;
  class: string;
  subclass: string;
  background: string;
  level: number;
  xp: number;
  sheet: CreateSheetInput;
  updatedAt: string;
};

type CharacterEvent = {
  id: string;
  campaignId: string;
  kind: string;
  summary: string;
  createdAt: string;
};

function titleCase(value: string) {
  return value.replace(/[-_]/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

const KIND_LABELS: Record<string, string> = {
  achievement: "Achievement",
  item: "Treasure",
  relationship: "Bond",
  death: "Death",
  level_up: "Level up",
  story: "Story",
};

export default function CharacterDetailPage({
  params,
}: {
  params: Promise<{ characterId: string }>;
}) {
  const { characterId } = use(params);
  const [character, setCharacter] = useState<LibraryCharacter | null>(null);
  const [events, setEvents] = useState<CharacterEvent[]>([]);
  const [loading, setLoading] = useState(true);

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

  if (loading) {
    return (
      <main className="mx-auto w-full max-w-3xl flex-1 p-6">
        <div className="flex justify-center py-10">
          <Loader2 className="size-5 animate-spin text-stone-500" />
        </div>
      </main>
    );
  }

  if (!character) {
    return (
      <main className="mx-auto w-full max-w-3xl flex-1 p-6">
        <p className="rounded-lg border border-stone-800 p-6 text-center text-stone-400">
          Character not found.{" "}
          <Link href="/characters" className="text-amber-200 hover:text-amber-400">
            Back to your library
          </Link>
        </p>
      </main>
    );
  }

  const sheet = character.sheet;
  const abilities = sheet.abilities;

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 p-6">
      <header className="mb-6">
        <Link href="/characters" className="text-sm text-stone-500 hover:text-stone-300">
          &larr; Back to your characters
        </Link>
        <div className="mt-2 flex items-center gap-3">
          <PixelTile src={PIXEL_ICONS.characters} />
          <div>
            <h1 className="font-display text-2xl tracking-wide text-amber-50">{character.name}</h1>
            <p className="text-sm text-stone-400">
              Level {character.level} {titleCase(character.race)} {titleCase(character.class)}
              {character.subclass ? ` (${character.subclass})` : ""}
              {character.background ? ` · ${titleCase(character.background)}` : ""}
            </p>
          </div>
        </div>
      </header>

      <section className="mb-6 rounded-lg border border-stone-800 bg-stone-950/60 p-4">
        <h2 className="mb-3 font-medium">Sheet</h2>
        <div className="grid grid-cols-3 gap-2 text-center sm:grid-cols-6">
          {(Object.entries(abilities) as Array<[string, number]>).map(([ability, score]) => (
            <div key={ability} className="rounded-lg border border-stone-800 p-2">
              <p className="text-xs uppercase text-stone-500">{ability}</p>
              <p className="text-lg text-stone-100">{score}</p>
              <p className="text-xs text-stone-400">{formatModifier(abilityMod(score))}</p>
            </div>
          ))}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-sm text-stone-300 sm:grid-cols-4">
          <span>HP {sheet.maxHp}</span>
          <span>AC {sheet.ac}</span>
          <span>Speed {sheet.speed} ft</span>
          <span>Gold {sheet.gold}</span>
        </div>
        {sheet.spellcasting ? (
          <p className="mt-2 text-sm text-stone-400">
            Spells:{" "}
            {[...sheet.spellcasting.known, ...sheet.spellcasting.prepared].join(", ") || "none chosen"}
          </p>
        ) : null}
        {sheet.equipment.length ? (
          <p className="mt-1 text-sm text-stone-400">
            Equipment:{" "}
            {sheet.equipment
              .map((item) => (item.qty > 1 ? `${item.name} x${item.qty}` : item.name))
              .join(", ")}
          </p>
        ) : null}
        {sheet.feats.length ? (
          <p className="mt-1 text-sm text-stone-400">Feats: {sheet.feats.join(", ")}</p>
        ) : null}
        {sheet.backstory ? (
          <p className="mt-2 whitespace-pre-wrap text-sm text-stone-400">
            Backstory: {sheet.backstory}
          </p>
        ) : null}
      </section>

      <section>
        <h2 className="mb-3 flex items-center gap-2 font-medium">
          <BookOpen className="size-4 text-amber-200" /> Story so far
        </h2>
        {events.length === 0 ? (
          <p className="rounded-lg border border-dashed border-stone-800 p-5 text-center text-sm text-stone-500">
            Nothing recorded yet. Milestones from campaigns land here: victories, treasures,
            bonds, and worse.
          </p>
        ) : (
          <ol className="space-y-2">
            {events.map((event) => (
              <li
                key={event.id}
                className="rounded-lg border border-stone-800 bg-stone-950/60 px-4 py-2.5 text-sm"
              >
                <span className="mr-2 rounded-full bg-stone-800 px-2 py-0.5 text-xs text-amber-300">
                  {KIND_LABELS[event.kind] ?? event.kind}
                </span>
                <span className="text-stone-200">{event.summary}</span>
                <span className="ml-2 text-xs text-stone-500">
                  {new Date(event.createdAt).toLocaleDateString()}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </main>
  );
}
