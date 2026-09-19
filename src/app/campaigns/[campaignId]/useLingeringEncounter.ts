"use client";

import { useEffect, useState } from "react";
import type { PublicEncounter } from "@/lib/db/encounter-view";

// How long the Hand needs to fold away (FOLD_MS in Hand.tsx, --dur-beat).
export const HAND_LEAVE_MS = 420;

// The Hand is mounted only while a fight is on, so the instant the encounter
// stopped being active it was gone and its fold-away never played. This keeps
// the last active encounter for one beat after it ends and says so, so the
// Hand can be told it is leaving and then be unmounted. A fight that starts
// again inside that beat simply takes over.
export function useLingeringEncounter(encounter: PublicEncounter | null | undefined): {
  encounter: PublicEncounter | null;
  leaving: boolean;
} {
  const active = encounter && encounter.status === "active" ? encounter : null;
  const [held, setHeld] = useState<PublicEncounter | null>(active);
  // State adjusted during render, React's pattern for following a prop: the
  // held copy tracks the live encounter while there is one.
  if (active && held !== active) {
    setHeld(active);
  }
  const leaving = !active && held !== null;

  useEffect(() => {
    if (!leaving) {
      return;
    }
    const timer = window.setTimeout(() => setHeld(null), HAND_LEAVE_MS);
    return () => window.clearTimeout(timer);
  }, [leaving]);

  return { encounter: active ?? held, leaving };
}
