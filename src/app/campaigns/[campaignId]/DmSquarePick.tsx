"use client";

import { useEffect, useRef, useState } from "react";
import { Crosshair } from "lucide-react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import {
  SQUARE_ARMED_EVENT,
  SQUARE_PICKED_EVENT,
  SQUARE_REQUEST_EVENT,
  areaFor,
  type SquarePickedDetail,
  type SquareRequestDetail,
} from "@/lib/battlemap/hand-area";
import type { CatalogField } from "@/lib/dm/catalog-types";

// "Pick on the board" beside a console form's column field (a spell area's
// centre, or where a wall runs): the battle map takes the next tap, previews
// the area the spell would lay there as the pointer moves
// (BoardAreaAim.tsx), and the tap fills the column and its row. With no
// board open to answer, the button says so and the numbers can be typed.

type Values = Record<string, unknown>;

const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : undefined);

function pair(values: Values, x: string, y: string) {
  const px = num(values[x]);
  const py = num(values[y]);
  return px !== undefined && py !== undefined ? { x: px, y: py } : undefined;
}

export function DmSquarePick({
  requestId,
  field,
  values,
  onPick,
}: {
  requestId: string;
  field: CatalogField;
  values: Values;
  onPick: (square: { x: number; y: number }) => void;
}) {
  const [state, setState] = useState<"idle" | "asking" | "armed" | "absent">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pickRef = useRef(onPick);
  useEffect(() => {
    pickRef.current = onPick;
  });

  useEffect(() => {
    const onArmed = (event: Event) => {
      if ((event as CustomEvent<{ requestId: string }>).detail?.requestId !== requestId) return;
      clearTimeout(timer.current);
      setState("armed");
    };
    const onPicked = (event: Event) => {
      const detail = (event as CustomEvent<SquarePickedDetail>).detail;
      if (detail?.requestId !== requestId) return;
      setState("idle");
      if (detail.square) pickRef.current(detail.square);
    };
    window.addEventListener(SQUARE_ARMED_EVENT, onArmed);
    window.addEventListener(SQUARE_PICKED_EVENT, onPicked);
    return () => {
      window.removeEventListener(SQUARE_ARMED_EVENT, onArmed);
      window.removeEventListener(SQUARE_PICKED_EVENT, onPicked);
      clearTimeout(timer.current);
    };
  }, [requestId]);

  if (!field.square) return null;
  const role = field.square.role;

  function ask() {
    if (state === "armed") {
      // A second press calls it off.
      window.dispatchEvent(new CustomEvent<SquarePickedDetail>(SQUARE_PICKED_EVENT, { detail: { requestId, square: null } }));
      return;
    }
    const spell = typeof values.spell === "string" ? values.spell.trim() : "";
    const level = num(values.level) ?? null;
    const casterRef = [values.characterId, values.casterId, values.casterEnemyId].find(
      (value): value is string => typeof value === "string" && value !== "",
    );
    const at = pair(values, "atX", "atY");
    const toward = pair(values, "towardX", "towardY");
    const detail: SquareRequestDetail = {
      requestId,
      role,
      label: field.label,
      area: spell ? areaFor(spell, level) : null,
      ...(at ? { at } : {}),
      ...(toward ? { toward } : {}),
      ...(casterRef ? { casterRef } : {}),
    };
    setState("asking");
    window.dispatchEvent(new CustomEvent(SQUARE_REQUEST_EVENT, { detail }));
    // A board that is open answers at once; none did.
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setState((current) => (current === "asking" ? "absent" : current)), 400);
  }

  return (
    <span className="ml-auto inline-flex items-center gap-1.5">
      {state === "absent" ? (
        <span className="motion-shake text-[11px] text-stone-400">Open the battle map to pick, or type the numbers.</span>
      ) : state === "armed" ? (
        <span className="animate-fade-up text-[11px] text-amber-200/90">Tap the square on the map.</span>
      ) : null}
      <button
        type="button"
        onClick={ask}
        aria-pressed={state === "armed"}
        className={cn(
          ui.btnSmall,
          "motion-press min-h-8 gap-1 px-2 py-0.5 text-[11px]",
          state === "armed" && "border-amber-500/70 bg-amber-400/10 text-amber-100 shadow-glow-gold",
        )}
      >
        <Crosshair className="size-3.5" />
        {state === "armed" ? "Stop" : "Pick on the board"}
      </button>
    </span>
  );
}
