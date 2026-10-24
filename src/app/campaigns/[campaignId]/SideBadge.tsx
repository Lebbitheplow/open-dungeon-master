"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import type { PublicEncounter } from "@/lib/db/encounter-view";
import { dominatorOf, type CombatSide } from "@/lib/dm/combat-sides-logic";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// A combatant fighting on the side its kind does not (issue 503): a
// character against the party in the foes' red, a creature the party
// dominates in the party's stone, the colours of its token's side band on
// the board (BoardStage.tsx). The server's projection says who
// (encounter-view.ts sides); the words say it for everyone, screen readers
// included. A badge comes in over 300 ms when the server moves somebody
// (globals.css .side-badge); reduced motion keeps the colour and the words.

type Kind = "pc" | "enemy" | "npc";

// The side a combatant is on when it is not its kind's, or null.
export function offSide(encounter: Pick<PublicEncounter, "sides"> | null | undefined, id: string, kind: Kind): CombatSide | null {
  const side = encounter?.sides?.[id];
  if (!side || kind === "npc") {
    return null;
  }
  return side !== (kind === "pc" ? "party" : "foe") ? side : null;
}

export function sideWords(side: CombatSide): string {
  return side === "foe" ? "against the party" : "with the party";
}

// The pill beside a name: the words, in the side's colours.
export function SideBadge({ side, className }: { side: CombatSide | null; className?: string }) {
  if (!side) {
    return null;
  }
  return (
    <span
      key={side}
      data-side-badge={side}
      className={cn(
        "side-badge inline-flex shrink-0 items-center rounded-full border px-1.5 text-[10px] font-medium leading-4",
        side === "foe" ? "border-red-500/70 bg-red-950/80 text-red-100" : "border-stone-500 bg-stone-800 text-stone-100",
        className,
      )}
    >
      {side === "foe" ? "Against the party" : "With the party"}
    </span>
  );
}

// The words alone, for a screen reader beside a name.
export function SideSr({ side }: { side: CombatSide | null }) {
  return side ? <span className="sr-only">, {sideWords(side)}</span> : null;
}

// The side's colour across the top of an initiative plate (BoardChrome.tsx).
export function SidePlateBand({ side }: { side: CombatSide | null }) {
  if (!side) {
    return null;
  }
  return <span key={side} data-side-badge={side} className={cn("side-badge absolute inset-x-0 top-0 h-[3px]", side === "foe" ? "bg-red-500" : "bg-stone-300")} />;
}

// "Sable fights against the party. " for each such combatant, for a name a
// whole order is read by.
export function sidesLine(encounter: PublicEncounter): string {
  return encounter.order
    .flatMap((entry) => {
      const side = offSide(encounter, entry.id, entry.kind);
      return side ? [`${entry.name} fights ${sideWords(side)}. `] : [];
    })
    .join("");
}

// The player's own characters fighting on the other side (a Dominate spell
// from it holds them), said above the composer for as long as it lasts, and
// a moment's word when it ends (companion-command.ts: the DM plays them
// meanwhile).
export function SideNotice({ encounter, sheets, meUserId }: { encounter: PublicEncounter | null; sheets: CharacterSheet[]; meUserId: string }) {
  const mine = sheets.filter((sheet) => sheet.userId === meUserId && !sheet.isCompanion);
  const held = encounter ? mine.filter((sheet) => offSide(encounter, sheet.id, "pc") === "foe") : [];
  const heldKey = held.map((sheet) => sheet.id).join(",");
  // Who was held a moment ago, so a release is told once (the server's
  // word drives it: the projection's sides changed).
  const [seen, setSeen] = useState<{ held: string; freed: string[] }>({ held: heldKey, freed: [] });
  if (seen.held !== heldKey) {
    const now = heldKey ? heldKey.split(",") : [];
    const before = seen.held ? seen.held.split(",") : [];
    setSeen({ held: heldKey, freed: before.filter((id) => !now.includes(id)) });
  }
  useEffect(() => {
    if (!seen.freed.length) {
      return;
    }
    const timer = window.setTimeout(() => setSeen((current) => ({ ...current, freed: [] })), 6000);
    return () => window.clearTimeout(timer);
  }, [seen.freed]);
  const freed = mine.filter((sheet) => seen.freed.includes(sheet.id));
  if (!held.length && !freed.length) {
    return null;
  }
  return (
    <div role="status" className="space-y-1">
      {held.map((sheet) => (
        <p key={sheet.id} data-side-notice="foe" className="side-badge rounded-lg border border-red-500/60 bg-red-950/70 px-3 py-1.5 text-xs text-red-100">
          {dominatorOf(sheet.conditions, sheet.conditionMeta as Record<string, { spell?: unknown; source?: unknown }>)
            ? `${sheet.name} is dominated: the DM plays ${sheet.name} until the charm ends.`
            : `${sheet.name} fights ${sideWords("foe")}.`}
        </p>
      ))}
      {freed.map((sheet) => (
        <p key={sheet.id} data-side-notice="party" className="side-badge rounded-lg border border-stone-500 bg-stone-800 px-3 py-1.5 text-xs text-stone-100">
          {sheet.name} is yours again.
        </p>
      ))}
    </div>
  );
}
