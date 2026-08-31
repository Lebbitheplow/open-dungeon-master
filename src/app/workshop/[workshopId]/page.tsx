"use client";

import {
  ArrowLeft,
  BookOpen,
  CircleHelp,
  Dices,
  Globe2,
  LayoutGrid,
  Loader2,
  Map as MapIcon,
  Pencil,
  Scale,
  Share2,
  Skull,
  Swords,
  Users,
} from "lucide-react";
import Link from "next/link";
import { use, useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { DmMapLibraryPanel } from "@/app/campaigns/[campaignId]/DmMapLibraryPanel";
import { DmNpcForgePanel } from "@/app/campaigns/[campaignId]/DmNpcForgePanel";
import { DmEncounterPrepPanel } from "@/app/campaigns/[campaignId]/DmEncounterPrepPanel";
import { DmBestiaryPanel } from "@/app/campaigns/[campaignId]/DmBestiaryPanel";
import { DmSharePanel } from "@/app/campaigns/[campaignId]/DmSharePanel";
import { DmStoryboardPanel } from "@/app/campaigns/[campaignId]/DmStoryboardPanel";
import { DmWorkbenchPanel } from "@/app/campaigns/[campaignId]/DmWorkbenchPanel";
import { DmTablesPanel } from "@/app/campaigns/[campaignId]/DmTablesPanel";
import { LorePanel } from "@/app/campaigns/[campaignId]/LorePanel";
import { OverworldPanel } from "@/app/campaigns/[campaignId]/OverworldPanel";
import { RulesPanel } from "@/app/campaigns/[campaignId]/RulesPanel";
import { RulesetLibrary } from "@/app/workshop/RulesetLibrary";
import { TargetPartyBar } from "@/app/workshop/[workshopId]/TargetPartyBar";
import { WorkshopHelpDialog } from "@/components/WorkshopHelpDialog";
import type { WorkshopSummary } from "@/app/workshop/types";

// The workshop shell.
//
// Every panel below is the one the DM console already uses, handed a
// workshop id instead of a campaign id. That works without a single change
// to any of them because a workshop IS a campaigns row and its owner holds
// the DM seat (docs/workshop-plan.md section 1). This page is the proof that
// the shadow-campaign decision paid for itself.

const TABS = [
  { id: "storyboard", label: "Storyboard", icon: LayoutGrid },
  { id: "maps", label: "Battle maps", icon: MapIcon },
  { id: "region", label: "Region", icon: Globe2 },
  { id: "encounters", label: "Encounters", icon: Swords },
  { id: "cast", label: "Cast", icon: Users },
  { id: "bestiary", label: "Bestiary", icon: Skull },
  { id: "lore", label: "Lore", icon: BookOpen },
  { id: "tables", label: "Tables", icon: Dices },
  { id: "rules", label: "Rules", icon: Scale },
  { id: "share", label: "Share", icon: Share2 },
] as const;

type TabId = (typeof TABS)[number]["id"];

export default function WorkshopPage({
  params,
}: {
  params: Promise<{ workshopId: string }>;
}) {
  const { workshopId } = use(params);
  const [workshop, setWorkshop] = useState<WorkshopSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<TabId>("storyboard");
  const [helpOpen, setHelpOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");

  // Inline rename over the PATCH that has existed since the shelf shipped;
  // the title is merged locally rather than replaced with the response so
  // the contents counts already on screen are not clobbered.
  async function saveTitle() {
    const title = titleDraft.trim();
    setRenaming(false);
    if (!title || !workshop || title === workshop.title) {
      return;
    }
    const response = await fetch(`/api/workshops/${workshopId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
    if (response.ok) {
      setWorkshop((current) => (current ? { ...current, title } : current));
    }
  }

  const load = useCallback(
    () =>
      fetch(`/api/workshops/${workshopId}`)
        .then((response) => (response.ok ? response.json() : null))
        .then((data) => {
          if (data?.workshop) {
            setWorkshop(data.workshop);
          }
        })
        .catch(() => {
          // transient; the next action reloads
        })
        .finally(() => setLoading(false)),
    [workshopId],
  );

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <main className="flex flex-1 items-center justify-center">
        <Loader2 className="size-6 animate-spin text-stone-500" />
      </main>
    );
  }

  if (!workshop) {
    return (
      <main className="mx-auto w-full max-w-3xl flex-1 p-6">
        <Link
          href="/workshop"
          className="mb-4 inline-flex items-center gap-1.5 text-sm text-stone-500 hover:text-amber-200"
        >
          <ArrowLeft className="size-4" /> Workshop
        </Link>
        <p className="text-stone-400">That workshop does not exist, or is not yours.</p>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 p-4 sm:p-6">
      <header className="mb-5">
        <Link
          href="/workshop"
          className="mb-3 inline-flex items-center gap-1.5 text-sm text-stone-500 hover:text-amber-200"
        >
          <ArrowLeft className="size-4" /> All workshops
        </Link>
        <div className="flex items-center gap-2">
          {renaming ? (
            <input
              value={titleDraft}
              maxLength={80}
              autoFocus
              onChange={(event) => setTitleDraft(event.target.value)}
              onBlur={() => void saveTitle()}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  void saveTitle();
                }
                if (event.key === "Escape") {
                  setRenaming(false);
                }
              }}
              className="w-full max-w-md rounded-md border border-stone-700 bg-stone-950 px-2 py-1 font-display text-xl tracking-wide text-amber-50"
            />
          ) : (
            <>
              <h1 className="font-display text-xl tracking-wide text-amber-50">{workshop.title}</h1>
              <button
                type="button"
                aria-label="Rename this workshop"
                onClick={() => {
                  setTitleDraft(workshop.title);
                  setRenaming(true);
                }}
                className="rounded p-1 text-stone-500 hover:text-stone-300"
              >
                <Pencil className="size-3.5" />
              </button>
            </>
          )}
          <button
            type="button"
            aria-label="How workshops work"
            onClick={() => setHelpOpen(true)}
            className="ml-auto rounded-md border border-stone-700 p-1.5 text-stone-500 hover:text-stone-300"
          >
            <CircleHelp className="size-4" />
          </button>
        </div>
      </header>
      <WorkshopHelpDialog open={helpOpen} onOpenChange={setHelpOpen} />

      <TargetPartyBar
        workshopId={workshop.id}
        targetParty={workshop.gameSettings.targetParty}
        onSaved={(targetParty) =>
          setWorkshop((current) =>
            current
              ? { ...current, gameSettings: { ...current.gameSettings, targetParty } }
              : current,
          )
        }
      />

      <nav className="mb-4 mt-5 flex flex-wrap gap-1.5" aria-label="Workshop sections">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            aria-current={tab === id ? "page" : undefined}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm transition-colors duration-150",
              tab === id
                ? "border-amber-500/50 bg-stone-800/70 text-amber-100"
                : "border-stone-700/60 bg-stone-900/40 text-stone-400 hover:border-amber-500/30 hover:text-amber-100",
            )}
          >
            <Icon className="size-4" />
            {label}
          </button>
        ))}
      </nav>

      <section>
        {tab === "storyboard" ? <DmStoryboardPanel campaignId={workshop.id} /> : null}
        {tab === "maps" ? <DmMapLibraryPanel campaignId={workshop.id} /> : null}
        {tab === "region" ? (
          <OverworldPanel
            campaignId={workshop.id}
            genre={workshop.gameSettings.genre}
            steersStory
          />
        ) : null}
        {tab === "cast" ? <DmNpcForgePanel campaignId={workshop.id} /> : null}
        {tab === "encounters" ? (
          <div className="space-y-4">
            <DmEncounterPrepPanel campaignId={workshop.id} />
            <DmWorkbenchPanel campaignId={workshop.id} />
          </div>
        ) : null}
        {tab === "bestiary" ? <DmBestiaryPanel campaignId={workshop.id} /> : null}
        {tab === "lore" ? <LorePanel campaignId={workshop.id} steersStory /> : null}
        {tab === "tables" ? <DmTablesPanel campaignId={workshop.id} /> : null}
        {tab === "share" ? <DmSharePanel campaignId={workshop.id} /> : null}
        {tab === "rules" ? (
          <>
            <RulesetLibrary campaignId={workshop.id} onApplied={() => void load()} />
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
    </main>
  );
}
