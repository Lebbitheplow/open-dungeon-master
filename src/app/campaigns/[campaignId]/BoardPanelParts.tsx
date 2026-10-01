"use client";

import { LocateFixed, Lock, Maximize2, Unlock, Users, ZoomIn, ZoomOut } from "lucide-react";
import { Dialog } from "@/components/ui/Dialog";
import { cn } from "@/lib/cn";
import { TILE_FEET } from "@/lib/battlemap/types";
import { TokenFace, type FaceLookup } from "@/app/campaigns/[campaignId]/BoardChrome";
import { DmInitiativePanel } from "@/app/campaigns/[campaignId]/DmInitiativePanel";
import type { PublicEncounter } from "@/lib/db/encounter-view";

// Two pieces of BattleMapPanel that carry no state of their own, split out so
// the panel stays readable: the camera buttons in the board's corner, and the
// order the initiative rail opens.

const CAMERA_BUTTON =
  "motion-press rounded-md border border-stone-700/80 bg-stone-950/85 p-1 text-stone-300 hover:text-stone-100";

// Camera controls: corner buttons for everyone, the follow toggle for a
// player in a fight, and the DM's pull, lock and free.
export function BoardCameraControls({
  onZoomIn,
  onZoomOut,
  onFit,
  followTurn,
  onFollowTurn,
  onDirect,
}: {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
  // Null when this seat has no follow toggle (the DM, or a scene board).
  followTurn: boolean | null;
  onFollowTurn: () => void;
  // Present for the DM seat only.
  onDirect?: (mode: "pull" | "lock" | "free") => void;
}) {
  return (
    <div className="absolute bottom-2 right-2 z-10 flex flex-col gap-1">
      <button type="button" onClick={onZoomIn} aria-label="Zoom in" className={CAMERA_BUTTON}>
        <ZoomIn className="size-4" />
      </button>
      <button type="button" onClick={onZoomOut} aria-label="Zoom out" className={CAMERA_BUTTON}>
        <ZoomOut className="size-4" />
      </button>
      <button type="button" onClick={onFit} aria-label="Fit the board" className={CAMERA_BUTTON}>
        <Maximize2 className="size-4" />
      </button>
      {followTurn !== null ? (
        <button
          type="button"
          onClick={onFollowTurn}
          aria-pressed={followTurn}
          aria-label="Follow the turn"
          title="Follow the turn"
          className={cn(
            "motion-press rounded-md border p-1",
            followTurn
              ? "border-amber-600/80 bg-amber-950/70 text-amber-200"
              : "border-stone-700/80 bg-stone-950/85 text-stone-400 hover:border-amber-500/50 hover:text-amber-100 hover:shadow-glow-gold",
          )}
        >
          <LocateFixed className="size-4" />
        </button>
      ) : null}
      {onDirect ? (
        <>
          <button
            type="button"
            title="Pull everyone here"
            aria-label="Pull everyone to this view"
            onClick={() => onDirect("pull")}
            className="motion-press rounded-md border border-amber-700/70 bg-stone-950/85 p-1 text-amber-200 hover:bg-amber-950/60"
          >
            <Users className="size-4" />
          </button>
          <button
            type="button"
            title="Lock everyone to my view"
            aria-label="Lock everyone to this view"
            onClick={() => onDirect("lock")}
            className={CAMERA_BUTTON}
          >
            <Lock className="size-4" />
          </button>
          <button
            type="button"
            title="Free everyone's view"
            aria-label="Free everyone's view"
            onClick={() => onDirect("free")}
            className={CAMERA_BUTTON}
          >
            <Unlock className="size-4" />
          </button>
        </>
      ) : null}
    </div>
  );
}

