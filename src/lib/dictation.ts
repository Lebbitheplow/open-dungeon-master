// Speaking instead of typing: the rules the dictation button follows, kept
// free of the browser so a test can hold them still.
//
// One take is one recording sent whole to /api/stt. Ten minutes is the cap:
// the Whisper service here turns five minutes of speech around in under
// thirty seconds, so a full take still lands well inside the hundred seconds
// a Cloudflare tunnel will wait for an answer.

export const DICTATION_MAX_MS = 10 * 60_000;
// When the timer starts warning that the take is about to close itself.
export const DICTATION_WARN_MS = DICTATION_MAX_MS - 30_000;
// Speech needs far less than the recorder's music default. At 32 kbps a
// full ten-minute take is about 2.4 MB, well under the route's 8 MB limit.
export const DICTATION_BITRATE = 32_000;
// Anything smaller is a tap with nothing said, not worth a round trip.
export const DICTATION_MIN_BYTES = 2_000;

// Adds what was said to what is already written. A new line in the field
// is kept as the join; otherwise one space. Never longer than the field's
// own limit, because a value set from code slips past maxLength.
export function appendDictation(current: string, spoken: string, maxLength?: number): string {
  const said = spoken.trim();
  if (!said) {
    return current;
  }
  const kept = current.replace(/[ \t]+$/, "");
  const joined = !kept.trim() ? said : kept.endsWith("\n") ? `${kept}${said}` : `${kept} ${said}`;
  return maxLength && maxLength > 0 ? joined.slice(0, maxLength) : joined;
}

// 0:07, 4:32, 10:00.
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

// The first container this recorder can write: Opus in WebM on Chromium and
// Firefox (the Android WebView and Electron included), MP4 on Safari. ""
// lets the browser choose. Whisper's decoder reads all of them.
const RECORDER_TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];

export function pickRecorderType(isSupported: (type: string) => boolean): string {
  for (const type of RECORDER_TYPES) {
    try {
      if (isSupported(type)) {
        return type;
      }
    } catch {
      // A browser that throws on the query answers no.
    }
  }
  return "";
}

export function dictationFileName(type: string): string {
  if (type.startsWith("audio/mp4")) {
    return "speech.m4a";
  }
  if (type.startsWith("audio/ogg")) {
    return "speech.ogg";
  }
  return "speech.webm";
}

// How loud the room is right now, 0 to 1, from one frame of an analyser's
// byte waveform (128 is silence). Speech sits around 0.3 to 0.7.
export function levelFromWaveform(samples: ArrayLike<number>): number {
  if (!samples.length) {
    return 0;
  }
  let sum = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const centred = (samples[index] - 128) / 128;
    sum += centred * centred;
  }
  const rms = Math.sqrt(sum / samples.length);
  return Math.min(1, rms * 4);
}

// How this page gets words from a take. The server listens when it can:
// "upload" sends the recording as it is, "upload-wav" sends 16 kHz WAV for
// the built-in engine. Only when the server has no speech-to-text does the
// device's own recognizer ("native", an app shell's) take over. "none"
// hides the button. Capabilities not known yet read as "upload", which is
// what every server before the built-in engine understood.
export type DictationEngine = "upload" | "upload-wav" | "native" | "none";

export function pickDictationEngine(
  stt: { configured: boolean; wantsWav?: boolean } | null | undefined,
  hasNative: boolean,
): DictationEngine {
  if (!stt) {
    return "upload";
  }
  if (stt.configured) {
    return stt.wantsWav ? "upload-wav" : "upload";
  }
  return hasNative ? "native" : "none";
}
