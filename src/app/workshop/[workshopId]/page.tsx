"use client";

import { ArrowLeft } from "lucide-react";
import { PageSkeleton } from "@/components/PageSkeleton";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, lazy, use, useCallback, useEffect, useState } from "react";
import { SystemCards } from "@/app/workshop/[workshopId]/SystemCards";
import { SystemView } from "@/app/workshop/[workshopId]/SystemView";
import { TargetPartyBar } from "@/app/workshop/[workshopId]/TargetPartyBar";
import { WorkshopHeader } from "@/app/workshop/[workshopId]/WorkshopHeader";
import {
  WORKSHOP_SYSTEMS,
  isSystemId,
  systemCount,
  type SystemId,
  type WorldCount,
} from "@/app/workshop/[workshopId]/systems";
import { workshopCommands } from "@/app/workshop/[workshopId]/palette-commands";
import { CommandPalette } from "@/components/CommandPalette";
import type { TourEnd } from "@/lib/tours/account-logic";
import { finishTour, useTourFinished } from "@/lib/tours/tour-store";
import { draftCount, worldPackDraftSchema } from "@/lib/worlds/draft";
import { requestTourPrepare } from "@/lib/tours/prepare";
import { HUB_TOUR, HUB_TOUR_ID, SYSTEM_TOURS, systemTourId } from "@/lib/tours/workshop";
import type { HelpTour } from "@/components/WorkshopHelpDialog";

