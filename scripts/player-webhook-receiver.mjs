// Run this on the player's computer, never on ODM's server account.
import { execFile, spawn, spawnSync } from "node:child_process";
import { readFileSync, mkdirSync, existsSync, unlinkSync, renameSync } from "node:fs";
import { register } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { LockRefused, PlayerInbox, atomicJson, playerPrompt, receiverServer, stillCurrent, takeReceiverLock } from "./lib/player-webhook-receiver.mjs";
import { promptSecret, saveToken, tokenStore } from "./lib/player-token-store.mjs";

import { runCodexPlayerTurn, playerCodexEnvironment, playerMcpOverride } from "./lib/player-webhook-codex.mjs";

register("./lib/register-alias.mjs", import.meta.url);
const MODES = ["--setup", "--save-token", "--login", "--subscribe", "--listen", "--headers", "--unsubscribe"];
const [mode, configArg] = process.argv.slice(2);
if (!MODES.includes(mode) || !configArg) {
  console.error("Usage: node scripts/player-webhook-receiver.mjs --setup|--listen|--save-token|--login|--subscribe|--unsubscribe <private-config.json>");
  process.exit(1);
}
const configPath = path.resolve(configArg);
const config = JSON.parse(readFileSync(configPath, "utf8"));
const directory = path.resolve(path.dirname(configPath), config.stateDirectory ?? "player-webhook-state");
const subscriptionFile = path.join(directory, "subscription.json");
const receiverCodexHome = path.join(directory, "codex-home");
// Without an authCommand, the token lives in the operating system's store.
const store = tokenStore(directory);

// An error whose message holds no secret, so it may be printed as it is.
class Plain extends Error {}

async function headers() {
  if (config.authCommand === undefined) {
    return { Authorization: `Bearer ${await store.read()}` };
  }
  if (!Array.isArray(config.authCommand) || !config.authCommand.length || config.authCommand.some((s) => typeof s !== "string")) throw new Error("Configure authCommand as an executable and argument list.");
  const { stdout } = await promisify(execFile)(config.authCommand[0], config.authCommand.slice(1), { windowsHide: true, maxBuffer: 8192, timeout: 10_000 });
  const value = JSON.parse(stdout);
  if (typeof value.Authorization !== "string" || !/^Bearer\s+\S+$/i.test(value.Authorization)) throw new Error("The credential helper did not return bearer headers.");
  return { Authorization: value.Authorization };
}

