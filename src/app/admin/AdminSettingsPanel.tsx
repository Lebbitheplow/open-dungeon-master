"use client";

import { Check, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { AdminInvitesSection } from "@/app/admin/AdminInvitesSection";

type MaskedConfig = {
  signupsEnabled: boolean;
  signupMode: "open" | "invite" | "closed";
  serverName: string;
  publicUrl: string;
  text: {
    provider: "" | "local" | "custom";
    localTextModel: string;
    customBaseUrl: string;
    customModel: string;
    hasCustomApiKey: boolean;
    utilityProvider: "" | "local" | "custom";
    utilityModel: string;
    utilityBaseUrl: string;
    hasUtilityApiKey: boolean;
  };
  images: {
    defaultBackend: "" | "comfyui" | "openai" | "mflux-hs" | "sdnq-hs";
    comfyUrl: string;
    comfyCheckpoint: string;
    fluxWorkerUrl: string;
    openaiBaseUrl: string;
    openaiModel: string;
    hasOpenaiApiKey: boolean;
  };
  speech: { kokoroUrl: string; sttUrl: string };
  voiceChat: {
    enabled: "" | "on" | "off";
    mode: "" | "sfu" | "mesh";
    announcedIp: string;
    domain: string;
    rtcPort: string;
  };
  discord: { clientId: string; hasClientSecret: boolean };
};

type EnvDefaults = {
  customBaseUrl: string;
  customModel: string;
  hasCustomApiKey: boolean;
  comfyUrl: string;
  fluxWorkerUrl: string;
  imageBackend: string;
  hasOpenaiImageApiKey: boolean;
  kokoroUrl: string;
  sttUrl: string;
  discordClientId: string;
  hasDiscordClientSecret: boolean;
  publicUrl: string;
  voiceEnabled: boolean;
  voiceAnnouncedIp: string;
  voiceDomain: string;
  voiceRtcPort: string;
};

// A secret field never receives its stored value; SECRET_KEPT means "leave it
// as is" and is stripped from the patch before sending.
const SECRET_KEPT = "\u0000keep";

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-stone-400">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-[11px] text-stone-600">{hint}</span> : null}
    </label>
  );
}

