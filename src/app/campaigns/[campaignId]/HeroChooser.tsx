"use client";

import { Plus, Sparkles, UserRound } from "lucide-react";
import { useEffect, useState } from "react";
import { GameIcon } from "@/components/ui/GameIcon";
import { SectionHead } from "@/components/ui/SectionHead";
import { cn } from "@/lib/cn";
import { IconChip, ui } from "@/lib/ui";
import type { CreateSheetInput } from "@/lib/schemas/sheet";
import { JoinConfirmDialog, type JoinHero } from "@/app/campaigns/[campaignId]/JoinConfirmDialog";
import { chooserSections } from "@/app/campaigns/[campaignId]/hero-chooser";
import { PregenPicker } from "@/app/campaigns/[campaignId]/PregenPicker";
import { useWorldPack } from "@/app/characters/builder/useBuilderOptions";
import { settingClassIds } from "@/lib/classes";
import { genrePreset } from "@/lib/genres";
import type { Genre } from "@/lib/schemas/game-settings";
import { findClass } from "@/lib/srd";
import { workshopClassName } from "@/lib/classes/workshop-registry";

export type ChooserCharacter = {
  id: string;
  name: string;
  role?: "pc" | "companion";
  race: string;
  class: string;
  subclass: string;
  level: number;
  // The workshop this sheet is a pregen for, or "" for the library's own.
  workshopId?: string;
  sheet?: CreateSheetInput;
};

