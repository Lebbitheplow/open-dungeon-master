// Notices a table stream that has gone quiet without closing (issue 73).
//
// An EventSource only reports trouble when its connection ends. A connection
// that stays open but stops carrying bytes (a laptop lid, a Wi-Fi handoff, a
// wedged proxy, a half-open socket behind Docker's port mapping) never ends,
// so the browser never retries and the tab sits on its last event until the
// page is reloaded: the DM's console stopped hearing the players while the
// players, on a newer connection, still heard the DM.
//
// The events route sends a named "ping" as a stream opens and every few
// seconds after, so silence past a few missed beats means the stream is dead.
// The watchdog arms on the first ping it hears: an older server sends its
// beat as an SSE comment, which no page can see, and an app talking to one
// must not take a quiet table for a dead one and reconnect forever.

// The events route's beat, and how many may go missing before the stream is
// given up on. Three, so one slow beat on a busy server is not a reconnect.
export const STREAM_PING_MS = 10_000;
export const STREAM_SILENCE_MS = STREAM_PING_MS * 3;

export type StreamWatchdog = {
  // Anything arrived: an event, a ping, or the stream opening.
  heard(): void;
  // A ping arrived; the server is one that beats.
  pinged(): void;
  // Called on a timer and whenever the page comes back to the front. `live`
  // is whether the stream is still meant to be running, open or connecting:
  // a reconnect can hang on a dead socket as surely as an open stream can,
  // while a stream closed for good is the snapshot probe's to explain.
  check(live: boolean): void;
};

export function createStreamWatchdog(
  onSilent: () => void,
  now: () => number = Date.now,
  silenceMs: number = STREAM_SILENCE_MS,
): StreamWatchdog {
  let armed = false;
  let lastHeard = now();
  return {
    heard() {
      lastHeard = now();
    },
    pinged() {
      armed = true;
      lastHeard = now();
    },
    check(live) {
      if (!armed || !live || now() - lastHeard <= silenceMs) {
        return;
      }
      // Counted from here, so a reconnect that takes a while to open is not
      // given up on again before it has had its own chance.
      lastHeard = now();
      onSilent();
    },
  };
}
