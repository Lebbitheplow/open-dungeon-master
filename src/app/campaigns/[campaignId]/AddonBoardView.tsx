"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  boardFx,
  boardSnapshot,
  boardRuler,
  BOARD_BRIDGE_VERSION,
  fileForRequest,
  readViewMessage,
  offeredBoardControl,
  nativeBoardHud,
  type Anchor,
  type AnchorStore,
  type BoardActionMenu,
  type BoardHud,
  type BoardControlId,
  type BoardLook,
  type HostMessageBody,
  type ViewCameraState,
  type ViewMessage,
} from "@/lib/addons/board-bridge";
import type { OfferedBoardView } from "@/lib/addons/offered";
import { normalizeOptionValues } from "@/lib/addons/contracts";
import type { FxEvent } from "@/lib/battlemap/fx-plan";
import type { TokenIntent } from "@/lib/battlemap/intent";
import type { PlayerMapView } from "@/lib/battlemap/view-types";
import type { Ruler } from "@/lib/battlemap/board-move";
import type { MapPing } from "@/lib/dm/board-logic";
import type { CameraEvent } from "@/lib/scene/state";
import { prefersReducedMotion, useLowEffects } from "@/lib/effects-mode";
import { AUDIO_PREF_FIELDS } from "@/lib/audio-prefs";
import { pageOrigin } from "@/lib/navigation";
import { shellHost } from "@/lib/shell-host";
import { attachNativeBoard, nativeFileUrls, postNativeBoard, NATIVE_IMAGE_MAX_BYTES } from "@/lib/addons/native-board-client";
import { useThemePrefs } from "@/lib/theme-mode";

// An addon's board view: its own page in a sandboxed frame where the grid
// would be, fed the board this viewer may see and the moments on it
// (effects, pings, the DM's camera), and answered when it asks for a stored
// file (src/lib/addons/board-bridge.ts is the contract).
//
// The frame gets allow-scripts and nothing else: no same-origin, no forms,
// no popups, no top navigation. Its taps come back as the tile and token
// taps the built-in grid makes, into the same handlers, so a move, a target
// or a ping from a 3D view goes through exactly the checks a click on the
// flat board does.
//
// The page is cross-origin isolated (next.config.ts), and the frame is
// credentialless: it has no cookies or storage of its own to lose, and it
// loads under the isolated page even from a server older than these headers
// (the desktop app draws the table from its own page for any server). An
// addon whose threads permission the admin accepted gets the isolation in
// its frame too: shared memory between its threads and precise timers.

// Typed apart: React knows the credentialless attribute, its types do not yet.
const CREDENTIALLESS = { credentialless: true } as Record<string, boolean>;

// The frame's origin is opaque ("null"), so "*" is the only target that
// reaches it; the message only ever goes to this frame's own window.
export function postTo(frame: HTMLIFrameElement | null, message: HostMessageBody, transfer: Transferable[] = []) {
  postNativeBoard(frame, message);
  frame?.contentWindow?.postMessage({ odm: BOARD_BRIDGE_VERSION, ...message }, "*", transfer);
}

const NO_FX: FxEvent[] = [];
const NO_STORE = () => () => {};

// Where the view drew one figure, for the plate or the action ring that sits
// on it; only a move of that figure re-renders the caller.
export function useAnchor(store: AnchorStore | null, tokenId: string): Anchor | undefined {
  return useSyncExternalStore(store ? store.subscribe : NO_STORE, () => store?.get(tokenId), () => undefined);
}

