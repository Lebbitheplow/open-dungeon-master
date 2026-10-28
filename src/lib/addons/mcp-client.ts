import { parseJsonLine, spawnProgram, type SpawnedProgram } from "@/lib/harness/process";

// The server's side of MCP over stdio, as much of it as addons need: the
// initialize handshake, tools/list and tools/call with progress and
// cancellation, and the requests an addon may send back (sampling, ping,
// roots, elicitation). One JSON-RPC message per line, as the stdio
// transport specifies, so any MCP SDK (TypeScript, Python, Go, ...) works
// unchanged, and an addon can be tried out in the MCP Inspector before it
// ever meets this server.

export const MCP_PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"] as const;
export const MAX_MESSAGE_BYTES = 32 * 1024 * 1024;

export type McpTool = { name: string; description: string; inputSchema: unknown };

export type ProgressUpdate = { progress: number; total?: number; message?: string };

type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout> | null;
  onProgress?: (update: ProgressUpdate) => void;
  progressToken?: string;
};

export type McpClientHandlers = {
  // A request from the addon (sampling/createMessage and the like). The
  // return value is the result; a throw becomes a JSON-RPC error.
  onRequest: (method: string, params: Record<string, unknown>) => Promise<unknown>;
  // notifications/message, and anything the addon wrote to stderr.
  onLog: (line: string) => void;
  onExit: (code: number | null, stderrTail: string) => void;
};

export class McpClient {
  private readonly pending = new Map<number, Pending>();
  private readonly byToken = new Map<string, number>();
  private nextId = 1;
  private exited = false;
  private settleExit: () => void = () => undefined;
  // Settles once the program has exited; stop() waits on it so the addon's
  // folder can be moved or deleted right after (Windows holds a running
  // program's folder, EBUSY).
  readonly exit: Promise<void> = new Promise((resolve) => {
    this.settleExit = resolve;
  });
  readonly program: SpawnedProgram;
  serverInfo: { name: string; version: string } = { name: "", version: "" };
  protocolVersion = "";

  private readonly handlers: McpClientHandlers;

  constructor(
    command: string,
    args: readonly string[],
    options: { cwd: string; env: Record<string, string> },
    handlers: McpClientHandlers,
  ) {
    this.handlers = handlers;
    this.program = spawnProgram(command, args, {
      cwd: options.cwd,
      env: options.env,
      maxLineBytes: MAX_MESSAGE_BYTES,
      onLine: (line) => this.onLine(line),
      onExit: (code) => {
        this.exited = true;
        const tail = this.program.stderrTail();
        for (const entry of this.pending.values()) {
          if (entry.timer) clearTimeout(entry.timer);
          entry.reject(new Error(code === null ? "The addon could not be started." : `The addon stopped (exit code ${code}).`));
        }
        this.pending.clear();
        this.byToken.clear();
        this.handlers.onExit(code, tail);
        this.settleExit();
      },
    });
    // stderr is the addon's own log; the client relays it a line at a time.
    this.program.child.stderr.on("data", (chunk: string | Buffer) => {
      for (const line of String(chunk).split(/\r?\n/)) {
        if (line.trim()) this.handlers.onLog(line.slice(0, 2_000));
      }
    });
  }

  get running(): boolean {
    return !this.exited;
  }

  private send(message: Record<string, unknown>) {
    this.program.write(JSON.stringify({ jsonrpc: "2.0", ...message }));
  }

  private onLine(line: string) {
    const message = parseJsonLine(line);
    if (!message) {
      // stdout is the protocol channel; anything else there is a bug in the
      // addon (a stray print), worth seeing in its log.
      this.handlers.onLog(`[stdout] ${line.slice(0, 500)}`);
      return;
    }
    const method = typeof message.method === "string" ? message.method : "";
    const id = message.id as number | string | undefined;
    const params = (message.params && typeof message.params === "object" ? message.params : {}) as Record<string, unknown>;
    if (method && id !== undefined) {
      this.handlers
        .onRequest(method, params)
        .then((result) => this.send({ id, result: result ?? {} }))
        .catch((error) =>
          this.send({ id, error: { code: -32603, message: error instanceof Error ? error.message : String(error) } }),
        );
      return;
    }
    if (method) {
      this.onNotification(method, params);
      return;
    }
    if (typeof id === "number" && this.pending.has(id)) {
      const entry = this.pending.get(id)!;
      this.pending.delete(id);
      if (entry.progressToken) this.byToken.delete(entry.progressToken);
      if (entry.timer) clearTimeout(entry.timer);
      const error = message.error as { message?: string } | undefined;
      if (error) entry.reject(new Error(error.message ?? "The addon answered with an error."));
      else entry.resolve(message.result);
    }
  }

