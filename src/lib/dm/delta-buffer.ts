// Coalesces per-token stream deltas into ~intervalMs flushes so narration
// does not turn into one SSE frame (and one client render) per token. The
// client reducer is a pure concatenator, so batching is transparent to it.
// Timer functions are injectable for the test harness.

type TimerFns = {
  set: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clear: (id: ReturnType<typeof setTimeout>) => void;
};

export function createDeltaBatcher(
  emit: (text: string) => void,
  intervalMs = 75,
  timers: TimerFns = { set: setTimeout, clear: clearTimeout },
) {
  let buffer = "";
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = () => {
    if (timer !== null) {
      timers.clear(timer);
      timer = null;
    }
    if (buffer) {
      const text = buffer;
      buffer = "";
      emit(text);
    }
  };

  return {
    push(text: string) {
      if (!text) {
        return;
      }
      buffer += text;
      if (timer === null) {
        timer = timers.set(flush, intervalMs);
      }
    },
    // Call at stream end and before tool processing so no text sits buffered
    // across a boundary.
    flush,
  };
}
