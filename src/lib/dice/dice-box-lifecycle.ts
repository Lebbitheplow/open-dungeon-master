// The parts of the 3D dice tray's lifecycle that are plain logic: catching
// the window listener dice-box-threejs adds during initialize() and never
// removes, and the idle window after which an unused tray is torn down.
//
// The library calls window.addEventListener("resize", ...) synchronously
// inside initialize(), before its first await, with no matching remove. A
// disposed box therefore keeps a listener that calls setDimensions on a
// dead renderer, and every rebuild stacks another. Wrapping the call for
// exactly that synchronous stretch captures the handler without patching
// the package.

type ListenerTarget = Pick<Window, "addEventListener" | "removeEventListener">;

export type CapturedListener = {
  type: string;
  listener: EventListenerOrEventListenerObject;
  options?: boolean | AddEventListenerOptions;
};

// Runs `start` with the target's addEventListener wrapped, restores it as
// soon as `start` returns (synchronously, so nothing else that mounts during
// the library's later awaits is caught), and hands back what was added.
export function captureListeners<T>(
  target: ListenerTarget,
  types: readonly string[],
  start: () => T,
): { result: T; captured: CapturedListener[] } {
  const captured: CapturedListener[] = [];
  const original = target.addEventListener;
  const wrapped: Window["addEventListener"] = function (
    this: unknown,
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ) {
    if (listener && types.includes(type)) {
      captured.push({ type, listener, options });
    }
    // The DOM accepts a null listener as a no-op; the lib typing does not.
    return original.call(target, type, listener as EventListenerOrEventListenerObject, options);
  };
  target.addEventListener = wrapped;
  try {
    const result = start();
    return { result, captured };
  } finally {
    target.addEventListener = original;
  }
}

export function releaseListeners(target: ListenerTarget, captured: CapturedListener[]): void {
  for (const entry of captured) {
    target.removeEventListener(entry.type, entry.listener, entry.options);
  }
  captured.length = 0;
}

// How long a tray sits unused before its WebGL context and canvas go. The
// next roll pays theme load plus context creation again (a few hundred
// milliseconds on a phone), so this is well past a normal pause between
// rolls but short enough that a table left idle stops holding a context.
export const DICE_IDLE_MS = 30_000;
