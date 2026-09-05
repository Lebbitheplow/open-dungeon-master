"use client";

import { ArrowLeft, Loader2 } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, use, useCallback, useEffect, useState } from "react";
import { SystemCards } from "@/app/workshop/[workshopId]/SystemCards";
import { SystemView } from "@/app/workshop/[workshopId]/SystemView";
import { TargetPartyBar } from "@/app/workshop/[workshopId]/TargetPartyBar";
import { WorkshopHeader } from "@/app/workshop/[workshopId]/WorkshopHeader";
import { isSystemId, type SystemId } from "@/app/workshop/[workshopId]/systems";
import { WorkshopHelpDialog } from "@/components/WorkshopHelpDialog";
import type { WorkshopSummary } from "@/app/workshop/types";

// The workshop shell: a hub of system cards, or one system open.
//
// Which one is in the URL (?system=cast), so the back button leaves a system
// for the hub the way a DM expects, and a link to one system can be shared or
// bookmarked. The target-party bar stays pinned in both views because every
// encounter and odds preview budgets against it.

function WorkshopPageInner({ workshopId }: { workshopId: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const requested = useSearchParams().get("system");
  const system: SystemId | null = isSystemId(requested) ? requested : null;

  const [workshop, setWorkshop] = useState<WorkshopSummary | null>(null);
  const [bestiary, setBestiary] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [helpOpen, setHelpOpen] = useState(false);

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

  // Refetched whenever the view changes, so a person added inside Cast is
  // counted on the card the moment the DM steps back to the hub.
  useEffect(() => {
    void load();
    void loadBestiary();
  }, [load, loadBestiary, system]);

  function openSystem(next: SystemId) {
    router.push(`${pathname}?system=${next}`);
  }

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
      <WorkshopHelpDialog open={helpOpen} onOpenChange={setHelpOpen} />

      {/* Pinned: the negative margins let the blur run edge to edge while the
          bar itself keeps the page's gutter. */}
      <div className="sticky top-0 z-20 -mx-4 bg-stone-950/85 px-4 py-2 backdrop-blur-md sm:-mx-6 sm:px-6">
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
          onChange={openSystem}
          onBack={() => router.push(pathname)}
          onRulesApplied={() => void load()}
        />
      ) : (
        <SystemCards workshop={workshop} bestiary={bestiary} onOpen={openSystem} />
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
