"use client";

import { useEffect, useState } from "react";
import { Select, type SelectOption } from "@/components/ui/Select";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { TTS_VOICES } from "@/lib/tts-voices";

// The narrator voice pickers (campaign settings, the campaign creator, the
// cast editor) offer what this server's speech backend really has, asked of
// it once per page (issue 89), and always let a voice be typed: many speech
// servers take blends ("af_heart(30)+af_bella(70)") and described voices that
// no list could hold. Until the server answers, and on a server older than
// the endpoint, the list is the shipped Kokoro one, as it always was.

type Voice = { id: string; label: string };
type VoiceList = { voices: Voice[]; provider: string; defaultVoice: string };

const SHIPPED: VoiceList = {
  voices: TTS_VOICES.map((voice) => ({ id: voice.id, label: voice.label })),
  provider: "kokoro",
  defaultVoice: "af_heart",
};

let cached: VoiceList | null = null;
let inflight: Promise<VoiceList> | null = null;

function loadVoices(): Promise<VoiceList> {
  if (cached) {
    return Promise.resolve(cached);
  }
  inflight ??= fetch("/api/tts/voices", { cache: "no-store" })
    .then((response) => (response.ok ? response.json() : null))
    .then((data: Partial<VoiceList> | null) => {
      cached = data && Array.isArray(data.voices) ? { ...SHIPPED, ...data, voices: data.voices } : SHIPPED;
      return cached;
    })
    .catch(() => SHIPPED)
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

export function useTtsVoices(): VoiceList {
  const [list, setList] = useState<VoiceList>(cached ?? SHIPPED);
  useEffect(() => {
    let live = true;
    void loadVoices().then((next) => {
      if (live) {
        setList(next);
      }
    });
    return () => {
      live = false;
    };
  }, []);
  return list;
}

// The name a voice goes by in a summary line.
export function voiceLabel(list: VoiceList, voice: string): string {
  return list.voices.find((entry) => entry.id === voice)?.label ?? voice;
}

const CUSTOM = "\u0000custom";

export function VoicePicker({
  value,
  onChange,
  label,
  size,
  className,
  // An entry ahead of the voices, for a picker that may also choose none
  // ("The narrator's voice" in the cast editor). Its value is "".
  noneLabel,
}: {
  value: string;
  onChange: (voice: string) => void;
  label: string;
  size?: "sm" | "md";
  className?: string;
  noneLabel?: string;
}) {
  const list = useTtsVoices();
  const listed = list.voices.some((voice) => voice.id === value);
  // Typing is open when asked for, and whenever the saved voice is one the
  // server did not list (a custom one, or a voice from another server).
  const [typing, setTyping] = useState(false);
  const custom = typing || (value !== "" && !listed);
  const [draft, setDraft] = useState(value);
  const [draftFor, setDraftFor] = useState(value);
  // The field follows the saved value when it changes from outside.
  if (draftFor !== value) {
    setDraftFor(value);
    setDraft(value);
  }

  const options: SelectOption<string>[] = [
    ...(noneLabel ? [{ value: "", label: noneLabel }] : []),
    ...list.voices.map((voice) => ({ value: voice.id, label: voice.label })),
    { value: CUSTOM, label: "Custom voice…", hint: "Type any voice this server understands" },
  ];

  function commit() {
    const next = draft.trim().slice(0, 120);
    if (next && next !== value) {
      onChange(next);
    }
  }

  return (
    <span className={cn("inline-flex min-w-0 max-w-full flex-wrap items-center gap-1.5", className)}>
      <Select<string>
        size={size}
        label={label}
        value={custom ? CUSTOM : value}
        onChange={(next) => {
          if (next === CUSTOM) {
            setTyping(true);
            return;
          }
          setTyping(false);
          onChange(next);
        }}
        options={options}
        className="min-w-0 grow"
      />
      {custom ? (
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.currentTarget.blur();
            }
          }}
          maxLength={120}
          aria-label={`${label}: custom voice`}
          placeholder={list.provider === "openai" ? "alloy" : "af_heart(30)+af_bella(70)"}
          className={cn(ui.input, "reveal min-w-0 grow basis-40", size === "sm" && "px-2 py-1 text-xs")}
        />
      ) : null}
    </span>
  );
}