function titleCase(value: string) {
  return value.replace(/[-_]/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

// One screen for every hero a seat can take (backlog F5), in this order: the
// player's own heroes, the pregens an adventure brought (a workshop's, which
// land in its importer's library: src/lib/db/workshop-bundle-parts.ts), the
// ready-made starters (src/lib/starter/pregens.ts), Help me build (the
// quick-build quiz, backlog F1), then Build new. Every pick, and every hero
// the quiz builds, opens the confirm sheet (JoinConfirmDialog.tsx) before it
// seats.
export function HeroChooser({
  campaignId,
  flow,
  level,
  characters,
  currentLibraryId,
  genre,
  worldPackId,
  onBuildNew,
  onHelpMeBuild,
  onSeated,
}: {
  campaignId: string;
  flow: "join" | "replace";
  // The table's starting level.
  level: number;
  // The player's library, allies the DM plays already left out.
  characters: ChooserCharacter[];
  currentLibraryId: string | null;
  // The table's setting, for the line that says a hero's class comes from
  // another one.
  genre?: Genre;
  worldPackId?: string;
  onBuildNew: () => void;
  // Opens the builder on the quick-build quiz, at this table's level.
  onHelpMeBuild: () => void;
  onSeated: () => void;
}) {
  const [workshops, setWorkshops] = useState<Record<string, string>>({});
  // Which of a library character's classes come from another setting than
  // the table's: said on the card before it joins, never refused (issue
  // #434). The same rule keeps the table's AI companions in setting.
  const pack = useWorldPack(worldPackId || undefined);
  const settingIds = genre ? settingClassIds(genre, (pack?.classes ?? []).map((entry) => entry.id)) : [];
  const settingName = pack?.name ?? (genre ? genrePreset(genre).name : "");
  const strangers = (character: ChooserCharacter): string[] => {
    if (!settingIds.length) {
      return [];
    }
    const ids = [...new Set([character.class, ...(character.sheet?.classes ?? []).map((entry) => entry.id)].map((id) => id.toLowerCase()))];
    return ids.filter((id) => !settingIds.includes(id)).map((id) => findClass(id)?.name ?? titleCase(id));
  };
  const [picked, setPicked] = useState<JoinHero | null>(null);
  const sections = chooserSections(characters);

  const wantsWorkshops = sections.pregens.length > 0;
  useEffect(() => {
    if (!wantsWorkshops) {
      return;
    }
    let cancelled = false;
    // Which adventure each pregen came with, by the workshop's title.
    fetch("/api/workshops")
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { workshops?: Array<{ id: string; title: string }> } | null) => {
        if (!cancelled) setWorkshops(Object.fromEntries((data?.workshops ?? []).map((workshop) => [workshop.id, workshop.title])));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [wantsWorkshops]);

  function characterCard(character: ChooserCharacter, from?: string) {
    return (
      <li key={character.id}>
        <button
          type="button"
          onClick={() => setPicked({ kind: "library", id: character.id, name: character.name })}
          className={cn(ui.cardHover, "w-full p-4 text-left")}
          data-hero-pick={character.id}
        >
          <div className="flex items-center gap-2">
            {character.sheet?.portrait?.url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={character.sheet.portrait.url}
                alt={character.name}
                className="size-8 shrink-0 rounded-lg border border-amber-500/30 object-cover"
              />
            ) : (
              <IconChip icon={UserRound} size="size-8" iconSize="size-4" />
            )}
            <span className="min-w-0 truncate font-display tracking-wide text-stone-100">{character.name}</span>
            <GameIcon icon={{ kind: "family", key: `class-${character.class.toLowerCase()}` }} size="size-7" className="ml-auto" />
            {character.id === currentLibraryId ? (
              <span className="rounded-full border border-amber-500/30 bg-amber-400/10 px-2 py-0.5 text-[11px] text-amber-200">
                current
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-sm text-stone-400">
            Level {character.level} {titleCase(character.race)} {workshopClassName(character.class) ?? titleCase(character.class)}
            {character.subclass ? ` (${character.subclass})` : ""}
          </p>
          {from ? <p className="mt-0.5 text-xs text-stone-500">From {from}</p> : null}
          {strangers(character).length ? (
            <p className="reveal mt-1 text-xs text-stone-400">
              {strangers(character).join(" and ")} {strangers(character).length === 1 ? "comes" : "come"} from another setting; this table plays {settingName}.
            </p>
          ) : null}
          {character.level !== level ? (
            <p className="reveal mt-1 text-xs text-amber-200">
              {character.level < level
                ? `Levelled up to ${level} for this table. Your library copy stays level ${character.level} until the campaign ends and brings its progress home.`
                : `Plays at level ${level} here. Your library copy keeps level ${character.level}; gear, gold and notes still come home with it.`}
            </p>
          ) : null}
        </button>
      </li>
    );
  }

  return (
    <section className="reveal space-y-5" data-hero-chooser>
      {sections.own.length ? (
        <div className="space-y-3" data-chooser-section="library">
          <SectionHead title="Your heroes" glyph="tab-characters" level="h2" aside={<span className="text-xs text-stone-400">{sections.own.length}</span>} />
          <ul className="stagger-up grid grid-cols-1 gap-3 sm:grid-cols-2">
            {sections.own.map((character) => characterCard(character))}
          </ul>
        </div>
      ) : null}

      {sections.pregens.length ? (
        <div className="space-y-3" data-chooser-section="pregens">
          <SectionHead title="Pregens from your adventures" glyph="tab-characters" level="h2" aside={<span className="text-xs text-stone-400">{sections.pregens.length}</span>} />
          <p className="text-xs text-stone-400">Heroes a workshop or an imported adventure was written for.</p>
          <ul className="stagger-up grid grid-cols-1 gap-3 sm:grid-cols-2">
            {sections.pregens.map((character) =>
              characterCard(character, workshops[character.workshopId ?? ""] || "an adventure"),
            )}
          </ul>
        </div>
      ) : null}

      {/* The ready-made starters, through the same confirm sheet. A switch
          in the lobby swaps one library hero for another (PUT /sheet); the
          ready-made door only seats a first hero, so it is not offered. */}
      {flow === "join" ? <PregenPicker campaignId={campaignId} heading="Ready-made heroes" onSeated={onSeated} /> : null}

      {/* A few questions, then a hero built at this table's level; it comes
          back here through the same confirm sheet (backlog F1). */}
      <button
        type="button"
        onClick={onHelpMeBuild}
        className={cn(ui.cardHover, "flex w-full items-center gap-3 p-4 text-left")}
        data-chooser-section="help"
      >
        <IconChip icon={Sparkles} size="size-8" iconSize="size-4" />
        <span className="min-w-0">
          <span className="block font-display tracking-wide text-stone-100">Help me build</span>
          <span className="block text-sm text-stone-400">Answer a few questions and get a hero suggested for you.</span>
        </span>
      </button>

      <button
        type="button"
        onClick={onBuildNew}
        className={cn(ui.btnSecondary, "w-full border-dashed")}
        data-chooser-section="build"
      >
        <Plus className="size-4" /> Build a new character
      </button>

      <JoinConfirmDialog
        campaignId={campaignId}
        hero={picked}
        flow={flow}
        onClose={() => setPicked(null)}
        onSeated={onSeated}
      />
    </section>
  );
}
