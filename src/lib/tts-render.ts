import { createHash } from "node:crypto";
import { synthesizeSpeech, type TtsBackend } from "@/lib/tts-backend";
import type { SpeechRequest } from "@/lib/tts-segments";

// How a passage's speech requests are run (issue 97). A passage with voices
// is many short requests instead of one long one, so three things keep it
// from costing more time than it used to:
//
//   - requests run a few at a time, across every table at once, and come
//     back to the caller in the order they are heard;
//   - a clip already rendered (the same words, voice and pace on the same
//     server) is not asked for twice, so a retry after one failed line, or a
//     second take after one voice changed, renders only what is missing;
//   - the clips are handed over as they land, so the table can start
//     listening before the last one exists (the live narrations below).
//
// On the Kokoro service this was measured against, a six-line passage took
// 3.4 s one request at a time and 2.3 s two at a time; more than two bought
// nothing, hence the default.

export function speechConcurrency(raw: string | undefined = process.env.TTS_CONCURRENCY): number {
  const asked = Number(raw);
  return Number.isInteger(asked) && asked >= 1 && asked <= 8 ? asked : 2;
}

type Slots = { busy: number; waiting: Array<() => void> };
type Clips = { bytes: number; byKey: Map<string, Buffer>; inFlight: Map<string, Promise<Buffer>> };

export type LiveNarration = {
  campaignId: string;
  chunks: Buffer[];
  state: "open" | "done" | "failed";
  wake: Set<() => void>;
};

declare global {
  var __odmSpeechSlots: Slots | undefined;
  var __odmSpeechClips: Clips | undefined;
  var __odmLiveNarration: Map<string, LiveNarration> | undefined;
}

// First come, first served, so two tables rendering at once take turns
// request by request rather than passage by passage.
async function withSlot<T>(limit: number, work: () => Promise<T>): Promise<T> {
  const slots = (globalThis.__odmSpeechSlots ??= { busy: 0, waiting: [] });
  if (slots.busy >= limit) {
    await new Promise<void>((resolve) => slots.waiting.push(resolve));
  } else {
    slots.busy += 1;
  }
  try {
    return await work();
  } finally {
    const next = slots.waiting.shift();
    if (next) {
      // The slot passes straight to the next in line.
      next();
    } else {
      slots.busy -= 1;
    }
  }
}

const CLIP_CACHE_BYTES = 16 * 1024 * 1024;

function clipKey(request: SpeechRequest, backend: Pick<TtsBackend, "v1" | "model">): string {
  return createHash("sha1")
    .update(`${backend.v1}\n${backend.model}\n${request.voice}\n${request.speed}\n${request.text}`)
    .digest("hex");
}

export type Synthesize = (text: string, voice: string, speed: number, backend: TtsBackend) => Promise<Buffer>;

function renderClip(request: SpeechRequest, backend: TtsBackend, limit: number, synthesize: Synthesize): Promise<Buffer> {
  const clips = (globalThis.__odmSpeechClips ??= { bytes: 0, byKey: new Map(), inFlight: new Map() });
  const key = clipKey(request, backend);
  const kept = clips.byKey.get(key);
  if (kept) {
    // Read again, so it is the last to be dropped.
    clips.byKey.delete(key);
    clips.byKey.set(key, kept);
    return Promise.resolve(kept);
  }
  const running = clips.inFlight.get(key);
  if (running) {
    return running;
  }
  const render = withSlot(limit, () => synthesize(request.text, request.voice, request.speed, backend))
    .then((audio) => {
      clips.byKey.set(key, audio);
      clips.bytes += audio.length;
      for (const [oldest, buffer] of clips.byKey) {
        if (clips.bytes <= CLIP_CACHE_BYTES || oldest === key) {
          break;
        }
        clips.byKey.delete(oldest);
        clips.bytes -= buffer.length;
      }
      return audio;
    })
    .finally(() => {
      clips.inFlight.delete(key);
    });
  clips.inFlight.set(key, render);
  return render;
}

// Every request's audio, in order. `onClip` is called with each clip as soon
// as it and all the clips before it exist. The first failure stops the
// passage: nothing new is started, and the error is the caller's.
export async function renderSpeech(
  requests: SpeechRequest[],
  backend: TtsBackend,
  onClip: (audio: Buffer, index: number) => void = () => undefined,
  options: { concurrency?: number; synthesize?: Synthesize } = {},
): Promise<Buffer[]> {
  const limit = options.concurrency ?? speechConcurrency();
  const synthesize = options.synthesize ?? synthesizeSpeech;
  const settled = requests.map(() => {
    let resolve!: (audio: Buffer) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<Buffer>((yes, no) => {
      resolve = yes;
      reject = no;
    });
    // A clip that fails after the passage already gave up has no one left
    // to tell.
    promise.catch(() => undefined);
    return { promise, resolve, reject };
  });
  let next = 0;
  let failed = false;
  const worker = async () => {
    while (!failed && next < requests.length) {
      const index = next;
      next += 1;
      try {
        settled[index].resolve(await renderClip(requests[index], backend, limit, synthesize));
      } catch (error) {
        failed = true;
        settled[index].reject(error);
      }
    }
  };
  for (let count = 0; count < Math.min(limit, requests.length); count += 1) {
    void worker();
  }
  const clips: Buffer[] = [];
  for (let index = 0; index < requests.length; index += 1) {
    const audio = await settled[index].promise;
    clips.push(audio);
    onClip(audio, index);
  }
  return clips;
}

// Narration still being rendered, by message id. The audio route answers a
// request for a passage found here with the clips so far and then each new
// one as it lands, which is what lets a table hear the first line while the
// last is still being made.
function liveNarrations(): Map<string, LiveNarration> {
  return (globalThis.__odmLiveNarration ??= new Map());
}

export function openLiveNarration(campaignId: string, messageId: string): LiveNarration {
  const live: LiveNarration = { campaignId, chunks: [], state: "open", wake: new Set() };
  liveNarrations().set(messageId, live);
  return live;
}

function wake(live: LiveNarration) {
  const waiting = [...live.wake];
  live.wake.clear();
  for (const resume of waiting) {
    resume();
  }
}

export function pushLiveNarration(live: LiveNarration, audio: Buffer) {
  live.chunks.push(audio);
  wake(live);
}

// Done or failed, the passage stops being live: whoever is already
// listening hears it out (or is cut off), and the next request is answered
// from the file.
export function closeLiveNarration(messageId: string, live: LiveNarration, state: "done" | "failed") {
  live.state = state;
  if (liveNarrations().get(messageId) === live) {
    liveNarrations().delete(messageId);
  }
  wake(live);
}

export function liveNarrationStream(campaignId: string, messageId: string): ReadableStream<Uint8Array> | null {
  const live = liveNarrations().get(messageId);
  if (!live || live.campaignId !== campaignId || live.state !== "open") {
    return null;
  }
  let sent = 0;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      for (;;) {
        if (sent < live.chunks.length) {
          controller.enqueue(new Uint8Array(live.chunks[sent]));
          sent += 1;
          return;
        }
        if (live.state === "done") {
          controller.close();
          return;
        }
        if (live.state === "failed") {
          controller.error(new Error("Narration failed."));
          return;
        }
        await new Promise<void>((resolve) => live.wake.add(resolve));
      }
    },
  });
}
