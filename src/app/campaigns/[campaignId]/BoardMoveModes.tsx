"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { cn } from "@/lib/cn";
import { dragReach } from "@/lib/battlemap/board-move";
import type { PlayerMapView } from "@/lib/battlemap/view";

// How the player's next move on the board goes: a walk, a long jump in a
// straight line (SRD 5.1, Jumping), or a walk that drags the creature they
// grapple (Grappling: Moving a Grappled Creature). The numbers come from the
// view (PlayerMapView.moves), which asks the rules the move route asks; the
// route plans the move and refuses in its own words. A sliding pill marks
// the choice (src/lib/motion/pill.ts), the options pop in on a stagger.

export type MoveMode = "walk" | "jump" | "drag";

export function effectiveMoveMode(mode: MoveMode, moves: PlayerMapView["moves"]): MoveMode {
  if (!moves) return "walk";
  if (mode === "drag" && !moves.drag) return "walk";
  return mode;
}

export function moveModeHint(mode: MoveMode, moves: PlayerMapView["moves"]): string {
  if (!moves || mode === "walk") return "";
  if (mode === "jump") {
    return moves.runningStart
      ? `Long jump: up to ${moves.jumpFeet} feet in a straight line, each foot a foot of movement. Tap where you land.`
      : `Standing long jump: up to ${moves.jumpFeet} feet (twice that after a 10-foot run this turn). Tap where you land.`;
  }
  const drag = moves.drag;
  if (!drag) return "";
  return drag.factor > 1
    ? `Dragging ${drag.names.join(" and ")}: every square costs double. Tap where you stop.`
    : `Dragging ${drag.names.join(" and ")}: two sizes smaller, so it costs nothing extra. Tap where you stop.`;
}

export function BoardMoveModes({
  mode,
  moves,
  onMode,
}: {
  mode: MoveMode;
  moves: PlayerMapView["moves"];
  onMode: (mode: MoveMode) => void;
}) {
  if (!moves) return null;
  const options: Array<{ id: MoveMode; label: string; note: string }> = [
    { id: "walk", label: "Walk", note: "Move square by square." },
    { id: "jump", label: "Jump", note: `A long jump of up to ${moves.jumpFeet} feet; a high jump of ${moves.highJumpFeet}.` },
    ...(moves.drag ? [{ id: "drag" as const, label: "Drag", note: `Take ${moves.drag.names.join(" and ")} with you.` }] : []),
  ];
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label="How you move" data-pill-group="">
      <span className="text-[10px] uppercase tracking-[0.18em] text-stone-500">Move</span>
      {options.map((option, index) => {
        const on = option.id === mode;
        return (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={on}
            data-on={on ? "" : undefined}
            title={option.note}
            style={{ "--i": index } as CSSProperties}
            onClick={() => onMode(option.id)}
            className={cn(
              "hand-option motion-press motion-pop inline-flex min-h-8 items-center rounded-full border px-2.5 text-[11px]",
              on ? "border-amber-400/70 bg-amber-500/20 text-amber-100" : "border-stone-700 text-stone-400 hover:border-amber-500/60",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

// A jump just made: its arc drawn from where the jumper left the ground to
// where they landed, while the figure slides across under it. It draws
// itself in and fades (zones-aim.css .jump-arc); the panel drops it after.
export function JumpArc({
  leap,
  width,
  height,
}: {
  leap: { from: { x: number; y: number }; to: { x: number; y: number }; key: number } | null;
  width: number;
  height: number;
}) {
  if (!leap) return null;
  const fx = leap.from.x + 0.5;
  const fy = leap.from.y + 0.5;
  const tx = leap.to.x + 0.5;
  const ty = leap.to.y + 0.5;
  const lift = Math.max(0.8, Math.hypot(tx - fx, ty - fy) * 0.45);
  const mx = (fx + tx) / 2;
  const my = Math.min(fy, ty) - lift;
  return (
    <svg
      key={leap.key}
      className="pointer-events-none absolute inset-0 z-10 size-full"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <path
        d={`M ${fx} ${fy} Q ${mx} ${my} ${tx} ${ty}`}
        pathLength={1}
        fill="none"
        stroke="#6ee7b7"
        strokeWidth={0.08}
        strokeLinecap="round"
        className="jump-arc"
      />
      <circle cx={tx} cy={ty} r={0.42} fill="none" stroke="#6ee7b7" strokeWidth={0.06} className="jump-land" />
    </svg>
  );
}

// The board's move state: the mode picked, the mode the view allows, the
// squares the move still reaches (dragging lights only the squares the
// doubled walk reaches), and the arc of the jump just made, for as long as it
// draws. Split from BattleMapPanel.tsx.
export function useBoardMoveModes(view: PlayerMapView) {
  const [moveModePicked, setMoveMode] = useState<MoveMode>("walk");
  const moveMode = effectiveMoveMode(moveModePicked, view.moves);
  const dragFactor = moveMode === "drag" ? view.moves?.drag?.factor ?? 1 : 1;
  const gridView = useMemo(() => dragReach(view, dragFactor), [view, dragFactor]);
  const [leap, setLeap] = useState<{ from: { x: number; y: number }; to: { x: number; y: number }; key: number } | null>(null);
  useEffect(() => {
    if (!leap) return;
    const timer = window.setTimeout(() => setLeap(null), 950);
    return () => window.clearTimeout(timer);
  }, [leap]);
  // What the move route is told of the mode, and what a landed move leaves:
  // a jump is one leap, drawn as its arc, and the next tap walks again.
  const moveBody = moveMode === "jump" ? { jump: true } : moveMode === "drag" ? { drag: true } : {};
  const landed = (from: { x: number; y: number } | null, to: { x: number; y: number }) => {
    if (moveMode !== "jump") return;
    if (from) setLeap({ from, to, key: Date.now() });
    setMoveMode("walk");
  };
  return { moveMode, setMoveMode, gridView, leap, moveBody, landed };
}

// Under the board: the move modes with what the chosen one does (a player
// moving, no area being aimed), and an area spell's aim, what to tap next and
// who it would catch.
export function BoardMoveHints({
  moveMode,
  moves,
  onMode,
  areaHint,
  caught,
}: {
  moveMode: MoveMode;
  // The view's moves, or undefined when the picker is not offered.
  moves: PlayerMapView["moves"];
  onMode: (mode: MoveMode) => void;
  areaHint: string | null | undefined;
  caught: string[];
}) {
  return (
    <>
      {moves ? (
        <div className="space-y-1">
          <BoardMoveModes mode={moveMode} moves={moves} onMode={onMode} />
          {moveModeHint(moveMode, moves) ? (
            <p key={moveMode} className="animate-fade-up text-[11px] leading-4 text-amber-200/80">
              {moveModeHint(moveMode, moves)}
            </p>
          ) : null}
        </div>
      ) : null}
      {areaHint ? (
        <p key={areaHint} className="animate-fade-up text-[11px] leading-4 text-amber-200/90">
          {areaHint}
          {caught.length ? <span className="text-stone-400"> Catches {caught.join(", ")}.</span> : null}
        </p>
      ) : null}
    </>
  );
}
