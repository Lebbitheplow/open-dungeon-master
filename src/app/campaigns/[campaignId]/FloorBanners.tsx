"use client";

import { Check, Hand, Swords } from "lucide-react";
import { cn } from "@/lib/cn";
import type { Floor } from "@/lib/db/campaigns";
import type { PublicEncounter } from "@/lib/db/encounters";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// Spotlight, held-responses, and initiative banners above the composer;
// the lead gets the release/skip buttons.
export function FloorBanners({
  floor,
  spotlighted,
  heldSpotlightNames,
  encounter,
  isLead,
  onRelease,
}: {
  floor: Floor;
  spotlighted: CharacterSheet[];
  heldSpotlightNames: string[];
  encounter?: PublicEncounter | null;
  isLead: boolean;
  onRelease: () => void;
}) {
  return (
    <>
      {floor.mode === "initiative" ? (
        <div className="mb-2 flex items-center justify-between rounded-md border border-red-900/60 bg-red-950/30 px-3 py-1.5 text-xs">
          <span className="flex min-w-0 items-center gap-1.5 text-red-200">
            <Swords className="size-3.5 shrink-0" />
            <span className="truncate">
              Round {floor.round}
              {encounter?.orderReady && encounter.order.length ? (
                <>
                  {" · "}
                  {encounter.order.map((entry, index) => {
                    const current = index === encounter.turnIndex;
                    return (
                      <span
                        key={entry.id}
                        className={cn(
                          current ? "font-semibold text-red-100" : "text-red-200/60",
                        )}
                      >
                        {index > 0 ? " > " : ""}
                        {entry.name}
                      </span>
                    );
                  })}
                </>
              ) : (
                <> · {floor.currentName}&apos;s turn</>
              )}
            </span>
          </span>
          {isLead ? (
            <button
              type="button"
              onClick={onRelease}
              className="ml-3 shrink-0 text-red-200 hover:text-red-300"
              title="Skip the current player's turn"
            >
              Skip turn
            </button>
          ) : null}
        </div>
      ) : null}
      {floor.mode === "spotlight" ? (
        <div className="mb-2 flex items-center justify-between rounded-md border border-amber-900/60 bg-amber-950/30 px-3 py-1.5 text-xs">
          <span className="flex items-center gap-1.5 text-amber-200">
            <span className="flex -space-x-1.5">
              {spotlighted
                .filter((sheet) => sheet.portrait)
                .slice(0, 4)
                .map((sheet) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={sheet.id}
                    src={sheet.portrait!.url}
                    alt=""
                    className="size-5 rounded-full border border-amber-900 object-cover"
                  />
                ))}
            </span>
            <span>
              {floor.respondedUserIds.length ? "Spotlight, waiting on: " : "Spotlight: "}
              {spotlighted.length
                ? spotlighted.map((sheet, index) => {
                    const responded = floor.respondedUserIds.includes(sheet.userId);
                    return (
                      <span
                        key={sheet.id}
                        className={responded ? "text-amber-200/50" : undefined}
                      >
                        {index > 0 ? ", " : ""}
                        {sheet.name}
                        {responded ? <Check className="inline size-3 align-baseline" /> : null}
                      </span>
                    );
                  })
                : "someone"}
              {floor.prompt ? (
                <span className="text-amber-200/80"> · {floor.prompt}</span>
              ) : null}
            </span>
          </span>
          {isLead ? (
            <button
              type="button"
              onClick={onRelease}
              className="ml-3 shrink-0 text-amber-200 hover:text-amber-300"
            >
              Release
            </button>
          ) : null}
        </div>
      ) : null}
      {floor.mode === "hold" ? (
        <div className="mb-2 flex items-center justify-between rounded-md border border-amber-900/60 bg-amber-950/30 px-3 py-1.5 text-xs">
          <span className="flex items-center gap-1.5 text-amber-200">
            <Hand className="size-3.5" />
            <span>
              Responses held. Talk it over; the lead opens the floor.
              {heldSpotlightNames.length ? (
                <span className="text-amber-200/80">
                  {" "}
                  Next: spotlight on {heldSpotlightNames.join(", ")}
                </span>
              ) : null}
            </span>
          </span>
          {isLead ? (
            <button
              type="button"
              onClick={onRelease}
              className="ml-3 shrink-0 text-amber-200 hover:text-amber-300"
            >
              Allow responses
            </button>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
