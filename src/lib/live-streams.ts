// Every open live stream (a campaign's events, the bell's pings) and the
// session that opened it. A stream checks the login once, when it opens,
// and then stays open for hours; without this, signing out, a password
// change or a deleted account stopped the next request but left a stream
// that was already open reading the table.
//
// Ending a session, an account or a campaign closes the streams that hang
// on it at once (src/lib/db/users.ts, src/lib/db/campaigns.ts). Each
// stream also rechecks its session and seat on its own heartbeat, which
// catches what does not pass through here: an expired session, a row
// deleted by hand. A closed stream reconnects, is refused, and the page
// goes back to the sign-in screen the way a refused snapshot already does.
//
// No "@/" imports, so the database layer can call it without a cycle.

export type LiveStream = {
  // The session the stream was opened with; null for a caller who sent no
  // token (no stream route accepts one, but the type does not assume it).
  tokenHash: string | null;
  userId: string;
  // The campaign it reads, or null for a stream that belongs to the account.
  campaignId: string | null;
  close: () => void;
};

declare global {
  // On globalThis for the same reason as the event bus: dev HMR reloads.
  var __odmLiveStreams: Set<LiveStream> | undefined;
}

function streams(): Set<LiveStream> {
  return (globalThis.__odmLiveStreams ??= new Set());
}

// How many streams one account may hold open at once (every tab, every
// device, every table). Past it the oldest is closed rather than the new one
// refused: a tab that was closed without saying so still counts until its
// socket times out, and must not lock its owner out of the table they just
// reopened.
export const STREAMS_PER_USER = 16;

// The whole server's ceiling. A new stream past it is refused (503) and its
// client retries; a single-process server holding this many is already in
// trouble elsewhere.
export const MAX_OPEN_STREAMS = 5_000;

export function streamCapacityLeft(): boolean {
  return streams().size < MAX_OPEN_STREAMS;
}

export function trackStream(stream: LiveStream, perUser = STREAMS_PER_USER): () => void {
  const mine = Array.from(streams()).filter((open) => open.userId === stream.userId);
  // The set keeps insertion order, so the first are the oldest.
  for (const old of mine.slice(0, Math.max(0, mine.length - perUser + 1))) {
    streams().delete(old);
    try {
      old.close();
    } catch {
      // Already closed.
    }
  }
  streams().add(stream);
  return () => {
    streams().delete(stream);
  };
}

function closeWhere(match: (stream: LiveStream) => boolean): number {
  let closed = 0;
  for (const stream of Array.from(streams())) {
    if (!match(stream)) {
      continue;
    }
    streams().delete(stream);
    closed += 1;
    try {
      stream.close();
    } catch {
      // Already closed; it is off the list either way.
    }
  }
  return closed;
}

export function closeStreamsForSession(tokenHash: string): number {
  return closeWhere((stream) => stream.tokenHash === tokenHash);
}

// Every stream the user has open, except the ones read with `exceptTokenHash`
// (a password change keeps the session that made it).
export function closeStreamsForUser(userId: string, exceptTokenHash?: string): number {
  return closeWhere(
    (stream) => stream.userId === userId && (!exceptTokenHash || stream.tokenHash !== exceptTokenHash),
  );
}

export function closeStreamsForCampaign(campaignId: string): number {
  return closeWhere((stream) => stream.campaignId === campaignId);
}

// Maintenance (src/lib/maintenance.ts): nobody keeps reading a world that
// is about to be replaced.
export function closeAllStreams(): number {
  return closeWhere(() => true);
}

export function openStreamCount(): number {
  return streams().size;
}
