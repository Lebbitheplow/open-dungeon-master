"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { returnFocus } from "@/components/ui/return-focus";
import {
  Eraser,
  Footprints,
  Lock,
  Maximize2,
  MapPin,
  Pencil,
  Swords,
  Undo2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
import { jumpRulerFor, moveNotesFrom, rulerFor } from "@/lib/battlemap/board-move";
import { BoardMoveHints, JumpArc, useBoardMoveModes, moveModeHint } from "@/app/campaigns/[campaignId]/BoardMoveModes";
import { TILE_FEET } from "@/lib/battlemap/types";
import { footprintDistance } from "@/lib/battlemap/footprint";

import { useAreaAim } from "@/app/campaigns/[campaignId]/BoardAreaAim";
import { BoardMoveNotes, useMoveNotes } from "@/app/campaigns/[campaignId]/BoardMoveNotes";
import type { FxEvent } from "@/lib/battlemap/fx-plan";
import { TEMPLATE_SHAPES, SHAPE_LABELS, type TemplateShape } from "@/lib/battlemap/template";
import type { AdhocTokenKind } from "@/lib/battlemap/types";
import { ADHOC_LABELS, ADHOC_NAME_MAX, type MapPing } from "@/lib/dm/board-logic";
import { ENTRY_NAME_MAX, MIN_INITIATIVE, MAX_INITIATIVE } from "@/lib/dm/initiative-edit";
import { extraTurnTag } from "@/lib/battlemap/initiative-rows";
import { offSide, sideWords } from "@/app/campaigns/[campaignId]/SideBadge";
import { playingSheet } from "@/lib/battlemap/hand-table";
import type { PlayerMapView } from "@/lib/battlemap/view";
import { boardHudGates } from "@/lib/battlemap/hand-hud";
import { effectiveMaxHp } from "@/lib/dm/condition-logic";
import type { PublicEncounter } from "@/lib/db/encounter-view";
import type { CameraEvent, SceneState } from "@/lib/scene/state";
import { SkyLayer } from "@/components/SkyLayer";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { characterPlaceholder, monsterPlaceholder, npcPlaceholder } from "@/lib/placeholders";
import { usePaintedMap } from "@/app/campaigns/[campaignId]/usePaintedMap";
import {
  FieldDie,
  InitiativeRail,
  TargetChips,
  TokenFace,
  TokenPlate,
  TurnBanner,
  TurnHud,
  type TurnHudBudget,
} from "@/app/campaigns/[campaignId]/BoardChrome";
import { IntentLayer } from "@/app/campaigns/[campaignId]/BoardIntent";
import { BoardCameraControls, BoardKeyStrip, BoardOrderDialog, BoardOrderStrip, boardHintText, PlayAsStrip } from "@/app/campaigns/[campaignId]/BoardPanelParts";
import type { StageToken } from "@/app/campaigns/[campaignId]/BoardStage";
import type { TokenIntent } from "@/lib/battlemap/intent";
import { familyIconPath } from "@/lib/icons";
import { TabletopOrder } from "@/app/campaigns/[campaignId]/CinematicParts";
import { AddonBoardView, postTo, useAnchor } from "@/app/campaigns/[campaignId]/AddonBoardView";
import { AddonViewSwitch, boardViewKey, useBoardView, useBoardViewOptions } from "@/app/campaigns/[campaignId]/AddonViewSwitch";
import { createAnchorStore, type AnchorStore, type Anchor, type BoardActionMenu, type BoardHud, type BoardControl, type BoardPanel, type BoardControlId, type BoardLook, type CameraControl, type ViewCameraState } from "@/lib/addons/board-bridge";
import { HEALTH_LABEL } from "@/lib/battlemap/health-words";
import { HAND_AIM_EVENT, HAND_TARGET_EVENT, HAND_BOARD_ACTION_EVENT, HAND_BOARD_STATUS_EVENT, HAND_BOARD_CONTROL_EVENT, HAND_BOARD_SURFACE_EVENT, type HandAimDetail, type HandBoardAction, type HandBoardStatus } from "@/lib/battlemap/hand-play";

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
// The turn's own buttons in the board's corner: End turn, and Undo move beside
// it. A finger's height on a narrow board, the old size where there is room.
const TURN_BUTTON =
  "motion-press min-h-10 rounded-lg border border-[rgba(107,99,148,0.5)] bg-[rgba(13,11,28,0.9)] px-3 py-1.5 text-[#e9e6f4] shadow-elev-1 hover:border-[rgba(212,171,58,0.6)] hover:text-[#f9ecc8] disabled:opacity-50 @md:min-h-0";

type Prompt = {
  kind: "damage" | "heal" | "condition";
  tokenId: string;
};

// The plate and the action ring sit on the figure an addon's view drew. The
// anchor is read here, not in the panel, so a camera sweep in the view
// re-renders these and nothing else.
function Anchored({ store, tokenId, children }: { store: AnchorStore | null; tokenId: string; children: (anchor: Anchor | undefined) => ReactNode }) {
  const anchor = useAnchor(store, tokenId);
  return <>{children(anchor)}</>;
}

export function BattleMapPanel({
  campaignId,
  view,
  encounter,
  sheets,
  refreshBattleMap,
  chronicle,
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
  genre = null,
  intents = null,
  turnBudget = null,
  fieldRoll = null,
  visible = true,
  meUserId = "",
  activeSheetId = "",
  multiCharacter = "off",
}: {
  campaignId: string;
  // Who is looking, which of their characters they play, and whether the
  // table lets a player field several: the enlarged tabletop offers the
  // switch, since it covers the Party panel that usually does.
  meUserId?: string;
  activeSheetId?: string;
  multiCharacter?: string;

  // The campaign's setting: it picks the skin the board is painted in and the
  // plates the monsters wear.
  genre?: string | null;
  view: PlayerMapView;
  encounter: PublicEncounter | null;
  sheets: CharacterSheet[];
  refreshBattleMap: () => Promise<void>;
  // The chronicle scroll beside the enlarged board (CinematicParts.tsx),
  // handed down from the session because the transcript lives there.
  chronicle?: ReactNode;
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
  // What the enemies mean to do, as the projection sends it for this seat
  // (src/lib/battlemap/intent.ts). The engine does not send any yet.
  intents?: TokenIntent[] | null;
  // The viewer's action economy this turn, when the projection carries it.
  turnBudget?: TurnHudBudget | null;
  // A roll in the air for a commit made from the board: the die on the field.
  fieldRoll?: { label: string } | null;
  // Whether the panel is on screen; the sky's weather rests while it is not.
  visible?: boolean;
}) {
  // A face for every token: the character's plate by lineage and class (an
  // uploaded portrait overrides it in the grid), a monster's plate by creature
  // type and setting. The DM's ad hoc NPCs and props keep their initial.
  const faces = useMemo(() => {
    const byRef = new Map<string, string>();
    for (const sheet of sheets) {
      byRef.set(sheet.id, characterPlaceholder({ race: sheet.race, class: sheet.class, gender: sheet.gender }));
    }
    for (const enemy of encounter?.enemies ?? []) {
      byRef.set(enemy.id, monsterPlaceholder(enemy.type, { cr: enemy.cr, genre, seed: enemy.name, slug: enemy.slug, name: enemy.name }));
    }
    // Somebody the DM put down by hand has no sheet and no stat block: they
    // draw one of the neutral faces by their name, and keep it.
    for (const token of view.tokens) {
      if (token.kind === "npc" && !byRef.has(token.refId)) {
        byRef.set(token.refId, npcPlaceholder(null, token.name));
      }
    }
    return byRef;
  }, [sheets, encounter?.enemies, genre, view.tokens]);
  const sheetsById = useMemo(() => new Map(sheets.map((sheet) => [sheet.id, sheet])), [sheets]);
  // The pictures to try for one combatant, best first: their own portrait,
  // their plate, then the class emblem; the initial is what is left.
  const faceOfRef = useCallback(
    (refId: string): Array<string | null | undefined> => {
      const sheet = sheetsById.get(refId);
      return [sheet?.portrait?.url, faces.get(refId), sheet ? familyIconPath(`class-${sheet.class}`) : null];
    },
    [sheetsById, faces],
  );
  const faceOfToken = useCallback((token: StageToken) => faceOfRef(token.refId), [faceOfRef]);
  // An addon's way of drawing the board (AddonBoardView.tsx), when this
  // device chose one: offered for every board, or only on the maps that
  // addon's generator made when it needs their data.
  const { views: offeredViews, active: addonView, choose: setViewChoice } = useBoardView(view.addonView?.addonId, encounter?.status === "active");
  const [viewOptions, setViewOption] = useBoardViewOptions();
  // Who each token is, for a view that draws creatures by kind; and where
  // the view drew each figure, so the plate and the action ring sit on it.
  const looks = useMemo(() => {
    const byRef = new Map<string, BoardLook>();
    for (const sheet of sheets) byRef.set(sheet.id, { character: { race: sheet.race, class: sheet.class, gender: sheet.gender } });
    for (const enemy of encounter?.enemies ?? []) byRef.set(enemy.id, { creature: { type: enemy.type, slug: enemy.slug ?? "", cr: enemy.cr } });
    return byRef;
  }, [sheets, encounter?.enemies]);
  const [nativeActionsSupported, setNativeActionsSupported] = useState(false);
  const [nativeHudSupported, setNativeHudSupported] = useState(false);
  const [nativeBattlefieldSupported, setNativeBattlefieldSupported] = useState(false);
  const capabilityOwner = useRef<object | null>(null);
  const [nativeSelection, setNativeSelection] = useState<{ mapId: string; tokenId: string } | null>(null);
  const [handAim, setHandAim] = useState<HandAimDetail | null>(null);
  const [handStatus, setHandStatus] = useState<HandBoardStatus | null>(null);
  useEffect(() => {
    const aim = (event: Event) => setHandAim((event as CustomEvent<HandAimDetail>).detail);
    const status = (event: Event) => { const detail = (event as CustomEvent<HandBoardStatus>).detail; if (detail?.campaignId === campaignId) setHandStatus(detail); };
    window.addEventListener(HAND_AIM_EVENT, aim);
    window.addEventListener(HAND_BOARD_STATUS_EVENT, status);
    return () => { window.removeEventListener(HAND_AIM_EVENT, aim); window.removeEventListener(HAND_BOARD_STATUS_EVENT, status); };
  }, [campaignId]);
  const [anchorStores] = useState(() => ({ inline: createAnchorStore(), enlarged: createAnchorStore() }));
  const addonCameras = useRef(new WeakMap<HTMLIFrameElement, ViewCameraState>());
  const anchorsOf = (expanded: boolean) => (addonView && (!drawActive || nativeBattlefieldActive) ? (expanded ? anchorStores.enlarged : anchorStores.inline) : null);
  // A slot the DM added to the order has no token to borrow a face from.
  const faceOfEntry = useCallback(
    (entry: { id: string; kind: string; name: string }) => [
      ...faceOfRef(entry.id),
      entry.kind === "npc" ? npcPlaceholder(null, entry.name) : null,
    ],
    [faceOfRef],
  );
  const [enlarged, setEnlarged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pointing, setPointing] = useState(false);
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);
  const [handledPing, setHandledPing] = useState<number | null>(null);
  const [expiredPing, setExpiredPing] = useState<number | null>(null);
  // A spell's area being aimed from the Hand or a console form, and the
  // notes a walk brought back.
  const areaAim = useAreaAim(view, canDirect, hover);
  const moveNotes = useMoveNotes();
  // A walk, a long jump, or a walk dragging the creature held, the squares
  // the move still reaches, and the arc of a jump just made (BoardMoveModes.tsx).
  const { moveMode, setMoveMode, gridView, leap, moveBody, landed } = useBoardMoveModes(view);
  // A tap on a square only aims the walk: the ruler holds the path and its
  // cost, and a second tap on the same square makes it. A stray click while
  // the camera is being moved is then not a step taken. The aim belongs to
  // the board, the square the figure stands on and the move mode, so a
  // change to any of them simply makes it stale.
  const [pendingMove, setPendingMove] = useState<{ key: string; x: number; y: number } | null>(null);
  const mover = view.tokens.find((token) => token.id === view.myTokenId);
  const pendingKey = `${view.mapId}:${mover?.x},${mover?.y}:${moveMode}`;
  const livePending = view.reachable.length > 0 && pendingMove?.key === pendingKey ? pendingMove : null;
  // The aim as an addon's board view is told it, so it can mark the square.
  const moveAim = useMemo(() => (livePending ? { x: livePending.x, y: livePending.y } : null), [livePending]);

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

  // The stage: the figure the pointer rests on (the hover plate), the target
  // the aim is on, the order dialog, and the banner for a new turn.
  const [plateTokenId, setPlateTokenId] = useState<string | null>(null);
  const [aimHoverId, setAimHoverId] = useState<string | null>(null);
  const [orderOpen, setOrderOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [orderEntry, setOrderEntry] = useState("");
  const [orderName, setOrderName] = useState("");
  const [orderScore, setOrderScore] = useState(12);
  const [orderConfirm, setOrderConfirm] = useState<{ key: string; title: string; line: string; body: Record<string, unknown> } | null>(null);
  const [endingTurn, setEndingTurn] = useState(false);
  const turnKey = view.turn ? `${view.turn.tokenId}:${view.turn.round}` : "";
  const [seenTurn, setSeenTurn] = useState(turnKey);
  const [bannerKey, setBannerKey] = useState<string | null>(null);
  // Adjusted while rendering because the prop changed: the banner plays for a
  // turn that arrives while the board is up, never for the one already on it
  // when the tab opens.
  if (turnKey !== seenTurn) {
    setSeenTurn(turnKey);
    setBannerKey(turnKey || null);
  }

  // Drawing on the board: a player's pencil toggle (the DM has the tool),
  // the shape and tone in hand, and the stroke being laid down.
  const [drawing, setDrawing] = useState(false);
  const [drawKind, setDrawKind] = useState<DrawingKind>("stroke");
  const [drawTone, setDrawTone] = useState<DrawingTone>("gold");
  const [drawTtl, setDrawTtl] = useState(false);
  // Whether the view in charge last offered the native battlefield's tools.
  const nativeToolsOffered = useRef(false);
  const handleCapabilities = useCallback((capabilities: { hud: boolean; tools: boolean; actions: boolean } | null, owner: object) => {
    // A closing enlarged view must not revoke its replacement's capabilities.
    if (!capabilities && capabilityOwner.current !== owner) return;
    capabilityOwner.current = capabilities ? owner : null;
    const hadTools = nativeToolsOffered.current;
    nativeToolsOffered.current = capabilities?.tools ?? false;
    setNativeBattlefieldSupported(capabilities?.tools ?? false);
    setNativeHudSupported(capabilities?.hud ?? false);
    setNativeActionsSupported(capabilities?.actions ?? false);
    // Drawing on the native battlefield ends with its tools. Drawing on the
    // flat board does not: under a view that never offered tools, the pencil
    // hides the view to bring the grid back, and the view's own unmount
    // reports no capabilities, which turned the drawing it had just started
    // off again, so the pencil did nothing.
    if (hadTools && !capabilities?.tools) { setDrawing(false); setTool(current => current === "draw" ? "handle" : current); }
  }, []);
  const [sketch, setSketch] = useState<Array<{ x: number; y: number }> | null>(null);
  const sketchRef = useRef<Array<{ x: number; y: number }> | null>(null);
  const drawActive = canDirect ? tool === "draw" : drawing;
  const nativeBattlefieldActive = Boolean(addonView?.sessionLayout && nativeBattlefieldSupported);
  const addonViewport = Boolean(addonView?.sessionLayout && (!drawActive || nativeBattlefieldActive));
  const nativeHudActive = addonViewport && nativeHudSupported;
  useEffect(() => {
    window.dispatchEvent(new CustomEvent(HAND_BOARD_SURFACE_EVENT, { detail: { campaignId, active: nativeBattlefieldActive } }));
    return () => { window.dispatchEvent(new CustomEvent(HAND_BOARD_SURFACE_EVENT, { detail: { campaignId, active: false } })); };
  }, [campaignId, nativeBattlefieldActive]);
  // An addon's view covers the board: what lies under it is not drawn. The
  // grid rests hidden (still playing the effects it reports as played) and
  // no picture is painted for it.
  const covered = Boolean(addonView) && (!drawActive || nativeBattlefieldActive);
  // The board's picture, painted on this device from the terrain it was sent.
  const painted = usePaintedMap(view, genre, covered);

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
  const { frameRef, attachFrame, ...cam } = useBoardCamera(view.width, view.height, {
    enabled: !addonViewport,
    followTurn: followTurn && !canDirect,
    turnTile,
    remote: camera,
    onRemoteHandled: onCameraDone,
    isDirector: canDirect,
  });
  const addonFrame = () => frameRef.current?.querySelector<HTMLIFrameElement>("iframe") ?? null;
  const cameraX = cam.camera.x, cameraY = cam.camera.y, cameraZoom = cam.camera.zoom;
  const cameraLocked = cam.locked, cameraCanRelease = cam.canRelease;
  const controlAddonCamera = (action: CameraControl) => postTo(addonFrame(), { type: "camera-control", action });
  function directCamera(mode: "pull" | "lock" | "free") {
    if (!canDirect) return;
    if (mode === "free") { void post("/dm/board", { do: "camera", mode }); return; }
    const frame = addonFrame();
    const here = addonViewport ? (frame ? addonCameras.current.get(frame) : null) : cam.describe();
    if (here) void post("/dm/board", { do: "camera", mode, ...here, ...(addonViewport ? { x: Math.min(view.width - 1, Math.round(here.x)), y: Math.min(view.height - 1, Math.round(here.y)), zoom: Math.max(0.5, Math.min(3, here.zoom)) } : {}) });
  }
  function releaseCamera() {
    cam.release();
    if (addonViewport) postTo(addonFrame(), { type: "camera", mode: "free", x: null, y: null, zoom: null });
  }
  const followX = turnTile?.x;
  const followY = turnTile?.y;
  useEffect(() => {
    if (addonViewport && followTurn && !canDirect && !cam.locked && followX !== undefined && followY !== undefined) {
      postTo(frameRef.current?.querySelector<HTMLIFrameElement>("iframe") ?? null, { type: "camera", mode: "pull", x: followX, y: followY, zoom: null });
    }
  }, [addonViewport, followTurn, canDirect, cam.locked, followX, followY, frameRef]);

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

  // The route's answer on success (truthy), null when it refused.
  async function post(path: string, body: unknown): Promise<Record<string, unknown> | null> {
    if (busy) {
      return null;
    }
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/campaigns/${campaignId}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string } & Record<string, unknown>;
      if (!response.ok) {
        setError(data.error ?? "That was not allowed.");
        return null;
      }
      return data;
    } catch {
      setError("Could not reach the table.");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function moveTo(x: number, y: number) {
    const start = view.tokens.find((token) => token.id === view.myTokenId);
    const moved = await post("/battle-map/move", { x, y, ...moveBody });
    if (moved) {
      setHover(null);
      landed(start ? { x: start.x, y: start.y } : null, { x, y });
      // What the walk met: opportunity attacks, a spell area's spikes or hold.
      moveNotes.push(moveNotesFrom(moved));
    }
    await refreshBattleMap();
  }

  // Takes back the last walk (src/lib/battlemap/move-undo.ts): the figure
  // goes back and the movement returns, while nothing else has happened.
  async function undoMove() {
    const done = await post("/battle-map/undo", {});
    if (done) {
      setHover(null);
      const feet = (done.undone as { feet?: unknown } | undefined)?.feet;
      moveNotes.push([{ text: typeof feet === "number" ? `Back where you stood: ${feet} feet of movement returned.` : "Back where you stood.", tone: "move" }]);
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
  //
  // The cost is the server's: the view carries what the move route would
  // charge for every lit square (spell areas, prone, passing allies), and
  // the ruler reads it (src/lib/battlemap/board-move.ts).
  const aimingArea = areaAim.active;
  const ruler = useMemo(() => {
    // Whoever is being measured: the piece the DM picked up, or the player's
    // own character. Not while a spell's area is being aimed.
    const fromId = held ?? view.myTokenId;
    // An aimed walk holds the ruler where it was aimed, whatever the pointer
    // does next; on a phone, with no hover, it is the only ruler there is.
    const to = livePending ?? hover;
    if (!to || !fromId || aimingArea) {
      return null;
    }
    // The DM spends no budget, so nothing they measure is ever too far.
    if (held === null && moveMode === "jump" && view.moves) {
      return jumpRulerFor(view, fromId, to, view.moves.jumpFeet);
    }
    return rulerFor(view, fromId, to, held === null, held === null && moveMode === "drag" ? view.moves?.drag?.factor ?? 1 : 1);
  }, [hover, livePending, held, view, aimingArea, moveMode]);

  // Who may be aimed at while a target is being chosen, nearest first, with
  // the distance the table would count (a diagonal is one square).
  const myToken = view.myTokenId ? tokensById.get(view.myTokenId) : undefined;
  const aimTargets = useMemo(() => {
    if (!targeting || !myToken) {
      return [];
    }
    return view.tokens
      .filter((token) => (token.kind === "enemy" || token.kind === "npc") && token.id !== myToken.id)
      .map((token) => ({
        token,
        // To the nearest square of a Large creature, as the engine measures it.
        feet: footprintDistance(token, view.tokenFootprint[token.id] ?? 1, myToken, view.tokenFootprint[myToken.id] ?? 1) * TILE_FEET,

      }))
      .sort((a, b) => a.feet - b.feet);
  }, [targeting, myToken, view.tokens, view.tokenFootprint]);

  const aim = useMemo(() => {
    if (!targeting || !myToken) {
      return null;
    }
    return {
      fromTokenId: myToken.id,
      targetIds: aimTargets.map((entry) => entry.token.id),
      hoverId: aimHoverId,
      labels: Object.fromEntries(aimTargets.map((entry) => [entry.token.id, `${entry.feet} ft`])),
    };
  }, [targeting, myToken, aimTargets, aimHoverId]);

  const overlay = useMemo<MapOverlay>(
    () => ({
      template: liveMeasure?.tiles,
      ruler,
      pings,
      selectedTokenId: held ?? teleporting,
      sketch: sketch ? { kind: drawKind, points: sketch, tone: drawTone } : null,
      aim,
      area: areaAim.overlay,
    }),
    [liveMeasure, ruler, pings, held, teleporting, sketch, drawKind, drawTone, aim, areaAim.overlay],
  );

  async function endTurn() {
    if (endingTurn) {
      return;
    }
    setEndingTurn(true);
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/encounter/end-turn`, { method: "POST" });
      // A refusal (the pointer moved, the turn is not theirs) is the
      // engine's sentence, shown on the board's own error line.
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? "The turn could not be ended.");
      }
    } catch {
      setError("Could not reach the table.");
    } finally {
      setEndingTurn(false);
    }
  }

  // Pointer to tile: through the frame's box and the camera's transform.
  const tileAtPointer = useCallback(
    (event: React.PointerEvent) => {
      const frame = frameRef.current;
      if (!frame) {
        return null;
      }
      const rect = frame.getBoundingClientRect();
      const px = (event.clientX - rect.left - cameraX) / cameraZoom;
      const py = (event.clientY - rect.top - cameraY) / cameraZoom;
      const unit = rect.width / (view.width * TILE);
      return { x: px / unit / TILE, y: py / unit / TILE };
    },
    [frameRef, cameraX, cameraY, cameraZoom, view.width],
  );

  async function finishSketch() {
    const points = sketchRef.current;
    sketchRef.current = null;
    setSketch(null);
    if (!points || points.length < 2) {
      return;
    }
    await saveDrawing(points);
  }

  async function saveDrawing(points: Array<{ x: number; y: number }>) {
    if (!canDraw || !drawActive || busy) return;
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
    // The DM's own character on its turn walks, as a player's does (a test
    // fight a person runs, issue 553); every other figure the DM places.
    if (canDirect && !(canMove && drag.tokenId === view.myTokenId)) {
      void board({ do: "place", tokenId: drag.tokenId, x, y });
    } else {
      // Carrying the figure there is deliberate: the drop is the move.
      setPendingMove(null);
      void moveTo(x, y);
    }
  }
  function onFramePointerCancel() {
    tokenDragRef.current = null;
    setTokenGhost(null);
  }
  const cancelInteraction = useCallback(() => {
    tokenDragRef.current = null;
    setTokenGhost(null);
    setTargeting(null);
    setAimHoverId(null);
    setPendingMove(null);
    setPlateTokenId(null);
    setHudTokenId(null);
    setTeleporting(null);
    setHeld(null);
    setNativeSelection(null);
  }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") cancelInteraction();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cancelInteraction]);

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
    setNativeSelection(null);
    setPlateTokenId(null);
    if (!targeting) setHudTokenId(null);
    if (pointing) {
      void sendPing(x, y);
      return;
    }
    // A spell's area being aimed takes the square (BoardAreaAim.tsx).
    if (areaAim.tap(x, y)) {
      return;
    }
    if (nativeBattlefieldActive && handStatus?.panel) return;
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
          void invoke("move_token", { token: token.name, x, y, teleport: true });
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
      // With no tool in hand, a DM who plays a character walks it on its
      // turn, below; any other DM taps nothing here.
      if (!canMove) {
        return;
      }
    }
    if (canMove) {
      // The first tap aims, the second on the same square walks.
      if (livePending && livePending.x === x && livePending.y === y) {
        setPendingMove(null);
        void moveTo(x, y);
      } else {
        setPendingMove({ key: pendingKey, x, y });
      }
    }
  }

  // A tap on a figure: pick a target while targeting, otherwise open the
  // HUD (the DM's on any piece, a player's on their own).
  function handleToken(tokenId: string, openMenu = true) {
    const token = tokensById.get(tokenId);
    if (!token) {
      return;
    }
    setNativeSelection({ mapId: view.mapId, tokenId });
    // Aiming an area: a figure is the square it stands on.
    if (areaAim.tap(token.x, token.y)) {
      return;
    }
    if (nativeHudSupported && !canDirect && handAim?.active && !handAim.area && (handAim.target === "enemy" || handAim.target === "ally")) {
      window.dispatchEvent(new CustomEvent(HAND_TARGET_EVENT, { detail: { id: token.refId } }));
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
      setAimHoverId(null);
      setHudTokenId(null);
      return;
    }
    if (!openMenu) {
      setHudTokenId(null);
      setPlateTokenId(tokenId === view.myTokenId ? null : tokenId);
      return;
    }
    if (canDirect) {
      setHudTokenId((current) => (current === tokenId ? null : tokenId));
      return;
    }
    if (tokenId === view.myTokenId && onCompose) {
      setHudTokenId((current) => (current === tokenId ? null : tokenId));
      return;
    }
    // Anybody else's figure: a tap is the phone's hover, and shows its plate.
    setPlateTokenId((current) => (current === tokenId ? null : tokenId));
  }

  // Every tile takes a tap when the DM is placing something, when anyone is
  // pointing, when a teleport is waiting for its tile, or when an area is
  // being measured. Otherwise the reachable overlay is the whole clickable
  // surface, exactly as before.
  const everyTileClickable =
    pointing || areaAim.active || (!canDirect && canMove && moveMode === "jump") || (canDirect && (tool !== "handle" || held !== null || teleporting !== null));

  const hudToken = hudTokenId ? tokensById.get(hudTokenId) : undefined;
  const plateToken = plateTokenId ? tokensById.get(plateTokenId) : undefined;
  const myTurn = Boolean(view.turn && view.myTokenId && view.turn.tokenId === view.myTokenId);
  // A walk this turn that can still be taken back (the move route keeps it).
  const undoFeet = myTurn && !canDirect && view.board === "fight" ? view.undoMove?.feet ?? null : null;
  const mySheet = myToken ? sheetsById.get(myToken.refId) : undefined;
  // The turn is a companion's this player commands (src/lib/dm/companion-command.ts).
  const commanding = myTurn && Boolean(mySheet?.isCompanion);
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
    // The same engine questions the Hand asks (src/lib/battlemap/hand-hud.ts),
    // so a sigil the engine would refuse says so instead of composing.
    const actions = playerActions(
      (text) => {
        onCompose?.(text);
        setHudTokenId(null);
      },
      (mode) => setTargeting(mode),
      mySheet && !scene ? boardHudGates(mySheet, encounter ?? null, { myTurn, currentName: view.currentTurnName }) : undefined,
      (reason) => setError(reason),
    );
    return nativeHudSupported ? actions.map(action => action.disabled ? action : { ...action, onPick: () => {
      window.dispatchEvent(new CustomEvent(HAND_BOARD_ACTION_EVENT, { detail: { campaignId, action: action.id as HandBoardAction, nativeChoices: nativeBattlefieldActive } }));
      setHudTokenId(null);
    } }) : actions;
    // `board` is a closure over state; the actions are rebuilt per token.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hudToken, canDirect, onCompose, mySheet, encounter, myTurn, view.currentTurnName, scene, nativeHudSupported, nativeBattlefieldActive, campaignId]);

  const closeHud = useCallback(() => {
    setNativeSelection(null); setPlateTokenId(null);
    setHudTokenId(null); setTargeting(null); setAimHoverId(null); setTeleporting(null);
  }, []);
  const hudHint = targeting ? (targeting === "attack" ? "Tap the enemy you attack" : "Tap the enemy you cast at")
    : teleporting === hudToken?.id ? "Tap the tile it appears on" : undefined;
  const nativeActionMenu = useMemo<BoardActionMenu | null>(() => hudToken && !prompt ? {
    tokenId: hudToken.id,
    hint: hudHint,
    actions: [...(targeting ? [] : hudActions).map(action => ({ id: action.id, label: action.label, disabled: busy || endingTurn || handStatus?.sending ? "Please wait for the current request." : action.disabled ?? null })), { id: "close", label: "Close", disabled: null }],
  } : null, [hudToken, hudActions, targeting, hudHint, prompt, busy, endingTurn, handStatus?.sending]);

  const closePanel: BoardControl = { id: "panel-close", label: "Close", disabled: null };
  const choose = (id: BoardControlId, label: string, value: string, options: Array<{ value: string; label: string; disabled: string | null }>): BoardControl => ({ id, label, value, disabled: null, options });
  const option = (value: string, label = value) => ({ value, label, disabled: null });
  const toolsPanel: BoardPanel = { title: "Battlefield tools", lines: ["Choose a tool, then close this panel to use it on the battlefield.", "Left drag orbits; middle drag pans; wheel zooms. WASD/arrows pan, 0 fits, Esc cancels. While drawing, left drag makes a mark.", ...(liveMeasure?.caught.length ? [`Caught: ${liveMeasure.caught.map(entry => entry.name).join(", ")}`] : []), ...(error ? [error] : [])], controls: [
    ...(!canDirect && !scene ? [{ id: "follow-turn" as const, label: `Keep current turn in view: ${followTurn ? "on" : "off"}`, disabled: null }] : []),
    choose("view", "Board view", addonView ? boardViewKey(addonView) : "", [option("", "ODM Board"), ...offeredViews.map(entry => option(boardViewKey(entry), entry.title))]),
    ...(meUserId && multiCharacter !== "off" && sheets.filter(sheet => sheet.userId === meUserId && !sheet.isCompanion).length > 1 ? [choose("play-as", "Playing as", playingSheet(sheets, meUserId, activeSheetId)?.id ?? "", sheets.filter(sheet => sheet.userId === meUserId && !sheet.isCompanion).map(sheet => option(sheet.id, sheet.name)))] : []),
    ...(canDirect ? [choose("tool", "Tool", tool, [option("handle", "Move pieces"), option("place", "Put something down"), option("measure", "Measure an area"), option("point", "Point at a tile"), ...(canDraw ? [option("draw", "Draw on the board")] : [])])] : [{ id: "point" as const, label: `Point at a tile: ${pointing ? "on" : "off"}`, disabled: null }, ...(canDraw ? [{ id: "draw" as const, label: `Drawing: ${drawing ? "on" : "off"}`, disabled: null }] : [])]),
    ...(canDirect && tool === "place" ? [choose("place-kind", "Place", placeKind, Object.entries(ADHOC_LABELS).map(([value, label]) => option(value, label))), { id: "place-name" as const, label: "Name", disabled: null, input: { value: placeName } }] : []),
    ...(canDirect && tool === "measure" ? [choose("measure-shape", "Shape", shape, TEMPLATE_SHAPES.map(value => option(value, SHAPE_LABELS[value]))), choose("measure-size", "Size in feet", String(sizeFeet), Array.from({ length: 12 }, (_, index) => option(String((index + 1) * 5), `${(index + 1) * 5} ft`))), { id: "measure-clear" as const, label: "Clear measure", disabled: null }, ...(liveMeasure?.caught.some(entry => entry.enemyId) ? [{ id: "measure-copy" as const, label: "Copy enemy ids", disabled: null }] : [])] : []),
    ...(drawActive && canDraw ? [choose("draw-kind", "Mark", drawKind, DRAWING_KINDS.map(value => option(value))), choose("draw-tone", "Ink", drawTone, DRAWING_TONES.map(value => option(value))), { id: "draw-ttl" as const, label: `Fades next round: ${drawTtl ? "yes" : "no"}`, disabled: null }, { id: "draw-erase" as const, label: canDirect ? "Clear all marks" : "Erase my marks", disabled: null }] : []), closePanel,
  ] };
  const orderKey = JSON.stringify([campaignId, view.mapId, encounter?.order, encounter?.turnIndex, view.round]);
  const confirmation = orderConfirm?.key === orderKey ? orderConfirm : null;
  const selectedEntry = encounter?.order.find(entry => entry.id === orderEntry) ?? encounter?.order[encounter.turnIndex];
  const selectedIndex = selectedEntry ? encounter?.order.indexOf(selectedEntry) ?? -1 : -1;
  const orderPanel: BoardPanel | null = encounter && orderOpen ? {
    title: `Initiative, round ${view.round}`,
    lines: [...(encounter.orderReady ? encounter.order.map((entry, index) => `${index === encounter.turnIndex ? "▶ " : ""}${entry.name}${entry.initiative !== undefined ? ` · ${entry.initiative}` : ""}${entry.hidden ? " · hidden" : ""}${extraTurnTag(entry) ? ` · ${extraTurnTag(entry)!.title}` : ""}${offSide(encounter, entry.id, entry.kind) ? ` · ${sideWords(offSide(encounter, entry.id, entry.kind)!)}` : ""}`) : ["Waiting for everyone's initiative roll.", ...(encounter.staged ?? []).map(entry => `${entry.name}: ${entry.initiative}`)]), ...(canDirect ? ["Stepping back changes the turn and round only; hit points and conditions stay as they are.", ...(encounter.enemiesDue?.length ? [`Enemy turns due: ${encounter.enemiesDue.map(entry => `${entry.name}${entry.acted ? " (acted)" : ""}`).join(", ")}`] : [])] : []), ...(error ? [error] : [])],
    controls: [...(canDirect && encounter.orderReady ? [
      choose("order-entry", "Combatant", selectedEntry?.id ?? "", encounter.order.map(entry => option(entry.id, entry.name))),
      { id: "order-up" as const, label: "Up the order", disabled: selectedIndex > 0 ? null : "Already first." }, { id: "order-down" as const, label: "Down the order", disabled: selectedIndex >= 0 && selectedIndex < encounter.order.length - 1 ? null : "Already last." },
      { id: "order-delay" as const, label: "Delay to end", disabled: selectedEntry ? null : "Choose a combatant." }, { id: "order-remove" as const, label: "Take out of order…", disabled: selectedEntry ? null : "Choose a combatant." }, { id: "order-take" as const, label: "Give them the turn", disabled: selectedEntry?.kind === "pc" && selectedIndex !== encounter.turnIndex ? null : "Choose another player's slot." },
      { id: "order-back" as const, label: "Back a turn", disabled: null }, { id: "order-forward" as const, label: "On a turn", disabled: null }, { id: "order-reset" as const, label: "Reset initiative…", disabled: null },
      { id: "order-name" as const, label: "New slot name", disabled: null, input: { value: orderName } }, { id: "order-score" as const, label: `Initiative (${MIN_INITIATIVE} to ${MAX_INITIATIVE})`, disabled: null, input: { value: String(orderScore), numeric: true } }, { id: "order-insert" as const, label: "Add slot", disabled: orderName.trim() ? null : "Name the slot first." },
      ...(encounter.enemiesDue?.length ? [{ id: "order-enemies-play" as const, label: "Play remaining enemies", disabled: null }, { id: "order-enemies-pass" as const, label: "Done, hand on turn", disabled: null }] : encounter.companionTurn ? [{ id: "order-companion" as const, label: `Play ${encounter.companionTurn.name}'s turn`, disabled: null }] : []),
    ] : []), closePanel],
  } : null;
  const nativePanel = nativeBattlefieldActive && !prompt ? handStatus?.panel ?? (confirmation ? { title: confirmation.title, lines: [confirmation.line], controls: [{ id: "confirm" as const, label: "Confirm", disabled: null }, closePanel] } : orderPanel ?? (toolsOpen ? toolsPanel : null)) : null;

  const selectedFigure = nativeSelection?.mapId === view.mapId ? tokensById.get(nativeSelection.tokenId) : undefined;
  const battlefieldHud: BoardHud = {
    selection: selectedFigure && !selectedFigure.hidden ? {
      tokenId: selectedFigure.id, name: selectedFigure.name,
      lines: [view.tokenHealth[selectedFigure.id] ? HEALTH_LABEL[view.tokenHealth[selectedFigure.id]] : "", ...(view.tokenConditions[selectedFigure.id] ?? []).map(entry => [entry.label, entry.rounds ? `${entry.rounds} rd` : "", entry.note].filter(Boolean).join(" · ")),
        ...(selectedFigure.kind === "enemy" && view.edges?.[selectedFigure.refId] ? (() => {
          const edge = view.edges[selectedFigure.refId];
          return [edge.blocked ? "No line of sight" : edge.cover ? `Cover: +${edge.cover} AC` : "", edge.flanking ? "Flanked: advantage in melee" : "", edge.hostileBeside && !edge.adjacent ? "Ranged at disadvantage: enemy beside you" : ""];
        })() : [])].filter(Boolean),
    } : null,
    turn: view.currentTurnName ? `${view.currentTurnName}'s turn · Round ${view.round}` : "",
    stats: [myTurn ? `${view.budgetLeft * TILE_FEET} ft left` : "", mySheet ? `HP ${mySheet.currentHp}/${effectiveMaxHp(mySheet)} · AC ${mySheet.ac}` : "",
      myTurn && turnBudget ? `Action ${turnBudget.action ? "ready" : "spent"} · Bonus ${turnBudget.bonus ? "ready" : "spent"} · Reaction ${turnBudget.reaction ? "ready" : "spent"}` : "",
      encounter?.orderReady ? `Order: ${encounter.order.map(entry => entry.name).join(" → ")}` : ""].filter(Boolean),
    hint: [hudHint ?? (handAim?.active ? "Choose the card's target on the board or in your hand, then play the card." : cameraLocked ? "The DM is steering the view" : boardHintText({ canDirect, tool, teleporting: Boolean(teleporting), held: Boolean(held), liveOrigin: Boolean(liveOrigin), pointing, drawing, targeting: Boolean(targeting), canMove, moveAimed: Boolean(livePending), scene, budgetLeft: view.budgetLeft, hasToken: Boolean(view.myTokenId) })), moveModeHint(moveMode, view.moves), areaAim.hint].filter(Boolean).join("\n"),
    notices: [...moveNotes.notes.map(note => note.text), ...(fieldRoll ? [fieldRoll.label] : []), ...(handStatus?.notice ? [handStatus.notice] : []), ...(areaAim.caught.length ? [`Area catches: ${areaAim.caught.join(", ")}`] : []), ...(liveMeasure?.caught.length ? [`Measured: ${liveMeasure.caught.map(entry => entry.name).join(", ")}`] : [])], error, pending: busy || endingTurn || Boolean(handStatus?.sending),
    controls: prompt && tokensById.has(prompt.tokenId) ? [{ id: "prompt-submit", label: "Apply", disabled: null }, { id: "prompt-cancel", label: "Cancel input", disabled: null }] : [
      ...(myTurn && !scene && !targeting ? [{ id: "end-turn" as const, label: "End turn", disabled: endingTurn ? "Ending turn…" : null }] : []),
      ...(undoFeet !== null && !targeting ? [{ id: "undo-move" as const, label: `Undo ${undoFeet} ft`, disabled: null }] : []),
      ...(!cameraLocked ? [{ id: "fit" as const, label: "Fit board", disabled: null }] : []),
      ...(canDirect ? [{ id: "camera-pull" as const, label: "Bring everyone here", disabled: null }, { id: "camera-lock" as const, label: "Lock view", disabled: null }, { id: "camera-free" as const, label: "Free view", disabled: null }] : []),
      ...(cameraLocked && cameraCanRelease ? [{ id: "camera-release" as const, label: "Look around", disabled: null }] : []),
      ...(targeting || nativeSelection || held || teleporting ? [{ id: "cancel" as const, label: "Cancel", disabled: null }] : []),
      ...(encounter ? [{ id: "order" as const, label: "Initiative", disabled: null }] : []),
      ...(nativeBattlefieldActive ? [
        ...(!canDirect && canMove && !areaAim.active && view.moves ? [choose("move-mode", "Move", moveMode, [option("walk", "Walk"), option("jump", "Jump"), ...(view.moves.drag ? [option("drag", `Drag ${view.moves.drag.names.join(" and ")}`)] : [])])] : []),
        { id: "tools" as const, label: "Tools", disabled: null }, { id: "enlarge" as const, label: enlarged ? "Back to campaign" : "Enlarge", disabled: null },
      ] : []),
    ],
    panel: nativePanel,
    drawing: nativeBattlefieldActive && drawActive && canDraw ? { kind: drawKind, tone: drawTone } : null,
    tiles: nativeBattlefieldActive ? (areaAim.overlay?.ghost ?? areaAim.overlay?.set)?.cells ?? liveMeasure?.tiles ?? [] : [],
    prompt: prompt && tokensById.has(prompt.tokenId) ? { title: `${prompt.kind === "damage" ? "Damage" : prompt.kind === "heal" ? "Heal" : "Condition on"} ${tokensById.get(prompt.tokenId)!.name}`, label: prompt.kind === "condition" ? "Condition" : "Hit points", numeric: prompt.kind !== "condition" } : null,
  };

  const promptToken = prompt ? tokensById.get(prompt.tokenId) : undefined;
  const submitPrompt = useCallback(
    async (value: string) => {
      if (!prompt || !promptToken) {
        return;
      }
      const isEnemy = promptToken.kind === "enemy";
      const ref = isEnemy ? { enemyId: promptToken.refId } : { characterId: promptToken.refId };
      // One action for a character or an enemy alike (issue #471): the ref
      // says which.
      let applied: boolean;
      if (prompt.kind === "condition") {
        applied = await invoke("set_condition", { ...ref, condition: value });
      } else {
        const amount = Number.parseInt(value, 10);
        if (!Number.isFinite(amount) || amount < 1) {
          setError("Give a number of hit points.");
          return;
        }
        if (prompt.kind === "damage") {
          applied = await invoke("apply_damage", { ...ref, amount });
        } else {
          applied = await invoke("heal", { ...ref, amount });
        }
      }
      if (applied) { setHudTokenId(null); setPrompt(null); }
    },
    // invoke closes over busy state; rebuilding per prompt is intended.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [prompt, promptToken, busy],
  );

  function handleBoardControl(action: BoardControlId, value?: string) {
    if (nativePanel && nativePanel === handStatus?.panel) {
      window.dispatchEvent(new CustomEvent(HAND_BOARD_CONTROL_EVENT, { detail: { campaignId, signature: handStatus.signature, actionId: action, value } }));
      return;
    }
    const editOrder = (body: Record<string, unknown>) => { if (canDirect) void post("/dm/initiative", body).then(result => { if (result && body.op === "insert") setOrderName(""); return refreshBattleMap(); }); };
    switch (action) {
      case "end-turn": void endTurn(); break;
      case "undo-move": void undoMove(); break;
      case "zoom-in": case "zoom-out": case "fit": controlAddonCamera(action); break;
      case "follow-turn": setFollowTurn(current => !current); break;
      case "camera-pull": directCamera("pull"); break;
      case "camera-lock": directCamera("lock"); break;
      case "camera-free": directCamera("free"); break;
      case "camera-release": releaseCamera(); break;
      case "cancel": cancelInteraction(); closeHud(); break;
      case "prompt-submit": void submitPrompt(value ?? ""); break;
      case "prompt-cancel": setPrompt(null); break;
      case "order": setOrderOpen(true); break;
      case "panel-close": if (confirmation) setOrderConfirm(null); else { setToolsOpen(false); setOrderOpen(false); } break;
      case "tools": setToolsOpen(true); break;
      case "enlarge": setEnlarged(current => !current); break;
      case "move-mode": setMoveMode(value as "walk" | "jump" | "drag"); setPendingMove(null); break;
      case "view": setViewChoice(value ?? ""); setToolsOpen(false); break;
      case "play-as": void post("/sheet/switch", { characterId: value }).then(() => refreshBattleMap()); break;
      case "point": setPointing(current => !current); break;
      case "draw": if (canDraw) { setDrawing(current => !current); setToolsOpen(false); } break;
      case "tool": if (canDirect) { setTool(value as BoardTool); setHeld(null); setTeleporting(null); setMeasureOrigin(null); } break;
      case "place-kind": setPlaceKind(value as AdhocTokenKind); break;
      case "place-name": if ((value?.length ?? 0) <= ADHOC_NAME_MAX) setPlaceName(value ?? ""); else setError(`Use at most ${ADHOC_NAME_MAX} characters.`); break;
      case "measure-shape": setShape(value as TemplateShape); setMeasure(null); setMeasureOrigin(null); break;
      case "measure-size": setSizeFeet(Number(value)); setMeasure(null); setMeasureOrigin(null); break;
      case "measure-clear": setMeasure(null); setMeasureOrigin(null); break;
      case "measure-copy": void navigator.clipboard?.writeText((liveMeasure?.caught ?? []).map(entry => entry.enemyId).filter(Boolean).join(", ")); break;
      case "draw-kind": setDrawKind(value as DrawingKind); break;
      case "draw-tone": setDrawTone(value as DrawingTone); break;
      case "draw-ttl": setDrawTtl(current => !current); break;
      case "draw-erase": void eraseDrawings(); break;
      case "order-entry": setOrderEntry(value ?? ""); break;
      case "order-name": if ((value?.length ?? 0) <= ENTRY_NAME_MAX) setOrderName(value ?? ""); else setError(`Use at most ${ENTRY_NAME_MAX} characters.`); break;
      case "order-score": { const score = Number(value); if (/^-?\d+$/.test(value ?? "") && Number.isInteger(score) && score >= MIN_INITIATIVE && score <= MAX_INITIATIVE) setOrderScore(score); else setError(`Initiative must be ${MIN_INITIATIVE} to ${MAX_INITIATIVE}.`); break; }
      case "order-up": case "order-down": if (selectedEntry) editOrder({ op: "move", id: selectedEntry.id, direction: action === "order-up" ? "up" : "down" }); break;
      case "order-delay": if (selectedEntry) editOrder({ op: "delay", id: selectedEntry.id }); break;
      case "order-take": if (selectedEntry?.kind === "pc") editOrder({ op: "goto", id: selectedEntry.id }); break;
      case "order-back": case "order-forward": editOrder({ op: "step", direction: action === "order-back" ? "back" : "forward" }); break;
      case "order-enemies-play": case "order-enemies-pass": editOrder({ op: "enemies", play: action === "order-enemies-play" }); break;
      case "order-companion": editOrder({ op: "companion" }); break;
      case "order-insert": if (orderName.trim()) editOrder({ op: "insert", name: orderName.trim(), initiative: orderScore }); break;
      case "order-remove": if (canDirect && selectedEntry) setOrderConfirm({ key: orderKey, title: `Take ${selectedEntry.name} out?`, line: "They get no more turns in this fight. The creature stays on the board.", body: { op: "remove", id: selectedEntry.id } }); break;
      case "order-reset": if (canDirect) setOrderConfirm({ key: orderKey, title: "Reset initiative?", line: "Clear the order and have everyone roll again?", body: { op: "reset" } }); break;
      case "confirm": if (canDirect && confirmation) { editOrder(confirmation.body); setOrderConfirm(null); } break;
    }
  }

  // The painted picture is one canvas, and a DOM node sits in one place: the
  // board on screen carries it (the open tabletop covers the panel). Both
  // boards drawing it let the tabletop take it and close with it, leaving
  // the panel's board bare.
  const gridWith = (picture: HTMLCanvasElement | null, expanded = false) => (
    <div
      ref={attachFrame}
      tabIndex={0}
      aria-label="Board view. Scroll or pinch to zoom, drag or use the arrow keys to pan, plus and minus to zoom, 0 to fit."
      // A container, so the stage chrome sizes to the board it sits on (the
      // side panel, a phone, the enlarged dialog) and not to the window.
      // board-view (board.css) draws the ring that says the board has the
      // keyboard, for a click as much as for Tab (issue 90).
      className={cn("board-view @container relative overflow-hidden rounded-lg outline-none", addonViewport && "min-h-36")}
      data-addon-viewport={addonViewport ? "" : undefined}
      {...(addonViewport ? {} : cam.frameProps)}
      onKeyDown={(event) => {
        if (undoFeet !== null && (event.ctrlKey || event.metaKey) && !event.shiftKey && (event.key === "z" || event.key === "Z")) {
          event.preventDefault();
          void undoMove();
          return;
        }
        if (!addonViewport) { cam.frameProps.onKeyDown(event); return; }
        if (event.target !== event.currentTarget || cam.locked || event.ctrlKey || event.metaKey || event.altKey) return;
        const action = ({ "+": "zoom-in", "=": "zoom-in", "-": "zoom-out", "0": "fit", ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down" } as Record<string, CameraControl>)[event.key];
        if (action) { event.preventDefault(); controlAddonCamera(action); }
      }}
      onPointerDownCapture={onFramePointerDownCapture}
      onPointerMove={(event) => {
        if (!addonViewport) { cam.frameProps.onPointerMove(event); onFramePointerMove(event); }
      }}
      onPointerUp={(event) => {
        if (!addonViewport) { cam.frameProps.onPointerUp(event); onFramePointerUp(event); }
      }}
      onPointerCancel={(event) => {
        if (!addonViewport) { cam.frameProps.onPointerCancel(event); onFramePointerCancel(); }
      }}
    >
      {/* The weather rests under a view that fills the frame; around a view
          the size of the board it still falls in the margins. */}
      {view.outdoors && !nativeBattlefieldActive ? <SkyLayer scene={sky} mode="board" className="rounded-lg" visible={visible && !addonViewport} /> : null}
      <div
        className={cn(!addonViewport && cam.eased && "sky-wash", addonViewport ? "absolute inset-0 isolate" : "relative", drawActive && "touch-none")}
        style={{
          transform: addonViewport ? undefined : `translate(${cam.camera.x}px, ${cam.camera.y}px) scale(${cam.camera.zoom})`,
          transformOrigin: "0 0",
          transition: !addonViewport && cam.eased ? "transform var(--dur-scene) var(--ease-drift)" : "none",
        }}
      >
        <div style={{ display: covered ? "none" : "contents" }}>
        <BattleMapGrid
          view={gridView}
          sheets={sheets}
          painted={picture}
          faces={faces}
          onTileClick={canDirect || canMove || pointing || areaAim.active ? handleTile : undefined}
          onTileHover={
            canMove || held || areaAim.active
              ? (x, y) => setHover(y === null ? null : { x, y })
              : undefined
          }
          onTokenClick={handleToken}
          onTokenHover={(tokenId) => {
            setPlateTokenId(tokenId);
            if (targeting) {
              setAimHoverId(tokenId && aimTargets.some((entry) => entry.token.id === tokenId) ? tokenId : null);
            }
          }}
          everyTileClickable={everyTileClickable}
          // A player's walk asks its own second tap (handleTile); the DM's
          // pieces and an aimed area keep the grid's touch preview.
          tapPreview={canDirect || areaAim.active}
          overlay={overlay}
          fx={fx}
          onFxPlayed={onFxPlayed}
          onLabelClick={onOpenLabel}
        />
        <JumpArc leap={leap} width={view.width} height={view.height} />
        </div>
        {/* With the grid hidden, an empty board of the same shape keeps the
            size it gave the frame. */}
        {covered && !addonViewport ? (
          <svg viewBox={`0 0 ${view.width * TILE} ${view.height * TILE}`} className="h-auto w-full rounded-lg border border-stone-800" aria-hidden="true" />
        ) : null}
        {/* Session renderers own the visible viewport and camera; ordinary
            board views keep the grid's sizing and camera. Drawing uses the grid.
            While the enlarged tabletop is open the panel's own view is hidden:
            a frame that is only covered keeps drawing every frame. */}
        {addonView && (!drawActive || nativeBattlefieldActive) ? (
          <div className={cn("absolute inset-0 z-[15] rounded-lg bg-[#0d0b1c]", enlarged && !expanded && "hidden")}>
            <AddonBoardView
              key={boardViewKey(addonView)}
              genre={genre}
              view={gridView}
              boardView={addonView}
              nativeActive={!enlarged || expanded}
              canDirect={canDirect}
              onTile={handleTile}
              actionMenu={nativeActionMenu}
              battlefieldHud={battlefieldHud}
              onBoardControl={handleBoardControl}
              onCapabilities={!enlarged || expanded ? handleCapabilities : undefined}
              onDraw={points => { void saveDrawing(points); }}
              onAction={id => {
                if (id === "close") closeHud();
                else { const action = hudActions.find(entry => entry.id === id); if (action && !action.disabled) action.onPick(); }
              }}
              onToken={handleToken}
              onCancel={cancelInteraction}
              onHover={(x, y) => {
                if (canMove || held || areaAim.active) setHover(x === null || y === null ? null : { x, y });
              }}
              faceFor={(tokenId) => {
                const token = tokensById.get(tokenId);
                return token ? faceOfToken(token) : [];
              }}
              looks={looks}
              intents={intents}
              moveAim={moveAim}
              ruler={ruler}
              fx={fx}
              ping={ping}
              camera={addonViewport && canDirect ? null : camera}
              onAnchors={nativeHudActive ? undefined : (expanded ? anchorStores.enlarged : anchorStores.inline).set}
              onCameraState={(state, frame) => addonCameras.current.set(frame, state)}
              viewOptions={viewOptions[boardViewKey(addonView)]}
              onFailure={addonView.sessionLayout ? () => setViewChoice("") : undefined}
            />
          </div>
        ) : null}
        {tokenGhost ? (
          <div
            className="pointer-events-none absolute z-20 overflow-hidden rounded-full border-2 border-amber-300 bg-stone-950/70 shadow-glow-gold"
            style={{
              left: `${(tokenGhost.x / view.width) * 100}%`,
              top: `${(tokenGhost.y / view.height) * 100}%`,
              width: `${100 / view.width}%`,
              aspectRatio: "1 / 1",
              opacity: 0.7,
            }}
          >
            {/* The ghost wears the figure's face, like the figure does. */}
            <TokenFace
              candidates={faceOfRef(tokensById.get(tokenGhost.tokenId)?.refId ?? "")}
              name={tokensById.get(tokenGhost.tokenId)?.name ?? ""}
              className="size-full text-[10px]"
            />
          </div>
        ) : null}
        {drawActive && !nativeBattlefieldActive ? (
          <div
            className="absolute inset-0 z-10 cursor-crosshair"
            aria-label="Drawing surface"
            data-no-pan=""
            onPointerDown={onDrawDown}
            onPointerMove={onDrawMove}
            onPointerUp={onDrawUp}
            onPointerCancel={onDrawCancel}
          />
        ) : null}
        {hudToken && !(addonView && nativeActionsSupported) ? (
          <Anchored store={anchorsOf(expanded)} tokenId={hudToken.id}>
            {(anchor) => (
              <TokenHud
                token={hudToken}
                boardWidth={view.width}
                boardHeight={view.height}
                footprint={view.tokenFootprint[hudToken.id] ?? 1}
                anchor={anchor}
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
                  setAimHoverId(null);
                  setTeleporting(null);
                }}
              />
            )}
          </Anchored>
        ) : null}
        {/* What the enemies mean to do. Only while the board is quiet: an aim
            or an effect in flight already owns the same space. */}
        {!scene && !targeting && !hudToken && fx.length === 0 && !addonView ? (
          <IntentLayer
            intents={intents}
            tokens={view.tokens}
            footprints={view.tokenFootprint}
            boardWidth={view.width}
            boardHeight={view.height}
            round={view.round}
            faceOf={faceOfToken}
          />
        ) : null}
        {plateToken && !hudToken && !tokenGhost && !drawActive && !nativeHudActive ? (
          <Anchored store={anchorsOf(expanded)} tokenId={plateToken.id}>
            {(anchor) => (
              <TokenPlate
                token={plateToken}
                boardWidth={view.width}
                boardHeight={view.height}
                footprint={view.tokenFootprint[plateToken.id] ?? 1}
                anchor={anchor}
                face={faceOfToken(plateToken)}
                health={view.tokenHealth[plateToken.id]}
                conditions={view.tokenConditions[plateToken.id]}
                edge={plateToken.kind === "enemy" ? view.edges?.[plateToken.refId] : undefined}
              />
            )}
          </Anchored>
        ) : null}
      </div>
      {/* The chrome of the stage (BoardChrome.tsx), fixed to the frame so it
          stays put while the camera moves under it. */}
      {!nativeHudActive ? <>
      {!scene && encounter ? (
        <InitiativeRail
          namesOnly={addonViewport}
          encounter={encounter}
          round={view.round}
          faceOf={faceOfEntry}
          onOpen={() => setOrderOpen(true)}
        />
      ) : null}
      {!scene ? (
        <TurnHud
          actorName={view.currentTurnName}
          mine={myTurn}
          commanded={commanding}
          budget={turnBudget}
          speedLeftFeet={myTurn ? view.budgetLeft * TILE_FEET : null}
          ac={mySheet?.ac ?? null}
          // The maximum the engine heals to: exhaustion 4 halves it, an
          // Amulet of Health raises it (condition-logic.ts effectiveMaxHp).
          hp={mySheet ? { current: mySheet.currentHp, max: effectiveMaxHp(mySheet) } : null}
        />
      ) : null}
      {!scene && bannerKey ? (
        <TurnBanner key={bannerKey} text={commanding ? `${view.currentTurnName}: your orders` : myTurn ? "Your turn" : view.currentTurnName} mine={myTurn} />
      ) : null}
      {fieldRoll ? <FieldDie label={fieldRoll.label} /> : null}
      <BoardMoveNotes notes={moveNotes.notes} />
      {targeting ? (
        <div className="absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2.5 rounded-[10px] border border-[rgba(224,112,58,0.5)] bg-[rgba(13,11,28,0.94)] px-3 py-1.5 shadow-elev-2">
          <span className="whitespace-nowrap font-display text-[10px] font-semibold uppercase tracking-[0.18em] text-[#ffbe8f]">
            {targeting === "attack" ? "Attack" : "Cast"} · pick a target
          </span>
          <button
            type="button"
            onClick={() => {
              setTargeting(null);
              setAimHoverId(null);
            }}
            aria-label="Cancel aiming"
            className="motion-press rounded-md border border-[rgba(107,99,148,0.5)] bg-[rgba(21,18,41,0.8)] px-2 py-0.5 text-[#aeaac6] hover:text-[#e9e6f4]"
          >
            {/* The size sits on a span: globals.css resets a button's own font. */}
            <span className="font-mono text-[11px]">esc</span>
          </button>
        </div>
      ) : null}
      {/* The corner: End turn and the camera buttons. One layer the size of
          the frame, so the buttons can ask how tall the board is and lie in
          a row along the bottom when a column would not fit (board.css). */}
      <div className="board-corner">
      {myTurn && !scene && !targeting ? (
        <div data-native-board-occluder className="board-endturn absolute bottom-2 right-11 z-10 flex items-center gap-1.5">
          {/* Beside End turn, as a tactics game offers the step back before
              the unit acts: only while the last walk can be taken back. */}
          {undoFeet !== null ? (
            <button
              type="button"
              onClick={() => void undoMove()}
              disabled={busy}
              aria-label={`Undo move, ${undoFeet} feet`}
              title={`Take back your last move and its ${undoFeet} feet (Ctrl+Z)`}
              className={cn(TURN_BUTTON, "motion-pop inline-flex items-center gap-1.5")}
            >
              <Undo2 className="size-3.5" aria-hidden="true" />
              <span className="block font-display text-[10px] font-semibold uppercase tracking-[0.16em]">Undo move</span>
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => void endTurn()}
            disabled={endingTurn}
            className={TURN_BUTTON}
          >
            <span className="block font-display text-[10px] font-semibold uppercase tracking-[0.16em]">End turn</span>
          </button>
        </div>
      ) : null}
      {/* Camera controls: corner buttons for everyone, the DM's pull and
          lock, and the escape hatch when a lock has held too long. */}
      <BoardCameraControls
        onZoomIn={addonViewport ? () => controlAddonCamera("zoom-in") : cam.zoomIn}
        onZoomOut={addonViewport ? () => controlAddonCamera("zoom-out") : cam.zoomOut}
        onFit={addonViewport ? () => controlAddonCamera("fit") : cam.reset}
        followTurn={!canDirect && !scene ? followTurn : null}
        onFollowTurn={() => setFollowTurn((current) => !current)}
        onDirect={canDirect ? directCamera : undefined}
      />
      </div>
      {cam.locked ? null : <BoardKeyStrip />}
      {cam.locked ? (
        <div className="absolute bottom-2 left-2 z-10 flex items-center gap-2 rounded-md border border-amber-800/60 bg-stone-950/90 px-2 py-1 text-[11px] text-amber-200 shadow-elev-1">
          <Lock className="size-3" />
          The GM is steering the view
          {cam.canRelease ? (
            <button type="button" onClick={releaseCamera} className="ml-1 text-stone-300 underline">
              look around anyway
            </button>
          ) : null}
        </div>
      ) : null}
      </> : null}
      <span className="sr-only" aria-live="polite">
        {!scene && view.currentTurnName ? (commanding ? `${view.currentTurnName}'s turn: your orders.` : myTurn ? "Your turn." : `${view.currentTurnName}'s turn.`) : ""}
      </span>
    </div>
  );

  // What sits under the board wherever the board is drawn: the move modes,
  // what the board is waiting for (or why a move is refused), and the aim's
  // target chips. The enlarged tabletop drew the grid alone, so a player who
  // enlarged it lost the move picker and every hint (issue #189).
  const underBoard = nativeBattlefieldActive ? null : (
    <>
      <AddonViewSwitch
        views={offeredViews}
        value={addonView ? boardViewKey(addonView) : ""}
        onChange={setViewChoice}
        stored={viewOptions}
        onOption={setViewOption}
      />
      <BoardMoveHints
        moveMode={moveMode}
        moves={!canDirect && canMove && !areaAim.active ? view.moves : undefined}
        onMode={setMoveMode}
        areaHint={areaAim.hint}
        caught={areaAim.caught}
      />
      <p className="text-[11px] leading-4 text-stone-500">
        {boardHintText({
          canDirect,
          tool,
          teleporting: Boolean(teleporting),
          held: Boolean(held),
          liveOrigin: Boolean(liveOrigin),
          pointing,
          drawing,
          targeting: Boolean(targeting),
          canMove,
          moveAimed: Boolean(livePending),
          scene,
          budgetLeft: view.budgetLeft,
          hasToken: Boolean(view.myTokenId),
        })}
      </p>
      {error ? <p className="text-[11px] text-red-400">{error}</p> : null}
      {targeting ? (
        <TargetChips
          targets={aimTargets.map((entry) => ({
            token: entry.token,
            face: faceOfToken(entry.token),
            health: view.tokenHealth[entry.token.id],
            feet: entry.feet,
          }))}
          onPick={handleToken}
          onHover={setAimHoverId}
        />
      ) : null}
    </>
  );

  // A player's own tools, in the inline header and the enlarged tabletop's
  // head alike: pointing at a tile and drawing on the board. The DM has the
  // tool rail instead.
  const playerTools = canDirect ? null : (
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
  );

  return (


    // board-panel: where the panel is given a fixed window (the fight stage,
    // the shared screen, the side panel and the phone) its header and footer
    // stay put and the board takes what is left (world.css, issue 87).
    <div className="board-panel space-y-2">
      {!nativeBattlefieldActive ? <div className="flex items-center justify-between">
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
          {playerTools}
          <button
            type="button"
            onClick={() => setEnlarged(true)}

            className="rounded p-1 text-stone-400 hover:bg-stone-900 hover:text-stone-200"
            aria-label="Enlarge battle map"
          >
            <Maximize2 className="size-4" />
          </button>
        </div>
      </div> : null}
      {canDirect && !nativeBattlefieldActive ? (
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
      {gridWith(enlarged ? null : painted)}
      {canDirect && tool === "place" && !nativeBattlefieldActive ? (
        <PlaceTokenForm
          kind={placeKind}
          name={placeName}
          onKind={setPlaceKind}
          onName={setPlaceName}
        />
      ) : null}
      {drawActive && !nativeBattlefieldActive ? (
        <div data-pill-group="" className="flex flex-wrap items-center gap-1">
          {DRAWING_KINDS.map((kind) => (
            <button data-on={drawKind === kind ? "" : undefined}
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
      {canDirect && tool === "measure" && !nativeBattlefieldActive ? (
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
      {underBoard}
      {!nativeBattlefieldActive ? <BoardOrderStrip encounter={encounter} faceOf={faceOfEntry} /> : null}

      <PromptDialog
        open={Boolean(prompt && promptToken) && !nativeHudActive}
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
      <BoardOrderDialog
        open={orderOpen && !nativeBattlefieldActive}
        onOpenChange={setOrderOpen}
        campaignId={campaignId}
        encounter={encounter}
        round={view.round}
        canDirect={canDirect}
        faceOf={faceOfEntry}
      />
      <Dialog.Root open={enlarged} onOpenChange={setEnlarged}>
        <Dialog.Portal>
          <Dialog.Overlay className="cine-tabletop-veil fixed inset-0 z-40" />
          {/* The tabletop ("ODM World Concepts" 3c): the board framed in gold
              on a starfield table, the turn order down the right. */}
          <Dialog.Content {...returnFocus} className="cine-tabletop fixed inset-0 z-50 flex flex-col outline-none">
            <div className={nativeBattlefieldActive ? "sr-only" : "cine-tabletop-head"}>
              <Dialog.Title className="cine-tabletop-title">
                {scene ? "The ground here" : `Battle map, round ${view.round}`}
              </Dialog.Title>
              {!nativeBattlefieldActive ? <div className="flex min-w-0 items-center gap-2">
                {/* The dialog covers the Party panel, so a player fielding
                    several characters picks who they play here (issue #189).
                    On a narrow phone the strip scrolls rather than pushing
                    the close off the edge: it is the only way back. */}
                <div className="flex min-w-0 items-center gap-2 overflow-x-auto">
                  <PlayAsStrip
                    campaignId={campaignId}
                    sheets={sheets}
                    meUserId={meUserId}
                    activeSheetId={activeSheetId}
                    multiCharacter={multiCharacter}
                  />
                  {playerTools}
                </div>
                <Dialog.Close className="cine-tabletop-close shrink-0" aria-label="Close the board">
                  <X className="size-4" />
                </Dialog.Close>
              </div> : null}
            </div>

            <div className="cine-tabletop-body">
              {chronicle}
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <div className="cine-board-frame">{gridWith(enlarged ? painted : null, true)}</div>
                {underBoard}
              </div>
              {!scene && !nativeBattlefieldActive ? <TabletopOrder encounter={encounter} faceOf={faceOfEntry} /> : null}
            </div>

          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
