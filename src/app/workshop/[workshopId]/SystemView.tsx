"use client";

import { ArrowLeft, CircleHelp } from "lucide-react";
import { IconRail, type IconRailItem } from "@/components/ui/IconRail";
import { DmMapLibraryPanel } from "@/app/campaigns/[campaignId]/DmMapLibraryPanel";
import { DmNpcForgePanel } from "@/app/campaigns/[campaignId]/DmNpcForgePanel";
import { DmEncounterPrepPanel } from "@/app/campaigns/[campaignId]/DmEncounterPrepPanel";
import { DmBestiaryPanel } from "@/app/campaigns/[campaignId]/DmBestiaryPanel";
import { DmSharePanel } from "@/app/campaigns/[campaignId]/DmSharePanel";
import { DmStoryboardPanel } from "@/app/campaigns/[campaignId]/DmStoryboardPanel";
import { DmTablesPanel } from "@/app/campaigns/[campaignId]/DmTablesPanel";
import { LorePanel } from "@/app/campaigns/[campaignId]/LorePanel";
import { OverworldPanel } from "@/app/campaigns/[campaignId]/OverworldPanel";
import { RulesPanel } from "@/app/campaigns/[campaignId]/RulesPanel";
import { RulesetLibrary } from "@/app/workshop/RulesetLibrary";
import { HomebrewPanel } from "@/app/workshop/homebrew/HomebrewPanel";
import { PartyPanel } from "@/app/workshop/party/PartyPanel";
import { PluginPanel } from "@/app/workshop/plugin/PluginPanel";
import {
  WORKSHOP_SYSTEMS,
  systemCount,
  type SystemId,
} from "@/app/workshop/[workshopId]/systems";
import type { WorkshopSummary } from "@/app/workshop/types";

// One system, open. A way back to the hub, the system's name with its count,
// a sideways rail to hop to a neighbour, and then the panel itself.
//
// Every panel below is the one the DM console already uses, handed a
// workshop id instead of a campaign id. That works without a single change
// to any of them because a workshop IS a campaigns row and its owner holds
// the DM seat (docs/workshop-plan.md section 1). Cast and Battle maps opt
// into their workshop layouts; the other eight render as they always have.
// Party, Homebrew and Plugin are the workshop's own.

export function SystemView({
  workshop,
  system,
  bestiary,
  homebrew,
  pregens,
  plugin,
  onChange,
  onBack,
  onHelp,
  onRulesApplied,
  onHomebrewChanged,
  onPregensChanged,
  onPluginChanged,
}: {
  workshop: WorkshopSummary;
  system: SystemId;
  bestiary: number | null;
  homebrew: number | null;
  pregens: number | null;
  plugin: number | null;
  onChange: (system: SystemId) => void;
  onBack: () => void;
  // The guide for this tool and its tour.
  onHelp: () => void;
  onRulesApplied: () => void;
  onHomebrewChanged: () => void;
  onPregensChanged: () => void;
  onPluginChanged: (count: number) => void;
}) {
  const current = WORKSHOP_SYSTEMS.find((entry) => entry.id === system) ?? WORKSHOP_SYSTEMS[0];
  const count = systemCount(current.id, workshop, bestiary, homebrew, pregens, plugin);
  const items: IconRailItem<SystemId>[] = WORKSHOP_SYSTEMS.map((entry) => {
    const entryCount = systemCount(entry.id, workshop, bestiary, homebrew, pregens, plugin);
    return {
      value: entry.id,
      label: entry.label,
      icon: entry.icon,
      badge: entryCount.total || undefined,
      tour: `system-tab-${entry.id}`,
    };
  });

  return (
    <section className="mt-4">
      <button
        type="button"
        onClick={onBack}
        className="mb-3 inline-flex items-center gap-1.5 text-sm text-stone-500 hover:text-amber-200"
      >
        <ArrowLeft className="size-4" /> {workshop.title}
      </button>
      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 className="font-display text-xl tracking-wide text-amber-50">{current.label}</h2>
        <span className="text-sm text-stone-500">{count.phrase}</span>
        <button
          type="button"
          aria-label={`How ${current.label} works`}
          title="Guide and tour for this tool"
          onClick={onHelp}
          data-tour="system-help"
          className="ml-auto rounded-md border border-stone-700 p-1.5 text-stone-500 hover:text-stone-300"
        >
          <CircleHelp className="size-4" />
        </button>
      </div>
      <div data-tour="system-rail">
        <IconRail
          items={items}
          value={current.id}
          onChange={onChange}
          orientation="horizontal"
          className="mb-4 border-b border-stone-800/80 pb-1"
        />
      </div>

      {system === "storyboard" ? (
        <DmStoryboardPanel campaignId={workshop.id} layout="board" />
      ) : null}
      {system === "party" ? (
        <PartyPanel
          workshopId={workshop.id}
          targetParty={workshop.gameSettings.targetParty}
          onChanged={onPregensChanged}
        />
      ) : null}
      {system === "maps" ? <DmMapLibraryPanel campaignId={workshop.id} layout="gallery" /> : null}
      {system === "region" ? (
        <OverworldPanel campaignId={workshop.id} genre={workshop.gameSettings.genre} steersStory />
      ) : null}
      {system === "cast" ? <DmNpcForgePanel campaignId={workshop.id} layout="rows" /> : null}
      {system === "encounters" ? (
        // Rows mode renders the workbench itself, as the collapsible
        // "How hard is this?" card above the fights.
        <DmEncounterPrepPanel
          campaignId={workshop.id}
          layout="rows"
          targetParty={workshop.gameSettings.targetParty}
        />
      ) : null}
      {system === "bestiary" ? <DmBestiaryPanel campaignId={workshop.id} layout="rows" /> : null}
      {system === "homebrew" ? (
        <HomebrewPanel
          variantRules={workshop.gameSettings.variantRules}
          onChanged={onHomebrewChanged}
        />
      ) : null}
      {system === "lore" ? <LorePanel campaignId={workshop.id} steersStory layout="rows" /> : null}
      {system === "tables" ? <DmTablesPanel campaignId={workshop.id} layout="rows" /> : null}
      {system === "plugin" ? (
        <PluginPanel workshopId={workshop.id} onChanged={onPluginChanged} />
      ) : null}
      {system === "share" ? <DmSharePanel campaignId={workshop.id} /> : null}
      {system === "rules" ? (
        <>
          <RulesetLibrary campaignId={workshop.id} onApplied={onRulesApplied} />
          {/* Remounted on every apply so the editor below shows what the
              ruleset just wrote rather than the text it replaced. */}
          <RulesPanel
            key={workshop.updatedAt}
            campaignId={workshop.id}
            settings={workshop.gameSettings}
            steersStory
          />
        </>
      ) : null}
    </section>
  );
}
