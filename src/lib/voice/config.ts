import { configValue, getGlobalConfig } from "@/lib/app-config";
import { serverEnv } from "@/lib/server-env";

// Voice runs on exactly one extra port, not the RTC port range mediasoup uses
// by default. A single WebRtcServer binds it once at startup and every
// transport on every table multiplexes over it, demultiplexed by ICE ufrag
// (src/lib/voice/room.ts). That keeps the deployment surface to one firewall
// rule instead of a hundred-port range.
//
// The port carries UDP and TCP on the same number: UDP is the real path, TCP
// is the fallback for networks that block outbound UDP.
export const DEFAULT_RTC_PORT = 44444;

// Which transport carries the audio. "sfu" is the mediasoup server on the
// open media port; "mesh" is browser-to-browser WebRTC, which needs no port
// at all and survives an HTTP-only tunnel.
export type VoiceMode = "sfu" | "mesh";

export type VoiceConfig = {
  mode: VoiceMode;
  enabled: boolean;
  listenIp: string;
  // The owner's public IP, and an optional hostname that overrides it. Two
  // settings rather than one because they are answers to different questions:
  // the IP is what the machine is, the domain is what an owner would rather
  // hand out. See announcedAddressFor for the precedence.
  announcedIp: string;
  domain: string;
  port: number;
};

function parsePort(raw: string): number {
  const port = Number.parseInt(raw, 10);
  return Number.isInteger(port) && port > 0 && port < 65536 ? port : DEFAULT_RTC_PORT;
}

// Resolution order matches every other global setting (src/lib/app-config.ts):
// the admin panel wins over the env var, which wins over the code default.
export function voiceConfig(): VoiceConfig {
  const admin = getGlobalConfig().voiceChat;
  const mode: VoiceMode = admin.mode === "mesh" ? "mesh" : "sfu";
  return {
    mode,
    // Opt-in. SFU voice cannot work until the owner opens a port and serves
    // the app over https, so defaulting it on would give every existing
    // install a Join button that fails. Turning it on is the same deliberate
    // act as opening the port. Blank in the admin panel falls through to the
    // env var. Mesh has no port prerequisite: picking the mode IS the
    // deliberate act, so only an explicit "off" disables it.
    enabled:
      mode === "mesh"
        ? admin.enabled !== "off"
        : admin.enabled === "on" ||
          (admin.enabled === "" && serverEnv("VOICE_ENABLED", "0") === "1"),
    listenIp: serverEnv("VOICE_LISTEN_IP", "0.0.0.0"),
    announcedIp: configValue(admin.announcedIp, "VOICE_ANNOUNCED_IP"),
    domain: configValue(admin.domain, "VOICE_DOMAIN"),
    port: parsePort(configValue(admin.rtcPort, "VOICE_RTC_PORT", String(DEFAULT_RTC_PORT))),
  };
}

// Identifies the network settings a running worker was built with. Changing
// any of them in the admin panel means the bound socket no longer matches what
// ICE candidates should say, so the runtime has to be rebuilt
// (src/lib/voice/room.ts).
export function networkSignature(config: VoiceConfig): string {
  return `${config.listenIp}|${announcedAddressFor(config)}|${config.port}`;
}

// What mediasoup writes into ICE candidates, in precedence order:
//
//   1. VOICE_DOMAIN, when the owner would rather hand out a name than an IP.
//      mediasoup accepts a hostname here, not just an address.
//   2. VOICE_ANNOUNCED_IP, the machine's own public or LAN address.
//   3. The listen address, which is only ever right for a localhost-only
//      install, and is why that case needs no configuration at all.
//
// A note on CDN proxies, because it is the subtlest way to get this wrong:
// whatever is announced must resolve to THIS host. A Cloudflare-proxied
// (orange cloud) domain resolves to Cloudflare, which proxies HTTP on a fixed
// set of ports and drops everything else, so announcing it means signaling
// succeeds over 443, the call reports connected, and no audio ever arrives.
// Point VOICE_DOMAIN at a DNS-only (grey cloud) record, or leave it unset and
// announce the IP.
export function announcedAddressFor(config: VoiceConfig): string {
  return config.domain || config.announcedIp || config.listenIp;
}

// True for addresses a browser outside this host cannot route to. Binding
// 0.0.0.0 is right; ANNOUNCING it is not, and neither is announcing a Docker
// bridge address. Called by the campaign voice GET
// (src/app/api/campaigns/[campaignId]/voice/route.ts) and the admin settings
// GET (src/app/api/admin/settings/route.ts), both of which warn rather than
// refuse, because a single-machine install on localhost is perfectly valid.
export function isUnroutableAddress(address: string): boolean {
  if (!address || address === "0.0.0.0" || address === "::") {
    return true;
  }
  // 172.16.0.0/12 covers the Docker bridge range that produces the classic
  // "voice connects then stays silent" failure.
  return /^172\.(1[6-9]|2\d|3[01])\./.test(address);
}