// The guide and the tour load the first time they are opened, and stay
// mounted after so they animate closed.
const GuidedTour = lazy(() => import("@/components/ui/GuidedTour").then((module) => ({ default: module.GuidedTour })));
const WorkshopHelpDialog = lazy(() =>
  import("@/components/WorkshopHelpDialog").then((module) => ({ default: module.WorkshopHelpDialog })),
);
import type { WorkshopSummary } from "@/app/workshop/types";
import { workshopHref, worldEntryPlace } from "@/lib/workshop/links";
import { useWorkshopVersions } from "@/app/workshop/[workshopId]/useWorkshopVersions";
import { mayLeaveDrafts } from "@/app/workshop/unsaved";
import { CreateChooser } from "@/app/workshop/[workshopId]/CreateChooser";
import type { CreateStep } from "@/lib/workshop/create-choices";

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
  const params = useSearchParams();
  const requested = params.get("system");
  const system: SystemId | null = isSystemId(requested) ? requested : null;
  // The record the tool opens on arrival, and the World entry the author
  // came from (src/lib/workshop/links.ts).
  const openId = params.get("open");
  const from = params.get("from");
  // Each kind of record's version, moved by changes here or in another tab.
  const versions = useWorkshopVersions(workshopId);
  const [workshop, setWorkshop] = useState<WorkshopSummary | null>(null);
  const [bestiary, setBestiary] = useState<number | null>(null);
  const [homebrew, setHomebrew] = useState<number | null>(null);
  const [pregens, setPregens] = useState<number | null>(null);
  const [plugin, setPlugin] = useState<number | null>(null);
  const [world, setWorld] = useState<WorldCount | null>(null);
  const [loading, setLoading] = useState(true);
  const [helpOpen, setHelpOpen] = useState(false);
  // The tour on screen: the hub's, or a tool's, by id.
  const [tour, setTour] = useState<string | null>(null);
  const [helpMounted, setHelpMounted] = useState(false);
  const [tourMounted, setTourMounted] = useState(false);
  if (helpOpen && !helpMounted) setHelpMounted(true);
  if (tour !== null && !tourMounted) setTourMounted(true);

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

  // The world pack draft is one JSON value; its card counts the entries it
  // names. The panel reports its own count while it is open, so this only
  // runs when the view changes.
  const loadPlugin = useCallback(
    () =>
      fetch(`/api/workshops/${workshopId}/plugin`)
        .then((response) => (response.ok ? response.json() : null))
        .then((data: { draft?: unknown } | null) => {
          const parsed = worldPackDraftSchema.safeParse(data?.draft);
          if (parsed.success) {
            setPlugin(draftCount(parsed.data));
          }
        })
        .catch(() => {
          // the card simply shows no figure until the next reload
        }),
    [workshopId],
  );

  // WorldForge counts what it lays over the records: links, events,
  // secrets and maps, from its own route.
  const loadWorld = useCallback(
    () =>
      fetch(`/api/campaigns/${workshopId}/world?counts=1`)
        .then((response) => (response.ok ? response.json() : null))
        .then((data: { counts?: WorldCount } | null) => {
          if (data?.counts) {
            setWorld(data.counts);
          }
        })
        .catch(() => {
          // the card simply shows no figure until the next reload
        }),
    [workshopId],
  );
  // The world's counts on the hub and the rail, kept current as records
  // change here or in another tab.
  const changes = versions.npc + versions.lore + versions.location + versions.faction + versions.world;
  useEffect(() => {
    if (changes) void loadWorld();
  }, [changes, loadWorld]);

  // Refetched whenever the view changes, so a person added inside Cast is
  // counted on the card the moment the DM steps back to the hub.
  useEffect(() => {
    void load();
    void loadBestiary();
    void loadHomebrew();
    void loadPregens();
    void loadPlugin();
    void loadWorld();
  }, [load, loadBestiary, loadHomebrew, loadPregens, loadPlugin, loadWorld, system]);

  // The once-only tours, once per account (issue #306): the hub's when the
  // workshop first loads, a tool's the first time that tool is opened, after
  // the panel has had a moment to draw itself. A tour already on screen is
  // left alone.
  // Spelled out rather than through systemTourId: a helper call at this
  // level is opaque to the React Compiler and costs the page its memoization.
  const tourId = system ? `workshop-${system}` : HUB_TOUR_ID;
  const tourFinished = useTourFinished(tourId);
  useEffect(() => {
    if (loading || !workshop || tour || tourFinished !== false) return;
    const timer = window.setTimeout(() => setTour(tourId), 900);
    return () => clearTimeout(timer);
  }, [loading, workshop, tourId, tour, tourFinished]);

  function closeTour(how: TourEnd) {
    if (tour) finishTour(tour, how);
    setTour(null);
  }

  // Every move to another tool or the hub asks first when an editor has
  // changes not saved (src/app/workshop/unsaved.ts).
  async function go(href: string): Promise<boolean> {
    if (!(await mayLeaveDrafts())) return false;
    router.push(href);
    return true;
  }

  function openSystem(next: SystemId) {
    void go(workshopHref(pathname, { system: next }));
  }

  // One record in its own tool, with the way back to its World entry.
  function openRecord(next: SystemId, id: string, fromRef: string) {
    void go(workshopHref(pathname, { system: next, open: id, from: fromRef }));
  }

  function openWorldEntry(ref: string) {
    void go(workshopHref(pathname, worldEntryPlace(ref)));
  }

  // "Create an entry" from the palette: go to the system, then ask its panel
  // to open its editor. The panel answers only once it has loaded, so the
  // request is made again a beat later, but only when nothing answered the
  // first: asked twice, an editor the author had already saved and closed
  // opened again, blank, over the tool (M6 journey 8).
  const [creating, setCreating] = useState<{ prepare: string; ask: number } | null>(null);
  useEffect(() => {
    if (!creating) return;
    let answered = false;
    const timers = [450, 1400].map((delay) =>
      window.setTimeout(() => {
        if (!answered) answered = requestTourPrepare(creating.prepare);
      }, delay),
    );
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [creating]);
  function createIn(next: SystemId, prepare: string) {
    if (system !== next) {
      openSystem(next);
    }
    setCreating((previous) => ({ prepare, ask: (previous?.ask ?? 0) + 1 }));
  }

  // A way in from the Create chooser (src/lib/workshop/create-choices.ts):
  // the page or tool that makes the thing, with that tool's own editor
  // asked to open once the author has left any unsaved one behind.
  const [chooserOpen, setChooserOpen] = useState(false);
  // The hub task the chooser opens on, or null for everything.
  const [chooserAt, setChooserAt] = useState<string | null>(null);
  async function createFrom(step: CreateStep) {
    if (step.href) {
      await go(step.href);
      return;
    }
    if (!step.system) return;
    const there = system === step.system && (!step.view || params.get("view") === step.view);
    if (!there && !(await go(workshopHref(pathname, { system: step.system, view: step.view })))) return;
    if (step.prepare) setCreating((previous) => ({ prepare: step.prepare!, ask: (previous?.ask ?? 0) + 1 }));
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
      <PageSkeleton kind="hub" />
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
          onCreate={() => setChooserOpen(true)}
          onRenamed={(title) =>
            setWorkshop((current) => (current ? { ...current, title } : current))
          }
        />
      )}
      <CreateChooser
        key={chooserAt ?? "all"}
        open={chooserOpen}
        onOpenChange={(next) => {
          setChooserOpen(next);
          if (!next) setChooserAt(null);
        }}
        onGo={(step) => void createFrom(step)}
        startAt={chooserAt}
      />
      <Suspense fallback={null}>
        {helpMounted ? (
          <WorkshopHelpDialog
            open={helpOpen}
            onOpenChange={setHelpOpen}
            tours={helpTours}
            system={system}
          />
        ) : null}
        {tourMounted ? (
          <GuidedTour
            open={tour !== null}
            steps={tourSteps}
            onPrepare={requestTourPrepare}
            onClose={closeTour}
          />
        ) : null}
      </Suspense>
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
          aside={
            <CommandPalette
              title="Workshop commands"
              placeholder="Jump to, or create"
              commands={workshopCommands({
                current: system,
                phrase: (id) => systemCount(id, workshop, bestiary, homebrew, pregens, plugin, world).phrase,
                onJump: openSystem,
                onCreate: createIn,
                onHub: () => void go(pathname),
                onHelp: () => setHelpOpen(true),
              })}
            />
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
          plugin={plugin}
          world={world}
          onChange={openSystem}
          openId={openId}
          from={from}
          onOpenRecord={openRecord}
          onWorldEntry={openWorldEntry}
          onBack={() => void go(pathname)}
          onCreate={() => setChooserOpen(true)}
          versions={versions}
          onHelp={() => setHelpOpen(true)}
          onRulesApplied={() => void load()}
          onHomebrewChanged={() => void loadHomebrew()}
          onPregensChanged={() => void loadPregens()}
          onPluginChanged={setPlugin}
        />
      ) : (
        <SystemCards
          workshop={workshop}
          bestiary={bestiary}
          homebrew={homebrew}
          pregens={pregens}
          plugin={plugin}
          world={world}
          onOpen={openSystem}
          onTask={(choiceId) => {
            setChooserAt(choiceId);
            setChooserOpen(true);
          }}
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
        <PageSkeleton kind="hub" />
      }
    >
      <WorkshopPageInner workshopId={workshopId} />
    </Suspense>
  );
}
