"use client";

import { Check, Loader2 } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { shellHost } from "@/lib/shell-host";
import { ui } from "@/lib/ui";
import { PageSection } from "@/components/PageShell";
import { PageSkeleton } from "@/components/PageSkeleton";
import { GameIcon } from "@/components/ui/GameIcon";
import { NumberStepper } from "@/components/ui/NumberStepper";
import { Select } from "@/components/ui/Select";
import { REROLL_LOW_DEFAULT, rerollBelowFor, rerollChoiceOf } from "@/lib/srd/ability-rerolls";
import { AdminInvitesSection } from "@/app/admin/AdminInvitesSection";
import { SpeedField } from "@/app/admin/SpeedField";
import { apiSpeedEligibility } from "@/lib/speed-tier";
import { describeEndpoint } from "@/lib/dm/sampling-logic";
import type { SpeedChannel, SpeedNote } from "@/lib/speed-status";
import { AdminNetworkSections } from "@/app/admin/AdminNetworkSections";
import { AdminPlayerAgentsSection } from "@/app/admin/AdminPlayerAgentsSection";
import { AdminBackupSection } from "@/app/admin/AdminBackupSection";
import { AdminStorageSection } from "@/app/admin/AdminStorageSection";
import { BackendProbe } from "@/app/admin/BackendProbe";
import { ModelChoiceField } from "@/app/admin/ModelChoice";
import { BLANK, fromEnv } from "@/app/admin/model-blanks";
import { AdminImagesSection } from "@/app/admin/AdminImagesSection";
import { AdminSpeechSection } from "@/app/admin/AdminSpeechSection";
import { AmbienceLibraryCard } from "@/app/admin/AmbienceLibraryCard";
import { AdminHarnessSection } from "@/app/admin/AdminHarnessSection";
import { mergeAdminConfigDraft } from "@/app/admin/merge-config-draft";
import { Lamp, type Tone } from "@/app/setup/SetupParts";
import { useCapabilities } from "@/lib/use-capabilities";
import {
  Field,
  SECRET_KEPT,
  SecretField,
  SelectField,
  type EnvDefaults,
  type MaskedConfig,
  inheritedHint,
} from "@/app/admin/AdminSettingsFields";

// The sticky contents rail: one stop per section, left out where a device
// world hides the section itself.
const STOPS: Array<{ id: string; label: string; glyph: string; server?: boolean }> = [
  { id: "admin-server", label: "Server", glyph: "tab-settings", server: true },
  { id: "admin-accounts", label: "Accounts", glyph: "ui-accounts", server: true },
  { id: "admin-text", label: "Text model", glyph: "ui-ai" },
  { id: "admin-harness", label: "Agent", glyph: "ui-agent" },
  { id: "admin-utility", label: "Utility model", glyph: "ui-utility" },
  { id: "admin-images", label: "Images", glyph: "ui-paint" },
  { id: "admin-speech", label: "Speech", glyph: "ui-speech" },
  { id: "admin-ambience", label: "Sound library", glyph: "tab-ambience" },
  { id: "admin-voice", label: "Voice chat", glyph: "ui-voice", server: true },
  { id: "admin-discord", label: "Discord", glyph: "system-share", server: true },
  { id: "admin-player-agents", label: "Player agents", glyph: "ui-agent", server: true },
  { id: "admin-backup", label: "Backup", glyph: "ui-backup", server: true },
  { id: "admin-storage", label: "Storage", glyph: "ui-storage" },
];

function jumpTo(id: string) {
  const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  document.getElementById(id)?.scrollIntoView({ behavior: calm ? "auto" : "smooth", block: "start" });
}

// Global server settings. Each string setting overrides its env var; a blank
// field falls back to the env value shown as the placeholder/hint.

