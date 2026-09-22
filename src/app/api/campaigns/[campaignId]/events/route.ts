import { isErrorResponse, requireMember } from "@/lib/campaign-api";
import { forEachEventSince, sseChunk, subscribe } from "@/lib/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEARTBEAT_MS = 20_000;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }

  // Catch-up point: EventSource sends Last-Event-ID on auto-reconnect; the
  // first connect passes ?lastSeq= from the snapshot fetch.
  const url = new URL(request.url);
  const lastEventId = request.headers.get("last-event-id");
  const lastSeq = Number(lastEventId ?? url.searchParams.get("lastSeq") ?? 0) || 0;

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const send = (chunk: string) => {
        if (closed) {
          return;
        }
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          cleanup();
        }
      };

      // Replay every persisted event missed while disconnected, batch after
      // batch until none are left, then go live. Stopping at one batch left
      // a gap after a long absence that the client's seq guard (which only
      // rejects duplicates) could not see.
      forEachEventSince(campaignId, lastSeq, (event) => {
        send(sseChunk(event.type, event.payload, event.seq));
      });

      // The member's id rides along so the bus can keep the campaign's
      // online set and announce joins and leaves (presence ephemeral).
      const unsubscribe = subscribe(campaignId, send, context.user.id);
      const heartbeat = setInterval(() => send(": ping\n\n"), HEARTBEAT_MS);

      const cleanup = () => {
        if (closed) {
          return;
        }
        closed = true;
        clearInterval(heartbeat);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // already closed
        }
      };

      request.signal.addEventListener("abort", cleanup);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
