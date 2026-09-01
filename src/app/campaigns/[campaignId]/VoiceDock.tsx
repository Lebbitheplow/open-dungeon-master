"use client";

import { Headphones } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { VoicePanel } from "@/app/campaigns/[campaignId]/VoicePanel";
import { Tooltip } from "@/components/ui/Tooltip";
import type { TurnEnforcement, VoiceFloorMode } from "@/lib/voice/turn-logic";
import type { VoiceRosterEntry } from "@/lib/voice/types";

// The voice call's home during play: a header button with the full voice
// menu in a dropdown under it. The panel stays mounted whether the dropdown
// is open or not, hidden with CSS, because useVoiceRoom tears the call down
// when its component unmounts. That is also why the dock lives in the header
// rather than in a side-panel tab, where switching tabs would hang up on
// whoever was talking.
export function VoiceDock({
  campaignId,
  meUserId,
  roster,
  speaking,
  floorMode,
  floorUserIds,
  turnEnforcement,
  adjudicates,
  sayRangeRule,
  audibilityVersion,
  meshSignal,
}: {
  campaignId: string;
  meUserId: string;
  roster: VoiceRosterEntry[] | null;
  speaking: { userId: string; at: number } | null;
  floorMode: VoiceFloorMode;
  floorUserIds: string[];
  turnEnforcement: TurnEnforcement;
  adjudicates: boolean;
  sayRangeRule: boolean;
  audibilityVersion: number;
  meshSignal: { to: string; version: number } | null;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Click-away and Escape both close the dropdown; the call inside keeps
  // running either way.
  useEffect(() => {
    if (!open) {
      return;
    }
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  // On the call when the server's roster says so; the roster is authoritative
  // and already rides the campaign stream.
  const onCall = Boolean(roster?.some((peer) => peer.userId === meUserId));
  const count = roster?.length ?? 0;
  const someoneSpeaking = Boolean(speaking?.userId);

  return (
    <div ref={rootRef} className="relative">
      <Tooltip content={onCall ? "Voice chat: you are on the call" : "Voice chat"} side="bottom">
        <button
          type="button"
          onClick={() => setOpen((current) => !current)}
          aria-label="Voice chat"
          aria-expanded={open}
          className={cn(
            "relative rounded-md border p-2.5 sm:p-1.5",
            open
              ? "border-amber-800 bg-amber-950/40 text-amber-400"
              : onCall
                ? "border-emerald-800 bg-emerald-950/40 text-emerald-400"
                : "border-stone-700 text-stone-500 hover:text-stone-300",
          )}
        >
          <Headphones className={cn("size-4", onCall && someoneSpeaking && "animate-pulse")} />
          {count ? (
            <span className="absolute -right-1 -top-1 rounded-full bg-gradient-to-b from-amber-300 to-amber-500 px-1 text-[9px] font-semibold leading-3 text-amber-950">
              {count}
            </span>
          ) : null}
        </button>
      </Tooltip>
      <div
        className={cn(
          // Solid backdrop under the panel's translucent background, so the
          // dropdown never reads as chat showing through it.
          "absolute right-0 top-full z-30 mt-2 w-80 max-w-[calc(100vw-1.5rem)] rounded-lg bg-stone-950 shadow-xl shadow-black/50",
          open ? "block" : "hidden",
        )}
      >
        <VoicePanel
          campaignId={campaignId}
          meUserId={meUserId}
          roster={roster}
          speaking={speaking}
          floorMode={floorMode}
          floorUserIds={floorUserIds}
          turnEnforcement={turnEnforcement}
          adjudicates={adjudicates}
          sayRangeRule={sayRangeRule}
          audibilityVersion={audibilityVersion}
          meshSignal={meshSignal}
          compact
        />
      </div>
    </div>
  );
}