// The rail on the board is display only; a tap opens the order itself: the
// DM's editable panel, the plain list for everyone else.
export function BoardOrderDialog({
  open,
  onOpenChange,
  campaignId,
  encounter,
  round,
  canDirect,
  faceOf,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  campaignId: string;
  encounter: PublicEncounter | null;
  round: number;
  canDirect: boolean;
  faceOf: FaceLookup;
}) {
  return (
    <Dialog
      open={open && Boolean(encounter)}
      onOpenChange={onOpenChange}
      title={`Initiative, round ${round}`}
      width="w-[min(94vw,26rem)]"
    >
      {encounter && canDirect ? (
        <DmInitiativePanel campaignId={campaignId} encounter={encounter} faceOf={faceOf} />
      ) : encounter ? (
        <ol className="space-y-1">
          {encounter.order.map((entry, index) => (
            <li
              key={`${entry.id}-${index}`}
              className={cn(
                "flex items-center gap-2 rounded-md border px-2 py-1 text-sm",
                index === encounter.turnIndex
                  ? "border-amber-700 bg-amber-950/40 text-amber-100"
                  : "border-stone-800 text-stone-300",
              )}
            >
              <TokenFace
                candidates={faceOf(entry)}
                name={entry.name}
                enemy={entry.kind === "enemy"}
                className="size-7 rounded-full border border-stone-700"
              />
              <span className="min-w-0 flex-1 truncate">{entry.name}{entry.reflex ? <sup className="motion-pop ml-0.5 text-[9px] text-amber-300" title="Thief's Reflexes: a second turn this round">2nd</sup> : null}</span>
              {index === encounter.turnIndex ? (
                <span className="text-[10px] uppercase tracking-wide text-amber-300">up now</span>
              ) : null}
            </li>
          ))}
        </ol>
      ) : null}
    </Dialog>
  );
}

// The line under the board saying what a tap does now, for the DM's tools
// and for a player's turn. Split from BattleMapPanel.tsx.
export function boardHintText(input: {
  canDirect: boolean;
  tool: string;
  teleporting: boolean;
  held: boolean;
  liveOrigin: boolean;
  pointing: boolean;
  drawing: boolean;
  targeting: boolean;
  canMove: boolean;
  scene: boolean;
  budgetLeft: number;
  hasToken: boolean;
}): string {
  const { canDirect, tool, teleporting, held, liveOrigin, pointing, drawing, targeting, canMove, scene } = input;
  return canDirect
    ? tool === "draw"
      ? "Drag to draw. Everyone sees it; it is a plan, not a fact."
      : teleporting
      ? "Tap the tile it appears on. No path, no movement spent."
      : held
        ? "Tap where it should stand. The round's movement is not charged for this."
        : tool === "measure"
          ? liveOrigin
            ? "Now tap where it points."
            : "Tap where the area starts."
          : tool === "point"
            ? "Tap a tile and everyone looks at it."
            : tool === "place"
              ? "Name it, then tap a tile."
              : "Tap a piece for its actions. Nothing here is charged against the round."
    : pointing
      ? "Tap a tile to point at it."
      : drawing
        ? "Drag to draw. The table sees it; erase it when the plan changes."
      : targeting
        ? "Tap the enemy."
        : canMove
          ? scene
            ? "Tap anywhere you can walk. Nothing is being counted out here."
            : `Tap a highlighted tile to move (${input.budgetLeft * TILE_FEET} ft left this round). Tap your figure for actions.`
          : input.hasToken
            ? "You can move on your turn. The shroud shows what your character cannot see."
            : "You have no token on this field.";
}

// The turn order under the board, the pointer's entry lit; a thief's second
// turn in round 1 is marked (Thief's Reflexes). Split from BattleMapPanel.tsx.
export function BoardOrderStrip({ encounter, faceOf }: { encounter: PublicEncounter | null | undefined; faceOf: FaceLookup }) {
  if (!encounter?.orderReady) return null;
  return (
    <ol className="flex flex-wrap gap-1 text-[11px] text-stone-400">
      {encounter.order.map((entry, index) => (
        <li
          key={`${entry.id}-${index}`}
          className={cn(
            "flex items-center gap-1 rounded-full py-0.5 pl-0.5 pr-2",
            index === encounter.turnIndex ? "bg-amber-950/60 font-medium text-amber-300" : "bg-stone-900",
          )}
        >
          <TokenFace
            candidates={faceOf(entry)}
            name={entry.name}
            enemy={entry.kind === "enemy"}
            className={cn(
              "size-5 rounded-full border",
              index === encounter.turnIndex ? "border-amber-500" : "border-stone-700",
            )}
          />
          {entry.name}
          {entry.hidden ? " (hidden)" : ""}
          {entry.reflex ? <sup className="motion-pop ml-0.5 text-[9px] text-amber-300" title="Thief's Reflexes: a second turn this round">2nd</sup> : null}
        </li>
      ))}
    </ol>
  );
}
