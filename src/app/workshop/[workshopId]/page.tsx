"use client";

import { ArrowLeft, Loader2 } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, use, useCallback, useEffect, useState } from "react";
import { SystemCards } from "@/app/workshop/[workshopId]/SystemCards";
import { SystemView } from "@/app/workshop/[workshopId]/SystemView";
import { TargetPartyBar } from "@/app/workshop/[workshopId]/TargetPartyBar";
import { WorkshopHeader } from "@/app/workshop/[workshopId]/WorkshopHeader";
import {
  WORKSHOP_SYSTEMS,
  isSystemId,
  type SystemId,
} from "@/app/workshop/[workshopId]/systems";
import { markTourSeen, tourSeen } from "@/lib/tours/logic";
import { requestTourPrepare } from "@/lib/tours/prepare";
import { HUB_TOUR, HUB_TOUR_ID, SYSTEM_TOURS, systemTourId } from "@/lib/tours/workshop";
import { GuidedTour } from "@/components/ui/GuidedTour";
import { WorkshopHelpDialog, type HelpTour } from "@/components/WorkshopHelpDialog";
import type { WorkshopSummary } from "@/app/workshop/types";

// The workshop shell: a hub of system cards, or one system open.
//
// Which one is in the URL (?system=cast), so the back button leaves a system
// for the hub the way a DM expects, and a link to one system can be shared or
// bookmarked. The target-party bar stays pinned in both views because every
// encounter and odds preview budgets against it.
//
// Tours: the hub runs its walkthrough once, the first time a workshop is
// opened; each tool runs its own once, the first time it is opened. Help
// replays any of them. The page only broadcasts a step's prepare name; the
// panel that owns the editor in question answers it.