export function AddonBoardView({
  view,
  boardView,
  canDirect,
  genre = null,
  onTile,
  onToken,
  onHover,
  onCancel,
  faceFor,
  looks,
  intents = null,
  moveAim = null,
  ruler = null,
  fx = NO_FX,
  ping = null,
  camera = null,
  onAnchors,
  onCameraState,
  viewOptions,
  onFailure,
  nativeActive = true,
  actionMenu = null,
  onAction,
  battlefieldHud = null,
  onBoardControl,
  onCapabilities,
  onDraw,
}: {
  view: PlayerMapView | null;
  boardView: OfferedBoardView;
  canDirect: boolean;
  genre?: string | null;
  onTile?: (x: number, y: number) => void;
  onToken?: (tokenId: string, openMenu?: boolean) => void;
  onHover?: (x: number | null, y: number | null) => void;
  onCancel?: () => void;
  // The picture a token wears on the flat board, first that exists.
  faceFor?: (tokenId: string) => Array<string | null | undefined>;
  // Who each token is (a monster's type, a character's class), by ref id.
  looks?: Map<string, BoardLook>;
  intents?: TokenIntent[] | null;
  // The square a first tap aimed the walk at (BattleMapPanel.tsx).
  moveAim?: { x: number; y: number } | null;
  ruler?: Ruler | null;
  fx?: FxEvent[];
  ping?: MapPing | null;
  camera?: CameraEvent | null;
  // Where the view drew each figure, for the plates and the action ring.
  onAnchors?: (anchors: Record<string, Anchor>) => void;
  onCameraState?: (state: ViewCameraState, frame: HTMLIFrameElement) => void;
  // What this device chose for the view's own options.
  viewOptions?: Record<string, string | number | boolean>;
  onFailure?: () => void;
  nativeActive?: boolean;
  actionMenu?: BoardActionMenu | null;
  onAction?: (actionId: string) => void;
  battlefieldHud?: BoardHud | null;
  onBoardControl?: (action: BoardControlId, value?: string) => void;
  onCapabilities?: (capabilities: { hud: boolean; tools: boolean; actions: boolean } | null, owner: object) => void;
  onDraw?: (points: Array<{ x: number; y: number }>) => void;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const nativeReceiver = useRef<(message: ViewMessage) => void>(() => {});
  // Bumped each time the page in the frame says it is ready (a reload
  // inside it included), which sends it a fresh snapshot.
  const [readyAt, setReadyAt] = useState(0);
  const [nativeOnly, setNativeOnly] = useState<boolean | null>(null);
  const [actionsSupported, setActionsSupported] = useState(false);
  const [hudSupported, setHudSupported] = useState(false);
  const [toolsSupported, setToolsSupported] = useState(false);
  const capabilityOwner = useRef({});
  const hudRevision = useRef(0);
  const [hudRequest, setHudRequest] = useState(0);
  const activeHud = useRef<{ revision: number; source: BoardHud; signature: string; mapId: string } | null>(null);
  const hudSignature = JSON.stringify([view?.mapId, view?.turn, view?.myTokenId, battlefieldHud]);
  const menuRevision = useRef(0);
  const [menuRequest, setMenuRequest] = useState(0);
  const activeMenu = useRef<{ revision: number; source: BoardActionMenu; ids: Set<string>; mapId: string } | null>(null);
  const [problem, setProblem] = useState("");
  const hasFailureHandler = Boolean(onFailure);
  const { mode } = useThemePrefs();
  const lowEffects = useLowEffects();
  const [audio, setAudio] = useState({ muted: true, volume: 0 });
  useEffect(() => {
    const read = () => {
      try {
        const muted = localStorage.getItem(AUDIO_PREF_FIELDS.ambienceMuted.key) === "1" || localStorage.getItem(AUDIO_PREF_FIELDS.chimeMuted.key) === "1";
        const raw = localStorage.getItem(AUDIO_PREF_FIELDS.ambienceVolume.key);
        const n = raw === null ? 0.6 : Number(raw);
        setAudio({ muted, volume: Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0.6 });
      } catch { setAudio({ muted: true, volume: 0 }); }
    };
    read();
    const events = [AUDIO_PREF_FIELDS.ambienceMuted.event, AUDIO_PREF_FIELDS.chimeMuted.event, "storage"];
    events.forEach(name => window.addEventListener(name, read));
    return () => events.forEach(name => window.removeEventListener(name, read));
  }, []);
  const appearance = useMemo(
    () => ({ theme: mode === "light" ? ("day" as const) : ("night" as const), reducedMotion: lowEffects || prefersReducedMotion(), audio }),
    [mode, lowEffects, audio],
  );
  const src = `${pageOrigin()}${boardView.url}`;
  const assetsUrl = `${pageOrigin()}/api/addons/${encodeURIComponent(boardView.addonId)}/assets/`;

  // The newest of everything the message handler reads, so it is attached
  // once per frame rather than once per board update.
  const latest = useRef({ view, onTile, onToken, onHover, onCancel, faceFor, onAnchors, onCameraState, onFailure, actionMenu, onAction, nativeActive, battlefieldHud, onBoardControl, hudSignature, onDraw });
  useLayoutEffect(() => {
    latest.current = { view, onTile, onToken, onHover, onCancel, faceFor, onAnchors, onCameraState, onFailure, actionMenu, onAction, nativeActive, battlefieldHud, onBoardControl, hudSignature, onDraw };
  });

  useEffect(() => {
    if (!nativeActive || !readyAt) return;
    const owner = capabilityOwner.current;
    onCapabilities?.({ hud: hudSupported, tools: toolsSupported, actions: actionsSupported }, owner);
    return () => onCapabilities?.(null, owner);
  }, [hudSupported, toolsSupported, actionsSupported, nativeActive, readyAt, onCapabilities]);

  useEffect(() => {
    activeMenu.current = null;
    if (!actionsSupported || !nativeActive) return;
    const revision = ++menuRevision.current;
    const menu = actionMenu && view ? {
      tokenId: actionMenu.tokenId,
      hint: actionMenu.hint?.slice(0, 200),
      actions: actionMenu.actions.slice(0, 16).map(action => ({ id: action.id, label: action.label.slice(0, 80), disabled: action.disabled?.slice(0, 300) ?? null })),
    } : null;
    if (menu && actionMenu && view) activeMenu.current = { revision, source: actionMenu, ids: new Set(menu.actions.map(action => action.id)), mapId: view.mapId };
    postNativeBoard(frame.current, { type: "action-menu", revision, menu });
  }, [readyAt, actionMenu, actionsSupported, nativeActive, view, menuRequest]);

  useEffect(() => {
    if (readyAt || !hasFailureHandler) return;
    const timeout = window.setTimeout(() => latest.current.onFailure?.(), 30_000);
    return () => window.clearTimeout(timeout);
  }, [src, readyAt, hasFailureHandler]);

  useEffect(() => {
    if (readyAt || nativeActive) {
      // Native startup must not wait for a cached iframe's one-time ready event.
      const send = readyAt ? postTo : postNativeBoard;
      if (!view) {
        send(frame.current, { type: "scene", genre, appearance, options: normalizeOptionValues(boardView.options, viewOptions), assetsUrl });
        return;
      }
      send(frame.current, {
        type: "snapshot",
        sessionLayout: boardView.sessionLayout,
        snapshot: boardSnapshot(view, boardView.addonId, {
          canDirect,
          genre,
          appearance,
          looks,
          intents,
          moveAim,
          assetsUrl,
          viewOptions: { fields: boardView.options, values: viewOptions },
        }),
      });
    }
  }, [readyAt, view, canDirect, genre, appearance, boardView.addonId, boardView.options, boardView.sessionLayout, looks, intents, moveAim, assetsUrl, viewOptions, nativeActive]);



  useEffect(() => {
    if (!hudSupported || !nativeActive || !battlefieldHud || !view) { activeHud.current = null; return; }
    if (activeHud.current?.signature === hudSignature) return;
    const revision = ++hudRevision.current;
    const selected = battlefieldHud.selection;
    const hud = nativeBoardHud({
      ...battlefieldHud,
      selection: selected && view.tokens.some(token => token.id === selected.tokenId) ? selected : null,
    });
    activeHud.current = { revision, source: hud, signature: hudSignature, mapId: view.mapId };
    postNativeBoard(frame.current, { type: "battlefield-ui", revision, mapId: view.mapId, hud });
  }, [readyAt, battlefieldHud, view, hudSupported, nativeActive, hudRequest, hudSignature]);

  // Pointer previews change without rebuilding an addon\'s terrain and figures.
  useEffect(() => {
    if (readyAt && view) postTo(frame.current, { type: "ruler", mapId: view.mapId, ruler: boardRuler(view, ruler) });
  }, [readyAt, view, ruler]);

  // The moments, each sent once: effects by id, a ping and a camera move by
  // when they happened. A frame that loads late hears only what follows.
  const sentFx = useRef(new Set<string>());
  useEffect(() => {
    if (!readyAt || !view) return;
    const fresh = fx.filter((event) => !sentFx.current.has(event.id));
    if (!fresh.length) return;
    for (const event of fresh) sentFx.current.add(event.id);
    postTo(frame.current, { type: "fx", events: boardFx(fresh) });
  }, [readyAt, fx, view]);

  const sentPing = useRef(0);
  useEffect(() => {
    if (!readyAt || !view || !ping || ping.at === sentPing.current) return;
    sentPing.current = ping.at;
    postTo(frame.current, { type: "ping", x: ping.x, y: ping.y, focus: ping.focus, at: ping.at });
  }, [readyAt, ping, view]);

  const sentCamera = useRef(0);
  useEffect(() => {
    if (!readyAt || !view || !camera || camera.at === sentCamera.current) return;
    sentCamera.current = camera.at;
    postTo(frame.current, { type: "camera", mode: camera.mode, x: camera.x ?? null, y: camera.y ?? null, zoom: camera.zoom ?? null });
  }, [readyAt, camera, view]);

  useLayoutEffect(() => {
    async function sendFile(requestId: string, name: string, paths: Array<string | null | undefined>, native = false, face = false) {
      const send = native ? postNativeBoard : postTo;
      const urls = paths.flatMap((path) => (!path ? [] : native ? nativeFileUrls(path, face) : [path]));
      for (const url of urls) {
        try {
          const response = await fetch(url);
          if (!response.ok) continue;
          let bytes: ArrayBuffer;
          if (native) {
            if (!response.body || Number(response.headers.get("content-length")) > NATIVE_IMAGE_MAX_BYTES) continue;
            const reader = response.body.getReader();
            const chunks: Uint8Array[] = [];
            let size = 0;
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              size += value.byteLength;
              if (size > NATIVE_IMAGE_MAX_BYTES) { await reader.cancel(); break; }
              chunks.push(value);
            }
            if (size > NATIVE_IMAGE_MAX_BYTES) continue;
            const joined = new Uint8Array(size);
            let offset = 0;
            for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.byteLength; }
            bytes = joined.buffer;
          } else bytes = await response.arrayBuffer();
          const packet: HostMessageBody = { type: "file", requestId, ok: true, name, mime: response.headers.get("content-type") ?? "", bytes };
          if (native) postNativeBoard(frame.current, packet);
          else postTo(frame.current, packet, [bytes]);
          return;
        } catch {
          // Try the next picture, if there is one.
        }
      }
      send(frame.current, { type: "file", requestId, ok: false, name, error: "Not found." });
    }

    // A view may report its figures several times a frame while its camera
    // moves; the newest report is passed on once a frame.
    let anchorFrame = 0;
    let anchorsWaiting: Record<string, Anchor> | null = null;
    function passAnchors() {
      anchorFrame = 0;
      const tokens = anchorsWaiting;
      anchorsWaiting = null;
      if (tokens && latest.current.view) latest.current.onAnchors?.(tokens);
    }

    function receive(message: ViewMessage, native = false) {
      const current = latest.current;
      // A separate native window is outside the HTML dialog's input trap.
      if (native && ["token", "tile", "action", "board-control", "board-draw", "cancel"].includes(message.type)
        && ((current.battlefieldHud?.prompt && message.type !== "board-control") || (current.battlefieldHud?.panel && message.type !== "board-control" && (message.type === "action" || !current.battlefieldHud.panel.boardInput)) || [...document.querySelectorAll('dialog[open],[role="dialog"],[role="alertdialog"]')].some(dialog => !dialog.contains(frame.current) && dialog.getClientRects().length && getComputedStyle(dialog).visibility !== "hidden"))) {
        activeHud.current = null;
        setHudRequest(value => value + 1);
        if (message.type === "action") { activeMenu.current = null; setMenuRequest(value => value + 1); }
        return;
      }
      switch (message.type) {
        case "ready":
          if (native) setToolsSupported(message.battlefieldTools === true);
          if (native) { activeHud.current = null; setHudSupported(message.battlefieldUi === true); }
          if (native) { activeMenu.current = null; setActionsSupported(message.actions === true); }
          setNativeOnly((current) => message.nativeOnly === true ? true : current ?? false);
          setReadyAt((count) => count + 1);
          break;
        case "board-control": {
          const offered = activeHud.current;
          if (!native || !current.nativeActive || !offered || offered.signature !== current.hudSignature
            || offered.revision !== message.revision || offered.mapId !== message.mapId || !offeredBoardControl(offered.source, message.actionId, message.value)) {
            if (native && current.nativeActive) { activeHud.current = null; setHudRequest(value => value + 1); }
            break;
          }
          activeHud.current = null;
          current.onBoardControl?.(message.actionId, message.value);
          setHudRequest(value => value + 1);
          break;
        }
        case "board-draw": {
          const offered = activeHud.current;
          if (!native || !current.nativeActive || !offered || offered.signature !== current.hudSignature || offered.revision !== message.revision || offered.mapId !== message.mapId
            || !offered.source.drawing || offered.source.panel || offered.source.pending || !current.view
            || !message.points.every(point => point.x < current.view!.width && point.y < current.view!.height)) break;
          activeHud.current = null;
          current.onDraw?.(message.points);
          setHudRequest(value => value + 1);
          break;
        }
        case "action": {
          const offered = activeMenu.current;
          if (!native || !current.nativeActive || !offered || offered.source !== current.actionMenu || offered.revision !== message.revision
            || offered.source.tokenId !== message.tokenId || offered.mapId !== current.view?.mapId || !offered.ids.has(message.actionId)
            || !current.view?.tokens.some(token => token.id === message.tokenId)) break;
          const action = current.actionMenu?.actions.find(entry => entry.id === message.actionId);
          if (action && !action.disabled) {
            activeMenu.current = null;
            current.onAction?.(action.id);
            setMenuRequest(value => value + 1);
          }
          break;
        }
        case "camera-state":
          if (current.view && frame.current && message.x >= 0 && message.y >= 0 && message.x < current.view.width && message.y < current.view.height) {
            current.onCameraState?.({ x: message.x, y: message.y, zoom: message.zoom }, frame.current);
          }
          break;
        case "tile":
          if (current.view && message.x >= 0 && message.y >= 0 && message.x < current.view.width && message.y < current.view.height) {
            current.onTile?.(message.x, message.y);
          }
          break;
        case "token":
          if (current.view?.tokens.some((token) => token.id === message.tokenId)) current.onToken?.(message.tokenId, message.menu);
          break;
        case "hover":
          if (current.view) current.onHover?.(message.x, message.y);
          break;
        case "cancel":
          if (current.view) current.onCancel?.();
          break;
        case "file": {
          const file = current.view ? fileForRequest(current.view, boardView.addonId, message.name) : null;
          void sendFile(message.requestId, message.name, file ? [file.path] : [], native);
          break;
        }
        case "face":
          void sendFile(
            message.requestId,
            message.tokenId,
            current.view?.tokens.some((token) => token.id === message.tokenId) ? current.faceFor?.(message.tokenId) ?? [] : [],
            native,
            true,
          );
          break;
        case "anchors":
          if (current.view) {
            anchorsWaiting = message.tokens;
            if (!anchorFrame) anchorFrame = requestAnimationFrame(passAnchors);
          }
          break;
        case "error":
          setProblem(message.message);
          current.onFailure?.();
          break;
      }
    }
    function onMessage(event: MessageEvent) {
      if (event.source !== frame.current?.contentWindow) return;
      const message = readViewMessage(event.data);
      if (message) receive(message);
    }
    nativeReceiver.current = message => receive(message, true);
    window.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("message", onMessage);
      cancelAnimationFrame(anchorFrame);
    };
  }, [boardView.addonId]);

  useEffect(() => {
    const api = shellHost()?.nativeBoard;
    if (!nativeActive || nativeOnly === null || !frame.current) return;
    const unavailable = () => {
      activeHud.current = null;
      setHudSupported(false);
      activeMenu.current = null;
      setActionsSupported(false);
      if (nativeOnly) nativeReceiver.current({ type: "error", message: "Native tabletop unavailable. Returning to the Board." });
    };
    if (!api) { unavailable?.(); return; }
    const detach = attachNativeBoard(frame.current, api, { addonId: boardView.addonId, viewId: boardView.id }, message => nativeReceiver.current(message), unavailable);
    return () => { detach(); activeMenu.current = null; activeHud.current = null; setActionsSupported(false); setHudSupported(false); };
  }, [src, boardView.addonId, boardView.id, nativeActive, nativeOnly]);

  return (
    <div className="relative h-full w-full">
      <iframe
        ref={frame}
        key={src}
        src={src}
        title={`${boardView.title} board view, from ${boardView.addonName}`}
        sandbox="allow-scripts"
        {...CREDENTIALLESS}
        referrerPolicy="no-referrer"
        allow={boardView.threads ? "cross-origin-isolated" : ""}
        className="block h-full w-full rounded-lg border-0 bg-transparent"
      />
      {problem ? (
        <p role="status" className="live-in absolute inset-x-2 bottom-2 rounded-md bg-stone-950/85 px-2 py-1 text-[11px] text-amber-200">
          {boardView.addonName}: {problem}
        </p>
      ) : null}
    </div>
  );
}
