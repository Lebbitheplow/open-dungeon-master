"use client";

import { Box, Eye, EyeOff, Hand, MapPin, Ruler, Trash2, UserPlus } from "lucide-react";
import { cn } from "@/lib/cn";
import { ADHOC_LABELS, ADHOC_HINTS, ADHOC_NAME_MAX } from "@/lib/dm/board-logic";
import { SHAPE_LABELS, SHAPE_MEASURES, TEMPLATE_SHAPES } from "@/lib/battlemap/template";
import type { TemplateShape } from "@/lib/battlemap/template";
import type { AdhocTokenKind } from "@/lib/battlemap/types";
import type { PlayerMapView } from "@/lib/battlemap/view";

// The DM's rail above the tactical board, and the small card that opens on a
// token. Presentational only: BattleMapPanel owns the state and does the
// talking, so the two can be read separately.

export type BoardTool = "handle" | "place" | "measure" | "point";

const TOOL_LABELS: Record<BoardTool, string> = {
  handle: "Move pieces",
  place: "Put something down",
  measure: "Measure an area",
  point: "Point at a tile",
};

const TOOL_ICONS: Record<BoardTool, typeof Hand> = {
  handle: Hand,
  place: Box,
  measure: Ruler,
  point: MapPin,
};

export function BoardToolRail({
  tool,
  onTool,
  disabled,
}: {
  tool: BoardTool;
  onTool: (tool: BoardTool) => void;
  disabled: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-1">
      {(Object.keys(TOOL_LABELS) as BoardTool[]).map((option) => {
        const Icon = TOOL_ICONS[option];
        return (
          <button
            key={option}
            type="button"
            disabled={disabled}
            onClick={() => onTool(option)}
            title={TOOL_LABELS[option]}
            className={cn(
              "flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs disabled:opacity-40",
              tool === option
                ? "border-amber-700 bg-amber-950/50 text-amber-100"
                : "border-stone-700 text-stone-400 hover:text-stone-200",
            )}
          >
            <Icon className="size-3.5" />
            {TOOL_LABELS[option]}
          </button>
        );
      })}
    </div>
  );
}

export function PlaceTokenForm({
  kind,
  name,
  onKind,
  onName,
}: {
  kind: AdhocTokenKind;
  name: string;
  onKind: (kind: AdhocTokenKind) => void;
  onName: (name: string) => void;
}) {
  return (
    <div className="space-y-1.5 rounded-lg border border-stone-800 bg-stone-950/60 px-2.5 py-2">
      <div className="flex gap-1">
        {(Object.keys(ADHOC_LABELS) as AdhocTokenKind[]).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => onKind(option)}
            title={ADHOC_HINTS[option]}
            className={cn(
              "rounded-md border px-2 py-1 text-xs",
              kind === option
                ? "border-amber-700 bg-amber-950/50 text-amber-100"
                : "border-stone-700 text-stone-400 hover:text-stone-200",
            )}
          >
            {ADHOC_LABELS[option]}
          </button>
        ))}
      </div>
      <input
        value={name}
        onChange={(event) => onName(event.target.value)}
        maxLength={ADHOC_NAME_MAX}
        placeholder={kind === "npc" ? "Marla the smith" : "Overturned cart"}
        className="w-full rounded-md border border-stone-700 bg-stone-950 px-2 py-1 text-xs text-stone-200 placeholder:text-stone-600"
      />
      <p className="text-[11px] text-stone-500">
        {name.trim()
          ? "Now tap the tile it stands on."
          : "Name it first. An unlabelled circle is a puzzle for the whole table."}
      </p>
    </div>
  );
}

export type CaughtToken = { name: string; characterId?: string; enemyId?: string };

