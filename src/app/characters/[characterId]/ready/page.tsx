"use client";

import Link from "next/link";
import { use, useEffect, useMemo, useRef, useState } from "react";
import { PageSkeleton } from "@/components/PageSkeleton";
import { AppHeader } from "@/components/AppHeader";
import { GameIcon } from "@/components/ui/GameIcon";
import { useHandSpells } from "@/app/campaigns/[campaignId]/HandSpells";
import { cn } from "@/lib/cn";
import { useLowEffects } from "@/lib/effects-mode";
import { freshPlaySheet, revealLine, threeThingsToTry } from "@/lib/characters/hero-tips";
import type { CreateSheetInput } from "@/lib/schemas/sheet";
import { CharacterPortrait, ui } from "@/lib/ui";
import { UseInCampaignDialog } from "../UseInCampaignDialog";

// The hero page (backlog F23 and F26): where a new character lands after
// its first save. A text page, not a toast: its own heading, which takes
// focus on arrival, the portrait or its placeholder while it paints, the
// line that notices the build, three things to try on a first turn, and the
// two ways on: to a table, or back to the roster. Every number on it is the
// table's own (src/lib/characters/hero-tips.ts). Nothing here times out.

type ReadyCharacter = {
  id: string;
  name: string;
  role?: "pc" | "companion";
  race: string;
  class: string;
  subclass: string;
  level: number;
  portraitStatus?: "queued" | "generating" | "failed" | null;
  campaigns?: Array<{ campaignId: string }>;
  sheet: CreateSheetInput;
};

// The sheet page's limit: polling stops even if the job never resolves.
const PORTRAIT_POLL_LIMIT = 240;

// An id as words ("half-elf" as "half elf"); the line's capitalize class
// shows it title-cased.
function spaced(value: string) {
  return value.split(/[-_]/).join(" ");
}

