// Kokoro voices exposed in campaign settings. The service on :8880 accepts
// any installed voice id; this curated list keeps the picker sane.
export const TTS_VOICES = [
  { id: "af_heart", label: "Heart (warm female)" },
  { id: "af_bella", label: "Bella (bright female)" },
  { id: "af_aoede", label: "Aoede (calm female)" },
  { id: "af_nicole", label: "Nicole (soft female)" },
  { id: "am_michael", label: "Michael (warm male)" },
  { id: "am_fenrir", label: "Fenrir (deep male)" },
  { id: "am_puck", label: "Puck (lively male)" },
  { id: "bf_emma", label: "Emma (British female)" },
  { id: "bm_george", label: "George (British male)" },
  { id: "bm_fable", label: "Fable (British narrator)" },
] as const;

export type TtsVoiceId = (typeof TTS_VOICES)[number]["id"];
