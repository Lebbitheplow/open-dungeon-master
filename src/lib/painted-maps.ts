// The device's choice to paint battle maps or keep the drawn board. Kept on
// the device like the other effect dials (src/lib/effects-mode.ts): it is a
// matter of taste and of how fast this screen's hardware is, not of the table.
const KEY = "odm:painted-maps";
const EVENT = "odm:painted-maps";

export function paintedMapsOn(): boolean {
  return typeof window === "undefined" || window.localStorage.getItem(KEY) !== "off";
}

export function writePaintedMaps(on: boolean): void {
  window.localStorage.setItem(KEY, on ? "on" : "off");
  window.dispatchEvent(new Event(EVENT));
}

// Calls back when the choice changes, in this tab or another. Returns the unsubscribe.
export function onPaintedMapsChange(listener: () => void): () => void {
  const storage = (event: StorageEvent) => {
    if (event.key === KEY) listener();
  };
  window.addEventListener(EVENT, listener);
  window.addEventListener("storage", storage);
  return () => {
    window.removeEventListener(EVENT, listener);
    window.removeEventListener("storage", storage);
  };
}
