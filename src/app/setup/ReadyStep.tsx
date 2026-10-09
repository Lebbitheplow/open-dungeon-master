"use client";

import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { ui } from "@/lib/ui";
import { BackendProbe } from "@/app/admin/BackendProbe";
import { HarnessTestPanel } from "@/app/admin/HarnessTestPanel";
import type { Capabilities } from "@/lib/capabilities";
import type { Draft } from "@/app/setup/draft";
import { Lamp, type Tone } from "@/app/setup/SetupParts";

type Row = { key: string; title: string; tone: Tone; text: string; step: number };

const SIGNUPS: Record<Draft["signupMode"], string> = {
  invite: "Accounts by invite code",
  open: "Anyone with the address can make an account",
  closed: "No new accounts",
};

const STT_WORDS: Record<string, string> = {
  whisper: "Dictation by the Whisper server",
  builtin: "Dictation by the built-in engine",
  openai: "Dictation by OpenAI, on the key",
};

function rows(input: {
  draft: Draft;
  caps: Capabilities | null;
  address: string;
  agentConnected: boolean;
  steps: Record<string, number>;
}): Row[] {
  const { draft, caps, steps } = input;
  const wait = !caps;
  const story: Row =
    draft.story === "none"
      ? { key: "story", title: "Storyteller", tone: "off", text: "A person narrates. No AI storyteller.", step: steps.story }
      : wait
        ? { key: "story", title: "Storyteller", tone: "wait", text: "Asking the storyteller…", step: steps.story }
        : caps.story.configured && caps.story.reachable
          ? { key: "story", title: "Storyteller", tone: "ok", text: `Answering${caps.story.model ? ` · ${caps.story.model}` : ""}`, step: steps.story }
          : {
              key: "story",
              title: "Storyteller",
              tone: "bad",
              text:
                draft.story === "agent"
                  ? "Saved, but the program is not ready: install it or sign it in, then check again."
                  : "Saved, but not answering yet: start the model server, then check again.",
              step: steps.story,
            };
  const pictures: Row =
    draft.pictures === "none"
      ? { key: "pictures", title: "Pictures", tone: "off", text: "Painted placeholders", step: steps.pictures }
      : wait
        ? { key: "pictures", title: "Pictures", tone: "wait", text: "Asking…", step: steps.pictures }
        : caps.images.configured && caps.images.reachable
          ? { key: "pictures", title: "Pictures", tone: "ok", text: draft.pictures === "comfyui" ? "ComfyUI paints them" : draft.pictures === "openai" ? "OpenAI paints them, on the key" : "The agent paints them", step: steps.pictures }
          : { key: "pictures", title: "Pictures", tone: "warn", text: "Saved, but not answering yet. Tables use placeholders until it does.", step: steps.pictures };
  const narration: Row =
    draft.narration === "off"
      ? { key: "narration", title: "Narration", tone: "off", text: "Text only", step: steps.voice }
      : wait
        ? { key: "narration", title: "Narration", tone: "wait", text: "Asking…", step: steps.voice }
        : caps.tts.configured && caps.tts.reachable
          ? { key: "narration", title: "Narration", tone: "ok", text: draft.narration === "kokoro" ? "Kokoro reads it aloud" : "OpenAI reads it aloud, on the key", step: steps.voice }
          : { key: "narration", title: "Narration", tone: "warn", text: "Saved, but not answering yet.", step: steps.voice };
  const dictation: Row = wait
    ? { key: "dictation", title: "Dictation", tone: "wait", text: "Asking…", step: steps.voice }
    : caps.stt.configured
      ? { key: "dictation", title: "Dictation", tone: "ok", text: STT_WORDS[caps.stt.backend] ?? "Ready", step: steps.voice }
      : { key: "dictation", title: "Dictation", tone: "off", text: "Off. The Voice step can download the built-in engine.", step: steps.voice };
  const players: Row = {
    key: "players",
    title: "Players",
    tone: "ok",
    text: `${SIGNUPS[draft.signupMode]}${input.address ? ` · ${input.address}` : ""}`,
    step: steps.players,
  };
  const agent: Row = input.agentConnected
    ? { key: "agent", title: "Your agent", tone: "ok", text: "Connection made", step: steps.agent }
    : { key: "agent", title: "Your agent", tone: "off", text: "Not connected (optional)", step: steps.agent };
  return [story, pictures, narration, dictation, players, agent];
}

// The last step: what the server can do now, asked live, each line with a
// way back to the step that sets it, and one real test of the storyteller.
export function ReadyStep({
  active,
  draft,
  address,
  agentConnected,
  steps,
  onJump,
}: {
  active: boolean;
  draft: Draft;
  address: string;
  agentConnected: boolean;
  steps: Record<string, number>;
  onJump: (step: number) => void;
}) {
  const [caps, setCaps] = useState<Capabilities | null>(null);
  const [checking, setChecking] = useState(false);

  const ask = useCallback(
    () =>
      fetch("/api/capabilities")
        .then((response) => (response.ok ? response.json() : null))
        .catch(() => null)
        .then((data) => {
          setCaps(data as Capabilities | null);
          setChecking(false);
        }),
    [],
  );

  // Asked on each arrival (the wizard remounts this step with a new key):
  // the steps before it have just saved.
  useEffect(() => {
    if (active) void ask();
  }, [active, ask]);

  function check() {
    setChecking(true);
    setCaps(null);
    void ask();
  }

  const list = rows({ draft, caps, address, agentConnected, steps });
  const agentPaints = draft.agent.id === "codex" || draft.agent.id === "grok";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-stone-400">What this server can do now</span>
        <button type="button" className={ui.btnSmall} onClick={check} disabled={checking} aria-busy={checking}>
          <RefreshCw className={checking ? "size-3.5 animate-spin" : "size-3.5"} /> Check again
        </button>
      </div>
      <ul className="stagger space-y-2" aria-live="polite">
        {list.map((row) => (
          <li key={row.key} className="su-row">
            <Lamp tone={row.tone} />
            <span className="min-w-0 flex-1">
              <span className="block text-sm text-stone-100">{row.title}</span>
              <span key={row.text} className="live-in block text-xs text-stone-400">
                {row.text}
              </span>
            </span>
            <button type="button" className={ui.btnSmall} onClick={() => onJump(row.step)}>
              Change
            </button>
          </li>
        ))}
      </ul>

      {draft.story === "local" || draft.story === "key" ? (
        <div className="su-row flex-col items-stretch">
          <span className="text-sm text-stone-200">Try the storyteller the way a table will</span>
          <BackendProbe which="story" baseUrl="" model="" />
        </div>
      ) : draft.story === "agent" && draft.agent.id ? (
        <div className="su-row flex-col items-stretch">
          <span className="text-sm text-stone-200">Try the agent with one tiny real turn</span>
          <HarnessTestPanel saved paints={agentPaints} picturesVerified={false} onVerified={check} />
        </div>
      ) : null}
    </div>
  );
}
