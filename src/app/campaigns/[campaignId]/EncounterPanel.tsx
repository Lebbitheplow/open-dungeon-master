"use client";

import { Skull, Swords, Wind } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { HEALTH_COLORS } from "@/lib/bestiary/health";
import type { PublicEncounter } from "@/lib/db/encounters";

function crLabel(cr: number): string {
  if (cr === 0.125) return "1/8";
  if (cr === 0.25) return "1/4";
  if (cr === 0.5) return "1/2";
  return String(cr);
}

// Live enemy roster during combat. Deliberately vague: players see health
// states, never numbers; exact HP stays on the server.
export function EncounterPanel({
  campaignId,
  encounter,
  isLead,
  embedded = false,
}: {
  campaignId: string;
  encounter: PublicEncounter;
  isLead: boolean;
  embedded?: boolean;
}) {
  const [ending, setEnding] = useState(false);

  async function forceEnd() {
    if (!window.confirm("End this encounter without a resolution? No XP is awarded.")) {
      return;
    }
    setEnding(true);
    try {
      await fetch(`/api/campaigns/${campaignId}/encounter`, { method: "DELETE" });
    } finally {
      setEnding(false);
    }
  }

  return (
    <section
      className={cn(
        "rounded-lg border border-red-900/50 bg-red-950/10",
        embedded ? "p-3" : "p-4",
      )}
    >
      <header className="mb-2 flex items-center justify-between">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-red-300">
          <Swords className="size-4" />
          Combat{encounter.orderReady ? ` · Round ${encounter.round}` : " · Rolling initiative"}
        </h2>
        {isLead ? (
          <button
            type="button"
            onClick={forceEnd}
            disabled={ending}
            className="text-xs text-stone-500 hover:text-red-300 disabled:opacity-50"
            title="Force-end the encounter (lead only)"
          >
            End encounter
          </button>
        ) : null}
      </header>
      <ul className="space-y-1.5">
        {encounter.enemies.map((enemy) => {
          const out = enemy.status !== "alive";
          return (
            <li
              key={enemy.id}
              className={cn(
                "rounded-md border border-stone-800 bg-stone-950/60 px-2.5 py-1.5",
                out && "opacity-60",
              )}
            >
              <div className="flex items-center justify-between">
                <span
                  className={cn(
                    "flex min-w-0 items-center gap-1.5 text-sm text-stone-200",
                    out && "line-through decoration-stone-500",
                  )}
                >
                  {enemy.status === "dead" ? (
                    <Skull className="size-3.5 shrink-0 text-stone-500" />
                  ) : enemy.status === "fled" ? (
                    <Wind className="size-3.5 shrink-0 text-stone-500" />
                  ) : null}
                  <span className="truncate">{enemy.name}</span>
                  <span className="shrink-0 rounded border border-stone-700 px-1 text-[10px] text-stone-500">
                    CR {crLabel(enemy.cr)}
                  </span>
                </span>
                <span
                  className={cn(
                    "ml-2 shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium capitalize",
                    HEALTH_COLORS[enemy.status === "fled" ? "dead" : enemy.health],
                  )}
                >
                  {enemy.status === "fled" ? "fled" : enemy.health}
                </span>
              </div>
              {enemy.conditions?.length ? (
                <div className="mt-1 flex flex-wrap gap-1">
                  {enemy.conditions.map((condition) => (
                    <span
                      key={condition}
                      className="rounded-full border border-amber-900/60 bg-amber-950/30 px-1.5 py-px text-[10px] capitalize text-amber-300"
                    >
                      {condition}
                      {enemy.conditionRounds?.[condition]
                        ? ` (${enemy.conditionRounds[condition]} rd)`
                        : ""}
                    </span>
                  ))}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
