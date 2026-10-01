"use client";

import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { area as areaPath, outline, TONE } from "@/app/campaigns/[campaignId]/BoardZoneLayer";
import {
  HAND_AIM_ASK_EVENT,
  HAND_AREA_EVENT,
  SQUARE_ARMED_EVENT,
  SQUARE_PICKED_EVENT,
  SQUARE_REQUEST_EVENT,
  areaCells,
  hoverPick,
  nextPick,
  pickHint,
  requestPick,
  type AreaPick,
  type HandArea,
  type HandAreaDetail,
  type SquarePickedDetail,
  type SquareRequestDetail,
} from "@/lib/battlemap/hand-area";
import { HAND_AIM_EVENT, type HandAimDetail } from "@/lib/battlemap/hand-play";
import type { ZoneLayout } from "@/lib/battlemap/zones";
import type { ZoneTone } from "@/lib/battlemap/zones-spells";
import type { PlayerMapView } from "@/lib/battlemap/view";

// Aiming a spell's area on the battle map: the board side of the pick the
// Hand (a player's area spell) or a console form (the DM's atX/atY) asks for
// (src/lib/battlemap/hand-area.ts). While a pick is open every tile takes a
// tap, the area the tap would lay follows the pointer as a breathing ghost,
// and the area picked so far sits settled under it. The squares are the
// engine's own geometry; nothing here decides a rule.

type Aim =
  | { source: "hand"; cardId: string; area: HandArea; pick: AreaPick }
  | { source: "console"; request: SquareRequestDetail };

export type AreaAimOverlay = {
  tone: ZoneTone;
  // The area as picked so far, and the one the square under the pointer
  // would give; either may be absent.
  set: ZoneLayout | null;
  ghost: ZoneLayout | null;
  // Changes whenever the settled area moves, so it settles in again.
  setKey: string;
};

const pointOf = (layout: ZoneLayout | null) => (layout ? layout.cells.join(",") : "");

