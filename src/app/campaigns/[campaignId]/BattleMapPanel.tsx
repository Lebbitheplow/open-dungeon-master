"use client";

import * as Dialog from "@radix-ui/react-dialog";
import {
  Eraser,
  Footprints,
  Lock,
  LocateFixed,
  Maximize2,
  MapPin,
  Pencil,
  Swords,
  Unlock,
  Users,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BattleMapGrid, type MapOverlay } from "@/app/campaigns/[campaignId]/BattleMapGrid";
import {
  BoardToolRail,
  MeasureControls,
  PlaceTokenForm,
  type BoardTool,
  type CaughtToken,
} from "@/app/campaigns/[campaignId]/DmBoardControls";
import {
  dmActions,
  playerActions,
  TokenHud,
  type HudAction,
} from "@/app/campaigns/[campaignId]/TokenHud";
import { useBoardCamera } from "@/app/campaigns/[campaignId]/useBoardCamera";
import { DRAWING_TONE } from "@/app/campaigns/[campaignId]/BoardStage";
import { TILE } from "@/app/campaigns/[campaignId]/battleMapCells";
import {
  DRAWING_KINDS,
  DRAWING_TONES,
  type DrawingKind,
  type DrawingTone,
  type MapLabel,
} from "@/lib/battlemap/scene";
import { PromptDialog } from "@/components/ui/PromptDialog";
import { cn } from "@/lib/cn";
import { findPath } from "@/lib/battlemap/movement";
import { moveCost, tileAt, TILE_FEET } from "@/lib/battlemap/types";
import type { FxEvent } from "@/lib/battlemap/fx-plan";
import type { TemplateShape } from "@/lib/battlemap/template";
import type { AdhocTokenKind } from "@/lib/battlemap/types";
import type { MapPing } from "@/lib/dm/board-logic";
import type { PlayerMapView } from "@/lib/battlemap/view";
import type { PublicEncounter } from "@/lib/db/encounter-view";
import type { CameraEvent, SceneState } from "@/lib/scene/state";
import { SkyLayer } from "@/components/SkyLayer";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// The tactical battle map tab.
//
// For a player it is their fogged grid with click-to-move on their own turn,
// plus a ruler that measures the walk before they commit to it, a way to
// point at a tile, and a radial HUD on their own token that pre-fills the
// composer with an action. For a DM it is the same board with the fog off
// and hands on it: pick any piece up, put people and furniture down, hide a
// combatant the party has not met, drop a measured area to see who is
// caught, damage, heal, condition or teleport a token from its HUD, and
// steer everyone's camera.
//
// Every rule is still enforced on the server. The ruler below runs the same
// pathfinder the move route runs, so what it promises and what the server
// allows cannot drift, and the DM's tools all POST to routes that check the
// board themselves (src/lib/dm/board.ts, /dm/invoke).

// A ping is a moment, not a state: it fades on its own.
const PING_MS = 2600;

const NO_FX: FxEvent[] = [];
const NOOP = () => {};

type Prompt = {
  kind: "damage" | "heal" | "condition";
  tokenId: string;
};

