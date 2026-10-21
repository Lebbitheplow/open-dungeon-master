// AbortSignal.timeout for asking a backend, except that a reply which came
// in while this process was held up is still read. Node runs the timers that
// are due before it reads the input that arrived, so after a pause longer
// than the timeout (a long synchronous job, a busy or paused machine) a plain
// timeout aborts a reply that is already here, and the listing says nothing
// answered. The abort waits one turn of the event loop, behind that input.
export function replyTimeout(ms: number): AbortSignal {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    setImmediate(() => controller.abort(new DOMException("The operation was aborted due to timeout", "TimeoutError")));
  }, ms);
  // As AbortSignal.timeout's own timer: it never keeps the process alive.
  timer.unref?.();
  return controller.signal;
}
