"use client";

import { EmptyState } from "@/components/EmptyState";
import { Loader2, Plus, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { GameIcon } from "@/components/ui/GameIcon";
import { SectionHead } from "@/components/ui/SectionHead";
import { Select } from "@/components/ui/Select";
import { ListHead, useListHead } from "@/app/workshop/ListHead";
import { rowIcon } from "@/app/workshop/kit";
import type { TargetParty } from "@/lib/workshop/kind";

// The Party system (docs/workshop-parity-audit.md phase 15): the party a
// workshop is built for, already declared in the pinned bar above, and the
// pregenerated characters that stand in for players who arrive without a
// sheet. A pregen is one of the DM's own library characters filed under
// this workshop; it is built and edited where every character is, and it
// travels in the bundle.

type Pregen = {
  id: string;
  name: string;
  role: "pc" | "companion";
  race: string;
  class: string;
  subclass: string;
  background: string;
  level: number;
};

type LibraryEntry = Pregen & { workshopId: string };

const NO_PREGENS: Pregen[] = [];
const readPregen = (character: Pregen) => ({ name: character.name });

const chip = "flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px]";

// A class or a companion, as the painted family icon; nothing if unpainted.
const faceOf = (character: Pregen) => ({
  kind: "family" as const,
  key: `class-${character.class}`,
});

function describe(character: Pregen): string {
  const parts = [character.race, character.class];
  if (character.subclass) {
    parts.push(`(${character.subclass})`);
  }
  return `Level ${character.level} ${parts.filter(Boolean).join(" ")}`;
}

export function PartyPanel({
  workshopId,
  targetParty,
  onChanged,
}: {
  workshopId: string;
  targetParty: TargetParty;
  onChanged: () => void;
}) {
  const [pregens, setPregens] = useState<Pregen[] | null>(null);
  const [library, setLibrary] = useState<LibraryEntry[]>([]);
  const [picked, setPicked] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Bumped after a change so the roster and the library are read again.
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch(`/api/workshops/${workshopId}/pregens`).then((response) =>
        response.ok ? response.json() : null,
      ),
      fetch("/api/characters").then((response) => (response.ok ? response.json() : null)),
    ])
      .then(([roster, shelf]) => {
        if (cancelled) {
          return;
        }
        if (roster?.pregens) {
          setPregens(roster.pregens);
        }
        if (shelf?.characters) {
          setLibrary(shelf.characters);
        }
      })
      .catch(() => {
        // transient; the next action reloads
      });
    return () => {
      cancelled = true;
    };
  }, [workshopId, version]);

  async function change(method: "POST" | "DELETE", characterId: string) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/workshops/${workshopId}/pregens`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ characterId }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError((payload as { error?: string }).error ?? "That did not work.");
        return;
      }
      setPregens((payload as { pregens: Pregen[] }).pregens);
      setPicked("");
      setVersion((current) => current + 1);
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  const head = useListHead(pregens ?? NO_PREGENS, readPregen);
  const rostered = new Set((pregens ?? []).map((character) => character.id));
  const available = library.filter((character) => !rostered.has(character.id));

  return (
    <section className="space-y-4">
      <SectionHead title="The party this is built for" glyph="system-party" level="h3" className="mb-0" />
      <p className="text-sm text-stone-400">
        Built for {targetParty.size} at level {targetParty.level}; every encounter and odds preview
        budgets against that. The characters below are pregens: sheets ready for anyone who sits
        down without one. They ride along in the bundle.
      </p>

      {pregens === null ? (
        <div aria-busy="true">
          <p className="mb-1.5 text-xs text-stone-500">Reading the roster...</p>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="skeleton-block h-20 rounded-xl" />
            <div className="skeleton-block hidden h-20 rounded-xl sm:block" />
          </div>
        </div>
      ) : (
        <>
        <ListHead head={head} noun={["pregen", "pregens"]} placeholder="Find a pregen" />
        <ul className="stagger-up grid gap-2 sm:grid-cols-2" data-tour="party-roster">
          {head.shown.map((character) => {
            const offLevel = character.level !== targetParty.level;
            return (
              <li key={character.id} className={cn(ui.card, "flex items-start gap-3 p-3")}>
                {/* The class painting sits over the party glyph, so a class
                    with no painting of its own still has a face. */}
                <span className="relative grid size-12 shrink-0 place-items-center rounded-lg border border-amber-500/25 bg-stone-950/70">
                  <GameIcon icon={{ kind: "glyph", key: "system-party" }} size="size-9" />
                  {character.class ? <GameIcon icon={faceOf(character)} size="size-9" className="absolute" /> : null}
                </span>
                <span className="min-w-0 flex-1">
                  <Link
                    href={`/characters/${character.id}`}
                    className="font-display tracking-wide text-amber-50 hover:text-amber-200"
                  >
                    {character.name}
                  </Link>
                  <span className="block text-sm text-stone-400">{describe(character)}</span>
                  <span className="mt-1 flex flex-wrap gap-1">
                    {character.role === "companion" ? (
                      <span className={cn(chip, "border-stone-700 text-stone-400")}>Companion</span>
                    ) : null}
                    {offLevel ? (
                      <span className={cn(chip, "border-amber-800 text-amber-300/90")}>
                        Level {character.level}, the party is built for {targetParty.level}
                      </span>
                    ) : null}
                  </span>
                </span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void change("DELETE", character.id)}
                  title="Take it off the roster. It stays in your library."
                  aria-label={`Take ${character.name} off the roster`}
                  className={cn(ui.iconAction, rowIcon, "hover:text-red-300 disabled:opacity-50")}
                >
                  <X className="size-3.5" />
                </button>
              </li>
            );
          })}
          {pregens.length === 0 ? (
            <li className="sm:col-span-2"><EmptyState art="board" title="No pregens yet. Pick one from your library below, or build one and come back." /></li>
          ) : null}
        </ul>
        </>
      )}

      <div className={cn(ui.card, "space-y-2 p-3")} data-tour="party-add">
        <SectionHead title="Add to the roster" glyph="tab-characters" className="mb-0" />
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-full min-w-48 sm:w-80">
          <Select
            value={picked}
            onChange={setPicked}
            label="A character from your library"
            placeholder="From your library..."
            options={available.map((character) => ({
              value: character.id,
              label: character.name,
              hint: `${describe(character)}${character.workshopId && character.workshopId !== workshopId ? " (in another workshop)" : ""}`,
              icon: character.class ? faceOf(character) : { kind: "glyph" as const, key: "system-party" },
            }))}
          />
          </span>
          <button
            type="button"
            disabled={busy || !picked}
            onClick={() => void change("POST", picked)}
            className={ui.btnPrimary}
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />} Add it
          </button>
          <Link href="/characters/new" className={ui.btnSecondary}>
            Build a new one
          </Link>
        </div>
        {available.length === 0 && library.length > 0 ? (
          <p className="reveal text-xs text-stone-500">Every character in your library is already on the roster.</p>
        ) : null}
        {error ? <p className="motion-shake text-xs text-red-400">{error}</p> : null}
      </div>
    </section>
  );
}
