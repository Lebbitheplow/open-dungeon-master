"use client";

import { Loader2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Wizard, type WizardStep } from "@/components/ui/Wizard";
import { GoldTitle } from "@/components/ui/GoldTitle";
import { navigateTo } from "@/lib/navigation";
import type { MaskedConfig } from "@/app/admin/AdminSettingsFields";
import { draftFromConfig, draftStoryIsOpenAi, draftWithScan, type Draft } from "@/app/setup/draft";
import { PicturesStep, VoiceStep } from "@/app/setup/MediaSteps";
import { PlayersStep } from "@/app/setup/PlayersStep";
import { ReadyStep } from "@/app/setup/ReadyStep";
import type { ScanResult } from "@/app/setup/SetupParts";
import { StorytellerStep } from "@/app/setup/StorytellerStep";
import { WelcomeStep } from "@/app/setup/WelcomeStep";
import { YourAgentStep, type MadeConnection } from "@/app/setup/YourAgentStep";
import { storySourceForUrl } from "@/lib/setup/discovery-logic";
import {
  joiningPatch,
  namePatch,
  narrationPatch,
  picturesPatch,
  storyPatch,
  type Patch,
  type StoryChoice,
} from "@/lib/setup/patches";

export type SetupInfo = {
  state: { finishedAt: string; dismissedAt: string };
  deviceWorld: boolean;
  inContainer: boolean;
  lanUrls: string[];
  publicUrl: string;
};

const KEYS = ["welcome", "story", "pictures", "voice", "players", "agent", "ready"] as const;
type StepKey = (typeof KEYS)[number];
const STEP_INDEX = Object.fromEntries(KEYS.map((key, index) => [key, index])) as Record<StepKey, number>;

function storyChoice(draft: Draft): StoryChoice | null {
  if (draft.story === "none") return { kind: "none" };
  if (draft.story === "local") return { kind: "local", baseUrl: draft.local.baseUrl, model: draft.local.model, apiKey: draft.local.apiKey };
  if (draft.story === "key") {
    return { kind: "key", provider: draft.key.provider, baseUrl: draft.key.baseUrl, model: draft.key.model, apiKey: draft.key.apiKey };
  }
  if (draft.story === "agent" && draft.agent.id) {
    return { kind: "agent", id: draft.agent.id, model: draft.agent.model, utilityModel: draft.agent.utilityModel };
  }
  return null;
}

