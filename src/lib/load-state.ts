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

// A change sent to the server, read to its end (WA-05): the reply's JSON
// when it said yes; otherwise one sentence, the server's own where it gave
// one, or what failed and why. Never throws, so a press whose request dies
// on the way says so in the panel instead of leaving an unhandled rejection
// and a draft that looks saved. A request with no answer at all is
// `unanswered`: the server may have done it all the same, so a create reads
// its list again before it offers to send the same thing twice.
export type WriteOutcome<T> =
  | { payload: T; error: null; unanswered: false }
  | { payload: null; error: string; unanswered: boolean };

export async function readWrite<T = Record<string, unknown>>(request: Promise<Response>, failed: string): Promise<WriteOutcome<T>> {
  let response: Response;
  try {
    response = await request;
  } catch {
    return { payload: null, error: `${failed} ${UNREACHABLE}`, unanswered: true };
  }
  // A yes whose body is not JSON (a 204, a cut-off body) is still a yes: the
  // change was made, and a panel that needs the row reads its list again.
  const body = (await response.json().catch(() => ({}))) as { error?: unknown };
  if (response.ok) {
    return { payload: body as T, error: null, unanswered: false };
  }
  const reason = typeof body.error === "string" && body.error.trim() ? body.error.trim() : `${failed} The server answered ${response.status}.`;
  return { payload: null, error: reason, unanswered: false };
}

// After a create whose answer was lost: whether the new row is on the
// server. The list is read again and a row that was not there before and
// matches what was sent means it was made; a list without one means it was
// not; a list that cannot be read either means nobody knows yet, and the
// panel keeps the draft and says so rather than invite a second copy.
export type LostCreate = "made" | "missing" | "unknown";

export async function findLostCreate<T extends { id: string }>(
  before: readonly T[],
  reread: () => Promise<readonly T[] | null>,
  matches: (row: T) => boolean,
): Promise<LostCreate> {
  const known = new Set(before.map((row) => row.id));
  const fresh = await reread().catch(() => null);
  if (!fresh) {
    return "unknown";
  }
  return fresh.some((row) => !known.has(row.id) && matches(row)) ? "made" : "missing";
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
