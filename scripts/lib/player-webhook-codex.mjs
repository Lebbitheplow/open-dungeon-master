// The receiver owns this app-server thread. It never writes into a desktop
// chat another process may already be driving.
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