// The guided setup: seven short steps over the same settings the admin panel
// holds. Each step saves when Continue is pressed, so leaving halfway keeps
// everything answered so far and the admin panel shows exactly what was
// chosen. The scan of this computer starts with the page and fills in what
// it finds while the admin reads the first step.
export function SetupWizard({ config: initialConfig, info }: { config: MaskedConfig; info: SetupInfo }) {
  const [config, setConfig] = useState(initialConfig);
  const firstRun = !info.state.finishedAt;
  const [draft, setDraft] = useState<Draft>(() => draftFromConfig(initialConfig, firstRun));
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [scanning, setScanning] = useState(true);
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [made, setMade] = useState<MadeConnection | null>(null);
  // Bumped on each arrival at the last step, which asks the server afresh.
  const [readyVisit, setReadyVisit] = useState(0);
  const update = (change: (current: Draft) => Draft) => {
    setSaveError("");
    setDraft(change);
  };

  // The scan's answer lands in a callback, so the page's opening scan reads
  // as "subscribe to an external system" to React and its effect linter.
  const scanNow = useCallback(
    () =>
      fetch("/api/admin/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "scan" }),
      })
        .then((response) => (response.ok ? (response.json() as Promise<ScanResult>) : null))
        .catch(() => null)
        .then((result) => {
          setScanning(false);
          if (result) {
            setScan(result);
            setDraft((current) => draftWithScan(current, result, draftStoryIsOpenAi(current)));
          }
        }),
    [],
  );

  useEffect(() => {
    void scanNow();
  }, [scanNow]);

  function rescan() {
    setScanning(true);
    void scanNow();
  }

  const storyIsOpenAi = draftStoryIsOpenAi(draft);
  const savedKeyFor = useMemo(() => {
    if (!config.text.hasCustomApiKey) return null;
    const source = storySourceForUrl(config.text.customBaseUrl);
    return source === "local" ? null : source;
  }, [config.text.hasCustomApiKey, config.text.customBaseUrl]);

  async function patch(body: Patch): Promise<boolean> {
    const response = await fetch("/api/admin/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null);
    const data = await response?.json().catch(() => null);
    if (!response?.ok) {
      setSaveError(data?.error || "Could not save. Try again.");
      return false;
    }
    if (data?.config) setConfig(data.config as MaskedConfig);
    return true;
  }

  // What Continue saves for the step being left.
  function patchFor(key: StepKey): Patch | { error: string } | null {
    if (key === "welcome") {
      return draft.serverName.trim() === config.serverName.trim() ? null : namePatch(draft.serverName);
    }
    if (key === "story") {
      const choice = storyChoice(draft);
      if (!choice) return { error: "Choose who tells the story." };
      const built = storyPatch(choice, config.text.customBaseUrl);
      return "error" in built ? built : built.patch;
    }
    if (key === "pictures") {
      if (draft.pictures === "comfyui") return picturesPatch({ kind: "comfyui", url: draft.comfy.url, checkpoint: draft.comfy.checkpoint });
      if (draft.pictures === "openai") return picturesPatch({ kind: "openai", apiKey: draft.picturesKey });
      if (draft.pictures === "agent") return picturesPatch({ kind: "agent" });
      return picturesPatch({ kind: "none" });
    }
    if (key === "voice") {
      if (draft.narration === "kokoro") return narrationPatch({ kind: "kokoro", url: draft.kokoro.url, voice: draft.kokoro.voice });
      if (draft.narration === "openai") return narrationPatch({ kind: "openai", apiKey: draft.narrationKey });
      return narrationPatch({ kind: "off" });
    }
    if (key === "players") {
      return joiningPatch({ signupMode: draft.signupMode, publicUrl: draft.publicUrl });
    }
    return null;
  }

  async function changeStep(next: number) {
    if (next <= step) {
      setSaveError("");
      setStep(next);
      return;
    }
    const body = patchFor(KEYS[step]);
    if (body && "error" in body && typeof body.error === "string") {
      setSaveError(body.error);
      return;
    }
    if (body) {
      setSaving(true);
      const ok = await patch(body as Patch);
      setSaving(false);
      if (!ok) return;
    }
    if (KEYS[next] === "ready") setReadyVisit((visit) => visit + 1);
    setStep(next);
  }

  async function finish() {
    setSaving(true);
    await fetch("/api/admin/setup", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state: "finished" }),
    }).catch(() => null);
    setSaving(false);
    navigateTo("/?new=1");
  }

  // Why Continue is held on a step, said beside the button.
  const storyBlocker =
    draft.story === ""
      ? "Choose who tells the story."
      : draft.story === "local" && !(draft.local.baseUrl.trim() && draft.local.model.trim())
        ? "Pick a model server and a model."
        : draft.story === "key" && !(draft.key.model.trim() && (draft.key.apiKey.trim() || savedKeyFor === draft.key.provider))
          ? "Paste the key, check it, and pick a model."
          : draft.story === "agent" && !draft.agent.id
            ? "Choose a program."
            : null;
  const picturesBlocker =
    draft.pictures === "comfyui" && !draft.comfy.url.trim()
      ? "Type where ComfyUI runs, or choose another answer."
      : draft.pictures === "openai" && !storyIsOpenAi && !draft.picturesKey.trim() && !config.images.hasOpenaiApiKey
        ? "Paste an OpenAI key, or choose another answer."
        : null;
  const voiceBlocker =
    draft.narration === "kokoro" && !draft.kokoro.url.trim()
      ? "Type where Kokoro runs, or choose another answer."
      : draft.narration === "openai" &&
          !storyIsOpenAi &&
          !draft.narrationKey.trim() &&
          !config.speech.hasTtsApiKey &&
          !config.images.hasOpenaiApiKey
        ? "Paste an OpenAI key, or choose another answer."
        : null;

  const address = draft.publicUrl.trim() || info.lanUrls[0] || "";
  const title = (eyebrow: string, text: string, key: StepKey) => (
    <span className="block">
      <span className="eyebrow block text-[10px] text-stone-500">{eyebrow}</span>
      <GoldTitle as="span" size="text-lg sm:text-xl" animate={KEYS[step] === key} className="inline-block">
        {text}
      </GoldTitle>
    </span>
  );

  const steps: Array<WizardStep & { key: StepKey }> = [
    {
      key: "welcome",
      label: "Welcome",
      title: title("Welcome", "Let's get your table ready", "welcome"),
      blurb: "A few questions, a few minutes. Everything here can be changed later in the admin panel.",
      content: <WelcomeStep draft={draft} update={update} scan={scan} scanning={scanning} />,
      continueLabel: "Begin",
    },
    {
      key: "story",
      label: "Storyteller",
      title: title("Step 1", "Who tells the story?", "story"),
      blurb: "The Dungeon Master's voice. The server always rolls the dice and keeps the rules; this only chooses who narrates.",
      content: (
        <StorytellerStep
          draft={draft}
          update={update}
          scan={scan}
          scanning={scanning}
          onRescan={rescan}
          savedKeyFor={savedKeyFor}
          savedKeyBase={config.text.hasCustomApiKey ? config.text.customBaseUrl : ""}
          inContainer={info.inContainer}
        />
      ),
      blocker: storyBlocker,
      canContinue: !storyBlocker,
    },
    {
      key: "pictures",
      label: "Pictures",
      title: title("Step 2", "Should the table have pictures?", "pictures"),
      blurb: "Character portraits, scene art and battle maps. Every table works without them.",
      content: (
        <PicturesStep
          draft={draft}
          update={update}
          scan={scan}
          scanning={scanning}
          storyIsOpenAi={storyIsOpenAi}
          agentPaints={draft.story === "agent" && config.harness.images === "native" && Boolean(config.harness.imagesVerifiedAt)}
          openaiKeySaved={config.images.hasOpenaiApiKey}
        />
      ),
      blocker: picturesBlocker,
      canContinue: !picturesBlocker,
    },
    {
      key: "voice",
      label: "Voice",
      title: title("Step 3", "Should the storyteller speak?", "voice"),
      blurb: "Narration reads each passage aloud; dictation lets players talk instead of type. Both are optional.",
      content: (
        <VoiceStep
          draft={draft}
          update={update}
          scan={scan}
          scanning={scanning}
          storyIsOpenAi={storyIsOpenAi}
          ttsKeySaved={config.speech.hasTtsApiKey || config.images.hasOpenaiApiKey}
        />
      ),
      blocker: voiceBlocker,
      canContinue: !voiceBlocker,
    },
    {
      key: "players",
      label: "Players",
      title: title("Step 4", "How do players get in?", "players"),
      blurb: "The address to send your friends, and who may make an account.",
      content: (
        <PlayersStep draft={draft} update={update} lanUrls={info.lanUrls} />
      ),
    },
    {
      key: "agent",
      label: "Your agent",
      title: title("Step 5", "Bring your own AI agent?", "agent"),
      blurb: "Optional. Connect Claude Code, Codex or opencode to this server over MCP, as you.",
      content: <YourAgentStep made={made} onMade={setMade} />,
      continueLabel: made ? "Continue" : "Skip for now",
    },
    {
      key: "ready",
      label: "Ready",
      title: title("All set", "Your server is ready", "ready"),
      blurb: "Here is what it can do right now. Change any of it here, or later in the admin panel.",
      content: (
        <ReadyStep
          key={readyVisit}
          active={KEYS[step] === "ready"}
          draft={draft}
          address={address}
          agentConnected={Boolean(made)}
          steps={STEP_INDEX}
          onJump={(index) => void changeStep(index)}
        />
      ),
    },
  ];

  return (
    <>
      <button
        type="button"
        aria-label="Leave setup"
        onClick={() => navigateTo("/")}
        className="absolute right-3 top-3 z-10 rounded p-1 text-stone-400 hover:bg-stone-900 sm:right-5 sm:top-5"
      >
        <X className="size-4" />
      </button>
      <Wizard
        title="Server setup"
        variant="diamonds"
        steps={steps.map((entry) =>
          entry.key === KEYS[step] && saving
            ? {
                ...entry,
                continueLabel: (
                  <>
                    <Loader2 className="size-4 animate-spin" /> Saving
                  </>
                ),
              }
            : entry,
        )}
        step={step}
        onStepChange={(next) => void changeStep(next)}
        // A failed save says so above the steps; Continue stays live so
        // the same answer can be sent again.
        notice={saveError ? { message: saveError, onDismiss: () => setSaveError("") } : undefined}
        onDone={() => void finish()}
        doneLabel={
          <>
            {saving ? <Loader2 className="size-4 animate-spin" /> : null}
            Start your first campaign
          </>
        }
        className="[&>header]:pr-9"
      />
    </>
  );
}
