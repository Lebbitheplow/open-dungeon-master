// Which engine writes down what a player or the DM says. Pure, so the
// capabilities probe, the /api/stt route and the tests all read the same
// order:
//
//   1. A Whisper service: an address set in the admin panel or STT_URL, or
//      the default odm-stt address answering. The best words and free.
//   2. The built-in engine, once an admin has installed its model: Whisper
//      inside this server on the CPU, for app-hosted worlds and servers
//      without the sidecar. Free and offline, a little slower.
//   3. OpenAI's transcription API, when this server holds an OpenAI key.
//      Billed to the key's owner, so it only answers when nothing free can.
//
// None of them: the server has no ears, and the button hides (or hands the
// job to the device, when an app offers its own recognizer).

export type SttBackend = "whisper" | "builtin" | "openai" | "none";

// STT_URL=off (or the admin field set to "off") says this server has no
// Whisper service, so nothing probes the default address: for a machine
// with something else on :8870, or an owner who wants the built-in engine.
export function whisperSwitchedOff(value: string): boolean {
  return value.trim().toLowerCase() === "off";
}

export function pickSttBackend(input: {
  explicitWhisperUrl: string;
  whisperReachable: boolean;
  builtinInstalled: boolean;
  openAiKey: string;
}): SttBackend {
  if (input.explicitWhisperUrl.trim() || input.whisperReachable) {
    return "whisper";
  }
  if (input.builtinInstalled) {
    return "builtin";
  }
  if (input.openAiKey.trim()) {
    return "openai";
  }
  return "none";
}

// The built-in engine reads 16 kHz WAV; the others take the recorder's Opus.
export function sttWantsWav(backend: SttBackend): boolean {
  return backend === "builtin";
}
