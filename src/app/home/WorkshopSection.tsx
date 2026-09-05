"use client";

import { Copy, Hammer, Loader2 } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/cn";
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
}: {
  workshops: WorkshopSummary[];
  cloningId: string;
  onClone: (id: string) => void;
}) {
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

      {workshops.length ? (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {workshops.map((workshop) => (
            <li key={workshop.id} className={cn(ui.cardHover, "group relative px-5 py-4")}>
              <Link href={`/workshop/${workshop.id}`} className="block">
                <p className="min-w-0 truncate pr-8 font-display text-lg tracking-wide text-amber-50">
                  {workshop.title}
                </p>
                <p className="text-sm text-stone-400">
                  Party of {workshop.gameSettings.targetParty.size} at level{" "}
                  {workshop.gameSettings.targetParty.level}
                </p>
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
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-xl border border-stone-800 bg-stone-950/40 px-5 py-4 text-sm text-stone-500">
          Nothing on the bench yet. A workshop is yours alone, and nothing in it reaches a table
          until you bring it in.
        </p>
      )}
    </section>
  );
}
