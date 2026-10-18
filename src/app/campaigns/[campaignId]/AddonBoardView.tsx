"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  boardFx,
  boardSnapshot,
  BOARD_BRIDGE_VERSION,
  fileForRequest,
  readViewMessage,
  type Anchor,
  type BoardLook,
  type HostMessageBody,
} from "@/lib/addons/board-bridge";
import type { OfferedBoardView } from "@/lib/addons/offered";
import type { FxEvent } from "@/lib/battlemap/fx-plan";
import type { TokenIntent } from "@/lib/battlemap/intent";
import type { PlayerMapView } from "@/lib/battlemap/view-types";
import type { MapPing } from "@/lib/dm/board-logic";
import type { CameraEvent } from "@/lib/scene/state";
import { prefersReducedMotion, useLowEffects } from "@/lib/effects-mode";
import { AUDIO_PREF_FIELDS } from "@/lib/audio-prefs";
import { pageOrigin } from "@/lib/navigation";
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

// The frame's origin is opaque ("null"), so "*" is the only target that
// reaches it; the message only ever goes to this frame's own window.
function postTo(frame: HTMLIFrameElement | null, message: HostMessageBody, transfer: Transferable[] = []) {
  frame?.contentWindow?.postMessage({ odm: BOARD_BRIDGE_VERSION, ...message }, "*", transfer);
}

const NO_FX: FxEvent[] = [];

export function AddonBoardView({
  view,
  boardView,
  canDirect,
  genre = null,
  onTile,
  onToken,
  onHover,
  faceFor,
  looks,
  intents = null,
  fx = NO_FX,
  ping = null,
  camera = null,
  onAnchors,
  viewOptions,
}: {
  view: PlayerMapView;
  boardView: OfferedBoardView;
  canDirect: boolean;
  genre?: string | null;
  onTile: (x: number, y: number) => void;
  onToken: (tokenId: string) => void;
  onHover: (x: number | null, y: number | null) => void;
  // The picture a token wears on the flat board, first that exists.
  faceFor: (tokenId: string) => Array<string | null | undefined>;
  // Who each token is (a monster's type, a character's class), by ref id.
  looks?: Map<string, BoardLook>;
  intents?: TokenIntent[] | null;
  fx?: FxEvent[];
  ping?: MapPing | null;
  camera?: CameraEvent | null;
  // Where the view drew each figure, for the plates and the action ring.
  onAnchors?: (anchors: Record<string, Anchor>) => void;
  // What this device chose for the view's own options.
  viewOptions?: Record<string, string | number | boolean>;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  // Bumped each time the page in the frame says it is ready (a reload
  // inside it included), which sends it a fresh snapshot.
  const [readyAt, setReadyAt] = useState(0);
  const [problem, setProblem] = useState("");
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
  const latest = useRef({ view, onTile, onToken, onHover, faceFor, onAnchors });
  useEffect(() => {
    latest.current = { view, onTile, onToken, onHover, faceFor, onAnchors };
  });

  useEffect(() => {
    if (readyAt) {
      postTo(frame.current, {
        type: "snapshot",
        snapshot: boardSnapshot(view, boardView.addonId, {
          canDirect,
          genre,
          appearance,
          looks,
          intents,
          assetsUrl,
          viewOptions: { fields: boardView.options, values: viewOptions },
        }),
      });
    }
  }, [readyAt, view, canDirect, genre, appearance, boardView.addonId, boardView.options, looks, intents, assetsUrl, viewOptions]);

  // The moments, each sent once: effects by id, a ping and a camera move by
  // when they happened. A frame that loads late hears only what follows.
  const sentFx = useRef(new Set<string>());
  useEffect(() => {
    if (!readyAt) return;
    const fresh = fx.filter((event) => !sentFx.current.has(event.id));
    if (!fresh.length) return;
    for (const event of fresh) sentFx.current.add(event.id);
    postTo(frame.current, { type: "fx", events: boardFx(fresh) });
  }, [readyAt, fx]);

  const sentPing = useRef(0);
  useEffect(() => {
    if (!readyAt || !ping || ping.at === sentPing.current) return;
    sentPing.current = ping.at;
    postTo(frame.current, { type: "ping", x: ping.x, y: ping.y, focus: ping.focus, at: ping.at });
  }, [readyAt, ping]);

  const sentCamera = useRef(0);
  useEffect(() => {
    if (!readyAt || !camera || camera.at === sentCamera.current) return;
    sentCamera.current = camera.at;
    postTo(frame.current, { type: "camera", mode: camera.mode, x: camera.x ?? null, y: camera.y ?? null, zoom: camera.zoom ?? null });
  }, [readyAt, camera]);

  useEffect(() => {
    async function sendFile(requestId: string, name: string, paths: Array<string | null | undefined>) {
      for (const path of paths) {
        if (!path) continue;
        try {
          const response = await fetch(path);
          if (!response.ok) continue;
          const bytes = await response.arrayBuffer();
          postTo(frame.current, { type: "file", requestId, ok: true, name, mime: response.headers.get("content-type") ?? "", bytes }, [bytes]);
          return;
        } catch {
          // Try the next picture, if there is one.
        }
      }
      postTo(frame.current, { type: "file", requestId, ok: false, name, error: "Not found." });
    }

    function onMessage(event: MessageEvent) {
      if (event.source !== frame.current?.contentWindow) return;
      const message = readViewMessage(event.data);
      if (!message) return;
      const current = latest.current;
      switch (message.type) {
        case "ready":
          setReadyAt((count) => count + 1);
          break;
        case "tile":
          if (message.x >= 0 && message.y >= 0 && message.x < current.view.width && message.y < current.view.height) {
            current.onTile(message.x, message.y);
          }
          break;
        case "token":
          if (current.view.tokens.some((token) => token.id === message.tokenId)) current.onToken(message.tokenId);
          break;
        case "hover":
          current.onHover(message.x, message.y);
          break;
        case "file": {
          const file = fileForRequest(current.view, boardView.addonId, message.name);
          void sendFile(message.requestId, message.name, file ? [file.path] : []);
          break;
        }
        case "face":
          void sendFile(
            message.requestId,
            message.tokenId,
            current.view.tokens.some((token) => token.id === message.tokenId) ? current.faceFor(message.tokenId) : [],
          );
          break;
        case "anchors":
          current.onAnchors?.(message.tokens);
          break;
        case "error":
          setProblem(message.message);
          break;
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [boardView.addonId]);

  return (
    <div className="relative h-full w-full">
      <iframe
        ref={frame}
        key={src}
        src={src}
        title={`${boardView.title} board view, from ${boardView.addonName}`}
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
        allow=""
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
