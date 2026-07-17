import { isErrorResponse, requireMember } from "@/lib/campaign-api";
import { listEventsSince, sseChunk, subscribe } from "@/lib/events";

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

      // Replay persisted events missed while disconnected, then go live.
      for (const event of listEventsSince(campaignId, lastSeq)) {
        send(sseChunk(event.type, event.payload, event.seq));
      }

      const unsubscribe = subscribe(campaignId, send);
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
