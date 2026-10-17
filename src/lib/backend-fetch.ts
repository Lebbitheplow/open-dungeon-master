// The guarded fetch every custom text backend goes through, shared by the
// Chat Completions client (src/lib/model-client.ts) and the Responses client
// (src/lib/openai-responses.ts).
//
// SECURITY: a campaign picks its own backend URL, so whatever answers there
// is not trusted, the same reasoning as src/lib/comfyui.ts. A redirect is
// followed only to the same host and only when it keeps the request whole
// (307 or 308, never down to http), so a reverse proxy's https upgrade or a
// moved path still works while an answer cannot steer the server's request
// to another address. Every body is read under a ceiling: a reply is
// kilobytes, a long streamed one a few megabytes.
export const MAX_BACKEND_BODY_BYTES = 16 * 1024 * 1024;
export const MAX_BACKEND_STREAM_BYTES = 64 * 1024 * 1024;
export const MAX_BACKEND_ERROR_BYTES = 64 * 1024;
const MAX_BACKEND_REDIRECTS = 3;

export class BackendRefusal extends Error {}

// A request whose connection dropped before the backend said anything:
// the pooled keep-alive socket was closed by the other side (a local
// llama-server or Ollama idles its connections out, Node's own servers
// after five seconds) in the same instant the request was written to it.
// Nothing was answered, so asking again on a fresh socket is the right
// move; a refusal, a timeout (the caller's signal) or a body that failed
// mid-read is not retried.
const DROPPED_CODES = new Set(["ECONNRESET", "EPIPE", "UND_ERR_SOCKET", "UND_ERR_CONNECT_TIMEOUT"]);

export function connectionDropped(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; current && depth < 4; depth += 1) {
    const { code, message, cause } = current as { code?: unknown; message?: unknown; cause?: unknown };
    if (typeof code === "string" && DROPPED_CODES.has(code)) {
      return true;
    }
    if (typeof message === "string" && /other side closed|socket hang up/i.test(message)) {
      return true;
    }
    current = cause;
  }
  return false;
}

export async function fetchBackend(url: string, init: RequestInit): Promise<Response> {
  let current = new URL(url);
  let retried = false;
  for (let hops = 0; ; hops += 1) {
    let response: Response;
    try {
      response = await fetch(current.href, { ...init, redirect: "manual" });
    } catch (error) {
      if (retried || init.signal?.aborted || !connectionDropped(error)) {
        throw error;
      }
      retried = true;
      hops -= 1;
      continue;
    }
    if (response.status < 300 || response.status >= 400) {
      return response;
    }
    await response.body?.cancel().catch(() => {});
    const location = response.headers.get("location");
    const next = location ? new URL(location, current) : null;
    // The same host and port, or that host's https on its default port.
    const sameServer =
      next !== null &&
      next.hostname === current.hostname &&
      ((next.protocol === current.protocol && next.port === current.port) ||
        (current.protocol === "http:" && next.protocol === "https:" && next.port === ""));
    const followed =
      sameServer && hops < MAX_BACKEND_REDIRECTS && (response.status === 307 || response.status === 308);
    if (!followed) {
      throw new BackendRefusal(
        `The backend at ${url} redirected the request elsewhere, which ODM does not follow. Use the address the server itself answers on.`,
      );
    }
    current = next!;
  }
}

// Up to `max` bytes of the body as text; `complete` is false when there
// was more, which is cancelled unread.
export async function readBody(response: Response, max: number): Promise<{ text: string; complete: boolean }> {
  if (!response.body) {
    return { text: "", complete: true };
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      return { text: Buffer.concat(chunks).toString("utf8"), complete: true };
    }
    total += value.byteLength;
    if (total > max) {
      chunks.push(value.subarray(0, value.byteLength - (total - max)));
      await reader.cancel().catch(() => {});
      return { text: Buffer.concat(chunks).toString("utf8"), complete: false };
    }
    chunks.push(value);
  }
}

// Reads an upstream streaming body line by line with an idle timeout that
// resets on every chunk, so a stalled model server can't hold the turn open
// forever while a slow-but-alive one is given all the time it needs.
// `onChunk` hears every chunk too: the DM queue's watchdog counts a stream
// that is still arriving (reasoning included) as progress
// (src/lib/dm/job-control.ts).
export async function forEachStreamLine(
  upstream: Response,
  idleMs: number,
  onIdleAbort: () => void,
  onLine: (line: string) => void,
  onChunk?: () => void,
) {
  const reader = upstream.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let total = 0;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  const resetIdle = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(onIdleAbort, idleMs);
  };

  resetIdle();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      resetIdle();
      onChunk?.();
      total += value.byteLength;
      if (total > MAX_BACKEND_STREAM_BYTES) {
        await reader.cancel().catch(() => {});
        throw new BackendRefusal("The backend streamed far more than any reply, so the stream was cut off.");
      }
      buffer += decoder.decode(value, { stream: true });
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line) {
          onLine(line);
        }
        newline = buffer.indexOf("\n");
      }
    }
    buffer += decoder.decode();
    const rest = buffer.trim();
    if (rest) {
      onLine(rest);
    }
  } catch (error) {
    // A consumer can stop a harmful stream while this reader still owns it.
    // Cancel before unwinding so buffered frames and the upstream body are not
    // left running after the callback rejects them.
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    clearTimeout(idleTimer);
  }
}
