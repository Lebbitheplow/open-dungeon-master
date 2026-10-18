// The receiver file a player saves for scripts/player-webhook-receiver.mjs
// (docs/player-webhooks.md), filled in from what the server already knows:
// its MCP address, the campaign and the player's character at that table.
// Settings > Connected agents offers it as a download, so nobody copies a
// campaign sheet ID out of the app by hand. It holds no token: the receiver
// keeps that in the operating system's credential store (--setup asks once).
// Each file names its own state directory, so receivers for several agents
// can share one private folder.

import { slugOf } from "../language/text-logic.ts";

export const RECEIVER_PATH = "/odm-player";
export const RECEIVER_PORT = 8787;

export type ReceiverConfig = {
  mcpUrl: string;
  campaignId: string;
  characterId: string;
  receiverUrl: string;
  stateDirectory: string;
  codexBinary: string;
  port: number;
  playerInstructions: string;
  effort: string;
};

// The address the server will send to, from what the player typed: their
// HTTPS tunnel's address, with the receiver's path added when they gave only
// the host. Anything else is refused here as the server would refuse it.
export function receiverUrl(value: string): string {
  const invalid = "Give your receiver's HTTPS address, such as https://my-pc.example.ts.net:8443.";
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new Error(invalid); }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) throw new Error(invalid);
  if (url.pathname === "/" || url.pathname === "") url.pathname = RECEIVER_PATH;
  return url.href;
}

export function receiverPort(value: number): number {
  if (!Number.isInteger(value) || value < 1024 || value > 65535) throw new Error("Pick a local port from 1024 to 65535.");
  return value;
}

// A name for the character's files: the name's words, in any script.
// The name is for the person reading the folder; the end of the campaign
// sheet's ID keeps two sheets apart that share a name (one library character
// copied into two campaigns), so their receivers never share state or a
// stored token.
export function receiverSlug(characterName: string, characterId: string): string {
  const name = slugOf(characterName).slice(0, 24).replace(/_+$/, "");
  const id = characterId.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(-8) || "player";
  return name ? `${name}-${id}` : id;
}

export function receiverFileName(characterName: string, characterId: string): string {
  return `receiver-${receiverSlug(characterName, characterId)}.json`;
}

export function receiverConfig(input: {
  mcpUrl: string;
  campaignId: string;
  characterId: string;
  characterName: string;
  receiverUrl: string;
  port?: number;
}): ReceiverConfig {
  return {
    mcpUrl: input.mcpUrl,
    campaignId: input.campaignId,
    characterId: input.characterId,
    receiverUrl: receiverUrl(input.receiverUrl),
    stateDirectory: `player-webhook-state-${receiverSlug(input.characterName, input.characterId)}`,
    codexBinary: "codex",
    port: receiverPort(input.port ?? RECEIVER_PORT),
    playerInstructions: `Play only ${input.characterName}, concisely and helpfully. Let the other players decide for themselves.`,
    effort: "medium",
  };
}

// What to run from the ODM repository on the player's computer. file is
// where they saved the receiver file. A Tailscale address also gets the
// Funnel line that publishes the local port at the HTTPS port the address
// names (Funnel takes 443, 8443 and 10000); mounting the whole port keeps the
// receiver's path as it is.
export function receiverCommands(file: string, config: Pick<ReceiverConfig, "receiverUrl" | "port">): { setup: string; listen: string; tunnel: string | null } {
  const url = new URL(config.receiverUrl);
  const httpsPort = Number(url.port || 443);
  const tunnel = url.hostname.endsWith(".ts.net") && [443, 8443, 10000].includes(httpsPort)
    ? `tailscale funnel --bg --https=${httpsPort} http://127.0.0.1:${config.port}`
    : null;
  return {
    setup: `node scripts/player-webhook-receiver.mjs --setup ${file}`,
    listen: `node scripts/player-webhook-receiver.mjs --listen ${file}`,
    tunnel,
  };
}
