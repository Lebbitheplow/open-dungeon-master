"use client";

import { Keyboard } from "lucide-react";
import { cn } from "@/lib/cn";
import { Tooltip } from "@/components/ui/Tooltip";
import { MODES, type MapTools, type ModeEntry, type ModeGroup, type SurfaceCaps } from "@/app/campaigns/[campaignId]/MapToolbox";

// The tool rail (docs/visual-overhaul-plan.md 4.3): every mode of the toolbox
// in three groups, the key printed small in the corner, a gold spine on the
// one in hand, and the Keys button at the foot. Upright beside the canvas on a
// desk; on a phone the same cells lie along the bottom as a strip that scrolls
// under the thumb, at 46 px so a finger can take one. A second press on the
// held tool puts it down, as the chips always did.

const GROUPS: ModeGroup[] = ["paint", "scene", "other"];

export function modesFor(caps: SurfaceCaps): ModeEntry[] {
  return MODES.filter((entry) => !entry.needs || caps[entry.needs]);
}

function RailCell({
  entry,
  active,
  strip,
  onPress,
}: {
  entry: ModeEntry;
  active: boolean;
  strip: boolean;
  onPress: () => void;
}) {
  const Icon = entry.icon;
  const button = (
    <button
      type="button"
      aria-pressed={active}
      aria-label={`${entry.label} (${entry.key})`}
      data-map-tool={entry.mode}
      onClick={onPress}
      className={cn(
        "relative flex shrink-0 flex-col items-center justify-center rounded-lg text-stone-500 motion-rail focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/40",
        strip ? "h-[46px] min-w-[52px] gap-0.5 px-1.5" : "size-[38px]",
        active
          ? "bg-amber-400/10 text-amber-200 shadow-[0_1px_0_rgba(244,224,166,0.15)_inset,0_0_16px_rgba(212,171,58,0.12)]"
          : "hover:bg-stone-900/70 hover:text-stone-200",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "map-rail-spine absolute rounded-full bg-amber-400",
          strip ? "inset-x-3 top-0 h-[2px]" : "inset-y-2 left-0 w-[2px]",
          active ? "opacity-100" : "scale-50 opacity-0",
        )}
      />
      <Icon className={strip ? "size-[18px]" : "size-4"} />
      {strip ? (
        <span className="font-mono text-[8px] uppercase tracking-wide">{entry.label}</span>
      ) : (
        <span aria-hidden="true" className="absolute bottom-[3px] right-[4px] font-mono text-[7px] leading-none text-stone-600">
          {entry.key}
        </span>
      )}
    </button>
  );
  // The strip prints the name under the icon, so it needs no tooltip; the
  // upright rail has only the icon and says the rest on hover or focus.
  return strip ? button : <Tooltip content={`${entry.label} (${entry.key}). ${entry.hint}`}>{button}</Tooltip>;
}

export function MapRail({
  tools,
  onTools,
  caps,
  onHelp,
  orientation,
  onPicked,
}: {
  tools: MapTools;
  onTools: (next: MapTools) => void;
  caps: SurfaceCaps;
  onHelp?: () => void;
  orientation: "upright" | "strip";
  // The phone raises the tool sheet when a tool with dials is taken up.
  onPicked?: (mode: MapTools["mode"]) => void;
}) {
  const strip = orientation === "strip";
  const entries = modesFor(caps);
  return (
    <nav
      aria-label="Map tools"
      className={cn(
        "flex shrink-0 border-stone-800 bg-stone-950/60",
        strip
          ? "w-full items-center gap-1 overflow-x-auto border-t px-2 py-1 [scrollbar-width:none]"
          : "w-[50px] flex-col items-center gap-0.5 overflow-y-auto border-r py-2 [scrollbar-width:none]",
      )}
    >
      {GROUPS.map((group, index) => {
        const cells = entries.filter((entry) => entry.group === group);
        if (!cells.length) {
          return null;
        }
        return (
          <div key={group} className={cn("flex items-center gap-0.5", strip ? "flex-row" : "flex-col")}>
            {index > 0 ? (
              <span aria-hidden="true" className={cn("shrink-0 bg-stone-800", strip ? "mx-1 h-6 w-px" : "my-1 h-px w-6")} />
            ) : null}
            {cells.map((entry) => (
              <RailCell
                key={entry.mode}
                entry={entry}
                strip={strip}
                active={tools.mode === entry.mode}
                onPress={() => {
                  const next = tools.mode === entry.mode ? "" : entry.mode;
                  onTools({ ...tools, mode: next });
                  onPicked?.(next);
                }}
              />
            ))}
          </div>
        );
      })}
      {onHelp ? (
        <button
          type="button"
          onClick={onHelp}
          aria-label="Keys"
          title="Every key (?)"
          className={cn(
            "flex shrink-0 flex-col items-center justify-center gap-0.5 rounded-lg text-stone-500 motion-rail hover:bg-stone-900/70 hover:text-stone-200",
            strip ? "ml-1 h-[46px] min-w-[52px] px-1.5" : "mt-auto size-[38px]",
          )}
        >
          <Keyboard className={strip ? "size-[18px]" : "size-4"} />
          {strip ? <span className="font-mono text-[8px] uppercase tracking-wide">Keys</span> : null}
        </button>
      ) : null}
    </nav>
  );
}
