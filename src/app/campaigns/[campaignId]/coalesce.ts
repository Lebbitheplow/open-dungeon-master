// A refetch that cannot pile up. The fogged battle map and the DM's
// encounter view are pulled per seat on every ping, and a burst of moves
// pings many times in a row: without this each ping opened its own request
// and whichever answered last won, even when it was the oldest.
//
// One request is in flight at a time and at most one more waits behind it,
// so a burst of ten pings costs two round trips. Because requests never
// overlap, no answer can be older than the one applied before it. A body
// identical to the last one applied is dropped, so a ping that changed
// nothing for this seat leaves the previous view object in place and the
// memoized board is not rebuilt.
export function coalesceRefresh(
  load: () => Promise<string | null>,
  apply: (body: string) => void,
): () => Promise<void> {
  let inFlight: Promise<void> | null = null;
  let trailing = false;
  let lastBody: string | null = null;

  const run = async () => {
    do {
      trailing = false;
      let body: string | null = null;
      try {
        body = await load();
      } catch {
        // Transient; the next ping retries, exactly as the plain fetch did.
        body = null;
      }
      if (body !== null && body !== lastBody) {
        lastBody = body;
        apply(body);
      }
    } while (trailing);
  };

  return () => {
    if (inFlight) {
      // The caller's data lands with the trailing run, which the same
      // promise covers, so awaiting it still means "my refresh is done".
      trailing = true;
      return inFlight;
    }
    inFlight = run().finally(() => {
      inFlight = null;
    });
    return inFlight;
  };
}
