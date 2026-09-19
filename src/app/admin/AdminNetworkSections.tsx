"use client";

import { PageSection } from "@/components/PageShell";
import { ui } from "@/lib/ui";
import {
  Field,
  SecretField,
  SelectField,
  type EnvDefaults,
  type MaskedConfig,
} from "@/app/admin/AdminSettingsFields";

// The two sections about how the server is reached from outside: live voice
// and Discord sign-in. A world an app hosts owns both itself, so the panel
// leaves this whole file out there.
export function AdminNetworkSections({
  config,
  env,
  setConfig,
  voiceUnroutable,
  discordSecret,
  setDiscordSecret,
}: {
  config: MaskedConfig;
  env: EnvDefaults;
  setConfig: (next: MaskedConfig) => void;
  voiceUnroutable: boolean;
  discordSecret: string;
  setDiscordSecret: (value: string) => void;
}) {
  return (
    <>
        <PageSection id="admin-voice" heading="Voice chat" glyph="cue-horn">
          <p className="mb-3 text-xs text-stone-500">
            Lets a table talk over live audio. Needs two things beyond this switch:
            the app reached over <strong>https</strong> (browsers block microphone
            access on plain http, except on localhost), and{" "}
            <strong>one open port</strong> for both UDP and TCP. That port carries the
            audio itself, which is not HTTP and cannot go through a reverse proxy, so
            open it on your firewall pointing straight at this host.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <SelectField
              label="Voice chat"
              hint={
                config.voiceChat.enabled === ""
                  ? `Following the server config: ${env.voiceEnabled ? "on" : "off"}`
                  : "Overrides the server config."
              }
              value={config.voiceChat.enabled}
              onChange={(enabled) => setConfig({ ...config, voiceChat: { ...config.voiceChat, enabled } })}
              options={[
                { value: "", label: `Use server config (${env.voiceEnabled ? "on" : "off"})` },
                { value: "on", label: "On" },
                { value: "off", label: "Off" },
              ]}
            />
            <SelectField
              label="Transport"
              hint="The voice server needs the media port below open. Peer-to-peer needs no port and works through tunnels, but suits small tables: every player sends audio to every other player."
              value={config.voiceChat.mode}
              onChange={(mode) => setConfig({ ...config, voiceChat: { ...config.voiceChat, mode } })}
              options={[
                { value: "", label: "Voice server (default)" },
                { value: "mesh", label: "Peer-to-peer (mesh)" },
              ]}
            />
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
          {/* Hidden as soon as mesh is picked, even before saving: the warning
              is about what the voice server announces, and mesh announces
              nothing. */}
          {voiceUnroutable && config.voiceChat.mode !== "mesh" ? (
            <p role="status" className="live-in mt-3 text-xs text-amber-400">
              Voice will connect but stay silent for remote players: set an announced
              address or domain.
            </p>
          ) : null}
          <p className="mt-3 text-[11px] text-stone-500">
            Port and address changes apply the next time somebody joins a call, once
            nobody is connected. No server restart needed.
          </p>
        </PageSection>

        <PageSection id="admin-discord" heading="Discord sign-in" glyph="system-share">
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
        </PageSection>
    </>
  );
}
