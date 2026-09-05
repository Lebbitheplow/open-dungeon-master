"use client";

import { ArrowLeft } from "lucide-react";
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

export function SystemView({
  workshop,
  system,
  bestiary,
  onChange,
  onBack,
  onRulesApplied,
}: {
  workshop: WorkshopSummary;
  system: SystemId;
  bestiary: number | null;
  onChange: (system: SystemId) => void;
  onBack: () => void;
  onRulesApplied: () => void;
}) {
  const current = WORKSHOP_SYSTEMS.find((entry) => entry.id === system) ?? WORKSHOP_SYSTEMS[0];
  const count = systemCount(current.id, workshop, bestiary);
  const items: IconRailItem<SystemId>[] = WORKSHOP_SYSTEMS.map((entry) => {
    const entryCount = systemCount(entry.id, workshop, bestiary);
    return {
      value: entry.id,
      label: entry.label,
      icon: entry.icon,
      badge: entryCount.total || undefined,
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
      <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="font-display text-xl tracking-wide text-amber-50">{current.label}</h2>
        <span className="text-sm text-stone-500">{count.phrase}</span>
      </div>
      <IconRail
        items={items}
        value={current.id}
        onChange={onChange}
        orientation="horizontal"
        className="mb-4 border-b border-stone-800/80 pb-1"
      />

      {system === "storyboard" ? (
        <DmStoryboardPanel campaignId={workshop.id} layout="board" />
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
      {system === "lore" ? <LorePanel campaignId={workshop.id} steersStory layout="rows" /> : null}
      {system === "tables" ? <DmTablesPanel campaignId={workshop.id} layout="rows" /> : null}
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
