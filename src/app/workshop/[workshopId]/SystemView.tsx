"use client";

import { ArrowLeft, CircleHelp } from "lucide-react";
import { IconRail, type IconRailItem } from "@/components/ui/IconRail";
import { GameIcon } from "@/components/ui/GameIcon";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { headIcon } from "@/app/workshop/kit";
import { Suspense, lazy } from "react";
import { PanelLoading } from "@/app/campaigns/[campaignId]/side-panel-loaders";

// One tool shows at a time, so each is its own download, fetched when the
// tool is opened: the hub and the first tool no longer carry every other
// tool's editors and rules tables.
const DmMapLibraryPanel = lazy(() => import("@/app/campaigns/[campaignId]/DmMapLibraryPanel").then((module) => ({ default: module.DmMapLibraryPanel })));
const DmNpcForgePanel = lazy(() => import("@/app/campaigns/[campaignId]/DmNpcForgePanel").then((module) => ({ default: module.DmNpcForgePanel })));
const DmEncounterPrepPanel = lazy(() => import("@/app/campaigns/[campaignId]/DmEncounterPrepPanel").then((module) => ({ default: module.DmEncounterPrepPanel })));
const DmBestiaryPanel = lazy(() => import("@/app/campaigns/[campaignId]/DmBestiaryPanel").then((module) => ({ default: module.DmBestiaryPanel })));
const DmSharePanel = lazy(() => import("@/app/campaigns/[campaignId]/DmSharePanel").then((module) => ({ default: module.DmSharePanel })));
const DmStoryboardPanel = lazy(() => import("@/app/campaigns/[campaignId]/DmStoryboardPanel").then((module) => ({ default: module.DmStoryboardPanel })));
const DmTablesPanel = lazy(() => import("@/app/campaigns/[campaignId]/DmTablesPanel").then((module) => ({ default: module.DmTablesPanel })));
const LorePanel = lazy(() => import("@/app/campaigns/[campaignId]/LorePanel").then((module) => ({ default: module.LorePanel })));
const OverworldPanel = lazy(() => import("@/app/campaigns/[campaignId]/OverworldPanel").then((module) => ({ default: module.OverworldPanel })));
const RulesPanel = lazy(() => import("@/app/campaigns/[campaignId]/RulesPanel").then((module) => ({ default: module.RulesPanel })));
const FactionsPanel = lazy(() => import("@/app/campaigns/[campaignId]/FactionsPanel").then((module) => ({ default: module.FactionsPanel })));
const MarketPanel = lazy(() => import("@/app/campaigns/[campaignId]/MarketPanel").then((module) => ({ default: module.MarketPanel })));
const RulesetLibrary = lazy(() => import("@/app/workshop/RulesetLibrary").then((module) => ({ default: module.RulesetLibrary })));
const HomebrewPanel = lazy(() => import("@/app/workshop/homebrew/HomebrewPanel").then((module) => ({ default: module.HomebrewPanel })));
const PartyPanel = lazy(() => import("@/app/workshop/party/PartyPanel").then((module) => ({ default: module.PartyPanel })));
const PluginPanel = lazy(() => import("@/app/workshop/plugin/PluginPanel").then((module) => ({ default: module.PluginPanel })));
const WorldForgePanel = lazy(() => import("@/app/workshop/world/WorldForgePanel").then((module) => ({ default: module.WorldForgePanel })));
import {
  WORKSHOP_SYSTEMS,
  isSystemId,
  systemCount,
  systemGlyph,
  type SystemId,
  type WorldCount,
} from "@/app/workshop/[workshopId]/systems";
import type { WorkshopSummary } from "@/app/workshop/types";
import { parseRef, refOf } from "@/lib/worldforge/model";
import type { RecordVersions } from "@/app/workshop/[workshopId]/useWorkshopVersions";
import { CreateButton } from "@/app/workshop/[workshopId]/CreateChooser";

// One system, open. A way back to the hub, the system's name with its count,
// a sideways rail to hop to a neighbour, and then the panel itself.
//
// Every panel below is the one the DM console already uses, handed a
// workshop id instead of a campaign id. That works without a single change
// to any of them because a workshop IS a campaigns row and its owner holds
// the DM seat (docs/workshop-plan.md section 1). Cast and Battle maps opt
// into their workshop layouts; the other eight render as they always have.
// Party, Homebrew, Plugin and WorldForge are the workshop's own.

