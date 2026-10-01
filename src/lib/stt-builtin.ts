// The built-in speech engine: Whisper running inside this server through
// @huggingface/transformers, the same ONNX runtime story memory uses. For
// worlds with no Whisper service beside them, above all the ones the desktop
// app hosts, which have nothing to talk to but themselves.
//
// Nothing downloads until an admin asks: POST /api/admin/speech (the admin
// panel's Speech section, or the desktop app's Local AI screen) fetches the
// model into models/speech with progress, and from then on dictation uses it
// whenever no Whisper service answers. Whisper base at 8-bit weights is
// 76 MB and multilingual; on a desktop CPU it writes down five minutes of
// speech in well under a minute. Transcriptions run one at a time, like the
// embedder, so two DMs dictating at once queue rather than fight for cores.

import { existsSync } from "node:fs";
import path from "node:path";
import { serverEnv } from "./server-env.ts";

export const BUILTIN_STT_MODEL = serverEnv("STT_BUILTIN_MODEL", "onnx-community/whisper-base").trim();
const DTYPE = "q8";
// Whisper base hears many languages, but transformers.js assumes English
// unless told otherwise. A table that plays in Italian sets
// STT_LANGUAGE=italian (Whisper's language names or codes both work).
const LANGUAGE = serverEnv("STT_LANGUAGE", "").trim().toLowerCase();
// Roughly what the install pulls, for the button that offers it.
export const BUILTIN_STT_DOWNLOAD_MB = 76;

// What transformers.js needs on disk for this model at q8. The model is
// "installed" once all of them are there; a half-finished download is not.
const REQUIRED_FILES = [
  "config.json",
  "generation_config.json",
  "preprocessor_config.json",
  "tokenizer.json",
  "tokenizer_config.json",
  "onnx/encoder_model_quantized.onnx",
  "onnx/decoder_model_merged_quantized.onnx",
];

export function speechCacheDir(): string {
  return path.join(process.cwd(), "models", "speech");
}

export function builtinSpeechInstalled(): boolean {
  const root = path.join(speechCacheDir(), BUILTIN_STT_MODEL);
  return REQUIRED_FILES.every((file) => existsSync(path.join(root, file)));
}

type Transcriber = (
  audio: Float32Array,
  options: { chunk_length_s: number; stride_length_s: number; language?: string; task?: string },
) => Promise<{ text: string } | Array<{ text: string }>>;

type InstallState = {
  status: "idle" | "installing" | "ready" | "error";
  // Bytes across every file, as transformers.js reports them.
  files: Record<string, { loaded: number; total: number }>;
  error: string;
};

declare global {
  var __odmSpeechPipe: Promise<Transcriber> | undefined;
  var __odmSpeechQueue: Promise<unknown> | undefined;
  var __odmSpeechInstall: InstallState | undefined;
}

function installState(): InstallState {
  return (globalThis.__odmSpeechInstall ??= { status: "idle", files: {}, error: "" });
}

type ProgressEvent = { status?: string; file?: string; loaded?: number; total?: number };

async function loadTranscriber(onProgress?: (event: ProgressEvent) => void): Promise<Transcriber> {
  const { pipeline } = await import("@huggingface/transformers");
  // cache_dir per call rather than env.cacheDir: the embedder sets the
  // shared env for its own folder, and the two must not trade places.
  const pipe = await pipeline("automatic-speech-recognition", BUILTIN_STT_MODEL, {
    dtype: DTYPE,
    cache_dir: speechCacheDir(),
    progress_callback: onProgress,
  });
  return pipe as unknown as Transcriber;
}

function transcriber(): Promise<Transcriber> {
  const loading = (globalThis.__odmSpeechPipe ??= loadTranscriber());
  // A failed load is not cached, so the next attempt tries again.
  loading.catch(() => {
    if (globalThis.__odmSpeechPipe === loading) {
      globalThis.__odmSpeechPipe = undefined;
    }
  });
  return loading;
}

export type BuiltinSpeechStatus = {
  model: string;
  downloadMb: number;
  installed: boolean;
  status: InstallState["status"];
  // 0 to 1 while installing.
  progress: number;
  error: string;
};

export function builtinSpeechStatus(): BuiltinSpeechStatus {
  const state = installState();
  const files = Object.values(state.files);
  const total = files.reduce((sum, file) => sum + file.total, 0);
  const loaded = files.reduce((sum, file) => sum + Math.min(file.loaded, file.total), 0);
  const installed = builtinSpeechInstalled();
  return {
    model: BUILTIN_STT_MODEL,
    downloadMb: BUILTIN_STT_DOWNLOAD_MB,
    installed,
    status: state.status === "idle" && installed ? "ready" : state.status,
    progress: state.status === "installing" ? (total ? loaded / total : 0) : installed ? 1 : 0,
    error: state.error,
  };
}

// Starts the download (or finds it already done) and returns at once; the
// status above reports how far it has got.
export function installBuiltinSpeech(): BuiltinSpeechStatus {
  const state = installState();
  if (state.status === "installing") {
    return builtinSpeechStatus();
  }
  state.status = "installing";
  state.files = {};
  state.error = "";
  const loading = loadTranscriber((event) => {
    if (event.status === "progress" && event.file && event.total) {
      state.files[event.file] = { loaded: event.loaded ?? 0, total: event.total };
    }
  });
  globalThis.__odmSpeechPipe = loading;
  loading.then(
    () => {
      state.status = "ready";
    },
    (error: unknown) => {
      globalThis.__odmSpeechPipe = undefined;
      state.status = "error";
      state.error = error instanceof Error ? error.message : String(error);
      console.error("[speech] built-in install failed", error);
    },
  );
  return builtinSpeechStatus();
}

// Words from 16 kHz mono samples. Serialized across the whole server.
export async function transcribeBuiltin(samples: Float32Array): Promise<string> {
  const run = async () => {
    const pipe = await transcriber();
    const output = await pipe(samples, {
      chunk_length_s: 30,
      stride_length_s: 5,
      ...(LANGUAGE ? { language: LANGUAGE, task: "transcribe" } : {}),
    });
    const parts = Array.isArray(output) ? output : [output];
    return parts.map((part) => part.text).join(" ").replace(/\s+/g, " ").trim();
  };
  const queued = (globalThis.__odmSpeechQueue ?? Promise.resolve()).then(run, run);
  globalThis.__odmSpeechQueue = queued.catch(() => undefined);
  return queued;
}
