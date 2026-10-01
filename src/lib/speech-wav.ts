// 16 kHz mono PCM WAV, the one audio shape the built-in speech engine reads.
// The browser records Opus, decodes it with Web Audio and sends this; the
// server reads it back into samples without ffmpeg. Pure, so the browser,
// the route and the tests share it.

export const SPEECH_SAMPLE_RATE = 16_000;
// One upload's worth. Two minutes of 16-bit mono at 16 kHz is 3.8 MB, well
// inside /api/stt's 8 MB, and a ten-minute take goes up as five of them.
export const SPEECH_CHUNK_SECONDS = 120;
// How far back from a chunk's end to look for a pause to cut at, so a word
// is not split between two uploads.
const CUT_SEARCH_SECONDS = 8;
const CUT_WINDOW_SECONDS = 0.1;

export function encodeWav(samples: Float32Array, sampleRate = SPEECH_SAMPLE_RATE): Uint8Array {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const text = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index));
    }
  };
  text(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (let index = 0; index < samples.length; index += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[index]));
    view.setInt16(44 + index * 2, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
  }
  return bytes;
}

// Reads 16-bit PCM or 32-bit float WAV, any channel count (mixed to mono).
// null for anything else, so the route can say what it wanted.
export function decodeWav(input: Uint8Array): { sampleRate: number; samples: Float32Array } | null {
  if (input.length < 44) {
    return null;
  }
  const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
  const tag = (offset: number) => String.fromCharCode(...input.subarray(offset, offset + 4));
  if (tag(0) !== "RIFF" || tag(8) !== "WAVE") {
    return null;
  }
  let format = 0;
  let channels = 0;
  let sampleRate = 0;
  let bits = 0;
  let offset = 12;
  while (offset + 8 <= input.length) {
    const id = tag(offset);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (id === "fmt ") {
      format = view.getUint16(body, true);
      channels = view.getUint16(body + 2, true);
      sampleRate = view.getUint32(body + 4, true);
      bits = view.getUint16(body + 14, true);
    } else if (id === "data") {
      const pcm = format === 1 && bits === 16;
      const float = format === 3 && bits === 32;
      if ((!pcm && !float) || channels < 1 || !sampleRate) {
        return null;
      }
      const width = bits / 8;
      const end = Math.min(input.length, body + size);
      const frames = Math.floor((end - body) / (width * channels));
      const samples = new Float32Array(frames);
      for (let frame = 0; frame < frames; frame += 1) {
        let sum = 0;
        for (let channel = 0; channel < channels; channel += 1) {
          const at = body + (frame * channels + channel) * width;
          sum += pcm ? view.getInt16(at, true) / 0x8000 : view.getFloat32(at, true);
        }
        samples[frame] = sum / channels;
      }
      return { sampleRate, samples };
    }
    offset = body + size + (size % 2);
  }
  return null;
}

// Cuts a long take into uploads no longer than maxSeconds, each cut placed
// at the quietest tenth of a second in the last few seconds before the limit.
export function splitForUpload(
  samples: Float32Array,
  sampleRate = SPEECH_SAMPLE_RATE,
  maxSeconds = SPEECH_CHUNK_SECONDS,
): Float32Array[] {
  const limit = Math.floor(maxSeconds * sampleRate);
  if (samples.length <= limit) {
    return [samples];
  }
  const window = Math.max(1, Math.floor(CUT_WINDOW_SECONDS * sampleRate));
  const search = Math.min(limit - window, Math.floor(CUT_SEARCH_SECONDS * sampleRate));
  const chunks: Float32Array[] = [];
  let start = 0;
  while (samples.length - start > limit) {
    let cut = start + limit;
    let quietest = Infinity;
    for (let end = start + limit; end - window >= start + limit - search; end -= window) {
      let energy = 0;
      for (let index = end - window; index < end; index += 1) {
        energy += samples[index] * samples[index];
      }
      if (energy < quietest) {
        quietest = energy;
        cut = end - Math.floor(window / 2);
      }
    }
    chunks.push(samples.subarray(start, cut));
    start = cut;
  }
  chunks.push(samples.subarray(start));
  return chunks;
}
