import type { ShellNativeBoard, NativeBoardRect } from "@/lib/shell-host";
import { readViewMessage, type HostMessageBody, type ViewMessage } from "./board-bridge";

const bindings = new WeakMap<HTMLIFrameElement, (packet: HostMessageBody) => void>();
const snapshots = new WeakMap<HTMLIFrameElement, HostMessageBody>();
const openings = new WeakMap<ShellNativeBoard, Promise<void>>();
const owners = new WeakMap<ShellNativeBoard, () => void>();
export const NATIVE_IMAGE_MAX_BYTES = 1024 * 1024;

export function nativeFilePacket(packet: HostMessageBody) {
  if (packet.type !== "file" || !packet.ok) return packet;
  const { bytes, ...metadata } = packet;
  if (bytes.byteLength > NATIVE_IMAGE_MAX_BYTES) return { type: "file", requestId: packet.requestId, ok: false, name: packet.name, error: "Picture is too large." };
  const data = new Uint8Array(bytes);
  let binary = "";
  for (let offset = 0; offset < data.length; offset += 32768) binary += String.fromCharCode(...data.subarray(offset, offset + 32768));
  return { ...metadata, bytesBase64: btoa(binary) };
}

export function postNativeBoard(frame: HTMLIFrameElement | null, packet: HostMessageBody): void {
  if (!frame) return;
  if (packet.type === "snapshot") snapshots.set(frame, packet);
  bindings.get(frame)?.(packet);
}

// The iframe remains mounted. Only its draw loop sleeps while native is ready.
export function attachNativeBoard(frame: HTMLIFrameElement, api: ShellNativeBoard,
  key: { addonId: string; viewId: string }, receive: (message: ViewMessage) => void, onUnavailable?: () => void): () => void {
  let disposed = false, id = "", active = false, previous = "";
  let unsubscribe = () => {};
  let stopWatching = () => {};
  let closeStarted = false;
  let opening: Promise<void> = Promise.resolve();
  const close = async () => {
    if (!id || closeStarted) return;
    closeStarted = true;
    await api.close(id).catch(() => {});
  };
  const detach = () => {
    if (disposed) return;
    disposed = true; active = false;
    if (owners.get(api) === detach) owners.delete(api);
    bindings.delete(frame); snapshots.delete(frame);
    unsubscribe(); stopWatching(); rendering(true);
    if (id) openings.set(api, opening.then(close));
  };
  const unavailable = () => {
    if (disposed) return;
    detach();
    onUnavailable?.();
  };
  const rect = (element: Element): NativeBoardRect => {
    const r = element.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  };
  const rendering = (enabled: boolean) => {
    frame.toggleAttribute("data-native-board-active", !enabled);
    frame.contentWindow?.postMessage({ odm: 1, type: "rendering", active: enabled }, "*");
  };
  const layout = () => {
    if (!id || disposed) return;
    const bounds = rect(frame);
    const occlusions = [...document.querySelectorAll('[data-native-board-occluder],dialog[open],[role="dialog"],[role="menu"],[role="tooltip"]')]
      .filter(e => e.getAttribute("role") !== "menu" || getComputedStyle(e).pointerEvents !== "none")
      .filter(e => !e.contains(frame) && e.getClientRects().length && getComputedStyle(e).visibility !== "hidden")
      .filter(e => {
        const board = e.closest(".board-view");
        return !board || board.contains(frame);
      })
      .map(rect).filter(r => r.x < bounds.x + bounds.width && r.y < bounds.y + bounds.height && r.x + r.width > bounds.x && r.y + r.height > bounds.y).slice(0, 64);
    const data = { bounds, occlusions, visible: active && bounds.width > 0 && bounds.height > 0 && document.visibilityState !== "hidden", scale: devicePixelRatio };
    const serialized = JSON.stringify(data);
    if (serialized !== previous) { previous = serialized; api.layout(id, data); }
  };
  // The next board can mount before the previous board's effect cleanup runs.
  owners.get(api)?.();
  owners.set(api, detach);
  opening = (openings.get(api) ?? Promise.resolve()).catch(() => {}).then(async () => {
    if (disposed) return;
    const result = await api.open(key);
    if (!result) { if (onUnavailable) unavailable(); return; }
    id = result.id;
    if (disposed) { await close(); return; }
    const resize = new ResizeObserver(layout);
    const changes = new MutationObserver(layout);
    resize.observe(frame);
    changes.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["style", "class", "open", "data-state"] });
    window.addEventListener("resize", layout);
    window.addEventListener("scroll", layout, true);
    document.addEventListener("visibilitychange", layout);
    let animation = 0, geometry = "";
    const followGeometry = () => {
      if (disposed) return;
      // Ancestor layout shifts and monitor scaling can move the frame without resizing it.
      if (active && document.visibilityState !== "hidden") {
        const next = JSON.stringify([rect(frame), devicePixelRatio]);
        if (next !== geometry) { geometry = next; layout(); }
      }
      animation = requestAnimationFrame(followGeometry);
    };
    animation = requestAnimationFrame(followGeometry);
    stopWatching = () => {
      cancelAnimationFrame(animation);
      resize.disconnect(); changes.disconnect();
      window.removeEventListener("resize", layout);
      window.removeEventListener("scroll", layout, true);
      document.removeEventListener("visibilitychange", layout);
    };
    unsubscribe = api.subscribe(id, raw => {
      const message = readViewMessage(raw);
      if (!message || disposed) return;
      if (message.type === "ready") { active = true; rendering(false); layout(); }
      if (message.type === "error") { unavailable(); return; }
      receive(message);
    });
    bindings.set(frame, packet => api.send(id, { odm: 1, ...nativeFilePacket(packet) }));
    layout();
    const latest = snapshots.get(frame);
    if (latest) api.send(id, { odm: 1, ...latest });
  }).catch(error => { console.warn("Native view unavailable.", String(error)); unavailable(); });
  openings.set(api, opening);
  return detach;
}