export function SystemView({
  workshop,
  system,
  bestiary,
  homebrew,
  pregens,
  plugin,
  world = null,
  onChange,
  onBack,
  onCreate,
  onHelp,
  onRulesApplied,
  onHomebrewChanged,
  onPregensChanged,
  onPluginChanged,
  openId = null,
  from = null,
  onOpenRecord,
  onWorldEntry,
  versions,
}: {
  workshop: WorkshopSummary;
  system: SystemId;
  bestiary: number | null;
  homebrew: number | null;
  pregens: number | null;
  plugin: number | null;
  world?: WorldCount | null;
  onChange: (system: SystemId) => void;
  onBack: () => void;
  // The Create chooser, from the tool's own header and WorldForge's empty wiki.
  onCreate: () => void;
  // The guide for this tool and its tour.
  onHelp: () => void;
  onRulesApplied: () => void;
  onHomebrewChanged: () => void;
  onPregensChanged: () => void;
  onPluginChanged: (count: number) => void;
  // From the URL (src/lib/workshop/links.ts): the record this tool opens on
  // arrival, and the World entry the author came from.
  openId?: string | null;
  from?: string | null;
  // A record in its own tool, with the World entry to come back to; and a
  // record's World entry.
  onOpenRecord: (system: SystemId, id: string, from: string) => void;
  onWorldEntry: (ref: string) => void;
  // Each kind of record's version (useWorkshopVersions): a tool refetches
  // when its own kind's moves.
  versions: RecordVersions;
}) {
  const current = WORKSHOP_SYSTEMS.find((entry) => entry.id === system) ?? WORKSHOP_SYSTEMS[0];
  const count = systemCount(current.id, workshop, bestiary, homebrew, pregens, plugin, world);
  const items: IconRailItem<SystemId>[] = WORKSHOP_SYSTEMS.map((entry) => {
    const entryCount = systemCount(entry.id, workshop, bestiary, homebrew, pregens, plugin, world);
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
        className={cn(ui.btnSmall, "mb-3 border-transparent bg-transparent px-1 text-sm text-stone-400 shadow-none")}
      >
        <ArrowLeft className="size-4" /> {workshop.title}
      </button>
      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1">
        <GameIcon icon={systemGlyph(current.id)} size="size-9" />
        <h2 className="gold-title font-display text-xl tracking-wide">{current.label}</h2>
        <span className="text-sm text-stone-500">{count.phrase}</span>
        <CreateButton onClick={onCreate} className="ml-auto" />
        <button
          type="button"
          aria-label={`How ${current.label} works`}
          title="Guide and tour for this tool"
          onClick={onHelp}
          data-tour="system-help"
          className={cn(ui.iconAction, headIcon)}
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

      {from && parseRef(from) && system !== "world" ? (
        <button type="button" onClick={() => onWorldEntry(from)} className={cn(ui.btnSmall, "mb-3")} data-testid="back-to-world-entry">
          <ArrowLeft className="size-3.5" /> Back to the World entry
        </button>
      ) : null}
      {/* Keyed by system so the incoming tool rises in instead of cutting. */}
      <div key={system} className="motion-tab">
        <Suspense fallback={<PanelLoading />}>
        {system === "world" ? (
          <WorldForgePanel
            campaignId={workshop.id}
            onCreate={onCreate}
            refreshKey={versions.npc + versions.lore + versions.location + versions.faction + versions.world}
            onOpenSystem={(next, record) => {
              if (!isSystemId(next)) return;
              if (record) onOpenRecord(next, record.id, record.from);
              else onChange(next);
            }}
          />
        ) : null}
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
        {system === "maps" ? <DmMapLibraryPanel campaignId={workshop.id} layout="gallery" openOnArrival={openId} /> : null}
        {system === "region" ? (
          <OverworldPanel campaignId={workshop.id} genre={workshop.gameSettings.genre} steersStory />
        ) : null}
        {system === "cast" ? <DmNpcForgePanel campaignId={workshop.id} layout="rows" refreshKey={versions.npc} openId={openId} onWorldEntry={(id) => onWorldEntry(refOf("npc", id))} /> : null}
        {system === "encounters" ? (
          // Rows mode renders the workbench itself, as the collapsible
          // "How hard is this?" card above the fights.
          <DmEncounterPrepPanel
            campaignId={workshop.id}
            layout="rows"
            openOnArrival={openId}
            targetParty={workshop.gameSettings.targetParty}
          />
        ) : null}
        {system === "bestiary" ? <DmBestiaryPanel campaignId={workshop.id} layout="rows" openOnArrival={openId} onWorldEntry={onWorldEntry} /> : null}
        {system === "homebrew" ? (
          <HomebrewPanel
            campaignId={workshop.id}
            openOnArrival={openId}
            onWorldEntry={onWorldEntry}
            variantRules={workshop.gameSettings.variantRules}
            onChanged={onHomebrewChanged}
          />
        ) : null}
        {system === "lore" ? (
          <>
            <LorePanel campaignId={workshop.id} steersStory isDm layout="rows" refreshKey={versions.lore} openId={openId} onWorldEntry={(id) => onWorldEntry(refOf("lore", id))} />
            <MarketPanel campaignId={workshop.id} steersStory isDm mySheet={null} />
          </>
        ) : null}
        {system === "factions" ? <FactionsPanel campaignId={workshop.id} steersStory refreshKey={versions.faction} openId={openId} onWorldEntry={(id) => onWorldEntry(refOf("faction", id))} /> : null}
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
              isDm
            />
          </>
        ) : null}
        </Suspense>
      </div>
    </section>
  );
}