export function MeasureControls({
  shape,
  sizeFeet,
  caught,
  onShape,
  onSize,
  onClear,
}: {
  shape: TemplateShape;
  sizeFeet: number;
  caught: CaughtToken[];
  onShape: (shape: TemplateShape) => void;
  onSize: (feet: number) => void;
  onClear: () => void;
}) {
  const enemyIds = caught.map((entry) => entry.enemyId).filter(Boolean).join(", ");
  return (
    <div className="space-y-1.5 rounded-lg border border-stone-800 bg-stone-950/60 px-2.5 py-2">
      <div className="flex flex-wrap gap-1">
        {TEMPLATE_SHAPES.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => onShape(option)}
            className={cn(
              "rounded-md border px-2 py-1 text-xs",
              shape === option
                ? "border-amber-700 bg-amber-950/50 text-amber-100"
                : "border-stone-700 text-stone-400 hover:text-stone-200",
            )}
          >
            {SHAPE_LABELS[option]}
          </button>
        ))}
      </div>
      <label className="flex items-center gap-2 text-[11px] text-stone-400">
        <span className="w-16 capitalize">{SHAPE_MEASURES[shape]}</span>
        <input
          type="range"
          min={5}
          max={60}
          step={5}
          value={sizeFeet}
          onChange={(event) => onSize(Number(event.target.value))}
          className="flex-1 accent-amber-500"
        />
        <span className="w-12 text-right tabular-nums text-stone-300">{sizeFeet} ft</span>
      </label>
      <p className="text-[11px] leading-4 text-stone-500">
        Tap where it starts, then tap where it points. Nobody else sees it.
      </p>
      {caught.length ? (
        <p className="text-[11px] leading-4 text-amber-300">
          Caught: {caught.map((entry) => entry.name).join(", ")}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-1">
        <button
          type="button"
          onClick={onClear}
          className="rounded-md border border-stone-700 px-2 py-1 text-xs text-stone-400 hover:text-stone-200"
        >
          Clear the measure
        </button>
        {/* The console's Area of effect takes enemy ids as comma-separated
            text, so measuring and resolving are two steps rather than one
            long form filled in by eye. */}
        {enemyIds ? (
          <button
            type="button"
            onClick={() => void navigator.clipboard?.writeText(enemyIds)}
            title={enemyIds}
            className="rounded-md border border-stone-700 px-2 py-1 text-xs text-stone-400 hover:text-stone-200"
          >
            Copy the enemy ids
          </button>
        ) : null}
      </div>
    </div>
  );
}

// The card that opens on a token: what it is, how it is doing, and the three
// things a DM does to a piece mid-fight.
export function TokenCard({
  token,
  hp,
  held,
  busy,
  onHold,
  onVisibility,
  onRemove,
  onClose,
}: {
  token: PlayerMapView["tokens"][number];
  hp?: { current: number; max: number };
  held: boolean;
  busy: boolean;
  onHold: () => void;
  onVisibility: (hidden: boolean) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const adhoc = token.kind === "npc" || token.kind === "prop";
  return (
    <div className="space-y-1.5 rounded-lg border border-amber-900/60 bg-stone-950/90 px-2.5 py-2">
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-xs font-medium text-stone-200">{token.name}</p>
        <button
          type="button"
          onClick={onClose}
          className="text-[11px] text-stone-500 hover:text-stone-300"
        >
          Close
        </button>
      </div>
      <p className="text-[11px] text-stone-500">
        {token.kind === "pc"
          ? "Player character"
          : token.kind === "enemy"
            ? "Enemy"
            : ADHOC_LABELS[token.kind as AdhocTokenKind]}
        {hp ? ` · ${hp.current} / ${hp.max} HP` : ""}
        {token.hidden ? " · hidden from the party" : ""}
      </p>
      <div className="flex flex-wrap gap-1">
        <button
          type="button"
          disabled={busy}
          onClick={onHold}
          className={cn(
            "flex items-center gap-1 rounded-md border px-2 py-1 text-xs disabled:opacity-40",
            held
              ? "border-amber-700 bg-amber-950/50 text-amber-100"
              : "border-stone-700 text-stone-400 hover:text-stone-200",
          )}
        >
          <Hand className="size-3.5" />
          {held ? "Put it back down" : "Pick it up"}
        </button>
        {token.kind === "pc" ? null : (
          <button
            type="button"
            disabled={busy}
            onClick={() => onVisibility(!token.hidden)}
            className="flex items-center gap-1 rounded-md border border-stone-700 px-2 py-1 text-xs text-stone-400 hover:text-stone-200 disabled:opacity-40"
          >
            {token.hidden ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
            {token.hidden ? "Reveal" : "Hide"}
          </button>
        )}
        {adhoc ? (
          <button
            type="button"
            disabled={busy}
            onClick={onRemove}
            className="flex items-center gap-1 rounded-md border border-red-900/60 px-2 py-1 text-xs text-red-300 hover:bg-red-950/40 disabled:opacity-40"
          >
            <Trash2 className="size-3.5" />
            Take off
          </button>
        ) : null}
      </div>
      {token.kind !== "pc" && !adhoc ? (
        <p className="flex items-center gap-1 text-[11px] text-stone-600">
          <UserPlus className="size-3" />
          Enemies leave the board when they die.
        </p>
      ) : null}
    </div>
  );
}
