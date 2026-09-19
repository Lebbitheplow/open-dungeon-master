"use client";

import { EmptyState } from "@/components/EmptyState";
import { Copy, Hammer, Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { ContextMenu } from "@/components/ui/ContextMenu";
import { workshopPlate } from "@/app/workshop/plates";
import { IconChip, ui } from "@/lib/ui";
import { Tooltip } from "@/components/ui/Tooltip";
import type { WorkshopSummary } from "@/app/workshop/types";

// The bench, alongside the tables. A workshop is not a game, so it gets its
// own section rather than a row in the campaign list, but it is a first
// thought rather than something buried in an account menu.
export function WorkshopSection({
  workshops,
  cloningId,
  onClone,
  pending,
}: {
  workshops: WorkshopSummary[];
  cloningId: string;
  onClone: (id: string) => void;
  // True while the host's list is still on the wire. A host that does not
  // say (the dashboard today) is covered by the probe below.
  pending?: boolean;
}) {
  const router = useRouter();
  // An empty list and a list not yet loaded look the same from here, and the
  // "nothing on the bench" plate flashing before six workshops arrive is a
  // lie. Until the host passes `pending`, one cheap probe of the same route
  // settles it: skeleton until it answers, the plate only if it agrees.
  const [probed, setProbed] = useState(false);
  useEffect(() => {
    if (pending !== undefined) return;
    let cancelled = false;
    fetch("/api/workshops")
      .catch(() => null)
      .finally(() => {
        if (!cancelled) setProbed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [pending]);
  const waiting = !workshops.length && (pending ?? !probed);
  return (
    <section className="mb-8">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <IconChip icon={Hammer} size="size-9" iconSize="size-4" />
          <div>
            <h2 className="eyebrow text-sm text-amber-200/90">Workshop</h2>
            <p className="text-xs text-stone-500">
              Build maps, NPCs, monsters, story and rules before a table exists.
            </p>
          </div>
        </div>
        <Link href="/workshop" className={ui.btnSecondary}>
          <Hammer className="size-4" /> Open workshop
        </Link>
      </div>

      {waiting ? (
        <div className="reveal grid grid-cols-1 gap-3 sm:grid-cols-2" aria-busy="true">
          <div className="skeleton-block h-[4.75rem] rounded-xl" />
          <div className="skeleton-block hidden h-[4.75rem] rounded-xl sm:block" />
        </div>
      ) : workshops.length ? (
        <ul className="stagger-up grid grid-cols-1 gap-3 sm:grid-cols-2">
          {workshops.map((workshop) => (
            <ContextMenu
              as="li"
              key={workshop.id}
              className={cn(ui.cardHover, "group relative px-4 py-3")}
              label={workshop.title}
              // The row's link and its one button again; both stay on the row.
              items={[
                { id: "open", label: "Open", glyph: "system-storyboard", onSelect: () => router.push(`/workshop/${workshop.id}`) },
                { id: "duplicate", label: "Duplicate", glyph: "tab-notes", disabled: cloningId === workshop.id, onSelect: () => onClone(workshop.id) },
              ]}
            >
              <Link href={`/workshop/${workshop.id}`} className="flex items-center gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={workshopPlate(workshop.id)}
                  alt=""
                  loading="lazy"
                  className="h-12 w-20 shrink-0 rounded-md border border-amber-400/20 object-cover"
                />
                <span className="min-w-0 pr-8">
                  <span className="block truncate font-display text-lg tracking-wide text-amber-50">
                    {workshop.title}
                  </span>
                  <span className="block text-sm text-stone-400">
                    Party of {workshop.gameSettings.targetParty.size} at level{" "}
                    {workshop.gameSettings.targetParty.level}
                  </span>
                </span>
              </Link>
              <Tooltip content="Copy this workshop and everything in it">
                <button
                  type="button"
                  aria-label={`Duplicate ${workshop.title}`}
                  disabled={cloningId === workshop.id}
                  onClick={() => onClone(workshop.id)}
                  className={cn("absolute right-2 top-2", ui.iconAction, "hover:text-amber-300")}
                >
                  {cloningId === workshop.id ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Copy className="size-4" />
                  )}
                </button>
              </Tooltip>
            </ContextMenu>
          ))}
        </ul>
      ) : (
        <EmptyState size="md" art="map" title="Nothing on the bench yet. A workshop is yours alone, and nothing in it reaches a table until you bring it in." />
      )}
    </section>
  );
}
