"use client";

import { Check, Loader2, X, Zap } from "lucide-react";
import { useRef, useState } from "react";
import { registerOutput, releaseOutput } from "@/lib/audio-devices";
import { ui } from "@/lib/ui";
import { PageSection } from "@/components/PageShell";
import { BuiltinSpeechCard } from "@/app/admin/BuiltinSpeechCard";
import {
  Field,
  SECRET_KEPT,
  SecretField,
  SelectField,
  type EnvDefaults,
  type MaskedConfig,
} from "@/app/admin/AdminSettingsFields";

// Narration and speech-to-text. Named "Speech" so it is not confused with the
// Voice chat section, which is a different feature.
//
// Narration is set up the way the text model is (issue 89): pick the kind of
// server, then its address, model and key appear, and a test speaks a line
// through exactly what is typed. The paragraph under the picker says where a
// passage's text goes, because "Narration: on" in a campaign says nothing
// about that.

type Speech = MaskedConfig["speech"];
type Provider = Speech["ttsProvider"];

type TestResult = {
  ok: boolean;
  endpoint?: string;
  model?: string;
  voice?: string;
  voices?: number;
  audio?: string;
  error?: string;
};

function host(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export function AdminSpeechSection({
  speech,
  env,
  apiKey,
  onSpeech,
  onApiKey,
}: {
  speech: Speech;
  env: EnvDefaults;
  // SECRET_KEPT until a new key is typed.
  apiKey: string;
  onSpeech: (speech: Speech) => void;
  onApiKey: (value: string) => void;
}) {
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // What "Auto" means on this server right now.
  const envProvider: Exclude<Provider, ""> =
    env.ttsProvider === "openai" || env.ttsProvider === "off" ? env.ttsProvider : "kokoro";
  const provider = speech.ttsProvider || envProvider;
  const set = (patch: Partial<Speech>) => {
    setResult(null);
    onSpeech({ ...speech, ...patch });
  };

  const kokoroAt = speech.kokoroUrl.trim() || env.kokoroUrl;
  const openaiAt = speech.ttsBaseUrl.trim() || env.ttsBaseUrl || "https://api.openai.com/v1";
  const official = host(openaiAt) === "api.openai.com";

  async function test() {
    setTesting(true);
    setResult(null);
    audioRef.current?.pause();
    try {
      const response = await fetch("/api/admin/tts-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider,
          kokoroUrl: speech.kokoroUrl,
          baseUrl: speech.ttsBaseUrl,
          model: speech.ttsModel,
          apiKey: apiKey === SECRET_KEPT ? "" : apiKey,
          voice: speech.ttsVoice,
        }),
      });
      const data = (await response.json().catch(() => null)) as TestResult | null;
      setResult(data ?? { ok: false, error: "The test request failed without an answer." });
      if (data?.ok && data.audio) {
        if (audioRef.current) {
          releaseOutput(audioRef.current);
        }
        const audio = registerOutput(new Audio(data.audio));
        audioRef.current = audio;
        audio.onended = () => releaseOutput(audio);
        void audio.play().catch(() => {});
      }
    } catch {
      setResult({ ok: false, error: "Could not reach this server." });
    } finally {
      setTesting(false);
    }
  }

  return (
    <PageSection id="admin-speech" heading="Speech" glyph="tab-ambience">
      <h3 className="mb-1 text-sm font-medium text-stone-200">Narration (text to speech)</h3>
      <p className="mb-3 text-xs text-stone-500">
        Reads each of the storyteller&apos;s passages aloud in campaigns that switch Narration on.
        Campaigns only choose a voice; where the text is sent is decided here, for all of them.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField<Provider>
          label="Narration server"
          value={speech.ttsProvider}
          onChange={(ttsProvider) => set({ ttsProvider })}
          options={[
            {
              value: "",
              label: `Auto (${envProvider === "openai" ? "OpenAI-compatible" : envProvider === "off" ? "off" : "Kokoro"})`,
            },
            { value: "kokoro", label: "Kokoro-FastAPI (local)" },
            { value: "openai", label: "OpenAI-compatible server" },
            { value: "off", label: "Off: no narration on this server" },
          ]}
        />
        {provider === "kokoro" ? (
          <Field label="Kokoro server URL" hint={`Blank uses ${env.kokoroUrl}.`}>
            <input
              className={ui.input}
              value={speech.kokoroUrl}
              onChange={(event) => set({ kokoroUrl: event.target.value })}
              placeholder={env.kokoroUrl}
            />
          </Field>
        ) : null}
        {provider === "openai" ? (
          <>
            <Field
              label="Server base URL"
              hint={
                env.ttsBaseUrl
                  ? `Env: ${env.ttsBaseUrl}`
                  : "Any server with OpenAI's /v1/audio/speech. Blank = api.openai.com."
              }
            >
              <input
                className={ui.input}
                value={speech.ttsBaseUrl}
                onChange={(event) => set({ ttsBaseUrl: event.target.value })}
                placeholder={env.ttsBaseUrl || "https://api.openai.com/v1"}
              />
            </Field>
            <Field
              label="Model name"
              hint={env.ttsModel ? `Env: ${env.ttsModel}` : official ? "Blank = gpt-4o-mini-tts." : "The model name your server expects. Blank = tts-1."}
            >
              <input
                className={ui.input}
                value={speech.ttsModel}
                onChange={(event) => set({ ttsModel: event.target.value })}
                placeholder={env.ttsModel || (official ? "gpt-4o-mini-tts" : "tts-1")}
              />
            </Field>
            <SecretField
              label="API key"
              isSet={speech.hasTtsApiKey}
              value={apiKey}
              onChange={(value) => {
                setResult(null);
                onApiKey(value);
              }}
              hint={
                env.hasTtsApiKey
                  ? "An env-var key is also set; this one wins when filled."
                  : official
                    ? "Blank uses the OpenAI key already saved for pictures, if there is one. Billed to whoever owns the key."
                    : "Most local servers need none."
              }
            />
          </>
        ) : null}
        {provider === "off" ? null : (
          <Field
            label="Default voice"
            hint={
              provider === "openai"
                ? `Used for the test, and whenever a campaign asks for a voice this server does not have. Blank = ${official ? "alloy" : "the first voice the server lists"}.`
                : "Used for the test. Blank = af_heart. Campaigns pick their own from the server's list, or type one."
            }
          >
            <input
              className={ui.input}
              value={speech.ttsVoice}
              maxLength={120}
              onChange={(event) => set({ ttsVoice: event.target.value })}
              placeholder={provider === "openai" ? (official ? "alloy" : "") : "af_heart"}
            />
          </Field>
        )}
      </div>
      <p className="mt-3 text-xs leading-5 text-stone-400">
        {provider === "off"
          ? "No passage is read aloud and no text is sent anywhere. Campaigns that have Narration on are told it is off here."
          : provider === "kokoro"
            ? `Each passage is sent as text to the Kokoro server at ${host(kokoroAt)} and comes back as audio. It is not sent to the text model's server or anywhere else.`
            : `Each passage is sent as text to ${host(openaiAt)} and comes back as audio${official ? ", billed to the API key" : ""}. It is not sent to the text model's server or anywhere else.`}
      </p>
      {provider === "off" ? null : (
        <div className="mt-3">
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={test} disabled={testing} aria-busy={testing} className={ui.btnSmall}>
              {testing ? <Loader2 className="size-4 animate-spin" /> : <Zap className="size-4" />}
              Test narration
            </button>
            <span className="text-xs text-stone-500">
              Speaks one line through the settings as typed, saved or not, and plays it here.
            </span>
          </div>
          {testing ? (
            <p role="status" className="live-in mt-2 text-sm text-stone-400">
              Asking the speech server for a line…
            </p>
          ) : null}
          {result?.ok ? (
            <p role="status" className="live-in mt-2 flex flex-wrap items-center gap-1 text-sm text-emerald-400">
              <Check className="size-4" /> Spoken by {result.model} in the voice {result.voice}.
              {result.voices ? ` The server lists ${result.voices} voices for campaigns to pick from.` : " The server lists no voices of its own, so campaigns type one."}
            </p>
          ) : result ? (
            <p role="alert" className="motion-shake mt-2 flex items-start gap-1 text-sm text-red-400">
              <X className="mt-0.5 size-4 shrink-0" /> {result.error || "The speech server did not answer."}
            </p>
          ) : null}
          {result && !result.ok && result.endpoint ? (
            <p className="mt-1 break-all text-xs text-stone-500">Tried {result.endpoint}</p>
          ) : null}
        </div>
      )}

      <h3 className="mb-1 mt-6 text-sm font-medium text-stone-200">Dictation (speech to text)</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Whisper STT URL" hint={`Env: ${env.sttUrl}. Type off when this server has no Whisper service.`}>
          <input
            className={ui.input}
            value={speech.sttUrl}
            onChange={(event) => onSpeech({ ...speech, sttUrl: event.target.value })}
            placeholder={env.sttUrl}
          />
        </Field>
        <BuiltinSpeechCard />
      </div>
    </PageSection>
  );
}