export function useAreaAim(view: PlayerMapView, canDirect: boolean, hover: { x: number; y: number } | null) {
  const [aim, setAim] = useState<Aim | null>(null);

  useEffect(() => {
    const onHandAim = (event: Event) => {
      const detail = (event as CustomEvent<HandAimDetail>).detail;
      if (canDirect) return;
      if (detail?.active && detail.cardId && detail.area) {
        const area = detail.area;
        const cardId = detail.cardId;
        setAim({ source: "hand", cardId, area, pick: detail.pick ?? {} });
      } else {
        setAim((current) => (current?.source === "hand" ? null : current));
      }
    };
    const onRequest = (event: Event) => {
      const request = (event as CustomEvent<SquareRequestDetail>).detail;
      if (!canDirect || !request?.requestId) return;
      setAim({ source: "console", request });
      window.dispatchEvent(new CustomEvent(SQUARE_ARMED_EVENT, { detail: { requestId: request.requestId } }));
    };
    window.addEventListener(HAND_AIM_EVENT, onHandAim);
    window.addEventListener(SQUARE_REQUEST_EVENT, onRequest);
    // A board opened after the card was raised asks for it again.
    if (!canDirect) window.dispatchEvent(new Event(HAND_AIM_ASK_EVENT));
    return () => {
      window.removeEventListener(HAND_AIM_EVENT, onHandAim);
      window.removeEventListener(SQUARE_REQUEST_EVENT, onRequest);
    };
  }, [canDirect]);

  // Escape calls a console pick off; the Hand has its own Escape.
  useEffect(() => {
    if (aim?.source !== "console") return;
    const requestId = aim.request.requestId;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      window.dispatchEvent(new CustomEvent<SquarePickedDetail>(SQUARE_PICKED_EVENT, { detail: { requestId, square: null } }));
      setAim(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [aim]);

  const casterAt = useMemo(() => {
    if (!aim) return null;
    const token =
      aim.source === "hand"
        ? view.tokens.find((entry) => entry.id === view.myTokenId)
        : aim.request.casterRef
          ? view.tokens.find((entry) => entry.refId === aim.request.casterRef)
          : undefined;
    return token ? { x: token.x, y: token.y } : null;
  }, [aim, view.tokens, view.myTokenId]);

  // An aura or a self-centred spell is only shown; the rest take the taps.
  const taking = Boolean(aim && (aim.source === "console" || aim.area.pick !== "none"));

  const overlay = useMemo<AreaAimOverlay | null>(() => {
    if (!aim) return null;
    const map = { terrain: view.terrain, width: view.width, height: view.height };
    const area = aim.source === "hand" ? aim.area : aim.request.area;
    if (!area) return null;
    const settled = aim.source === "hand" ? aim.pick : requestPick(aim.request, null);
    const ghostPick = !hover || !taking ? null : aim.source === "hand" ? hoverPick(area, aim.pick, hover) : requestPick(aim.request, hover);
    const set = areaCells(area, settled, map, casterAt);
    const ghost = ghostPick ? areaCells(area, ghostPick, map, casterAt) : null;
    if (!set && !ghost) return null;
    return { tone: area.tone, set, ghost: ghost && pointOf(ghost) !== pointOf(set) ? ghost : null, setKey: pointOf(set) };
  }, [aim, hover, taking, view.terrain, view.width, view.height, casterAt]);

  // Who the area would catch, by name: the ghost's when there is one.
  const caught = useMemo(() => {
    const cells = new Set((overlay?.ghost ?? overlay?.set)?.cells ?? []);
    return view.tokens.filter((token) => cells.has(token.y * view.width + token.x)).map((token) => token.name);
  }, [overlay, view.tokens, view.width]);

  // A tap on a square while a pick is open: the pick takes it and the tap
  // goes no further (no walk, no ping). True when it was taken.
  const tap = useCallback(
    (x: number, y: number): boolean => {
      if (!aim || !taking) return false;
      if (aim.source === "console") {
        window.dispatchEvent(
          new CustomEvent<SquarePickedDetail>(SQUARE_PICKED_EVENT, { detail: { requestId: aim.request.requestId, square: { x, y } } }),
        );
        setAim(null);
        return true;
      }
      const pick = nextPick(aim.area, aim.pick, { x, y });
      setAim({ ...aim, pick });
      window.dispatchEvent(new CustomEvent<HandAreaDetail>(HAND_AREA_EVENT, { detail: { cardId: aim.cardId, pick } }));
      return true;
    },
    [aim, taking],
  );

  const hint = !aim
    ? ""
    : aim.source === "hand"
      ? `${aim.area.spell}: ${pickHint(aim.area, aim.pick)}`
      : `Tap the square for ${aim.request.label.toLowerCase()}. Esc stops.`;

  return { active: taking, overlay, caught, tap, hint };
}

// The area being aimed, drawn over the figures so the caster sees who it
// would catch: the settled pick in the spell's colour, the pointer's ghost
// breathing over it.
export const AreaAimLayer = memo(function AreaAimLayer({ aim, width }: { aim: AreaAimOverlay | null | undefined; width: number }) {
  if (!aim) return null;
  const color = TONE[aim.tone] ?? TONE.hush;
  return (
    <g data-layer="area-aim" pointerEvents="none" style={{ color }}>
      {aim.set?.cells.length ? (
        <g key={aim.setKey} className="area-aim-set">
          <path d={areaPath(aim.set.cells, width)} fill={color} fillOpacity={0.22} />
          {aim.set.hot?.length ? <path d={areaPath(aim.set.hot, width)} fill={color} fillOpacity={0.1} /> : null}
          <path d={outline(aim.set.cells, width)} fill="none" stroke={color} strokeWidth={2} strokeDasharray="6 4" className="area-aim-edge" />
        </g>
      ) : null}
      {aim.ghost?.cells.length ? (
        <g>
          <path d={areaPath(aim.ghost.cells, width)} fill={color} className="area-aim-ghost" />
          {aim.ghost.hot?.length ? <path d={areaPath(aim.ghost.hot, width)} fill={color} fillOpacity={0.08} /> : null}
          <path d={outline(aim.ghost.cells, width)} fill="none" stroke={color} strokeOpacity={0.9} strokeWidth={1.5} strokeDasharray="4 4" className="area-aim-edge" />
        </g>
      ) : null}
    </g>
  );
});
