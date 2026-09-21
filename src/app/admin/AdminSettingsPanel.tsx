"use client";

import { Check, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { shellHost } from "@/lib/shell-host";
import { ui } from "@/lib/ui";
import { PageSection } from "@/components/PageShell";
import { PageSkeleton } from "@/components/PageSkeleton";
import { GameIcon } from "@/components/ui/GameIcon";
import { NumberStepper } from "@/components/ui/NumberStepper";
import { AdminInvitesSection } from "@/app/admin/AdminInvitesSection";
import { AdminNetworkSections } from "@/app/admin/AdminNetworkSections";
import { AdminBackupSection } from "@/app/admin/AdminBackupSection";
import { BackendProbe } from "@/app/admin/BackendProbe";
import { AdminHarnessSection } from "@/app/admin/AdminHarnessSection";
import {
  Field,
  SECRET_KEPT,
  SecretField,
  SelectField,
  type EnvDefaults,
  type MaskedConfig,
} from "@/app/admin/AdminSettingsFields";

// The sticky contents rail: one stop per section, left out where a device
// world hides the section itself.
const STOPS: Array<{ id: string; label: string; glyph: string; server?: boolean }> = [
  { id: "admin-server", label: "Server", glyph: "tab-settings", server: true },
  { id: "admin-accounts", label: "Accounts", glyph: "tab-characters", server: true },
  { id: "admin-text", label: "Text model", glyph: "system-lore" },
  { id: "admin-harness", label: "Agent", glyph: "system-lore" },
  { id: "admin-utility", label: "Utility model", glyph: "tab-log" },
  { id: "admin-images", label: "Images", glyph: "sense-truesight" },
  { id: "admin-speech", label: "Speech", glyph: "tab-ambience" },
  { id: "admin-voice", label: "Voice chat", glyph: "cue-horn", server: true },
  { id: "admin-discord", label: "Discord", glyph: "system-share", server: true },
  { id: "admin-backup", label: "Backup", glyph: "tab-handout", server: true },
];

function jumpTo(id: string) {
  const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  document.getElementById(id)?.scrollIntoView({ behavior: calm ? "auto" : "smooth", block: "start" });
}

// Global server settings. Each string setting overrides its env var; a blank
// field falls back to the env value shown as the placeholder/hint.
export function AdminSettingsPanel() {
  const [config, setConfig] = useState<MaskedConfig | null>(null);
  const [env, setEnv] = useState<EnvDefaults | null>(null);
  const [apiKey, setApiKey] = useState(SECRET_KEPT);
  const [utilityApiKey, setUtilityApiKey] = useState(SECRET_KEPT);
  const [openaiImageKey, setOpenaiImageKey] = useState(SECRET_KEPT);
  const [discordSecret, setDiscordSecret] = useState(SECRET_KEPT);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  // Server-computed, because the announced-address fallback chain ends at the
  // bind address, which never reaches this panel. Reflects the SAVED config.
  const [voiceUnroutable, setVoiceUnroutable] = useState(false);
  // A world hosted by the client app on this device. The shell owns the
  // public address, sign-up mode, voice transport and there is no usable
  // Discord redirect, so those sections disappear and only AI settings stay.
  const [deviceWorld, setDeviceWorld] = useState(false);
  // A phone cannot run Ollama or a local ComfyUI install; the desktop shell
  // can, so the PC keeps the local-AI fields.
  const phoneWorld = deviceWorld && shellHost()?.platform === "android";

  useEffect(() => {
    fetch("/api/admin/settings")
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (data) {
          setConfig(data.config);
          setEnv(data.envDefaults);
          setVoiceUnroutable(Boolean(data.voiceAnnounceUnroutable));
          setDeviceWorld(Boolean(data.deviceWorld));
        }
      });
  }, []);

  if (!config || !env) {
    return <PageSkeleton kind="flat" className="px-0 py-2" />;
  }

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
                publicUrl: config.publicUrl,
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
          },
          images: {
            defaultBackend: config.images.defaultBackend,
            comfyUrl: config.images.comfyUrl,
            comfyCheckpoint: config.images.comfyCheckpoint,
            fluxWorkerUrl: config.images.fluxWorkerUrl,
            openaiBaseUrl: config.images.openaiBaseUrl,
            openaiModel: config.images.openaiModel,
            ...(openaiImageKey === SECRET_KEPT ? {} : { openaiApiKey: openaiImageKey }),
          },
          speech: config.speech,
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        setError(data?.error || "Could not save settings.");
        return;
      }
      setConfig(data.config);
      setVoiceUnroutable(Boolean(data.voiceAnnounceUnroutable));
      setApiKey(SECRET_KEPT);
      setUtilityApiKey(SECRET_KEPT);
      setOpenaiImageKey(SECRET_KEPT);
      setDiscordSecret(SECRET_KEPT);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <nav aria-label="Settings sections" className="contents-rail panel">
        {STOPS.filter((stop) => !(deviceWorld && stop.server)).map((stop) => (
          <button key={stop.id} type="button" onClick={() => jumpTo(stop.id)} className="motion-press">
            <GameIcon icon={{ kind: "glyph", key: stop.glyph }} size="size-7" /> {stop.label}
          </button>
        ))}
      </nav>
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
                ? `Env: ${env.publicUrl}`
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
        <PageSection id="admin-accounts" heading="Accounts" glyph="tab-characters">
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
          </div>
        </PageSection>
      )}

      <PageSection id="admin-text" heading="Text model defaults" glyph="system-lore">
        <p className="mb-3 text-xs text-stone-500">
          Defaults for new campaigns and fallbacks when a campaign leaves a field empty. Each
          campaign&apos;s own Text Model settings still win.
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
            <Field label="Local model (Ollama native)">
              <input
                className={ui.input}
                value={config.text.localTextModel}
                onChange={(event) =>
                  setConfig({
                    ...config,
                    text: { ...config.text, localTextModel: event.target.value },
                  })
                }
                placeholder="gemma4:31b-it-qat"
              />
            </Field>
          )}
          <Field label="Backend base URL" hint={env.customBaseUrl ? `Env: ${env.customBaseUrl}` : undefined}>
            <input
              className={ui.input}
              value={config.text.customBaseUrl}
              onChange={(event) =>
                setConfig({ ...config, text: { ...config.text, customBaseUrl: event.target.value } })
              }
              placeholder={env.customBaseUrl || "http://127.0.0.1:11434/v1"}
            />
          </Field>
          <Field label="Model name" hint={env.customModel ? `Env: ${env.customModel}` : undefined}>
            <input
              className={ui.input}
              value={config.text.customModel}
              onChange={(event) =>
                setConfig({ ...config, text: { ...config.text, customModel: event.target.value } })
              }
              placeholder={env.customModel || "qwen3.6-dm"}
            />
          </Field>
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
        <BackendProbe
          which="story"
          baseUrl={config.text.customBaseUrl}
          model={config.text.customModel}
          apiKey={apiKey === SECRET_KEPT ? "" : apiKey}
        />
      </PageSection>

      {phoneWorld ? null : (
        <AdminHarnessSection textProvider={config.text.provider} onConfig={setConfig} />
      )}

      <PageSection id="admin-utility" heading="Utility model (optional)" glyph="tab-log">
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
          <Field
            label="Model name"
            hint="Blank = off. Anything in the 4B-8B class is plenty; e.g. gemma4:e4b-it-qat."
          >
            <input
              className={ui.input}
              value={config.text.utilityModel}
              onChange={(event) =>
                setConfig({ ...config, text: { ...config.text, utilityModel: event.target.value } })
              }
              placeholder="Off"
            />
          </Field>
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
              placeholder="http://127.0.0.1:11434/v1"
            />
          </Field>
          <SecretField
            label="API key"
            isSet={config.text.hasUtilityApiKey}
            value={utilityApiKey}
            onChange={setUtilityApiKey}
            hint="Most local servers need none."
          />
        </div>
        <BackendProbe
          which="utility"
          baseUrl={config.text.utilityBaseUrl}
          model={config.text.utilityModel}
          apiKey={utilityApiKey === SECRET_KEPT ? "" : utilityApiKey}
        />
      </PageSection>

      <PageSection id="admin-images" heading="Image generation" glyph="sense-truesight">
        <div className="mb-3">
          <SelectField<MaskedConfig["images"]["defaultBackend"]>
            label="Default backend"
            hint={
              phoneWorld
                ? "For new campaigns. The OpenAI API renders in the cloud with the key below and needs no GPU."
                : "For new campaigns. ComfyUI and the FLUX workers run on this machine; the OpenAI API renders in the cloud with the key below and needs no GPU."
            }
            value={config.images.defaultBackend}
            onChange={(defaultBackend) => setConfig({ ...config, images: { ...config.images, defaultBackend } })}
            options={[
              { value: "", label: `Auto (${env.imageBackend || "ComfyUI"})` },
              ...(phoneWorld ? [] : [{ value: "comfyui" as const, label: "ComfyUI (local)" }]),
              { value: "openai", label: "OpenAI API (cloud, needs key)" },
              ...(phoneWorld
                ? []
                : [
                    { value: "mflux-hs" as const, label: "FLUX worker: mflux (Apple Silicon)" },
                    { value: "sdnq-hs" as const, label: "FLUX worker: sdnq (CUDA/ROCm)" },
                  ]),
              // Only once the agent program has painted a real test picture.
              ...(config.harness?.images === "native" && config.harness.imagesVerifiedAt
                ? [{ value: "harness" as const, label: "The agent program's own pictures" }]
                : []),
            ]}
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {phoneWorld ? null : (
            <Field label="ComfyUI URL" hint={`Env: ${env.comfyUrl}`}>
              <input
                className={ui.input}
                value={config.images.comfyUrl}
                onChange={(event) =>
                  setConfig({ ...config, images: { ...config.images, comfyUrl: event.target.value } })
                }
                placeholder={env.comfyUrl}
              />
            </Field>
          )}
          {phoneWorld ? null : (
            <Field label="ComfyUI checkpoint">
              <input
                className={ui.input}
                value={config.images.comfyCheckpoint}
                onChange={(event) =>
                  setConfig({
                    ...config,
                    images: { ...config.images, comfyCheckpoint: event.target.value },
                  })
                }
                placeholder="CyberRealisticXLPlay_V6.0.safetensors"
              />
            </Field>
          )}
          {phoneWorld ? null : (
            <Field label="FLUX worker URL" hint={`Env: ${env.fluxWorkerUrl}`}>
              <input
                className={ui.input}
                value={config.images.fluxWorkerUrl}
                onChange={(event) =>
                  setConfig({
                    ...config,
                    images: { ...config.images, fluxWorkerUrl: event.target.value },
                  })
                }
                placeholder={env.fluxWorkerUrl}
              />
            </Field>
          )}
          <Field label="OpenAI image model" hint="Blank = gpt-image-1.">
            <input
              className={ui.input}
              value={config.images.openaiModel}
              onChange={(event) =>
                setConfig({
                  ...config,
                  images: { ...config.images, openaiModel: event.target.value },
                })
              }
              placeholder="gpt-image-1"
            />
          </Field>
          <Field
            label="OpenAI base URL"
            hint="Only for OpenAI-compatible image proxies. Blank = api.openai.com."
          >
            <input
              className={ui.input}
              value={config.images.openaiBaseUrl}
              onChange={(event) =>
                setConfig({
                  ...config,
                  images: { ...config.images, openaiBaseUrl: event.target.value },
                })
              }
              placeholder="https://api.openai.com/v1"
            />
          </Field>
          <SecretField
            label="OpenAI image API key"
            isSet={config.images.hasOpenaiApiKey}
            value={openaiImageKey}
            onChange={setOpenaiImageKey}
            hint={
              env.hasOpenaiImageApiKey
                ? "An env-var key is also set; this one wins when filled."
                : "Billed to whoever owns the key. Used only when a campaign's backend is the OpenAI API."
            }
          />
        </div>
      </PageSection>

      {/* Narration and speech-to-text. Named "Speech" so it is not confused
          with the Voice chat section below, which is a different feature. */}
      <PageSection id="admin-speech" heading="Speech" glyph="tab-ambience">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Kokoro TTS URL" hint={`Env: ${env.kokoroUrl}`}>
            <input
              className={ui.input}
              value={config.speech.kokoroUrl}
              onChange={(event) =>
                setConfig({ ...config, speech: { ...config.speech, kokoroUrl: event.target.value } })
              }
              placeholder={env.kokoroUrl}
            />
          </Field>
          <Field label="Whisper STT URL" hint={`Env: ${env.sttUrl}`}>
            <input
              className={ui.input}
              value={config.speech.sttUrl}
              onChange={(event) =>
                setConfig({ ...config, speech: { ...config.speech, sttUrl: event.target.value } })
              }
              placeholder={env.sttUrl}
            />
          </Field>
        </div>
      </PageSection>


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
        <PageSection id="admin-backup" heading="Backup & restore" glyph="tab-handout">
          <AdminBackupSection />
        </PageSection>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={save} disabled={saving} aria-busy={saving} className={ui.btnPrimary}>
          {saving ? <Loader2 className="size-4 animate-spin" /> : null} Save settings
        </button>
        {saved ? (
          <span role="status" className="live-in inline-flex items-center gap-1 text-sm text-emerald-400">
            <Check className="size-4" /> Saved
          </span>
        ) : null}
        {error ? <span role="alert" className="motion-shake inline-block text-sm text-red-400">{error}</span> : null}
      </div>
    </div>
  );
}
