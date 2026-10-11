// The receiver owns this app-server thread. It never writes into a desktop
// chat another process may already be driving.
import path from "node:path";

export function playerCodexEnvironment(directory, inherited = process.env) {
  const env = { ...inherited, CODEX_HOME: path.join(directory, "codex-home") };
  // The device-auth profile supplies the player's subscription sign-in.
  // An unrelated API key in the parent shell must not select paid API auth.
  delete env.OPENAI_API_KEY;
  return env;
}

export function playerMcpOverride(url, helper) {
  // The table's own sheet (odm_get_sheet), not the library copy play does
  // not change, the transcript pager for anything older than the snapshot, and
  // the DM's private whispers, which the transcript never carries.
  const tools = ["odm_whoami", "odm_get_campaign", "odm_get_sheet", "odm_get_messages", "odm_get_whispers", "odm_get_player_webhook_opportunities", "odm_take_action", "odm_answer_roll", "odm_end_turn"];
  return `mcp_servers={odm_player={url=${JSON.stringify(url)},http_headers_helper=${JSON.stringify(helper)},enabled_tools=${JSON.stringify(tools)},default_tools_approval_mode="approve",tool_timeout_sec=120,startup_timeout_sec=30}}`;
}

export async function runCodexPlayerTurn(createPeer, args, options) {
  let resolveTurn, rejectTurn;
  const completed = new Promise((resolve, reject) => { resolveTurn = resolve; rejectTurn = reject; });
  completed.catch(() => {});
  const peer = createPeer(options.binary, args, { cwd: options.cwd, env: options.env }, {
    onNotification(method, params) {
      if (method === "turn/completed") {
        if (params.turn?.status === "completed") resolveTurn();
        else rejectTurn(new Error("Player turn failed."));
      }
    },
    onRequest(method) {
      if (["item/commandExecution/requestApproval", "item/fileChange/requestApproval", "item/permissions/requestApproval"].includes(method)) return { decision: "decline" };
      if (method === "mcpServer/elicitation/request") return { action: "decline" };
      if (method === "item/tool/requestUserInput") return { answers: {} };
      throw new Error("Unsupported receiver request.");
    },
    onExit() { rejectTurn(new Error("Codex stopped.")); },
  });
  options.onPeer?.(peer);
  const timeout = setTimeout(() => rejectTurn(new Error("Player turn timed out.")), options.timeoutMs ?? 180_000);
  try {
    await peer.request("initialize", { clientInfo: { name: "odm_player_receiver", version: "1" } });
    peer.notify("initialized");
    const thread = await peer.request(options.threadId ? "thread/resume" : "thread/start", {
      ...(options.threadId ? { threadId: options.threadId } : {}), cwd: options.cwd, approvalPolicy: "never", sandbox: "read-only",
      ...(options.model ? { model: options.model } : {}),
    });
    const threadId = thread.thread?.id;
    if (!threadId) throw new Error("Codex did not return a thread.");
    options.onThreadId(threadId);
    await peer.request("turn/start", {
      threadId, input: [{ type: "text", text: options.prompt }], approvalPolicy: "never", sandboxPolicy: { type: "readOnly" },
      ...(options.effort ? { effort: options.effort } : {}),
    });
    await completed;
  } finally { clearTimeout(timeout); peer.kill(); options.onPeer?.(undefined); }
}