export function BattleMapPanel({
  campaignId,
  view,
  encounter,
  sheets,
  refreshBattleMap,
  canDirect = false,
  canFocusPing = false,
  ping = null,
  fx = NO_FX,
  onFxPlayed = NOOP,
  camera = null,
  onCameraDone = NOOP,
  onCompose,
  sky = null,
  canDraw = true,
  onOpenLabel,
}: {
  campaignId: string;
  view: PlayerMapView;
  encounter: PublicEncounter | null;
  sheets: CharacterSheet[];
  refreshBattleMap: () => Promise<void>;
  // The DM seat. Deliberately not derived from view.fullVision: that flag
  // says what the projection withheld, not what this person may do.
  canDirect?: boolean;
  // Story authority, which is what the ping route accepts the focus flag
  // for; the DM seat alone is not what makes a ping open everyone's board.
  canFocusPing?: boolean;
  ping?: MapPing | null;
  // Effects the server planned for this board, and how to report them played.
  fx?: FxEvent[];
  onFxPlayed?: (ids: string[]) => void;
  // The DM steering the camera, and how to say it was obeyed.
  camera?: CameraEvent | null;
  onCameraDone?: () => void;
  // Puts words in the composer: the HUD's shortcut to an action.
  onCompose?: (text: string) => void;
  // The sky, for a board under it (src/components/SkyLayer.tsx).
  sky?: SceneState | null;
  // Whether this seat may draw on the board (the DM always may).
  canDraw?: boolean;
  // A pinned label was tapped: open what it points at.
  onOpenLabel?: (label: MapLabel) => void;
}) {
  const [enlarged, setEnlarged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pointing, setPointing] = useState(false);
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);
  const [handledPing, setHandledPing] = useState<number | null>(null);
  const [expiredPing, setExpiredPing] = useState<number | null>(null);

  // DM tools.
  const [tool, setTool] = useState<BoardTool>("handle");
  const [held, setHeld] = useState<string | null>(null);
  const [placeKind, setPlaceKind] = useState<AdhocTokenKind>("npc");
  const [placeName, setPlaceName] = useState("");
  const [shape, setShape] = useState<TemplateShape>("sphere");
  const [sizeFeet, setSizeFeet] = useState(20);
  // A measure belongs to the board it was taken on. Both carry the map id so
  // a new board simply makes them stale, rather than an effect having to
  // remember to clear them.
  const [measure, setMeasure] = useState<
    { mapId: string; tiles: number[]; caught: CaughtToken[] } | null
  >(null);
  const [measureOrigin, setMeasureOrigin] = useState<
    { mapId: string; x: number; y: number } | null
  >(null);
  const liveMeasure = measure?.mapId === view.mapId ? measure : null;
  const liveOrigin = measureOrigin?.mapId === view.mapId ? measureOrigin : null;

  // The HUD: which token it is open on, and what the next tap means.
  const [hudTokenId, setHudTokenId] = useState<string | null>(null);
  const [targeting, setTargeting] = useState<"attack" | "cast" | null>(null);
  const [teleporting, setTeleporting] = useState<string | null>(null);
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [followTurn, setFollowTurn] = useState(true);

  // Drawing on the board: a player's pencil toggle (the DM has the tool),
  // the shape and tone in hand, and the stroke being laid down.
  const [drawing, setDrawing] = useState(false);
  const [drawKind, setDrawKind] = useState<DrawingKind>("stroke");
  const [drawTone, setDrawTone] = useState<DrawingTone>("gold");
  const [drawTtl, setDrawTtl] = useState(false);
  const [sketch, setSketch] = useState<Array<{ x: number; y: number }> | null>(null);
  const sketchRef = useRef<Array<{ x: number; y: number }> | null>(null);
  const drawActive = canDirect ? tool === "draw" : drawing;

  const scene = view.board === "scene";
  const canMove = view.reachable.length > 0;

  const tokensById = useMemo(
    () => new Map(view.tokens.map((token) => [token.id, token])),
    [view.tokens],
  );
  const turnToken = view.turn ? tokensById.get(view.turn.tokenId) : undefined;
  const turnTile = useMemo(
    () => (turnToken ? { x: turnToken.x, y: turnToken.y } : null),
    [turnToken],
  );
  const { frameRef, ...cam } = useBoardCamera(view.width, view.height, {
    followTurn: followTurn && !canDirect,
    turnTile,
    remote: camera,
    onRemoteHandled: onCameraDone,
    isDirector: canDirect,
  });

  // A focusing ping opens the board on every client. That is an adjustment
  // made while rendering because the prop changed, not an effect: an effect
  // would render the closed dialog first and then flip it.
  if (ping && ping.at !== handledPing) {
    setHandledPing(ping.at);
    if (ping.focus) {
      setEnlarged(true);
    }
  }
  // The ring animates itself, so a ping needs no state beyond "has this one
  // been up long enough": it is the prop until the timer says otherwise.
  const pings = useMemo(
    () => (ping && ping.at !== expiredPing ? [ping] : []),
    [ping, expiredPing],
  );
  useEffect(() => {
    if (!ping) {
      return;
    }
    const timer = setTimeout(() => setExpiredPing(ping.at), PING_MS);
    return () => clearTimeout(timer);
  }, [ping]);

  async function post(path: string, body: unknown): Promise<boolean> {
    if (busy) {
      return false;
    }
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/campaigns/${campaignId}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setError(data.error ?? "That was not allowed.");
        return false;
      }
      return true;
    } catch {
      setError("Could not reach the table.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function moveTo(x: number, y: number) {
    if (await post("/battle-map/move", { x, y })) {
      setHover(null);
    }
    await refreshBattleMap();
  }

  async function sendPing(x: number, y: number) {
    setPointing(false);
    await post("/battle-map/ping", { x, y, focus: canFocusPing });
  }

  async function board(body: unknown) {
    if (await post("/dm/board", body)) {
      await refreshBattleMap();
      return true;
    }
    return false;
  }

  // The DM's HUD reaches the same engine the console does, by name.
  async function invoke(name: string, args: Record<string, unknown>) {
    if (busy) {
      return false;
    }
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/dm/invoke`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, args }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
        result?: { error?: string };
      };
      const failure = !response.ok ? data.error : data.result?.error;
      if (failure) {
        setError(failure);
        return false;
      }
      await refreshBattleMap();
      return true;
    } catch {
      setError("Could not reach the table.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  // The drag ruler. It runs the server's own pathfinder over the projection
  // the viewer holds, so it can only ever promise a route the move route
  // would also allow; over budget it turns red rather than disappearing,
  // because "how far past my speed is this" is the question being asked.
  //
  // It routes around the tokens this viewer can see, which for a player does
  // not include one the DM has hidden. That is the right trade: the server's
  // reachable set does count the hidden token, so the tile still refuses the
  // click, and a ruler that bent around an invisible ambusher would give it
  // away.
  const ruler = useMemo(() => {
    // Whoever is being measured: the piece the DM picked up, or the player's
    // own character.
    const fromId = held ?? view.myTokenId;
    if (!hover || !fromId) {
      return null;
    }
    const from = view.tokens.find((token) => token.id === fromId);
    if (!from || (from.x === hover.x && from.y === hover.y)) {
      return null;
    }
    const occupied = new Set(
      view.tokens
        .filter((token) => token.id !== from.id)
        .map((token) => token.y * view.width + token.x),
    );
    const path = findPath(view.terrain, view.width, view.height, occupied, from, hover);
    if (!path?.length) {
      return null;
    }
    const cost = path.reduce(
      (total, step) => total + moveCost(tileAt(view.terrain, view.width, step.x, step.y)),
      0,
    );
    return {
      path: [{ x: from.x, y: from.y }, ...path],
      label: `${cost * TILE_FEET} ft`,
      // The DM spends no budget, so nothing they measure is ever too far.
      overBudget: held === null && cost > view.budgetLeft,
    };
  }, [hover, held, view]);

  const overlay = useMemo<MapOverlay>(
    () => ({
      template: liveMeasure?.tiles,
      ruler,
      pings,
      selectedTokenId: held ?? teleporting,
      sketch: sketch ? { kind: drawKind, points: sketch, tone: drawTone } : null,
    }),
    [liveMeasure, ruler, pings, held, teleporting, sketch, drawKind, drawTone],
  );

  // Pointer to tile: through the frame's box and the camera's transform.
  const tileAtPointer = useCallback(
    (event: React.PointerEvent) => {
      const frame = frameRef.current;
      if (!frame) {
        return null;
      }
      const rect = frame.getBoundingClientRect();
      const px = (event.clientX - rect.left - cam.camera.x) / cam.camera.zoom;
      const py = (event.clientY - rect.top - cam.camera.y) / cam.camera.zoom;
      const unit = rect.width / (view.width * TILE);
      return { x: px / unit / TILE, y: py / unit / TILE };
    },
    [frameRef, cam.camera, view.width],
  );

  async function finishSketch() {
    const points = sketchRef.current;
    sketchRef.current = null;
    setSketch(null);
    if (!points || points.length < 2) {
      return;
    }
    await post("/battle-map/draw", {
      kind: drawKind,
      points,
      tone: drawTone,
      ...(drawTtl ? { ttlRounds: 1 } : {}),
    });
    await refreshBattleMap();
  }

  async function eraseDrawings() {
    if (busy) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/battle-map/draw`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? "Nothing to erase.");
      }
    } finally {
      setBusy(false);
    }
    await refreshBattleMap();
  }

  // Dragging a figure (docs/vtt-parity-implementation-plan.md section 10.2):
  // the press must travel 8 px before it is a drag, a ghost follows the
  // pointer at 70 percent, and the drop lands where the pick-up-then-tap
  // would have, through the same routes. The tap model stays.
  const tokenDragRef = useRef<{ tokenId: string; x: number; y: number; active: boolean } | null>(null);
  const [tokenGhost, setTokenGhost] = useState<{ tokenId: string; x: number; y: number } | null>(null);
  function onFramePointerDownCapture(event: React.PointerEvent) {
    if (drawActive || targeting || teleporting) {
      return;
    }
    const target = event.target as HTMLElement;
    const figure = target.closest?.("[data-token-id]") as HTMLElement | null;
    const tokenId = figure?.dataset.tokenId;
    if (!tokenId) {
      return;
    }
    const token = tokensById.get(tokenId);
    if (!token) {
      return;
    }
    const mayDrag = canDirect || (token.id === view.myTokenId && canMove);
    if (!mayDrag) {
      return;
    }
    tokenDragRef.current = { tokenId, x: event.clientX, y: event.clientY, active: false };
  }
  function onFramePointerMove(event: React.PointerEvent) {
    const drag = tokenDragRef.current;
    if (!drag) {
      return;
    }
    if (!drag.active) {
      if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 8) {
        return;
      }
      drag.active = true;
      (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    }
    const at = tileAtPointer(event);
    if (at) {
      setTokenGhost({ tokenId: drag.tokenId, x: Math.floor(at.x), y: Math.floor(at.y) });
      if (!canDirect) {
        setHover({ x: Math.floor(at.x), y: Math.floor(at.y) });
      }
    }
  }
  function onFramePointerUp(event: React.PointerEvent) {
    const drag = tokenDragRef.current;
    tokenDragRef.current = null;
    if (!drag || !drag.active) {
      return;
    }
    setTokenGhost(null);
    const at = tileAtPointer(event);
    if (!at) {
      return;
    }
    const x = Math.floor(at.x);
    const y = Math.floor(at.y);
    if (x < 0 || y < 0 || x >= view.width || y >= view.height) {
      return;
    }
    // A drop that did not leave the tile is a tap, and the tap already happened.
    const token = tokensById.get(drag.tokenId);
    if (token && token.x === x && token.y === y) {
      return;
    }
    if (canDirect) {
      void board({ do: "place", tokenId: drag.tokenId, x, y });
    } else {
      void moveTo(x, y);
    }
  }
  function onFramePointerCancel() {
    tokenDragRef.current = null;
    setTokenGhost(null);
  }
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        tokenDragRef.current = null;
        setTokenGhost(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function onDrawDown(event: React.PointerEvent) {
    if (event.button !== 0 && event.pointerType === "mouse") {
      return;
    }
    const at = tileAtPointer(event);
    if (!at) {
      return;
    }
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    sketchRef.current = [at];
    setSketch([at]);
  }
  function onDrawMove(event: React.PointerEvent) {
    if (!sketchRef.current) {
      return;
    }
    const at = tileAtPointer(event);
    if (!at) {
      return;
    }
    const next = drawKind === "stroke" ? [...sketchRef.current, at] : [sketchRef.current[0], at];
    sketchRef.current = next;
    setSketch(next);
  }
  function onDrawUp() {
    void finishSketch();
  }
  function onDrawCancel() {
    sketchRef.current = null;
    setSketch(null);
  }

  // What a tap on a tile means right now. One place, because "which mode am
  // I in" is the only thing that changes between them.
  // Not memoized on purpose: the grid reads its handlers through refs and
  // its memo only checks whether one was passed, so a fresh identity every
  // render costs nothing and a dependency list here would be a trap.
  function handleTile(x: number, y: number) {
    if (pointing) {
      void sendPing(x, y);
      return;
    }
    if (targeting) {
      // A tile is not a target; the hint says so.
      return;
    }
    if (canDirect) {
      if (teleporting) {
        const token = tokensById.get(teleporting);
        setTeleporting(null);
        setHudTokenId(null);
        if (token) {
          void invoke("teleport_token", { tokenName: token.name, x, y });
        }
        return;
      }
      if (tool === "point") {
        void sendPing(x, y);
        return;
      }
      if (tool === "place") {
        if (!placeName.trim()) {
          setError("Name it first.");
          return;
        }
        void board({ do: "add", kind: placeKind, name: placeName.trim(), x, y }).then((ok) => {
          if (ok) {
            setPlaceName("");
          }
        });
        return;
      }
      if (tool === "measure") {
        if (!liveOrigin) {
          setMeasureOrigin({ mapId: view.mapId, x, y });
          setMeasure(null);
          return;
        }
        void (async () => {
          setBusy(true);
          setError("");
          try {
            const response = await fetch(`/api/campaigns/${campaignId}/dm/board`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                do: "template",
                shape,
                origin: { x: liveOrigin.x, y: liveOrigin.y },
                target: { x, y },
                sizeFeet,
              }),
            });
            const data = (await response.json().catch(() => ({}))) as {
              tiles?: number[];
              caught?: CaughtToken[];
              error?: string;
            };
            if (!response.ok) {
              setError(data.error ?? "That area could not be measured.");
              return;
            }
            setMeasure({
              mapId: view.mapId,
              tiles: data.tiles ?? [],
              caught: data.caught ?? [],
            });
            setMeasureOrigin(null);
          } finally {
            setBusy(false);
          }
        })();
        return;
      }
      if (held) {
        void board({ do: "place", tokenId: held, x, y }).then((ok) => {
          if (ok) {
            setHeld(null);
            setHudTokenId(null);
          }
        });
        return;
      }
      return;
    }
    if (canMove) {
      void moveTo(x, y);
    }
  }

  // A tap on a figure: pick a target while targeting, otherwise open the
  // HUD (the DM's on any piece, a player's on their own).
  function handleToken(tokenId: string) {
    const token = tokensById.get(tokenId);
    if (!token) {
      return;
    }
    if (targeting && onCompose) {
      if (token.kind !== "enemy" && token.kind !== "npc") {
        setError("Pick an enemy.");
        return;
      }
      onCompose(
        targeting === "attack"
          ? `I attack ${token.name}.`
          : `I cast  at ${token.name}.`,
      );
      setTargeting(null);
      setHudTokenId(null);
      return;
    }
    if (canDirect) {
      setHudTokenId((current) => (current === tokenId ? null : tokenId));
      return;
    }
    if (tokenId === view.myTokenId && onCompose) {
      setHudTokenId((current) => (current === tokenId ? null : tokenId));
    }
  }

  // Every tile takes a tap when the DM is placing something, when anyone is
  // pointing, when a teleport is waiting for its tile, or when an area is
  // being measured. Otherwise the reachable overlay is the whole clickable
  // surface, exactly as before.
  const everyTileClickable =
    pointing || (canDirect && (tool !== "handle" || held !== null || teleporting !== null));

  const hudToken = hudTokenId ? tokensById.get(hudTokenId) : undefined;
  const hudActions: HudAction[] = useMemo(() => {
    if (!hudToken) {
      return [];
    }
    if (canDirect) {
      return dmActions(hudToken, {
        hold: () => {
          setHeld((current) => (current === hudToken.id ? null : hudToken.id));
          setTool("handle");
          setHudTokenId(null);
        },
        teleport: () => {
          setTeleporting(hudToken.id);
          setHeld(null);
          setTool("handle");
        },
        visibility: (hidden) => {
          void board({ do: "visibility", tokenId: hudToken.id, hidden });
          setHudTokenId(null);
        },
        damage: () => setPrompt({ kind: "damage", tokenId: hudToken.id }),
        heal: () => setPrompt({ kind: "heal", tokenId: hudToken.id }),
        condition: () => setPrompt({ kind: "condition", tokenId: hudToken.id }),
        remove: () => {
          void board({ do: "remove", tokenId: hudToken.id });
          setHudTokenId(null);
        },
      });
    }
    return playerActions(
      hudToken,
      (text) => {
        onCompose?.(text);
        setHudTokenId(null);
      },
      (mode) => setTargeting(mode),
    );
    // `board` is a closure over state; the actions are rebuilt per token.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hudToken, canDirect, onCompose]);

  const promptToken = prompt ? tokensById.get(prompt.tokenId) : undefined;
  const submitPrompt = useCallback(
    (value: string) => {
      if (!prompt || !promptToken) {
        return;
      }
      const isEnemy = promptToken.kind === "enemy";
      const ref = isEnemy ? { enemyId: promptToken.refId } : { characterId: promptToken.refId };
      if (prompt.kind === "condition") {
        void invoke(isEnemy ? "set_enemy_condition" : "set_condition", { ...ref, condition: value });
      } else {
        const amount = Number.parseInt(value, 10);
        if (!Number.isFinite(amount) || amount < 1) {
          setError("Give a number of hit points.");
          return;
        }
        if (prompt.kind === "damage") {
          void invoke(isEnemy ? "damage_enemy" : "apply_damage", { ...ref, amount });
        } else {
          void invoke("heal", { ...ref, amount });
        }
      }
      setHudTokenId(null);
    },
    // invoke closes over busy state; rebuilding per prompt is intended.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [prompt, promptToken],
  );

  const grid = (
    <div
      ref={frameRef}
      tabIndex={0}
      aria-label="Board view. Scroll or pinch to zoom, arrow keys to pan."
      className="relative overflow-hidden rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-amber-400/50"
      {...cam.frameProps}
      onPointerDownCapture={onFramePointerDownCapture}
      onPointerMove={(event) => {
        cam.frameProps.onPointerMove(event);
        onFramePointerMove(event);
      }}
      onPointerUp={(event) => {
        cam.frameProps.onPointerUp(event);
        onFramePointerUp(event);
      }}
      onPointerCancel={(event) => {
        cam.frameProps.onPointerCancel(event);
        onFramePointerCancel();
      }}
    >
      {view.outdoors ? <SkyLayer scene={sky} mode="board" className="rounded-lg" /> : null}
      <div
        className={cn(cam.eased && "sky-wash", "relative", drawActive && "touch-none")}
        style={{
          transform: `translate(${cam.camera.x}px, ${cam.camera.y}px) scale(${cam.camera.zoom})`,
          transformOrigin: "0 0",
          transition: cam.eased ? "transform var(--dur-scene) var(--ease-drift)" : "none",
        }}
      >
        <BattleMapGrid
          view={view}
          sheets={sheets}
          onTileClick={canDirect || canMove || pointing ? handleTile : undefined}
          onTileHover={
            canMove || held
              ? (x, y) => setHover(y === null ? null : { x, y })
              : undefined
          }
          onTokenClick={canDirect || (view.myTokenId && onCompose) ? handleToken : undefined}
          everyTileClickable={everyTileClickable}
          overlay={overlay}
          fx={fx}
          onFxPlayed={onFxPlayed}
          onLabelClick={onOpenLabel}
        />
        {tokenGhost ? (
          <div
            className="pointer-events-none absolute z-20 flex items-center justify-center rounded-full border-2 border-amber-300 bg-stone-950/70 text-[10px] text-amber-100 shadow-glow-gold"
            style={{
              left: `${(tokenGhost.x / view.width) * 100}%`,
              top: `${(tokenGhost.y / view.height) * 100}%`,
              width: `${100 / view.width}%`,
              aspectRatio: "1 / 1",
              opacity: 0.7,
            }}
          >
            {tokensById.get(tokenGhost.tokenId)?.name.charAt(0).toUpperCase() ?? ""}
          </div>
        ) : null}
        {drawActive ? (
          <div
            className="absolute inset-0 z-10 cursor-crosshair"
            aria-label="Drawing surface"
            onPointerDown={onDrawDown}
            onPointerMove={onDrawMove}
            onPointerUp={onDrawUp}
            onPointerCancel={onDrawCancel}
          />
        ) : null}
        {hudToken ? (
          <TokenHud
            token={hudToken}
            boardWidth={view.width}
            boardHeight={view.height}
            footprint={view.tokenFootprint[hudToken.id] ?? 1}
            actions={targeting ? [] : hudActions}
            hint={
              targeting
                ? targeting === "attack"
                  ? "Tap the enemy you attack"
                  : "Tap the enemy you cast at"
                : teleporting === hudToken.id
                  ? "Tap the tile it appears on"
                  : undefined
            }
            onClose={() => {
              setHudTokenId(null);
              setTargeting(null);
              setTeleporting(null);
            }}
          />
        ) : null}
      </div>
      {/* Camera controls: corner buttons for everyone, the DM's pull and
          lock, and the escape hatch when a lock has held too long. */}
      <div className="absolute bottom-2 right-2 z-10 flex flex-col gap-1">
        <button
          type="button"
          onClick={cam.zoomIn}
          aria-label="Zoom in"
          className="rounded-md border border-stone-700/80 bg-stone-950/85 p-1 text-stone-300 hover:text-stone-100"
        >
          <ZoomIn className="size-4" />
        </button>
        <button
          type="button"
          onClick={cam.zoomOut}
          aria-label="Zoom out"
          className="rounded-md border border-stone-700/80 bg-stone-950/85 p-1 text-stone-300 hover:text-stone-100"
        >
          <ZoomOut className="size-4" />
        </button>
        <button
          type="button"
          onClick={cam.reset}
          aria-label="Fit the board"
          className="rounded-md border border-stone-700/80 bg-stone-950/85 p-1 text-stone-300 hover:text-stone-100"
        >
          <Maximize2 className="size-4" />
        </button>
        {!canDirect && !scene ? (
          <button
            type="button"
            onClick={() => setFollowTurn((current) => !current)}
            aria-pressed={followTurn}
            title="Follow the turn"
            className={cn(
              "rounded-md border p-1",
              followTurn
                ? "border-amber-600/80 bg-amber-950/70 text-amber-200"
                : "border-stone-700/80 bg-stone-950/85 text-stone-400 hover:text-stone-100",
            )}
          >
            <LocateFixed className="size-4" />
          </button>
        ) : null}
        {canDirect ? (
          <>
            <button
              type="button"
              title="Pull everyone here"
              aria-label="Pull everyone to this view"
              onClick={() => {
                const here = cam.describe();
                if (here) {
                  void post("/dm/board", { do: "camera", mode: "pull", ...here });
                }
              }}
              className="rounded-md border border-amber-700/70 bg-stone-950/85 p-1 text-amber-200 hover:bg-amber-950/60"
            >
              <Users className="size-4" />
            </button>
            <button
              type="button"
              title="Lock everyone to my view"
              aria-label="Lock everyone to this view"
              onClick={() => {
                const here = cam.describe();
                if (here) {
                  void post("/dm/board", { do: "camera", mode: "lock", ...here });
                }
              }}
              className="rounded-md border border-stone-700/80 bg-stone-950/85 p-1 text-stone-300 hover:text-stone-100"
            >
              <Lock className="size-4" />
            </button>
            <button
              type="button"
              title="Free everyone's view"
              aria-label="Free everyone's view"
              onClick={() => void post("/dm/board", { do: "camera", mode: "free" })}
              className="rounded-md border border-stone-700/80 bg-stone-950/85 p-1 text-stone-300 hover:text-stone-100"
            >
              <Unlock className="size-4" />
            </button>
          </>
        ) : null}
      </div>
      {cam.locked ? (
        <div className="absolute left-2 top-2 z-10 flex items-center gap-2 rounded-md border border-amber-800/60 bg-stone-950/90 px-2 py-1 text-[11px] text-amber-200 shadow-elev-1">
          <Lock className="size-3" />
          The DM is steering the view
          {cam.canRelease ? (
            <button type="button" onClick={cam.release} className="ml-1 text-stone-300 underline">
              look around anyway
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 text-sm font-medium text-stone-200">
          {scene ? (
            <>
              <Footprints className="size-4 text-amber-400" />
              Exploring
            </>
          ) : (
            <>
              <Swords className="size-4 text-red-400" />
              Round {view.round}
              {view.currentTurnName ? (
                <span className="text-xs font-normal text-stone-400">
                  {view.currentTurnName}&apos;s turn
                </span>
              ) : null}
            </>
          )}
        </h3>
        <div className="flex items-center gap-1">
          {canDirect ? null : (
            <>
              <button
                type="button"
                onClick={() => setPointing((current) => !current)}
                title="Point at a tile"
                aria-pressed={pointing}
                className={`rounded p-1 ${
                  pointing ? "bg-amber-950/60 text-amber-300" : "text-stone-400 hover:bg-stone-900"
                }`}
              >
                <MapPin className="size-4" />
              </button>
              {canDraw ? (
                <button
                  type="button"
                  onClick={() => setDrawing((current) => !current)}
                  title="Draw on the board"
                  aria-pressed={drawing}
                  className={`rounded p-1 ${
                    drawing ? "bg-amber-950/60 text-amber-300" : "text-stone-400 hover:bg-stone-900"
                  }`}
                >
                  <Pencil className="size-4" />
                </button>
              ) : null}
            </>
          )}
          <button
            type="button"
            onClick={() => setEnlarged(true)}
            className="rounded p-1 text-stone-400 hover:bg-stone-900 hover:text-stone-200"
            aria-label="Enlarge battle map"
          >
            <Maximize2 className="size-4" />
          </button>
        </div>
      </div>
      {canDirect ? (
        <BoardToolRail
          tool={tool}
          onTool={(next) => {
            setTool(next);
            setHeld(null);
            setTeleporting(null);
            setMeasureOrigin(null);
          }}
          disabled={busy}
        />
      ) : null}
      {grid}
      {canDirect && tool === "place" ? (
        <PlaceTokenForm
          kind={placeKind}
          name={placeName}
          onKind={setPlaceKind}
          onName={setPlaceName}
        />
      ) : null}
      {drawActive ? (
        <div className="flex flex-wrap items-center gap-1">
          {DRAWING_KINDS.map((kind) => (
            <button
              key={kind}
              type="button"
              aria-pressed={drawKind === kind}
              onClick={() => setDrawKind(kind)}
              className={cn(
                "rounded-md border px-2 py-0.5 text-[11px] capitalize",
                drawKind === kind ? "border-amber-700 bg-amber-950/50 text-amber-100" : "border-stone-700 text-stone-400",
              )}
            >
              {kind}
            </button>
          ))}
          <span className="mx-1 h-4 w-px bg-stone-800" />
          {DRAWING_TONES.map((tone) => (
            <button
              key={tone}
              type="button"
              aria-label={`${tone} ink`}
              aria-pressed={drawTone === tone}
              onClick={() => setDrawTone(tone)}
              className={cn(
                "size-5 rounded-full border-2",
                drawTone === tone ? "border-stone-100" : "border-transparent",
              )}
              style={{ background: DRAWING_TONE[tone] }}
            />
          ))}
          <label className="ml-1 flex items-center gap-1 text-[11px] text-stone-500">
            <input type="checkbox" checked={drawTtl} onChange={(event) => setDrawTtl(event.target.checked)} />
            fades next round
          </label>
          <button
            type="button"
            onClick={() => void eraseDrawings()}
            className="ml-auto flex items-center gap-1 rounded-md border border-stone-700 px-2 py-0.5 text-[11px] text-stone-400 hover:text-red-300"
            title={canDirect ? "Clear every mark" : "Erase your marks"}
          >
            <Eraser className="size-3" />
            {canDirect ? "Clear" : "Erase mine"}
          </button>
        </div>
      ) : null}
      {canDirect && tool === "measure" ? (
        <MeasureControls
          shape={shape}
          sizeFeet={sizeFeet}
          caught={liveMeasure?.caught ?? []}
          onShape={setShape}
          onSize={setSizeFeet}
          onClear={() => {
            setMeasure(null);
            setMeasureOrigin(null);
          }}
        />
      ) : null}
      <p className="text-[11px] leading-4 text-stone-500">
        {canDirect
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
                  : `Tap a highlighted tile to move (${view.budgetLeft * TILE_FEET} ft left this round). Tap your figure for actions.`
                : view.myTokenId
                  ? "You can move on your turn. The shroud shows what your character cannot see."
                  : "You have no token on this field."}
      </p>
      {error ? <p className="text-[11px] text-red-400">{error}</p> : null}
      {encounter?.orderReady ? (
        <ol className="flex flex-wrap gap-1 text-[11px] text-stone-400">
          {encounter.order.map((entry, index) => (
            <li
              key={`${entry.id}-${index}`}
              className={
                index === encounter.turnIndex
                  ? "rounded bg-amber-950/60 px-1.5 py-0.5 font-medium text-amber-300"
                  : "rounded bg-stone-900 px-1.5 py-0.5"
              }
            >
              {entry.name}
              {entry.hidden ? " (hidden)" : ""}
            </li>
          ))}
        </ol>
      ) : null}
      <PromptDialog
        open={Boolean(prompt && promptToken)}
        title={
          prompt?.kind === "damage"
            ? `Damage ${promptToken?.name ?? ""}`
            : prompt?.kind === "heal"
              ? `Heal ${promptToken?.name ?? ""}`
              : `Condition on ${promptToken?.name ?? ""}`
        }
        label={prompt?.kind === "condition" ? "Condition" : "Hit points"}
        placeholder={prompt?.kind === "condition" ? "prone" : "8"}
        submitLabel={prompt?.kind === "damage" ? "Deal it" : prompt?.kind === "heal" ? "Heal" : "Apply"}
        onSubmit={submitPrompt}
        onOpenChange={(open) => {
          if (!open) {
            setPrompt(null);
          }
        }}
      />
      <Dialog.Root open={enlarged} onOpenChange={setEnlarged}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/80" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[92vh] w-[min(94vw,64rem)] -translate-x-1/2 -translate-y-1/2 overflow-auto panel rounded-xl p-4">
            <div className="mb-2 flex items-center justify-between">
              <Dialog.Title className="font-serif text-stone-100">
                {scene ? "The ground here" : `Battle map, round ${view.round}`}
              </Dialog.Title>
              <Dialog.Close className="rounded p-1 text-stone-400 hover:bg-stone-900">
                <X className="size-4" />
              </Dialog.Close>
            </div>
            {grid}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
