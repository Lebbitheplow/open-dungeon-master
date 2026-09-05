"use client";

import { Headphones } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";
import { VoicePanel } from "@/app/campaigns/[campaignId]/VoicePanel";
import { headerButtonClass } from "@/app/campaigns/[campaignId]/headerButton";
import { Tooltip } from "@/components/ui/Tooltip";
import type { TurnEnforcement, VoiceFloorMode } from "@/lib/voice/turn-logic";
import type { VoiceRosterEntry } from "@/lib/voice/types";

// The voice call's home during play: a header button with the full voice
// menu under it. From lg up the menu is a dropdown anchored to the button;
// below lg the same menu rises as a bottom sheet with a grip, the way the
// phone mockups draw it.
//
// The panel is rendered exactly once and stays mounted whether the menu is
// open or not, hidden with CSS, because useVoiceRoom tears the call down
// when its component unmounts. That is also why the dock lives in the header
// rather than in a side-panel tab, where switching tabs would hang up on
// whoever was talking, and why the sheet is not the Sheet primitive: a
// Radix dialog unmounts its content on close, which would end the call every
// time the player put the menu away. One portaled container carries both
// shapes as responsive classes, so there is never a second React position
// for the panel to move to. It is portaled because the header is a glass
// surface (backdrop-filter), which makes it the containing block for fixed
// descendants, and the phone sheet has to reach the bottom of the screen.

const noSubscribe = () => () => {};

export function VoiceDock({
  campaignId,
  meUserId,
  roster,
  speaking,
  floorMode,
  floorUserIds,
  turnEnforcement,
  adjudicates,
  steersStory,
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
  // For the panel's breakout-room controls, whose route asks for story
  // authority rather than the DM seat.
  steersStory: boolean;
  sayRangeRule: boolean;
  audibilityVersion: number;
  meshSignal: { to: string; version: number } | null;
}) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  // The portal needs a document; the server render has none and the call
  // cannot have started before the first click anyway.
  const mounted = useSyncExternalStore(noSubscribe, () => true, () => false);

  // Where the desktop dropdown hangs: measured from the button when the menu
  // opens, and again on resize, written straight to the element rather than
  // through state so a resize never re-renders the call.
  const anchor = () => {
    const button = buttonRef.current;
    const panel = panelRef.current;
    if (!button || !panel) {
      return;
    }
    const rect = button.getBoundingClientRect();
    panel.style.setProperty("--dock-top", `${Math.round(rect.bottom + 8)}px`);
    panel.style.setProperty("--dock-right", `${Math.round(window.innerWidth - rect.right)}px`);
  };

  // Click-away and Escape both close the menu; the call inside keeps
  // running either way.
  useEffect(() => {
    if (!open) {
      return;
    }
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!buttonRef.current?.contains(target) && !panelRef.current?.contains(target)) {
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
    window.addEventListener("resize", anchor);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", anchor);
    };
  }, [open]);

  // On the call when the server's roster says so; the roster is authoritative
  // and already rides the campaign stream.
  const onCall = Boolean(roster?.some((peer) => peer.userId === meUserId));
  const count = roster?.length ?? 0;
  const someoneSpeaking = Boolean(speaking?.userId);
  const tip = onCall
    ? `Voice chat: you are on the call with ${count} ${count === 1 ? "person" : "people"}`
    : count
      ? `Voice chat: ${count} on the call`
      : "Voice chat";

  return (
    <>
      <Tooltip content={tip} side="bottom">
        <button
          ref={buttonRef}
          type="button"
          onClick={() => {
            anchor();
            setOpen((current) => !current);
          }}
          aria-label="Voice chat"
          aria-expanded={open}
          className={cn(
            headerButtonClass(open, "relative flex items-center gap-1.5 md:px-2.5"),
            // Emerald while on the call so the header says so at a glance,
            // without stealing the gold that marks an open menu.
            !open && onCall && "border-emerald-700/60 bg-emerald-950/40 text-emerald-300",
          )}
        >
          <Headphones className={cn("size-4", onCall && someoneSpeaking && "animate-pulse")} />
          <span className="hidden text-sm md:inline">Voice</span>
          {count ? (
            <span
              className="absolute -right-1 -top-1 rounded-full bg-gradient-to-b from-amber-300 to-amber-500 px-1 text-[9px] font-semibold leading-3 text-amber-950 shadow-glow-gold md:static md:ml-0.5 md:px-1.5 md:text-[10px] md:leading-4"
              aria-label={`${count} on the call`}
            >
              {count}
            </span>
          ) : null}
        </button>
      </Tooltip>
      {mounted
        ? createPortal(
            <>
              {/* Phone only: dims the table under the sheet; a tap on it
                  lands outside the panel and closes through the listener. */}
              <div
                className={cn(
                  "fixed inset-0 z-[60] bg-[#05030d]/70 backdrop-blur-sm lg:hidden",
                  open ? "block" : "hidden",
                )}
                aria-hidden="true"
              />
              <div
                ref={panelRef}
                role="dialog"
                aria-label="Voice chat"
                style={{ "--dock-top": "4rem", "--dock-right": "1rem" } as CSSProperties}
                className={cn(
                  open ? "block" : "hidden",
                  // Below lg: a bottom sheet, same shape as src/components/ui/Sheet.tsx.
                  "texture-noise fixed inset-x-0 bottom-0 z-[60] max-h-[85vh] overflow-y-auto rounded-t-2xl border border-stone-600/50 bg-stone-950 px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-2 shadow-elev-2",
                  // From lg: a dropdown hanging from the button. Solid backdrop
                  // under the panel's translucent background, so it never
                  // reads as chat showing through it.
                  "lg:inset-x-auto lg:bottom-auto lg:right-[var(--dock-right)] lg:top-[var(--dock-top)] lg:max-h-[calc(100vh-5rem)] lg:w-80 lg:max-w-[calc(100vw-1.5rem)] lg:rounded-lg lg:border-0 lg:p-0 lg:shadow-xl lg:shadow-black/50",
                )}
              >
                <div
                  className="mx-auto mb-3 h-1 w-10 rounded-full bg-stone-600/70 lg:hidden"
                  aria-hidden="true"
                />
                <VoicePanel
                  campaignId={campaignId}
                  meUserId={meUserId}
                  roster={roster}
                  speaking={speaking}
                  floorMode={floorMode}
                  floorUserIds={floorUserIds}
                  turnEnforcement={turnEnforcement}
                  adjudicates={adjudicates}
                  steersStory={steersStory}
                  sayRangeRule={sayRangeRule}
                  audibilityVersion={audibilityVersion}
                  meshSignal={meshSignal}
                  compact
                />
              </div>
            </>,
            document.body,
          )
        : null}
    </>
  );
}