async function mcp(method, params) {
  const response = await fetch(config.mcpUrl, {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(30_000),
    headers: { ...(await headers()), "Content-Type": "application/json", Accept: "application/json, text/event-stream", "MCP-Protocol-Version": "2025-03-26" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!response.ok) throw new Error("ODM connection failed; check the grant and server.");
  const body = await response.text();
  let message;
  if (response.headers.get("content-type")?.includes("text/event-stream")) {
    message = body.split("\n").filter((line) => line.startsWith("data:")).map((line) => JSON.parse(line.slice(5))).find((item) => item.id === 1);
  } else message = JSON.parse(body);
  if (!message || message.error) throw new Error("ODM refused the request.");
  return message.result;
}
// A tool ODM refused. Its own reason is kept for matching against known
// cases; it is not printed as it is.
class Refused extends Error {
  constructor(reason) { super("ODM refused the player tool; inspect the connection and current character."); this.reason = reason; }
}
async function tool(name, args) {
  const result = await mcp("tools/call", { name, arguments: args });
  const text = result.content.filter((item) => item.type === "text").map((item) => item.text).join("");
  if (result.isError) throw new Refused(text);
  return JSON.parse(text);
}
function quoteCommand(value) {
  if (process.platform === "win32") {
    if (/["%!\r\n]/.test(value)) throw new Error("Helper paths cannot contain quotes, expansion characters or newlines.");
    return `"${value}"`;
  }
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function checkMcpUrl() {
  const url = new URL(config.mcpUrl);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) throw new Plain("Configure a plain HTTPS MCP URL (mcpUrl).");
}

// A bare name, like the receiver file's "codex", is looked up the way the
// server finds its programs: on Windows npm installs codex.cmd, and spawn()
// does not find that by its bare name.
async function codexBinary() {
  const name = config.codexBinary ?? "codex";
  if (os.platform() !== "win32" || /[\\/]/.test(name) || path.extname(name)) return name;
  const { findBinary } = await import("../src/lib/harness/discover.ts");
  return (await findBinary([name])) ?? name;
}

async function codexShim() {
  const { resolveWindowsShim } = await import("../src/lib/harness/discover.ts");
  return resolveWindowsShim(await codexBinary());
}

// Codex handles its own device sign-in in the player's terminal. No
// credentials are read, copied from their normal profile, or logged here.
async function login() {
  mkdirSync(receiverCodexHome, { recursive: true, mode: 0o700 });
  const { command, prefix } = await codexShim();
  const exitCode = await new Promise((resolve, reject) => {
    const child = spawn(command, [...prefix, "login", "--device-auth"], {
      env: playerCodexEnvironment(directory), stdio: "inherit", windowsHide: true,
    });
    child.on("error", () => reject(new Plain("Codex could not be started. Install the Codex CLI, or set codexBinary in the config to its path.")));
    child.on("exit", resolve);
  });
  if (exitCode !== 0) throw new Plain("Codex sign-in did not finish.");
}

async function signedIn() {
  if (!existsSync(receiverCodexHome)) return false;
  const { command, prefix } = await codexShim();
  const result = spawnSync(command, [...prefix, "login", "status"], { env: playerCodexEnvironment(directory), stdio: "ignore", windowsHide: true, timeout: 30_000 });
  return result.status === 0;
}

async function askForToken() {
  const token = await promptSecret("Paste this connection's token (from Settings > Connected agents; it is not shown): ");
  try {
    await saveToken(store, token);
  } catch (error) {
    throw new Plain(error instanceof Error ? error.message : "The token could not be saved.");
  }
  console.log(`Token saved in ${store.where}.`);
}

async function subscribe() {
  if (existsSync(subscriptionFile)) throw new Plain("A subscription is already saved here. Unsubscribe before replacing it.");
  let subscription;
  try {
    subscription = await tool("odm_subscribe_player_webhook", { campaignId: config.campaignId, characterId: config.characterId, url: config.receiverUrl });
  } catch (error) {
    if (error instanceof Refused && /already has a webhook receiver/i.test(error.reason)) {
      throw new Plain("ODM already has a receiver registered for this character, from another folder or computer. Run --unsubscribe there, or revoke that connection under Settings > Connected agents, then run --setup again.");
    }
    throw new Plain("ODM did not register the webhook. Check that the server's admin allowed this receiver address (Admin > Player agents) and that this character is still the one you play at that table.");
  }
  atomicJson(subscriptionFile, subscription);
  console.log("Subscription saved privately. Its signing secret was not printed.");
}

function savedSubscription() {
  const saved = JSON.parse(readFileSync(subscriptionFile, "utf8"));
  if (saved.campaignId !== config.campaignId || saved.characterId !== config.characterId || saved.url !== config.receiverUrl) {
    throw new Plain("This folder's saved webhook is for another campaign, character or address than this config. Give this config its own stateDirectory, or run --unsubscribe with the old config first.");
  }
  return saved;
}

// Everything before --listen, in one run: the token once, ODM's answer to
// it, the receiver's own Codex sign-in, and the webhook registration. Steps
// already done are kept, after asking ODM whether they still hold: a
// connection that expired or was revoked takes its webhook with it.
async function setup() {
  checkMcpUrl();
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  let storedEarlier = false;
  if (config.authCommand === undefined) {
    try { await store.read(); storedEarlier = true; } catch { storedEarlier = false; }
    if (storedEarlier) console.log(`A token is already saved in ${store.where}; --save-token replaces it.`);
    else await askForToken();
  }
  try {
    await mcp("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "odm-player-receiver", version: "1" } });
  } catch {
    throw new Plain(storedEarlier
      ? "ODM did not accept the saved token. If you made a new connection, run --save-token with its token, then --setup again. Otherwise check mcpUrl."
      : "ODM did not accept this connection. Check mcpUrl, and that the connection still exists with Read and Play.");
  }
  console.log("ODM accepted the connection.");
  if (await signedIn()) console.log("The receiver's Codex profile is already signed in.");
  else {
    console.log("Sign the receiver's own Codex profile in (your usual Codex sign-in is not touched):");
    await login();
  }
  if (existsSync(subscriptionFile)) {
    const saved = savedSubscription();
    let live = true;
    try { await tool("odm_get_player_webhook_opportunities", { subscriptionId: saved.id }); } catch { live = false; }
    if (live) console.log("The webhook is already registered.");
    else {
      // Kept beside the ledger rather than deleted, for anyone checking an
      // uncertain turn later.
      renameSync(subscriptionFile, `${subscriptionFile}.gone-${Date.now()}`);
      console.log("The saved webhook is no longer on the server (it was removed, or its connection expired or was revoked). Registering it again.");
      await subscribe();
    }
  } else await subscribe();
  console.log(`Done. Start the receiver and keep it running:\n  node scripts/player-webhook-receiver.mjs --listen ${configArg}`);
  console.log(`Then point an HTTPS tunnel at http://127.0.0.1:${config.port ?? 8787} so ${config.receiverUrl} reaches it.`);
}

try {
  if (mode === "--setup") {
    await setup();
  } else if (mode === "--save-token") {
    if (config.authCommand !== undefined) throw new Plain("This config reads its token through authCommand, so a saved token would not be used. Remove authCommand to use the saved one.");
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    await askForToken();
  } else if (mode === "--login") {
    await login();
  } else if (mode === "--headers") {
    process.stdout.write(JSON.stringify(await headers()));
  } else {
    checkMcpUrl();
    await mcp("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "odm-player-receiver", version: "1" } });
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    if (mode === "--subscribe") {
      await subscribe();
      console.log("Start --listen.");
    } else if (mode === "--unsubscribe") {
      const subscription = JSON.parse(readFileSync(subscriptionFile, "utf8"));
      await tool("odm_unsubscribe_player_webhook", { subscriptionId: subscription.id });
      unlinkSync(subscriptionFile);
      // Leave the local ledger for inspecting any uncertain submissions.
      console.log("Webhook removed. Stop the receiver with Ctrl+C.");
    } else {
      const subscription = savedSubscription();
      let release;
      try {
        release = takeReceiverLock(path.join(directory, "receiver.lock"));
      } catch (error) {
        throw error instanceof LockRefused ? new Plain(error.message) : error;
      }
      process.once("exit", release);
      const inbox = new PlayerInbox(directory);
      const { startJsonRpc } = await import("../src/lib/harness/jsonrpc-stdio.ts");
      const { codexArgs } = await import("../src/lib/harness/adapters/codex.ts");
      mkdirSync(receiverCodexHome, { recursive: true, mode: 0o700 });
      const helper = [process.execPath, fileURLToPath(import.meta.url), "--headers", configPath].map(quoteCommand).join(" ");
      const args = [...codexArgs({ mcpUrl: null, images: false, disableServers: [], catalogPath: null }), "-c",
        playerMcpOverride(config.mcpUrl, helper)];
      const scratch = path.join(directory, "scratch");
      mkdirSync(scratch, { recursive: true, mode: 0o700 });
      const binary = await codexBinary();
      let activePeer;
      const wake = (event) => runCodexPlayerTurn(startJsonRpc, args, {
        binary, cwd: scratch, env: playerCodexEnvironment(directory),
        threadId: inbox.state.threadId, model: config.model, effort: config.effort,
        prompt: playerPrompt(event, config.playerInstructions ?? "Play only your assigned character, helpfully and concisely."),
        onThreadId(threadId) { inbox.state.threadId = threadId; inbox.save(); },
        onPeer(peer) { activePeer = peer; },
      });
      const check = async (event) => {
        if (event.subscriptionId !== subscription.id) return false;
        return stillCurrent(await tool("odm_get_player_webhook_opportunities", { subscriptionId: subscription.id }), event);
      };
      const server = receiverServer({ ...subscription, path: new URL(config.receiverUrl).pathname }, inbox);
      server.requestTimeout = 10_000;
      server.headersTimeout = 10_000;
      server.listen(config.port ?? 8787, "127.0.0.1", () => console.log("Player receiver listening on loopback. Keep the HTTPS tunnel and this process running."));
      const timer = setInterval(() => void inbox.processOne(check, wake).catch(() => console.error("Receiver storage failed; inspect local state.")), 1000);
      const stop = () => { clearInterval(timer); activePeer?.kill(); server.close(); };
      process.on("SIGINT", stop);
      process.on("SIGTERM", stop);
    }
  }
} catch (error) {
  // Helper output and raw server/app-server errors can contain credentials,
  // so only this script's own plain messages are printed.
  console.error(error instanceof Plain
    ? error.message
    : "Receiver setup failed. Check the private config, saved token or credential helper, grant scopes, allowed receiver address and saved subscription. No secrets were printed.");
  process.exitCode = 1;
}