export default function HeroReadyPage({ params }: { params: Promise<{ characterId: string }> }) {
  const { characterId } = use(params);
  const [character, setCharacter] = useState<ReadyCharacter | null>(null);
  const [loading, setLoading] = useState(true);
  const [seating, setSeating] = useState(false);
  const [skip, setSkip] = useState(false);
  const [skipError, setSkipError] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);
  const pollCount = useRef(0);
  const lowEffects = useLowEffects();

  useEffect(() => {
    fetch(`/api/characters/${characterId}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (data?.character) setCharacter(data.character);
      })
      .finally(() => setLoading(false));
    fetch("/api/profile", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => setSkip(data?.settings?.skipHeroPage === true))
      .catch(() => {});
  }, [characterId]);

  // Focus moves to the heading once, when the page has something to say,
  // so a screen reader starts at the character's name.
  // Deferred a tick: in the apps the heading is attached after this effect
  // runs on the render that loads it, and a focus() then found no element.
  const loaded = character !== null;
  useEffect(() => {
    if (!loaded) return;
    const id = window.setTimeout(() => heading.current?.focus(), 0);
    return () => window.clearTimeout(id);
  }, [loaded]);

  // The portrait paints in the background; re-read until it lands.
  const portraitPending = character?.portraitStatus === "queued" || character?.portraitStatus === "generating";
  useEffect(() => {
    if (!portraitPending || pollCount.current >= PORTRAIT_POLL_LIMIT) return;
    const id = setTimeout(() => {
      pollCount.current += 1;
      fetch(`/api/characters/${characterId}`)
        .then((response) => (response.ok ? response.json() : null))
        .then((data) => {
          if (data?.character) setCharacter(data.character);
        })
        .catch(() => {});
    }, 2500);
    return () => clearTimeout(id);
  }, [portraitPending, character, characterId]);

  // The sheet as it sits down at a table: what the tips and the reveal read.
  // Keyed on the sheet alone, so a portrait poll does not rebuild it.
  const sheet = character?.sheet;
  const level = character?.level ?? 1;
  const play = useMemo(
    () => (sheet ? freshPlaySheet({ id: characterId, name: sheet.name, level, sheet }) : null),
    [sheet, level, characterId],
  );
  const spells = useHandSpells(play);
  const tips = useMemo(() => (play ? threeThingsToTry(play, spells) : []), [play, spells]);
  const reveal = useMemo(() => (play ? revealLine(play) : ""), [play]);

  async function changeSkip(next: boolean) {
    setSkip(next);
    setSkipError("");
    try {
      const response = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings: { skipHeroPage: next } }),
      });
      if (!response.ok) throw new Error("refused");
    } catch {
      setSkip(!next);
      setSkipError("Could not save that. Try again.");
    }
  }

  if (loading) {
    return (
      <main className="mx-auto w-full max-w-3xl flex-1 p-4 sm:p-6">
        <AppHeader />
        <PageSkeleton kind="sheet" className="px-0 py-2" />
      </main>
    );
  }

  if (!character || !play) {
    return (
      <main className="mx-auto w-full max-w-3xl flex-1 p-4 sm:p-6">
        <AppHeader />
        <div className={cn(ui.card, "ornate texture-noise flex flex-col items-center gap-3 px-6 py-8 text-center")}>
          <p className="font-serif text-sm text-stone-300">Character not found.</p>
          <Link href="/characters" className={ui.btnSecondary}>
            Back to your library
          </Link>
        </div>
      </main>
    );
  }

  const portraitUrl = character.sheet.portrait?.url;
  const ancestry = spaced(character.race);
  const calling = `${spaced(character.class)}${character.subclass ? ` (${spaced(character.subclass)})` : ""}`;
  const motion = lowEffects ? "" : "reveal";

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 p-4 sm:p-6">
      <AppHeader />
      <section
        aria-labelledby="hero-heading"
        className={cn(ui.card, "ornate texture-noise mb-4 p-4 sm:p-6", motion)}
      >
        <div className="flex flex-col items-center gap-4 text-center sm:flex-row sm:items-start sm:text-left">
          <span className="relative shrink-0">
            {portraitUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={portraitUrl}
                alt={`Portrait of ${character.name}`}
                className="size-28 rounded-xl border border-amber-500/30 object-cover shadow-glow-gold sm:size-32"
              />
            ) : (
              <CharacterPortrait
                look={{ race: character.race, class: character.class, gender: character.sheet.gender }}
                alt={`${character.name}, placeholder portrait`}
                size="size-28 sm:size-32"
                rounded="rounded-xl"
                className="border-amber-500/30 shadow-glow-gold"
              />
            )}
            <GameIcon
              icon={{ kind: "family", key: `class-${character.class}` }}
              size="size-9"
              className="pointer-events-none absolute -bottom-2 -right-2"
            />
          </span>
          <div className="min-w-0 flex-1">
            <h1
              id="hero-heading"
              ref={heading}
              tabIndex={-1}
              className="gold-title font-display text-3xl tracking-wide outline-none focus-visible:ring-2 focus-visible:ring-amber-300/60 sm:text-4xl"
            >
              {character.name} is ready
            </h1>
            <p className="mt-1 text-sm capitalize text-stone-300">
              Level {character.level} {ancestry} {calling}
            </p>
            {reveal ? <p className="mt-2 font-serif text-base italic text-amber-200">{reveal}</p> : null}
            {portraitPending ? (
              <p className="mt-2 text-xs text-stone-400">The portrait is still painting. It will appear here when it is done.</p>
            ) : !portraitUrl && character.portraitStatus === "failed" ? (
              <p className="mt-2 text-xs text-stone-500">The portrait couldn&apos;t be painted. You can paint or upload one from the sheet.</p>
            ) : null}
          </div>
        </div>
      </section>

      <section aria-labelledby="hero-tips-heading" className={cn(ui.card, "mb-4 p-4 sm:p-5", motion)}>
        <h2 id="hero-tips-heading" className="font-display text-lg tracking-wide text-amber-100">
          Three things to try on your turn
        </h2>
        {tips.length ? (
          <ol className="mt-3 space-y-3">
            {tips.map((tip) => (
              <li key={tip.text} className="flex items-start gap-3">
                <GameIcon icon={tip.icon} size="size-7" className="mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm text-stone-100">{tip.text}</p>
                  {tip.note ? <p className="mt-0.5 text-xs text-stone-400">{tip.note}</p> : null}
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <p className="mt-3 text-sm text-stone-400">Your sheet lists everything you can do once you sit down at a table.</p>
        )}
      </section>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <label className="inline-flex min-h-10 cursor-pointer items-center gap-2 text-sm text-stone-300">
          <input
            type="checkbox"
            checked={skip}
            onChange={(event) => void changeSkip(event.target.checked)}
            className="size-5 accent-amber-400 focus-visible:outline-2 focus-visible:outline-amber-300"
          />
          Don&apos;t show this again
        </label>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setSeating(true)} className={cn(ui.btnPrimary, "min-w-0 flex-1 sm:flex-none")}>
            <GameIcon icon={{ kind: "glyph", key: "tab-campaigns" }} size="size-6" /> Bring to a table
          </button>
          <Link href="/characters" className={cn(ui.btnSecondary, "min-w-0 flex-1 sm:flex-none")}>
            Done
          </Link>
        </div>
      </div>
      {skipError ? (
        <p role="alert" className="mt-2 text-sm text-red-400">
          {skipError}
        </p>
      ) : null}

      {seating ? (
        <UseInCampaignDialog
          characterId={characterId}
          characterName={character.name}
          characterLevel={character.level}
          role={character.role}
          seatedIn={(character.campaigns ?? []).map((assignment) => assignment.campaignId)}
          onClose={() => setSeating(false)}
        />
      ) : null}
    </main>
  );
}