function WorkshopPageInner({ workshopId }: { workshopId: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const requested = useSearchParams().get("system");
  const system: SystemId | null = isSystemId(requested) ? requested : null;
  const [workshop, setWorkshop] = useState<WorkshopSummary | null>(null);
  const [bestiary, setBestiary] = useState<number | null>(null);
  const [homebrew, setHomebrew] = useState<number | null>(null);
  const [pregens, setPregens] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [helpOpen, setHelpOpen] = useState(false);
  // The tour on screen: the hub's, or a tool's, by id.
  const [tour, setTour] = useState<string | null>(null);

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

  // Homebrew monsters are not an importable kind, so the contents map does
  // not carry them; the bestiary list route is the only place to count them.
  const loadBestiary = useCallback(
    () =>
      fetch(`/api/campaigns/${workshopId}/dm/bestiary`)
        .then((response) => (response.ok ? response.json() : null))
        .then((data: { monsters?: unknown[] } | null) => {
          if (data?.monsters) {
            setBestiary(data.monsters.length);
          }
        })
        .catch(() => {
          // the card simply shows no figure until the next reload
        }),
    [workshopId],
  );

  // Items, spells and character options are user-scoped like monsters, so
  // their count comes from their own list route too.
  const loadHomebrew = useCallback(
    () =>
      fetch("/api/homebrew")
        .then((response) => (response.ok ? response.json() : null))
        .then((data: { entries?: Array<{ kind: string }> } | null) => {
          if (data?.entries) {
            setHomebrew(data.entries.filter((entry) => entry.kind !== "monster").length);
          }
        })
        .catch(() => {
          // the card simply shows no figure until the next reload
        }),
    [],
  );

  // Pregens are library characters filed under the workshop, counted by
  // the Party system's own route.
  const loadPregens = useCallback(
    () =>
      fetch(`/api/workshops/${workshopId}/pregens`)
        .then((response) => (response.ok ? response.json() : null))
        .then((data: { pregens?: unknown[] } | null) => {
          if (data?.pregens) {
            setPregens(data.pregens.length);
          }
        })
        .catch(() => {
          // the card simply shows no figure until the next reload
        }),
    [workshopId],
  );

  // Refetched whenever the view changes, so a person added inside Cast is
  // counted on the card the moment the DM steps back to the hub.
  useEffect(() => {
    void load();
    void loadBestiary();
    void loadHomebrew();
    void loadPregens();
  }, [load, loadBestiary, loadHomebrew, loadPregens, system]);

  // The once-only tours: the hub's when the workshop first loads, a tool's
  // the first time that tool is opened, after the panel has had a moment to
  // draw itself. A tour already on screen is left alone.
  // Spelled out rather than through systemTourId: a helper call at this
  // level is opaque to the React Compiler and costs the page its memoization.
  const tourId = system ? `workshop-${system}` : HUB_TOUR_ID;
  useEffect(() => {
    if (loading || !workshop || tour) return;
    if (tourSeen(window.localStorage, tourId)) return;
    const timer = window.setTimeout(() => setTour(tourId), 900);
    return () => clearTimeout(timer);
  }, [loading, workshop, tourId, tour]);

  function closeTour() {
    if (tour) markTourSeen(window.localStorage, tour);
    setTour(null);
  }

  function openSystem(next: SystemId) {
    router.push(`${pathname}?system=${next}`);
  }

  // What Help can replay from here: the hub's tour and, inside a tool, that
  // tool's own.
  const helpTours: HelpTour[] = [
    {
      label: "Tour the workshop",
      detail: "The hub: the party bar, the tool cards and the actions on the workshop.",
      onStart: () => setTour(HUB_TOUR_ID),
    },
    ...(system
      ? [
          {
            label: `Tour ${WORKSHOP_SYSTEMS.find((entry) => entry.id === system)?.label ?? system}`,
            detail: "This tool's controls, one at a time.",
            onStart: () => setTour(systemTourId(system)),
          },
        ]
      : []),
  ];
  const tourSteps = tour === HUB_TOUR_ID ? HUB_TOUR : tour ? SYSTEM_TOURS[tour.replace(/^workshop-/, "")] ?? [] : [];

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
      {system ? null : (
        <WorkshopHeader
          workshop={workshop}
          onHelp={() => setHelpOpen(true)}
          onRenamed={(title) =>
            setWorkshop((current) => (current ? { ...current, title } : current))
          }
        />
      )}
      <WorkshopHelpDialog
        open={helpOpen}
        onOpenChange={setHelpOpen}
        tours={helpTours}
        system={system}
      />
      <GuidedTour
        open={tour !== null}
        steps={tourSteps}
        onPrepare={requestTourPrepare}
        onClose={closeTour}
      />
      {/* Pinned: the negative margins let the blur run edge to edge while the
          bar itself keeps the page's gutter. */}
      <div
        className="sticky top-0 z-20 -mx-4 bg-stone-950/85 px-4 py-2 backdrop-blur-md sm:-mx-6 sm:px-6"
        data-tour="hub-party"
      >
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
      </div>
      {system ? (
        <SystemView
          workshop={workshop}
          system={system}
          bestiary={bestiary}
          homebrew={homebrew}
          pregens={pregens}
          onChange={openSystem}
          onBack={() => router.push(pathname)}
          onHelp={() => setHelpOpen(true)}
          onRulesApplied={() => void load()}
          onHomebrewChanged={() => void loadHomebrew()}
          onPregensChanged={() => void loadPregens()}
        />
      ) : (
        <SystemCards
          workshop={workshop}
          bestiary={bestiary}
          homebrew={homebrew}
          pregens={pregens}
          onOpen={openSystem}
        />
      )}
    </main>
  );
}

// useSearchParams needs a Suspense boundary during prerender in Next 16.
export default function WorkshopPage({
  params,
}: {
  params: Promise<{ workshopId: string }>;
}) {
  const { workshopId } = use(params);
  return (
    <Suspense
      fallback={
        <main className="flex flex-1 items-center justify-center">
          <Loader2 className="size-6 animate-spin text-stone-500" />
        </main>
      }
    >
      <WorkshopPageInner workshopId={workshopId} />
    </Suspense>
  );
}
