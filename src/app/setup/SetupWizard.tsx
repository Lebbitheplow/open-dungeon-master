"use client";

import { Loader2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Wizard, type WizardStep } from "@/components/ui/Wizard";
import { GoldTitle } from "@/components/ui/GoldTitle";
import { navigateTo } from "@/lib/navigation";
import type { EnvDefaults, MaskedConfig } from "@/app/admin/AdminSettingsFields";
import { draftFromConfig, draftStoryIsOpenAi, draftWithScan, picturesBlocker as picturesStepBlocker, type Draft } from "@/app/setup/draft";
import { PicturesStep, VoiceStep, withNarration, withPictures } from "@/app/setup/MediaSteps";
import { PlayersStep } from "@/app/setup/PlayersStep";
import { ReadyStep } from "@/app/setup/ReadyStep";
import type { ScanResult } from "@/app/setup/SetupParts";
import { StorytellerStep } from "@/app/setup/StorytellerStep";
import { WelcomeStep } from "@/app/setup/WelcomeStep";
import { YourAgentStep, type MadeConnection } from "@/app/setup/YourAgentStep";
import { normalizeBaseUrl, storySourceForUrl } from "@/lib/setup/discovery-logic";
import { fillsStep, suggestNarration, suggestPictures } from "@/lib/setup/suggest";
import {
  PAINTING_AGENTS,
  dictationPatch,
  joiningPatch,
  mergePatches,
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

function storyChoice(draft: Draft, found: ScanResult["text"]): StoryChoice | null {
  if (draft.story === "none") return { kind: "none" };
  if (draft.story === "local") {
    const server = draft.local.typed ? undefined : found.find((entry) => entry.baseUrl === normalizeBaseUrl(draft.local.baseUrl));
    return { kind: "local", baseUrl: draft.local.baseUrl, model: draft.local.model, apiKey: draft.local.apiKey, ollama: Boolean(server?.ollamaNative) };
  }
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
export function SetupWizard({ config: initialConfig, env, info }: { config: MaskedConfig; env: EnvDefaults; info: SetupInfo }) {
  const [config, setConfig] = useState(initialConfig);
  const firstRun = !info.state.finishedAt;
  const [draft, setDraft] = useState<Draft>(() => draftFromConfig(initialConfig, firstRun));
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [scanning, setScanning] = useState(true);
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [made, setMade] = useState<MadeConnection | null>(null);
  // The ComfyUI at the draft's address offered models or checkpoints to
  // pick from (PicturesStep reports it).
  const [comfyOffers, setComfyOffers] = useState(false);
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
  // What the setup suggests for the media steps: reuse what is already set
  // up (src/lib/setup/suggest.ts).
  const suggestInput = {
    story: draft.story,
    agentId: draft.agent.id,
    storyIsOpenAi,
    comfyFound: Boolean(scan?.comfyui),
    kokoroFound: Boolean(scan?.kokoro),
  };
  const picturesSuggestion = suggestPictures(suggestInput);
  const narrationSuggestion = suggestNarration(suggestInput);
  const savedKeyFor = useMemo(() => {
    if (!config.text.hasCustomApiKey) return null;
    const source = storySourceForUrl(config.text.customBaseUrl);
    return source === "local" ? null : source;
  }, [config.text.hasCustomApiKey, config.text.customBaseUrl]);

  // After a test picture: the verified mark lives in the saved settings.
  async function refreshConfig() {
    const data = await fetch("/api/admin/settings")
      .then((response) => (response.ok ? response.json() : null))
      .catch(() => null);
    if (data?.config) setConfig(data.config as MaskedConfig);
  }

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
      const choice = storyChoice(draft, scan?.text ?? []);
      if (!choice) return { error: "Choose who tells the story." };
      const built = storyPatch(choice, config.text.customBaseUrl);
      return "error" in built ? built : built.patch;
    }
    if (key === "pictures") {
      // Unanswered: nothing is written, so a server left on its own keeps
      // finding a ComfyUI that starts later. Only a deliberate "No pictures
      // for now" saves the switch off.
      if (draft.pictures === "") return null;
      if (draft.pictures === "comfyui") return picturesPatch({ kind: "comfyui", url: draft.comfy.url, checkpoint: draft.comfy.checkpoint, preset: draft.comfy.preset });
      if (draft.pictures === "openai") return picturesPatch({ kind: "openai", apiKey: draft.picturesKey, model: draft.picturesModel });
      if (draft.pictures === "agent") return picturesPatch({ kind: "agent" });
      return picturesPatch({ kind: "none" });
    }
    if (key === "voice") {
      // Unanswered narration writes nothing, like unanswered pictures.
      const narration =
        draft.narration === "kokoro"
          ? narrationPatch({ kind: "kokoro", url: draft.kokoro.url, voice: draft.kokoro.voice })
          : draft.narration === "openai"
            ? narrationPatch({ kind: "openai", apiKey: draft.narrationKey, model: draft.narrationModel })
            : draft.narration === "off"
              ? narrationPatch({ kind: "off" })
              : null;
      // The dictation model the step asked for, if it asked (VoiceStep).
      const dictation = scan?.whisper
        ? dictationPatch({ whisperModel: draft.dictation.whisperModel })
        : storyIsOpenAi
          ? dictationPatch({ openaiModel: draft.dictation.openaiModel })
          : null;
      return narration && dictation ? mergePatches(narration, dictation) : (narration ?? dictation);
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
    arrive(next);
  }

  // Arriving at a step: the last one asks the server afresh, and a media
  // step nobody has answered yet is filled with the setup's suggestion (only
  // a real service: "none" and "off" are never chosen for the admin).
  function arrive(next: number) {
    const key = KEYS[next];
    if (key === "ready") setReadyVisit((visit) => visit + 1);
    if (key === "pictures" && fillsStep(picturesSuggestion.pick)) {
      setDraft((current) => (current.pictures === "" ? withPictures(current, picturesSuggestion.pick, scan?.comfyui ?? null) : current));
    }
    if (key === "voice" && fillsStep(narrationSuggestion.pick)) {
      setDraft((current) => (current.narration === "" ? withNarration(current, narrationSuggestion.pick, scan?.kokoro ?? null) : current));
    }
    setStep(next);
  }

  // "Skip for now": this step's answer goes back to what the server holds
  // and nothing is saved for it, so skipping never writes an Off over a
  // service that is set up.
  function skip(key: StepKey) {
    const saved = draftFromConfig(config, firstRun);
    setSaveError("");
    setDraft((current) =>
      key === "pictures"
        ? { ...current, pictures: saved.pictures, comfy: saved.comfy, picturesKey: "", picturesModel: saved.picturesModel }
        : key === "voice"
          ? { ...current, narration: saved.narration, kokoro: saved.kokoro, narrationKey: "", narrationModel: saved.narrationModel, dictation: saved.dictation }
          : key === "players"
            ? { ...current, signupMode: saved.signupMode, publicUrl: saved.publicUrl }
            : current,
    );
    arrive(STEP_INDEX[key] + 1);
  }

  // Once someone tells the story, the rest can wait: the storyteller is
  // saved and the last step shows what the server can do, each line with a
  // way back to the step it skipped.
  async function finishLater() {
    const body = patchFor("story");
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
    arrive(STEP_INDEX.ready);
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
  const agentPaints = draft.story === "agent" && draft.agent.id !== "" && PAINTING_AGENTS.includes(draft.agent.id);
  const picturesBlocker = picturesStepBlocker(draft, {
    agentVerified: Boolean(config.harness.imagesVerifiedAt),
    storyIsOpenAi,
    openaiKeySaved: config.images.hasOpenaiApiKey,
    envImageModel: env.openaiImageModel,
    comfyOffers,
  });
  const voiceBlocker =
    draft.narration === "kokoro" && !draft.kokoro.url.trim()
      ? "Type where Kokoro runs, or choose another answer."
      : draft.narration === "openai" &&
          !storyIsOpenAi &&
          !draft.narrationKey.trim() &&
          !config.speech.hasTtsApiKey &&
          !config.images.hasOpenaiApiKey
        ? "Paste an OpenAI key, or choose another answer."
        : draft.narration === "openai" && !draft.narrationModel.trim() && !env.ttsModel
          ? "Pick the narration model, or choose another answer."
          : null;

  const address = draft.publicUrl.trim() || info.lanUrls[0] || "";
  // The eyebrow names the topic; the wizard's own "Step 3 / 7" is the one
  // count, so the two never disagree (Welcome is a step there).
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
      title: title("The storyteller", "Who tells the story?", "story"),
      blurb: "The Dungeon Master's words. The server always rolls the dice and keeps the rules; this only chooses who tells the story. Reading it aloud is a later step.",
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
      secondary: storyBlocker
        ? undefined
        : {
            label: "Save and finish later",
            title: "Saves the storyteller and goes to the summary. Pictures, voice and the rest stay as they are until you set them.",
            onClick: () => void finishLater(),
          },
    },
    {
      key: "pictures",
      label: "Pictures",
      title: title("Pictures", "Should the table have pictures?", "pictures"),
      blurb: "Character portraits, scene art and battle maps. Every table works without them.",
      content: (
        <PicturesStep
          draft={draft}
          update={update}
          scan={scan}
          scanning={scanning}
          storyIsOpenAi={storyIsOpenAi}
          agentPaints={agentPaints}
          agentVerified={Boolean(config.harness.imagesVerifiedAt)}
          agentLabel={draft.agent.id === "grok" ? "Grok Build" : "Codex"}
          onAgentVerified={() => void refreshConfig()}
          openaiKeySaved={config.images.hasOpenaiApiKey}
          env={env}
          onComfyOffers={setComfyOffers}
          suggestion={picturesSuggestion}
          onRescan={rescan}
        />
      ),
      blocker: picturesBlocker,
      canContinue: !picturesBlocker,
      secondary: { label: "Skip for now", title: "Leaves pictures as they are. Nothing on this step is saved.", onClick: () => skip("pictures") },
    },
    {
      key: "voice",
      label: "Voice",
      title: title("Speech", "Should the storyteller speak?", "voice"),
      blurb: "Narration reads each passage aloud; dictation lets players talk instead of type. Both are optional.",
      content: (
        <VoiceStep
          draft={draft}
          update={update}
          scan={scan}
          scanning={scanning}
          storyIsOpenAi={storyIsOpenAi}
          ttsKeySaved={config.speech.hasTtsApiKey || config.images.hasOpenaiApiKey}
          env={env}
          suggestion={narrationSuggestion}
          onRescan={rescan}
        />
      ),
      blocker: voiceBlocker,
      canContinue: !voiceBlocker,
      secondary: { label: "Skip for now", title: "Leaves narration and dictation as they are. Nothing on this step is saved.", onClick: () => skip("voice") },
    },
    {
      key: "players",
      label: "Players",
      title: title("Players", "How do players get in?", "players"),
      blurb: "The address to send your friends, and who may make an account.",
      content: (
        <PlayersStep draft={draft} update={update} lanUrls={info.lanUrls} />
      ),
      secondary: { label: "Skip for now", title: "Leaves sign-ups and the address as they are. Nothing on this step is saved.", onClick: () => skip("players") },
    },
    {
      key: "agent",
      label: "Your agent",
      title: title("Your own agent", "Bring your own AI agent?", "agent"),
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
