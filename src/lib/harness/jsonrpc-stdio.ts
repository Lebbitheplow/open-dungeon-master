// JSON-RPC 2.0 over a program's stdin and stdout, one message per line. Used
// by Codex's app-server and by ACP programs (Grok Build).

import { parseJsonLine, spawnProgram, type SpawnedProgram } from "./process.ts";

type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> };

export type JsonRpcHandlers = {
  // A notification from the program.
  onNotification: (method: string, params: Record<string, unknown>) => void;
  // A request from the program; the return value is the result.
  onRequest: (method: string, params: Record<string, unknown>) => Promise<unknown> | unknown;
  onExit: (code: number | null, stderr: string) => void;
};

export type JsonRpcPeer = {
  request<T = Record<string, unknown>>(method: string, params?: unknown, timeoutMs?: number): Promise<T>;
  notify(method: string, params?: unknown): void;
  kill(): void;
  program: SpawnedProgram;
};

export function startJsonRpc(
  binary: string,
  args: readonly string[],
  options: { cwd: string; env: Record<string, string> },
  handlers: JsonRpcHandlers,
): JsonRpcPeer {
  const pending = new Map<number | string, Pending>();
  let nextId = 1;
  // Declared before the program exists, called only once it does: the
  // handlers below run on the program's output.
  const send = (message: Record<string, unknown>) => program.write(JSON.stringify({ jsonrpc: "2.0", ...message }));

  const program: SpawnedProgram = spawnProgram(binary, args, {
    cwd: options.cwd,
    env: options.env,
    onLine: (line) => {
      const message = parseJsonLine(line);
      if (!message) {
        return;
      }
      const id = message.id as number | string | undefined;
      const method = typeof message.method === "string" ? message.method : "";
      if (method && id !== undefined) {
        Promise.resolve()
          .then(() => handlers.onRequest(method, (message.params as Record<string, unknown>) ?? {}))
          .then((result) => send({ id, result: result ?? {} }))
          .catch((error) =>
            send({ id, error: { code: -32000, message: error instanceof Error ? error.message : String(error) } }),
          );
        return;
      }
      if (method) {
        handlers.onNotification(method, (message.params as Record<string, unknown>) ?? {});
        return;
      }
      if (id !== undefined && pending.has(id)) {
        const entry = pending.get(id)!;
        pending.delete(id);
        clearTimeout(entry.timer);
        if (message.error) {
          const error = message.error as { message?: string };
          entry.reject(new Error(error.message ?? "JSON-RPC error"));
        } else {
          entry.resolve(message.result);
        }
      }
    },
    onExit: (code) => {
      for (const entry of pending.values()) {
        clearTimeout(entry.timer);
        entry.reject(new Error("The program exited."));
      }
      pending.clear();
      handlers.onExit(code, program.stderrTail());
    },
  });

  return {
    request<T>(method: string, params: unknown = {}, timeoutMs = 60_000) {
      const id = nextId++;
      return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`${method} timed out`));
        }, timeoutMs);
        pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer });
        send({ id, method, params });
      });
    },
    notify(method: string, params: unknown = {}) {
      send({ method, params });
    },
    kill: () => program.kill(),
    program,
  };
}