export function AdminSettingsPanel() {
  const [config, setConfig] = useState<MaskedConfig | null>(null);
  // The config as the server last saved it, so the panel can say whether
  // anything here is waiting for Save settings.
  const [savedConfig, setSavedConfig] = useState<MaskedConfig | null>(null);
  const capabilities = useCapabilities();
  const [env, setEnv] = useState<EnvDefaults | null>(null);
  const [apiKey, setApiKey] = useState(SECRET_KEPT);
  const [utilityApiKey, setUtilityApiKey] = useState(SECRET_KEPT);
  const [openaiImageKey, setOpenaiImageKey] = useState(SECRET_KEPT);
  const [ttsApiKey, setTtsApiKey] = useState(SECRET_KEPT);
  const [discordSecret, setDiscordSecret] = useState(SECRET_KEPT);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  // Campaigns the save moved off a picture backend that could not paint
  // (src/lib/image-backend-rescue.ts), named once so the admin knows.
  const [rescued, setRescued] = useState<Array<{ title: string }>>([]);
  const [error, setError] = useState("");
  // Server-computed, because the announced-address fallback chain ends at the
  // bind address, which never reaches this panel. Reflects the SAVED config.
  const [voiceUnroutable, setVoiceUnroutable] = useState(false);
  // A world hosted by the client app on this device. The shell owns the
  // public address, sign-up mode, voice transport and there is no usable
  // Discord redirect, so those sections disappear and only AI settings stay.
  const [deviceWorld, setDeviceWorld] = useState(false);
  // What the last Fast calls ran at, per role (issue 255).
  const [speedNotes, setSpeedNotes] = useState<Partial<Record<SpeedChannel, SpeedNote>>>({});
  // A phone cannot run Ollama or a local ComfyUI install; the desktop shell
  // can, so the PC keeps the local-AI fields.
  const phoneWorld = deviceWorld && shellHost()?.platform === "android";

  useEffect(() => {
    fetch("/api/admin/settings")
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (data) {
          setConfig(data.config);
          setSavedConfig(data.config);
          setEnv(data.envDefaults);
          setVoiceUnroutable(Boolean(data.voiceAnnounceUnroutable));
          setDeviceWorld(Boolean(data.deviceWorld));
          setSpeedNotes(data.speedStatus ?? {});
        }
      });
  }, []);

  // A link from elsewhere can name one section (Settings > Connected agents
  // sends an admin to ?section=admin-player-agents): it is brought into view
  // once the sections are drawn. A query rather than a #hash, which the
  // apps' router does not carry.
  const section = useSearchParams().get("section");
  const drawn = Boolean(config && env);
  useEffect(() => {
    if (!drawn || !section || !STOPS.some((stop) => stop.id === section)) return;
    // The sections above fetch their own state and grow after the first
    // paint, so the section is put back in view as they settle, until the
    // reader scrolls for themselves.
    const place = () => document.getElementById(section)?.scrollIntoView({ block: "start" });
    const timers = [0, 300, 800, 1600].map((delay) => window.setTimeout(place, delay));
    const stop = () => timers.forEach((timer) => window.clearTimeout(timer));
    const events = ["wheel", "touchstart", "keydown"] as const;
    events.forEach((name) => window.addEventListener(name, stop, { once: true, passive: true }));
    return () => {
      stop();
      events.forEach((name) => window.removeEventListener(name, stop));
    };
  }, [drawn, section]);

  const secretsTouched = [apiKey, utilityApiKey, openaiImageKey, ttsApiKey, discordSecret].some((value) => value !== SECRET_KEPT);
  const dirty = Boolean(config && savedConfig) && (secretsTouched || JSON.stringify(config) !== JSON.stringify(savedConfig));

  // Leaving with changes unsaved asks first: the form saves only with its
  // button, and nothing else on the page says a change is waiting.
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  if (!config || !env) {
    return <PageSkeleton kind="flat" className="px-0 py-2" />;
  }

  function discard() {
    if (!savedConfig) return;
    setConfig(savedConfig);
    setApiKey(SECRET_KEPT);
    setUtilityApiKey(SECRET_KEPT);
    setOpenaiImageKey(SECRET_KEPT);
    setTtsApiKey(SECRET_KEPT);
    setDiscordSecret(SECRET_KEPT);
    setError("");
  }

  // What the rail says beside the AI sections, in four states a person can
  // tell apart: working, set up but not answering, not set up yet, switched
  // off on purpose; and "checking" until the server has said. Read from the
  // live capabilities and the saved settings, so it reflects what is saved
  // rather than what is typed.
  const lampFor = (id: string): { tone: Tone; words: string } | null => {
    const part = id === "admin-text" ? "story" : id === "admin-images" ? "images" : id === "admin-speech" ? "tts" : null;
    if (!part) return null;
    if (!capabilities) return { tone: "wait", words: "Checking" };
    const switchedOff =
      (part === "story" && savedConfig?.text.provider === "none") ||
      (part === "tts" && (savedConfig?.speech.ttsProvider === "off" || capabilities.tts?.provider === "off"));
    if (switchedOff) return { tone: "off", words: "Switched off" };
    const state = capabilities[part];
    if (!state.configured) return { tone: "warn", words: "Not set up yet" };
    return state.reachable ? { tone: "ok", words: "Working" } : { tone: "bad", words: "Set up, but not answering" };
  };

  async function save() {
    if (!config) return;
    setSaving(true);
    setSaved(false);
    setError("");
    try {
      const response = await fetch("/api/admin/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        // On a device world the shell writes the address, sign-up mode,
        // voice and Discord settings itself; sending this panel's (possibly
        // stale) copy back would fight it, so those keys stay out entirely
        // and the PATCH route keeps the stored values.
        body: JSON.stringify({
          ...(deviceWorld
            ? {}
            : {
                signupMode: config.signupMode,
                serverName: config.serverName,
                accountDeletionGraceDays: config.accountDeletionGraceDays,
                abilityRerollBelow: config.abilityRerollBelow,
                publicUrl: config.publicUrl,
                sharedHost: config.sharedHost,
                voiceChat: config.voiceChat,
                discord: {
                  clientId: config.discord.clientId,
                  ...(discordSecret === SECRET_KEPT ? {} : { clientSecret: discordSecret }),
                },
              }),
          text: {
            provider: config.text.provider,
            localTextModel: config.text.localTextModel,
            customBaseUrl: config.text.customBaseUrl,
            customModel: config.text.customModel,
            ...(apiKey === SECRET_KEPT ? {} : { customApiKey: apiKey }),
            utilityProvider: config.text.utilityProvider,
            utilityModel: config.text.utilityModel,
            utilityBaseUrl: config.text.utilityBaseUrl,
            ...(utilityApiKey === SECRET_KEPT ? {} : { utilityApiKey }),
            speed: config.text.speed,
            utilitySpeed: config.text.utilitySpeed,
          },
          images: {
            defaultBackend: config.images.defaultBackend,
            comfyUrl: config.images.comfyUrl,
            comfyCheckpoint: config.images.comfyCheckpoint,
            comfyWorkflowPreset: config.images.comfyWorkflowPreset,
            fluxWorkerUrl: config.images.fluxWorkerUrl,
            openaiBaseUrl: config.images.openaiBaseUrl,
            openaiModel: config.images.openaiModel,
            ...(openaiImageKey === SECRET_KEPT ? {} : { openaiApiKey: openaiImageKey }),
          },
          speech: {
            ttsProvider: config.speech.ttsProvider,
            kokoroUrl: config.speech.kokoroUrl,
            ttsBaseUrl: config.speech.ttsBaseUrl,
            ttsModel: config.speech.ttsModel,
            ttsVoice: config.speech.ttsVoice,
            sttUrl: config.speech.sttUrl,
            sttModel: config.speech.sttModel,
            sttOpenaiModel: config.speech.sttOpenaiModel,
            ...(ttsApiKey === SECRET_KEPT ? {} : { ttsApiKey }),
          },
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        setError(data?.error || "Could not save settings.");
        return;
      }
      setConfig(data.config);
      setSavedConfig(data.config);
      setVoiceUnroutable(Boolean(data.voiceAnnounceUnroutable));
      setApiKey(SECRET_KEPT);
      setUtilityApiKey(SECRET_KEPT);
      setOpenaiImageKey(SECRET_KEPT);
      setTtsApiKey(SECRET_KEPT);
      setDiscordSecret(SECRET_KEPT);
      setRescued(Array.isArray(data.rescued) ? data.rescued : []);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <nav aria-label="Settings sections" className="contents-rail panel">
        {STOPS.filter((stop) => !(deviceWorld && stop.server)).map((stop) => {
          const lamp = lampFor(stop.id);
          return (
            <button key={stop.id} type="button" onClick={() => jumpTo(stop.id)} className="motion-press">
              <GameIcon icon={{ kind: "glyph", key: stop.glyph }} size="size-7" /> {stop.label}
              {lamp ? (
                <span title={lamp.words}>
                  <Lamp tone={lamp.tone} className="ml-0.5" />
                  <span className="sr-only">: {lamp.words}</span>
                </span>
              ) : null}
            </button>
          );
        })}
      </nav>
      <p className="text-xs text-stone-500">
        Changes on this page wait for <span className="text-stone-300">Save settings</span>, which follows you down the
        page. Invites, backups, storage and player agents act at once.
      </p>
      {/* The lamps in words, so the four states are read rather than told
          apart by colour alone. */}
      <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-stone-400" data-admin-status>
        {(
          [
            ["admin-text", "Text model"],
            ["admin-images", "Images"],
            ["admin-speech", "Speech"],
          ] as const
        ).map(([id, label]) => {
          const lamp = lampFor(id);
          return lamp ? (
            <span key={`${id}-${lamp.words}`} className="reveal inline-flex items-center gap-1.5">
              <Lamp tone={lamp.tone} />
              {label}: {lamp.words.toLowerCase()}
            </span>
          ) : null;
        })}
      </p>
      {deviceWorld ? (
        <p className="reveal text-xs text-stone-500">
          This world runs inside the app, which manages its address, sharing
          and voice chat for you. There are no passwords or sign-up rules to
          set: anyone you give a live room code to can join, and nobody else
          can make an account. The settings here tune the AI it plays with.
        </p>
      ) : null}
      {deviceWorld ? null : (
        <PageSection id="admin-server" heading="Server" glyph="tab-settings">
          <div className="mb-3">
            <Field
              label="Server name"
              hint="Shown on the login screen and in client apps' server pickers. Blank = Open Dungeon Master."
            >
              <input
                className={ui.input}
                value={config.serverName}
                maxLength={100}
                onChange={(event) => setConfig({ ...config, serverName: event.target.value })}
                placeholder="Open Dungeon Master"
              />
            </Field>
          </div>
          <Field
            label="Public URL"
            hint={
              env.publicUrl
                ? inheritedHint(config.publicUrl, env.publicUrl)
                : "The address players actually use (needed for Discord sign-in behind a reverse proxy). Blank = auto-detect."
            }
          >
            <input
              className={ui.input}
              value={config.publicUrl}
              onChange={(event) => setConfig({ ...config, publicUrl: event.target.value })}
              placeholder={env.publicUrl || "https://dungeon.example.org"}
            />
          </Field>
        </PageSection>
      )}

      {deviceWorld ? null : (
        <PageSection id="admin-accounts" heading="Accounts" glyph="ui-accounts">
          <SelectField
            label="New account sign-ups"
            value={config.signupMode}
            onChange={(signupMode) => setConfig({ ...config, signupMode })}
            options={[
              { value: "open", label: "Open: anyone with the address can register" },
              { value: "invite", label: "Invite-only: registering needs a code from below" },
              { value: "closed", label: "Closed: no new accounts" },
            ]}
          />
          <p className="mt-2 text-xs text-stone-500">
            Applies to registration and to first-time Discord sign-ins alike. Existing users always
            keep their access.
          </p>
          {config.signupMode === "invite" ? <AdminInvitesSection /> : null}
          {/* Sharing the server with friends who run their own tables
              (issues #137, #138): who may start one, and whose tables may
              spend the paid backends. Usage per account and campaign is on
              the Usage tab. */}
          <div className="mt-4 space-y-3">
            <SelectField
              label="Who may start campaigns and workshops"
              value={config.sharedHost.campaignCreation || "everyone"}
              onChange={(campaignCreation) => setConfig({ ...config, sharedHost: { ...config.sharedHost, campaignCreation } })}
              options={[
                { value: "everyone", label: "Everyone with an account" },
                { value: "admins", label: "Administrators only: others join by room code" },
              ]}
            />
            <SelectField
              label="Paid AI backends"
              hint="Paid means a text, picture or speech backend on a public host that takes this server's key (OpenAI, OpenRouter, a hosted model), and the agent program. Backends on this machine or your network (llama-server, Ollama, ComfyUI, Kokoro, Whisper) stay open to every table, keyed or not. A table that may not spend the paid ones can bring its own key in the client app."
              value={config.sharedHost.paidAi || "everyone"}
              onChange={(paidAi) => setConfig({ ...config, sharedHost: { ...config.sharedHost, paidAi } })}
              options={[
                { value: "everyone", label: "Every campaign may use them" },
                { value: "admins", label: "Only campaigns an administrator leads" },
              ]}
            />
          </div>
          <div className="mt-4">
            <Field
              group
              label="Account deletion grace period (days)"
              hint="When someone deletes their account it is signed out at once and erased after this many days; signing in before then keeps it. 0 erases immediately. Deleting a user from the Users tab always erases at once."
            >
              <NumberStepper
                label="Account deletion grace period (days)"
                min={0}
                max={90}
                step={1}
                suffix="days"
                value={config.accountDeletionGraceDays}
                onChange={(next) => {
                  const days = Math.round(Number(next));
                  setConfig({
                    ...config,
                    accountDeletionGraceDays: Number.isFinite(days) ? Math.min(90, Math.max(0, days)) : 0,
                  });
                }}
              />
            </Field>
            <Field
              label="Rolled 4d6 stats"
              hint="The server throws and keeps a player's six 4d6 totals. Choose whether they may throw again: never, only when the six add up to less than a total you set (70 is the default; the book names no rule), or as often as they like. This is the rule in the library and at every table that follows the server, where a player has one six for all of them. A table can set its own rule in its settings and then keeps a separate six for each player; a character made there still joins its player's library like any other, and a library character or a file brought to a table is only checked against what the dice could give."
            >
              <Select
                label="Rolled 4d6 stats"
                value={rerollChoiceOf(config.abilityRerollBelow)}
                onChange={(choice) =>
                  setConfig({ ...config, abilityRerollBelow: rerollBelowFor(choice, config.abilityRerollBelow) })
                }
                options={[
                  { value: "keep", label: "The first roll stands" },
                  { value: "low", label: "Reroll a low roll" },
                  { value: "free", label: "Reroll as often as they like" },
                ]}
              />
              {rerollChoiceOf(config.abilityRerollBelow) === "low" ? (
                <NumberStepper
                  label="Reroll when the six add up to less than"
                  min={1}
                  max={107}
                  step={1}
                  suffix="total"
                  value={config.abilityRerollBelow}
                  onChange={(next) => {
                    const below = Math.round(Number(next));
                    setConfig({
                      ...config,
                      abilityRerollBelow: Number.isFinite(below) ? Math.min(107, Math.max(1, below)) : REROLL_LOW_DEFAULT,
                    });
                  }}
                />
              ) : null}
            </Field>
          </div>
        </PageSection>
      )}

      <PageSection id="admin-text" heading="Text model defaults" glyph="ui-ai">
        <p className="mb-3 text-xs text-stone-500">
          The backend every player&apos;s campaign runs on. A campaign can still pick its model,
          but only an admin&apos;s own campaigns can point at another address or key.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <SelectField
            label="Default provider"
            value={config.text.provider}
            onChange={(provider) => setConfig({ ...config, text: { ...config.text, provider } })}
            options={[
              { value: "" as const, label: "Auto (env or built-in)" },
              { value: "custom" as const, label: "OpenAI-compatible server" },
              ...(phoneWorld ? [] : [{ value: "local" as const, label: "Ollama (native)" }]),
              ...(phoneWorld ? [] : [{ value: "harness" as const, label: "The agent program (below)" }]),
              { value: "none" as const, label: "No AI storyteller" },
            ]}
          />
          {phoneWorld ? null : (
            <ModelChoiceField
              label="Local model (Ollama native)"
              hint="What this machine's Ollama has pulled; any tag it serves can be typed."
              role="story"
              provider="local"
              value={config.text.localTextModel}
              onChange={(localTextModel) => setConfig({ ...config, text: { ...config.text, localTextModel } })}
              blankLabel={env.localTextModel ? fromEnv(env.localTextModel, "LOCAL_TEXT_MODEL") : BLANK.story}
            />
          )}
          <Field label="Backend base URL" hint={inheritedHint(config.text.customBaseUrl, env.customBaseUrl)}>
            <input
              className={ui.input}
              value={config.text.customBaseUrl}
              onChange={(event) =>
                setConfig({ ...config, text: { ...config.text, customBaseUrl: event.target.value } })
              }
              placeholder={env.customBaseUrl || "http://127.0.0.1:8001/v1"}
            />
          </Field>
          <ModelChoiceField
            label="Model name"
            role="story"
            provider="custom"
            baseUrl={config.text.customBaseUrl || env.customBaseUrl}
            apiKey={apiKey === SECRET_KEPT ? "" : apiKey}
            value={config.text.customModel}
            onChange={(customModel) => setConfig({ ...config, text: { ...config.text, customModel } })}
            blankLabel={env.customModel ? fromEnv(env.customModel, "OPENAI_COMPAT_MODEL") : BLANK.story}
          />
        </div>
        <div className="mt-3">
          <SecretField
            label="API key"
            isSet={config.text.hasCustomApiKey}
            value={apiKey}
            onChange={setApiKey}
            hint={
              env.hasCustomApiKey
                ? "An env-var key is also set; this one wins when filled."
                : "Most local servers need none."
            }
          />
        </div>
        {/* The CLI's capability probe: streaming, a real tool call, and a
            continuation, so a backend is proven before a campaign learns it
            the hard way. Uses the field values as typed, saved values and
            env as fallbacks. */}
        {config.text.provider === "" || config.text.provider === "custom" ? (
          <div className="mt-3 sm:w-1/2">
            <SpeedField
              label="Processing speed"
              value={config.text.speed}
              onChange={(speed) => setConfig({ ...config, text: { ...config.text, speed } })}
              eligibility={apiSpeedEligibility({
                endpointKind: describeEndpoint(config.text.customBaseUrl || env.customBaseUrl || "").kind,
                model: config.text.customModel || env.customModel || "",
              })}
              note={speedNotes.story}
            />
          </div>
        ) : null}
        <BackendProbe
          which="story"
          baseUrl={config.text.customBaseUrl}
          model={config.text.customModel}
          apiKey={apiKey === SECRET_KEPT ? "" : apiKey}
        />
      </PageSection>

      {phoneWorld ? null : (
        <AdminHarnessSection
          textProvider={config.text.provider}
          imagesBackend={config.images.defaultBackend}
          onConfig={(patch) => {
            // The agent section saves its own fields: they are saved, so the
            // snapshot takes them too and they never read as unsaved.
            setConfig((current) => (current ? mergeAdminConfigDraft(current, patch) : current));
            setSavedConfig((current) => (current ? mergeAdminConfigDraft(current, patch) : current));
          }}
          speedNotes={speedNotes}
        />
      )}

      <PageSection id="admin-utility" heading="Utility model (optional)" glyph="ui-utility">
        <p className="mb-3 text-xs text-stone-500">
          A second, smaller model for the mechanical work: history compaction, chapter summaries
          and fact extraction, world-arc ticks, lore checks, and Ask answers. None of it is
          narration, so a small model does it well while the story model keeps its weights and
          prompt cache resident. Leave the model name blank to turn this off, and every one of
          those calls goes back to the story model. If a configured utility model is unreachable,
          the story model picks the job up anyway.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <SelectField
            label="Provider"
            value={config.text.utilityProvider}
            onChange={(utilityProvider) => setConfig({ ...config, text: { ...config.text, utilityProvider } })}
            options={[
              { value: "" as const, label: "Auto (Ollama)" },
              ...(phoneWorld ? [] : [{ value: "local" as const, label: "Ollama (native)" }]),
              { value: "custom" as const, label: "OpenAI-compatible server" },
            ]}
          />
          <ModelChoiceField
            label="Model name"
            hint="Anything in the 4B-8B class is plenty."
            role="utility"
            provider={config.text.utilityProvider === "custom" ? "custom" : "local"}
            baseUrl={config.text.utilityProvider === "custom" ? config.text.utilityBaseUrl : ""}
            apiKey={utilityApiKey === SECRET_KEPT ? "" : utilityApiKey}
            value={config.text.utilityModel}
            onChange={(utilityModel) => setConfig({ ...config, text: { ...config.text, utilityModel } })}
            blankLabel={BLANK.utility}
          />
          <Field
            label="Backend base URL"
            hint="Only for an OpenAI-compatible utility server. Blank uses the Ollama endpoint."
          >
            <input
              className={ui.input}
              value={config.text.utilityBaseUrl}
              onChange={(event) =>
                setConfig({
                  ...config,
                  text: { ...config.text, utilityBaseUrl: event.target.value },
                })
              }
              placeholder="http://127.0.0.1:8001/v1"
            />
          </Field>
          <SecretField
            label="API key"
            isSet={config.text.hasUtilityApiKey}
            value={utilityApiKey}
            onChange={setUtilityApiKey}
            hint="Most local servers need none."
          />
          {config.text.utilityProvider === "custom" && config.text.utilityModel.trim() ? (
            <SpeedField
              label="Processing speed"
              value={config.text.utilitySpeed}
              onChange={(utilitySpeed) => setConfig({ ...config, text: { ...config.text, utilitySpeed } })}
              eligibility={apiSpeedEligibility({
                endpointKind: describeEndpoint(config.text.utilityBaseUrl).kind,
                model: config.text.utilityModel,
              })}
              note={speedNotes.utility}
            />
          ) : null}
        </div>
        <BackendProbe
          which="utility"
          baseUrl={config.text.utilityBaseUrl}
          model={config.text.utilityModel}
          apiKey={utilityApiKey === SECRET_KEPT ? "" : utilityApiKey}
        />
      </PageSection>

      <AdminImagesSection
        images={config.images}
        env={env}
        harness={config.harness}
        phoneWorld={phoneWorld}
        openaiKey={openaiImageKey}
        onImages={(images) => setConfig({ ...config, images })}
        onOpenaiKey={setOpenaiImageKey}
      />

      <AdminSpeechSection
        speech={config.speech}
        env={env}
        apiKey={ttsApiKey}
        openaiSpeechBaseUrl={config.images.openaiBaseUrl || env.openaiImageBaseUrl || "https://api.openai.com/v1"}
        onSpeech={(speech) => setConfig({ ...config, speech })}
        onApiKey={setTtsApiKey}
      />

      <AmbienceLibraryCard />

      {deviceWorld ? null : (
        <AdminNetworkSections
          config={config}
          env={env}
          setConfig={setConfig}
          voiceUnroutable={voiceUnroutable}
          discordSecret={discordSecret}
          setDiscordSecret={setDiscordSecret}
        />
      )}

      {deviceWorld ? null : (
        <PageSection id="admin-player-agents" heading="Player agents" glyph="ui-agent">
          <AdminPlayerAgentsSection />
        </PageSection>
      )}

      {deviceWorld ? null : (
        <PageSection id="admin-backup" heading="Backup & restore" glyph="ui-backup">
          <AdminBackupSection />
        </PageSection>
      )}

      <PageSection id="admin-storage" heading="Storage" glyph="ui-storage">
        <AdminStorageSection />
      </PageSection>

      <div className="admin-savebar flex flex-wrap items-center gap-3" data-dirty={dirty || undefined}>
        <button type="button" onClick={save} disabled={saving} aria-busy={saving} className={ui.btnPrimary}>
          {saving ? <Loader2 className="size-4 animate-spin" /> : null} Save settings
        </button>
        {dirty && !saving ? (
          <>
            <span role="status" className="live-in inline-flex items-center gap-1.5 text-sm text-amber-200">
              <Lamp tone="wait" /> Unsaved changes
            </span>
            <button type="button" onClick={discard} className={ui.btnSmall}>
              Undo changes
            </button>
          </>
        ) : null}
        {saved ? (
          <span role="status" className="live-in inline-flex items-center gap-1 text-sm text-emerald-400">
            <Check className="size-4" /> Saved
          </span>
        ) : null}
        {rescued.length ? (
          <span role="status" className="live-in basis-full text-xs text-stone-400">
            {rescued.length === 1 ? "1 campaign" : `${rescued.length} campaigns`} could not paint on {rescued.length === 1 ? "its" : "their"} old picture backend and now use{rescued.length === 1 ? "s" : ""} the new default:{" "}
            {rescued.slice(0, 4).map((row) => row.title).join(", ")}
            {rescued.length > 4 ? ` and ${rescued.length - 4} more` : ""}.
          </span>
        ) : null}
        {error ? <span role="alert" className="motion-shake inline-block text-sm text-red-400">{error}</span> : null}
      </div>
    </div>
  );
}
