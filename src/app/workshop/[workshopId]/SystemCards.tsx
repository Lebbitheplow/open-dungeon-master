"use client";

import { cn } from "@/lib/cn";
import { IconChip, ui } from "@/lib/ui";
import { miscPlaceholder, workshopPlaceholder } from "@/lib/placeholders";
import { Ribbon } from "@/components/ui/Ribbon";
import {
  WORKSHOP_SYSTEMS,
  systemCount,
  totalPieces,
  type SystemId,
} from "@/app/workshop/[workshopId]/systems";
import type { WorkshopSummary } from "@/app/workshop/types";

// The hub: one card per system, each wearing its live count so a DM sees at
// a glance what is built and what is still empty. Tapping one opens that
// system.

// Each card's picture. Nine systems have a workshop plate of their own; the
// region is a journey, the share room is a chest of everything packed, and
// the plugin is the world's banner.
function systemPlate(id: SystemId): string {
  if (id === "region") {
    return miscPlaceholder("journey");
  }
  if (id === "share") {
    return miscPlaceholder("treasure");
  }
  if (id === "party") {
    return miscPlaceholder("party");
  }
  if (id === "plugin") {
    return miscPlaceholder("faction");
  }
  return workshopPlaceholder(id === "rules" ? "rulesets" : id);
}

export function SystemCards({
  workshop,
  bestiary,
  homebrew,
  pregens = null,
  plugin = null,
  onOpen,
}: {
  workshop: WorkshopSummary;
  bestiary: number | null;
  homebrew: number | null;
  pregens?: number | null;
  plugin?: number | null;
  onOpen: (system: SystemId) => void;
}) {
  const total = totalPieces(workshop, bestiary, homebrew, pregens, plugin);
  return (
    <section className="mt-5">
      <div className="mb-3 flex items-center gap-3">
        <Ribbon className="flex-1">Systems</Ribbon>
        <span className="shrink-0 text-xs text-stone-500">
          {total} {total === 1 ? "piece" : "pieces"} of prep
        </span>
      </div>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5" data-tour="hub-systems">
        {WORKSHOP_SYSTEMS.map((system) => {
          const count = systemCount(system.id, workshop, bestiary, homebrew, pregens, plugin);
          const empty = count.figure === "0" || count.figure === "none";
          return (
            <li key={system.id}>
              <button
                type="button"
                onClick={() => onOpen(system.id)}
                className={cn(
                  ui.card,
                  ui.tileHover,
                  "ornate flex h-full w-full flex-col gap-2 p-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/40",
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <IconChip icon={system.icon} size="size-9" iconSize="size-4" />
                  {count.figure !== null ? (
                    <span
                      className={cn(
                        "font-display text-2xl leading-none tracking-wide",
                        empty ? "text-stone-600" : "text-amber-200",
                      )}
                    >
                      {count.figure}
                    </span>
                  ) : null}
                </div>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={systemPlate(system.id)}
                  alt=""
                  loading="lazy"
                  className={cn(
                    "aspect-[16/7] w-full rounded-lg border border-amber-400/20 object-cover",
                    empty && "opacity-60",
                  )}
                />
                <div className="mt-auto">
                  <p className="font-display text-[13px] font-semibold uppercase tracking-[0.12em] text-stone-200">
                    {system.label}
                  </p>
                  <p className="text-xs text-stone-500">{system.blurb}</p>
                </div>
              </button>
            </li>
          );
        })}
      </ul>
      <p className="mt-4 text-sm text-stone-500">
        Everything here is yours alone. Import any of it into a campaign when you start one.
      </p>
    </section>
  );
}