  private onNotification(method: string, params: Record<string, unknown>) {
    if (method === "notifications/progress") {
      const token = String(params.progressToken ?? "");
      const id = this.byToken.get(token);
      const entry = id === undefined ? undefined : this.pending.get(id);
      if (entry?.onProgress && typeof params.progress === "number") {
        entry.onProgress({
          progress: params.progress,
          total: typeof params.total === "number" ? params.total : undefined,
          message: typeof params.message === "string" ? params.message.slice(0, 300) : undefined,
        });
      }
      return;
    }
    if (method === "notifications/message") {
      const data = typeof params.data === "string" ? params.data : JSON.stringify(params.data ?? "");
      this.handlers.onLog(`[${String(params.level ?? "info")}] ${data.slice(0, 2_000)}`);
    }
  }

  request<T = Record<string, unknown>>(
    method: string,
    params: Record<string, unknown> = {},
    options: { timeoutMs?: number; onProgress?: (update: ProgressUpdate) => void } = {},
  ): { id: number; promise: Promise<T> } {
    const id = this.nextId++;
    const progressToken = options.onProgress ? `odm-${id}` : undefined;
    const promise = new Promise<T>((resolve, reject) => {
      if (this.exited) {
        reject(new Error("The addon is not running."));
        return;
      }
      const timer = options.timeoutMs
        ? setTimeout(() => {
            this.pending.delete(id);
            if (progressToken) this.byToken.delete(progressToken);
            reject(new Error(`${method} timed out.`));
          }, options.timeoutMs)
        : null;
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer, onProgress: options.onProgress, progressToken });
      if (progressToken) this.byToken.set(progressToken, id);
      const withMeta = progressToken ? { ...params, _meta: { progressToken } } : params;
      this.send({ id, method, params: withMeta });
    });
    return { id, promise };
  }

  notify(method: string, params: Record<string, unknown> = {}) {
    if (!this.exited) this.send({ method, params });
  }

  // Tells the addon to stop working on a request, and fails it here at once.
  cancel(id: number, reason: string) {
    const entry = this.pending.get(id);
    if (!entry) return;
    this.pending.delete(id);
    if (entry.progressToken) this.byToken.delete(entry.progressToken);
    if (entry.timer) clearTimeout(entry.timer);
    this.notify("notifications/cancelled", { requestId: id, reason });
    entry.reject(new Error(reason));
  }

  async initialize(clientVersion: string, capabilities: Record<string, unknown>, timeoutMs = 30_000) {
    const { promise } = this.request<Record<string, unknown>>(
      "initialize",
      {
        protocolVersion: MCP_PROTOCOL_VERSIONS[0],
        capabilities,
        clientInfo: { name: "open-game-master", version: clientVersion },
      },
      { timeoutMs },
    );
    const result = await promise;
    const version = String(result.protocolVersion ?? "");
    if (!(MCP_PROTOCOL_VERSIONS as readonly string[]).includes(version)) {
      throw new Error(`The addon speaks MCP ${version || "(unknown)"}; this server speaks ${MCP_PROTOCOL_VERSIONS.join(", ")}.`);
    }
    this.protocolVersion = version;
    const info = (result.serverInfo ?? {}) as Record<string, unknown>;
    this.serverInfo = { name: String(info.name ?? ""), version: String(info.version ?? "") };
    this.notify("notifications/initialized");
  }

  async listTools(timeoutMs = 30_000): Promise<McpTool[]> {
    const tools: McpTool[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 20; page += 1) {
      const { promise } = this.request<{ tools?: unknown[]; nextCursor?: string }>(
        "tools/list",
        cursor ? { cursor } : {},
        { timeoutMs },
      );
      const result = await promise;
      for (const raw of result.tools ?? []) {
        const tool = raw as Record<string, unknown>;
        if (typeof tool.name === "string") {
          tools.push({ name: tool.name, description: String(tool.description ?? ""), inputSchema: tool.inputSchema ?? {} });
        }
      }
      cursor = typeof result.nextCursor === "string" && result.nextCursor ? result.nextCursor : undefined;
      if (!cursor) break;
    }
    return tools;
  }

  kill() {
    this.program.kill();
  }

  // Kills the program and waits for it to be gone, up to `timeoutMs` (the
  // program gets SIGTERM, then SIGKILL after three seconds).
  async stop(timeoutMs = 5_000): Promise<void> {
    this.kill();
    if (this.exited) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    await Promise.race([
      this.exit,
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, timeoutMs);
        timer.unref?.();
      }),
    ]);
    if (timer) clearTimeout(timer);
  }
}