function SecretField({
  label,
  isSet,
  value,
  onChange,
  hint,
}: {
  label: string;
  isSet: boolean;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
}) {
  const kept = value === SECRET_KEPT;
  return (
    <Field label={label} hint={hint}>
      <div className="flex gap-2">
        <input
          type="password"
          className={ui.input}
          placeholder={isSet && kept ? "•••••••• (set)" : "Not set"}
          value={kept ? "" : value}
          onChange={(event) => onChange(event.target.value)}
        />
        {isSet && kept ? (
          <button
            type="button"
            onClick={() => onChange("")}
            className={cn(ui.btnSmall, "shrink-0 hover:text-red-400")}
          >
            Clear
          </button>
        ) : null}
      </div>
    </Field>
  );
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

  useEffect(() => {
    fetch("/api/admin/settings")
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (data) {
          setConfig(data.config);
          setEnv(data.envDefaults);
        }
      });
  }, []);

  if (!config || !env) {
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="size-5 animate-spin text-stone-500" />
      </div>
    );
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
        body: JSON.stringify({
          signupMode: config.signupMode,
          serverName: config.serverName,
          publicUrl: config.publicUrl,
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
          voiceChat: config.voiceChat,
          discord: {
            clientId: config.discord.clientId,
            ...(discordSecret === SECRET_KEPT ? {} : { clientSecret: discordSecret }),
          },
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        setError(data?.error || "Could not save settings.");
        return;
      }
      setConfig(data.config);
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

  const section = "texture-noise rounded-xl border border-stone-700/50 bg-stone-950/60 p-5 shadow-elev-1";

  return (
    <div className="space-y-4">
      <section className={section}>
        <h2 className="mb-3 text-sm font-medium text-stone-300">Server</h2>
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
      </section>

      <section className={section}>
        <h2 className="mb-3 text-sm font-medium text-stone-300">Accounts</h2>
        <Field label="New account sign-ups">
          <select
            className={ui.input}
            value={config.signupMode}
            onChange={(event) =>
              setConfig({
                ...config,
                signupMode: event.target.value as MaskedConfig["signupMode"],
              })
            }
          >
            <option value="open">Open: anyone with the address can register</option>
            <option value="invite">Invite-only: registering needs a code from below</option>
            <option value="closed">Closed: no new accounts</option>
          </select>
        </Field>
        <p className="mt-2 text-xs text-stone-500">
          Applies to registration and to first-time Discord sign-ins alike. Existing users always
          keep their access.
        </p>
        {config.signupMode === "invite" ? <AdminInvitesSection /> : null}
      </section>

      <section className={section}>
        <h2 className="mb-3 text-sm font-medium text-stone-300">Text model defaults</h2>
        <p className="mb-3 text-xs text-stone-500">
          Defaults for new campaigns and fallbacks when a campaign leaves a field empty. Each
          campaign&apos;s own Text Model settings still win.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Default provider">
            <select
              className={ui.input}
              value={config.text.provider}
              onChange={(event) =>
                setConfig({
                  ...config,
                  text: { ...config.text, provider: event.target.value as "" | "local" | "custom" },
                })
              }
            >
              <option value="">Auto (env or built-in)</option>
              <option value="custom">OpenAI-compatible server</option>
              <option value="local">Ollama (native)</option>
            </select>
          </Field>
          <Field label="Local model (Ollama native)">
            <input
              className={ui.input}
              value={config.text.localTextModel}
              onChange={(event) =>
                setConfig({ ...config, text: { ...config.text, localTextModel: event.target.value } })
              }
              placeholder="gemma4:31b-it-qat"
            />
          </Field>
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
      </section>

      <section className={section}>
        <h2 className="mb-3 text-sm font-medium text-stone-300">Utility model (optional)</h2>
        <p className="mb-3 text-xs text-stone-500">
          A second, smaller model for the mechanical work: history compaction, chapter summaries
          and fact extraction, world-arc ticks, lore checks, and Ask answers. None of it is
          narration, so a small model does it well while the story model keeps its weights and
          prompt cache resident. Leave the model name blank to turn this off, and every one of
          those calls goes back to the story model. If a configured utility model is unreachable,
          the story model picks the job up anyway.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Provider">
            <select
              className={ui.input}
              value={config.text.utilityProvider}
              onChange={(event) =>
                setConfig({
                  ...config,
                  text: {
                    ...config.text,
                    utilityProvider: event.target.value as "" | "local" | "custom",
                  },
                })
              }
            >
              <option value="">Auto (Ollama)</option>
              <option value="local">Ollama (native)</option>
              <option value="custom">OpenAI-compatible server</option>
            </select>
          </Field>
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
      </section>

      <section className={section}>
        <h2 className="mb-3 text-sm font-medium text-stone-300">Image generation</h2>
        <div className="mb-3">
          <Field
            label="Default backend"
            hint="For new campaigns. ComfyUI and the FLUX workers run on this machine; the OpenAI API renders in the cloud with the key below and needs no GPU."
          >
            <select
              className={ui.input}
              value={config.images.defaultBackend}
              onChange={(event) =>
                setConfig({
                  ...config,
                  images: {
                    ...config.images,
                    defaultBackend: event.target.value as MaskedConfig["images"]["defaultBackend"],
                  },
                })
              }
            >
              <option value="">Auto ({env.imageBackend || "ComfyUI"})</option>
              <option value="comfyui">ComfyUI (local)</option>
              <option value="openai">OpenAI API (cloud, needs key)</option>
              <option value="mflux-hs">FLUX worker: mflux (Apple Silicon)</option>
              <option value="sdnq-hs">FLUX worker: sdnq (CUDA/ROCm)</option>
            </select>
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
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
      </section>

      <section className={section}>
        {/* Narration and speech-to-text. Named "Speech" so it is not confused
            with the Voice chat section below, which is a different feature. */}
        <h2 className="mb-3 text-sm font-medium text-stone-300">Speech</h2>
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
      </section>


      <section className={section}>
        <h2 className="mb-3 text-sm font-medium text-stone-300">Voice chat</h2>
        <p className="mb-3 text-xs text-stone-500">
          Lets a table talk over live audio. Needs two things beyond this switch:
          the app reached over <strong>https</strong> (browsers block microphone
          access on plain http, except on localhost), and{" "}
          <strong>one open port</strong> for both UDP and TCP. That port carries the
          audio itself, which is not HTTP and cannot go through a reverse proxy, so
          open it on your firewall pointing straight at this host.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="Voice chat"
            hint={
              config.voiceChat.enabled === ""
                ? `Following the server config: ${env.voiceEnabled ? "on" : "off"}`
                : "Overrides the server config."
            }
          >
            <select
              className={ui.input}
              value={config.voiceChat.enabled}
              onChange={(event) =>
                setConfig({
                  ...config,
                  voiceChat: {
                    ...config.voiceChat,
                    enabled: event.target.value as "" | "on" | "off",
                  },
                })
              }
            >
              <option value="">Use server config ({env.voiceEnabled ? "on" : "off"})</option>
              <option value="on">On</option>
              <option value="off">Off</option>
            </select>
          </Field>
          <Field
            label="Transport"
            hint="The voice server needs the media port below open. Peer-to-peer needs no port and works through tunnels, but suits small tables: every player sends audio to every other player."
          >
            <select
              className={ui.input}
              value={config.voiceChat.mode}
              onChange={(event) =>
                setConfig({
                  ...config,
                  voiceChat: {
                    ...config.voiceChat,
                    mode: event.target.value as "" | "sfu" | "mesh",
                  },
                })
              }
            >
              <option value="">Voice server (default)</option>
              <option value="mesh">Peer-to-peer (mesh)</option>
            </select>
          </Field>
          <Field
            label="Media port"
            hint={`Open for UDP and TCP. Env: ${env.voiceRtcPort}`}
          >
            <input
              className={ui.input}
              value={config.voiceChat.rtcPort}
              onChange={(event) =>
                setConfig({
                  ...config,
                  voiceChat: { ...config.voiceChat, rtcPort: event.target.value },
                })
              }
              placeholder={env.voiceRtcPort}
            />
          </Field>
          <Field
            label="Announced address"
            hint="The address a player's BROWSER can reach this host on, normally your public IP. Leave blank only for a localhost-only install."
          >
            <input
              className={ui.input}
              value={config.voiceChat.announcedIp}
              onChange={(event) =>
                setConfig({
                  ...config,
                  voiceChat: { ...config.voiceChat, announcedIp: event.target.value },
                })
              }
              placeholder={env.voiceAnnouncedIp || "203.0.113.10"}
            />
          </Field>
          <Field
            label="Voice domain (optional)"
            hint="Announce a hostname instead of the IP. It must resolve straight here: a Cloudflare-proxied name does not carry UDP, so calls would connect and stay silent."
          >
            <input
              className={ui.input}
              value={config.voiceChat.domain}
              onChange={(event) =>
                setConfig({
                  ...config,
                  voiceChat: { ...config.voiceChat, domain: event.target.value },
                })
              }
              placeholder={env.voiceDomain || "voice.example.com"}
            />
          </Field>
        </div>
        <p className="mt-3 text-[11px] text-stone-600">
          Port and address changes apply the next time somebody joins a call, once
          nobody is connected. No server restart needed.
        </p>
      </section>

      <section className={section}>
        <h2 className="mb-3 text-sm font-medium text-stone-300">Discord sign-in</h2>
        <p className="mb-3 text-xs text-stone-500">
          Optional. Create an application at discord.com/developers, add the redirect URI
          {" "}<code className="text-stone-400">&lt;public URL&gt;/api/auth/discord/callback</code>{" "}
          (the exact address players use, e.g. https://your.domain or http://lan-host:3005),
          then paste the client ID and secret. The login button appears once both are set.
          Behind a reverse proxy, also set the Public URL in the Server section above.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="Client ID"
            hint={env.discordClientId ? `Env: ${env.discordClientId}` : undefined}
          >
            <input
              className={ui.input}
              value={config.discord.clientId}
              onChange={(event) =>
                setConfig({ ...config, discord: { ...config.discord, clientId: event.target.value } })
              }
              placeholder={env.discordClientId || "Not set"}
            />
          </Field>
          <SecretField
            label="Client secret"
            isSet={config.discord.hasClientSecret}
            value={discordSecret}
            onChange={setDiscordSecret}
            hint={env.hasDiscordClientSecret ? "An env-var secret is also set." : undefined}
          />
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={save} disabled={saving} className={ui.btnPrimary}>
          {saving ? <Loader2 className="size-4 animate-spin" /> : null} Save settings
        </button>
        {saved ? (
          <span className="inline-flex items-center gap-1 text-sm text-emerald-400">
            <Check className="size-4" /> Saved
          </span>
        ) : null}
        {error ? <span className="text-sm text-red-400">{error}</span> : null}
      </div>
    </div>
  );
}
