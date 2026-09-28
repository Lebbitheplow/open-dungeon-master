// The server's side of picking a speech engine for dictation: gathers what
// the pure rule in stt-logic.ts needs (is a Whisper service there, is the
// built-in model installed, is there an OpenAI key) and answers with one
// backend. The voice-chat transcript (src/lib/stt.ts) keeps its own rule:
// it runs only when an operator names STT_URL.

import { configValue, getGlobalConfig } from "@/lib/app-config";
import { probeReachable, sttProbeUrl } from "@/lib/capabilities";
import { openAiSpeechConfig } from "@/lib/openai-images";
import { builtinSpeechInstalled } from "@/lib/stt-builtin";
import { pickSttBackend, whisperSwitchedOff, type SttBackend } from "@/lib/stt-logic";

export function whisperUrl(): string {
  return configValue(getGlobalConfig().speech.sttUrl, "STT_URL", "http://127.0.0.1:8870");
}

export async function currentSttBackend(): Promise<SttBackend> {
  const configured = configValue(getGlobalConfig().speech.sttUrl, "STT_URL");
  const off = whisperSwitchedOff(configured);
  const explicitWhisperUrl = off ? "" : configured;
  return pickSttBackend({
    explicitWhisperUrl,
    whisperReachable: off ? false : explicitWhisperUrl ? true : await probeReachable(sttProbeUrl(whisperUrl())),
    builtinInstalled: builtinSpeechInstalled(),
    openAiKey: openAiSpeechConfig().apiKey,
  });
}
