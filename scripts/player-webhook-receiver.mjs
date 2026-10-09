// Run this on the player's computer, never on ODM's server account.
import { execFile } from "node:child_process";
import { readFileSync, mkdirSync, existsSync, openSync, closeSync, writeFileSync, unlinkSync } from "node:fs";
import { register } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { PlayerInbox, atomicJson, playerPrompt, receiverServer } from "./lib/player-webhook-receiver.mjs";

import { runCodexPlayerTurn } from "./lib/player-webhook-codex.mjs";

register("./lib/register-alias.mjs", import.meta.url);
const [mode, configArg] = process.argv.slice(2);
if (!["--subscribe", "--listen", "--headers", "--unsubscribe"].includes(mode) || !configArg) {
  console.error("Usage: node scripts/player-webhook-receiver.mjs --subscribe|--listen|--unsubscribe <private-config.json>");
  process.exit(1);
}
const configPath = path.resolve(configArg);
const config = JSON.parse(readFileSync(configPath, "utf8"));
const directory = path.resolve(path.dirname(configPath), config.stateDirectory ?? "player-webhook-state");
const subscriptionFile = path.join(directory, "subscription.json");

async function headers() {
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
async function tool(name, args) {
  const result = await mcp("tools/call", { name, arguments: args });
  if (result.isError) throw new Error("ODM refused the player tool; inspect the connection and current character.");
  return JSON.parse(result.content.filter((item) => item.type === "text").map((item) => item.text).join(""));
}
function quoteCommand(value) {
  if (process.platform === "win32") {
    if (/["%!\r\n]/.test(value)) throw new Error("Helper paths cannot contain quotes, expansion characters or newlines.");
    return `"${value}"`;
  }
  return `'${value.replaceAll("'", "'\\''")}'`;
}

try {
  if (mode === "--headers") {
    process.stdout.write(JSON.stringify(await headers()));
  } else {
    const url = new URL(config.mcpUrl);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) throw new Error("Configure a plain HTTPS MCP URL.");
    await mcp("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "odm-player-receiver", version: "1" } });
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    if (mode === "--subscribe") {
      if (existsSync(subscriptionFile)) throw new Error("A subscription is already saved here. Unsubscribe before replacing it.");
      const subscription = await tool("odm_subscribe_player_webhook", { campaignId: config.campaignId, characterId: config.characterId, url: config.receiverUrl });
      atomicJson(subscriptionFile, subscription);
      console.log("Subscription saved privately. Its signing secret was not printed. Start --listen.");
    } else if (mode === "--unsubscribe") {
      const subscription = JSON.parse(readFileSync(subscriptionFile, "utf8"));
      await tool("odm_unsubscribe_player_webhook", { subscriptionId: subscription.id });
      unlinkSync(subscriptionFile);
      // Leave the local ledger for inspecting any uncertain submissions.
      console.log("Webhook removed. Stop the receiver with Ctrl+C.");
    } else {
      const subscription = JSON.parse(readFileSync(subscriptionFile, "utf8"));
      if (subscription.campaignId !== config.campaignId || subscription.characterId !== config.characterId || subscription.url !== config.receiverUrl) throw new Error("Config and saved subscription differ.");
      const lockPath = path.join(directory, "receiver.lock");
      const lock = openSync(lockPath, "wx", 0o600);
      writeFileSync(lock, String(process.pid));
      closeSync(lock);
      process.once("exit", () => { try { unlinkSync(lockPath); } catch { /* Already removed. */ } });
      const inbox = new PlayerInbox(directory);
      const { startJsonRpc } = await import("../src/lib/harness/jsonrpc-stdio.ts");
      const { codexArgs } = await import("../src/lib/harness/adapters/codex.ts");
      const helper = [process.execPath, fileURLToPath(import.meta.url), "--headers", configPath].map(quoteCommand).join(" ");
      const tools = ["odm_whoami", "odm_get_campaign", "odm_get_character", "odm_list_characters", "odm_get_player_webhook_opportunities", "odm_take_action", "odm_answer_roll", "odm_end_turn"];
      const args = [...codexArgs({ mcpUrl: null, images: false, disableServers: [] }), "-c",
        `mcp_servers={odm_player={url=${JSON.stringify(config.mcpUrl)},http_headers_helper=${JSON.stringify(helper)},enabled_tools=${JSON.stringify(tools)}}`];
      const scratch = path.join(directory, "scratch");
      mkdirSync(scratch, { recursive: true, mode: 0o700 });
      let activePeer;
      const wake = (event) => runCodexPlayerTurn(startJsonRpc, args, {
        binary: config.codexBinary ?? "codex", cwd: scratch, env: { ...process.env },
        threadId: inbox.state.threadId, model: config.model, effort: config.effort,
        prompt: playerPrompt(event, config.playerInstructions ?? "Play only your assigned character, helpfully and concisely."),
        onThreadId(threadId) { inbox.state.threadId = threadId; inbox.save(); },
        onPeer(peer) { activePeer = peer; },
      });
      const check = async (event) => {
        if (event.subscriptionId !== subscription.id) return false;
        const state = await tool("odm_get_player_webhook_opportunities", { subscriptionId: subscription.id });
        if (event.type.startsWith("campaign_")) return true;
        if (state.busy) throw new Error("Narration is processing; check again later.");
        return state.lifecycle === "active" && state.opportunities.some((o) => o.opportunityId === event.opportunityId);
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
} catch {
  // Helper output and raw server/app-server errors can contain credentials.
  console.error("Receiver setup failed. Check the private config, credential helper, grant scopes, allowed origin and saved subscription. No secrets were printed.");
  process.exitCode = 1;
}
