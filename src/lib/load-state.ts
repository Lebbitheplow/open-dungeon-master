"use client";

import { useCallback, useState } from "react";

// What a panel knows about the list it asked the server for, kept apart from
// the list itself (issue 140). A panel that starts with `[]` and drops a
// refused or failed request on the floor draws its "nothing here yet" plate
// over maps, cast and fights that exist, which reads as lost work. Issue 121
// was exactly that: every DM tab of an imported workshop answered 403 and
// every tab said it was empty. So the empty plate waits for a reply that
// says empty, and a reply that says no is shown in its own words with a way
// to ask again.

export type LoadOutcome<T> = { payload: T; error: null } | { payload: null; error: string };

export const UNREACHABLE = "The server could not be reached.";
export const UNREADABLE = "The server's answer could not be read.";

// Reads a list request to its end: the JSON payload when the server said
// yes; otherwise one sentence, the server's own where it gave one ("Only the
// Dungeon Master can do that."), after what did not load. Never throws, so
// a `.then` on it is the whole handling.
export async function readLoad<T>(request: Promise<Response>, what: string): Promise<LoadOutcome<T>> {
  const failed = (reason: string): LoadOutcome<T> => ({ payload: null, error: `${what} did not load. ${reason}` });
  let response: Response;
  try {
    response = await request;
  } catch {
    return failed(UNREACHABLE);
  }
  if (response.ok) {
    try {
      return { payload: (await response.json()) as T, error: null };
    } catch {
      // A 200 that is not JSON: a proxy's sign-in page, a cut-off body.
      return failed(UNREADABLE);
    }
  }
  const body = (await response.json().catch(() => ({}))) as { error?: unknown };
  const reason = typeof body.error === "string" && body.error.trim() ? body.error.trim() : `The server answered ${response.status}.`;
  return failed(reason);
}

// The two facts a panel renders by: whether any load has ever landed (until
// then it is loading, not empty) and the last load's refusal, if any. A
// refetch that fails after a good load keeps the rows and adds the sentence.
export function useLoadStatus() {
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState("");
  const settle = useCallback((outcome: LoadOutcome<unknown>) => {
    if (outcome.error === null) {
      setLoaded(true);
      setLoadError("");
    } else {
      setLoadError(outcome.error);
    }
  }, []);
  return { loaded, loadError, settle };
}
