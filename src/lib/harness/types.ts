// Public types of the harness context: an agent program the admin already
// has (Claude Code, Codex, opencode, Grok Build) standing in for the story
// model. Pure, no imports, so scripts/test-harness-*.mjs can load it.

export type HarnessId = "claude" | "codex" | "opencode" | "grok";

export const HARNESS_IDS: readonly HarnessId[] = ["claude", "codex", "opencode", "grok"];

export function isHarnessId(value: unknown): value is HarnessId {
  return typeof value === "string" && (HARNESS_IDS as readonly string[]).includes(value);
}

// How far the program's own tools were taken away. "removed" means the
// program was started with none of its built-in tools at all (proven by the
// tool list it reports). "contained" means some remain but are boxed in: a
// read-only sandbox, an empty working folder, every approval refused.
export type Lockdown = "removed" | "contained";

// Why a harness cannot run here even when it is installed.
export type HarnessAvailability = "ok" | "container" | "sandboxed-package" | "phone";

export type HarnessModel = {
  id: string;
  label: string;
  // The model's own context window, where known.
  contextTokens?: number;
  // Good for summaries and bookkeeping: offered first as the utility model.
  cheap?: boolean;
};

export type HarnessAuth = {
  state: "ready" | "signed-out" | "unknown";
  // "subscription" = the vendor's own sign-in (Claude, ChatGPT, SuperGrok);
  // "api-key" = a key in the program's environment or config.
  kind?: "subscription" | "api-key";
  plan?: string;
  // Masked before it leaves the server (maskAccount).
  account?: string;
};

export type HarnessStatus = {
  id: HarnessId;
  label: string;
  installed: boolean;
  version?: string;
  path?: string;
  auth: HarnessAuth;
  models: HarnessModel[];
  // What this program's lockdown can achieve. "unproven" = built from its
  // documentation and not yet run on this machine.
  lockdown: Lockdown;
  lockdownProven: boolean;
  // Whether the program can paint pictures with its own tool at all, and
  // whether one has actually been made here.
  nativeImages: "no" | "untested" | "verified";
  availability: HarnessAvailability;
  // Shown under the card when something is wrong, with the fix.
  message?: string;
  // Commands the admin can run themselves; ODM never runs them.
  installHint?: string;
  signInHint?: string;
  checkedAt: number;
};

export type HarnessConfig = {
  id: HarnessId | "";
  binaryPath: string;
  model: string;
  utilityModel: string;
  effort: "" | "low" | "medium" | "high" | "xhigh" | "max";
  images: "off" | "native";
  imagesVerifiedAt: string;
  campaigns: "all" | "admins";
  maxConcurrent: number;
  turnTimeoutSec: number;
};

// One tool as MCP describes it.
export type McpToolDefinition = {
  name: string;
  description: string;
  inputSchema: { type: "object"; [key: string]: unknown };
};

// What a running program reports back. Tool calls do NOT arrive here: they
// arrive at ODM's own MCP endpoint, which is the only door into the game.
export type HarnessEvent =
  | { type: "ready"; tools: string[] }
  | { type: "delta"; text: string }
  | { type: "turn_end"; text: string; usage?: HarnessUsage }
  | { type: "image"; bytes: Buffer; mime: string }
  | { type: "rate_limit"; utilization: number; resetsAt?: number; window?: string }
  | { type: "error"; message: string; kind?: HarnessErrorKind }
  | { type: "exit"; code: number | null };

export type HarnessErrorKind = "signed-out" | "limit" | "lockdown" | "missing" | "crash" | "timeout";

export type HarnessUsage = { inputTokens?: number; outputTokens?: number; costUsd?: number };

export type HarnessStartOptions = {
  binary: string;
  system: string;
  model: string;
  effort: HarnessConfig["effort"];
  // Null for a plain completion: no tools of any kind.
  mcp: { url: string; token: string } | null;
  // Native image tool on, for a picture run. Everything else stays off.
  images?: boolean;
  cwd: string;
  env: Record<string, string>;
  onEvent: (event: HarnessEvent) => void;
};

export type HarnessSession = {
  // Sends one user message. The first call starts the turn.
  send(text: string): void;
  // Ends the program and releases everything it holds.
  close(): void;
};

export type HarnessAdapter = {
  id: HarnessId;
  label: string;
  binaryNames: readonly string[];
  installHint: string;
  signInHint: string;
  lockdown: Lockdown;
  // Whether the program has its own image tool.
  paints: boolean;
  probe(binary: string, env: Record<string, string>): Promise<Omit<HarnessStatus, "id" | "label" | "availability" | "checkedAt" | "path" | "installHint" | "signInHint" | "lockdown" | "lockdownProven" | "nativeImages"> & { lockdownProven?: boolean }>;
  start(options: HarnessStartOptions): Promise<HarnessSession>;
};
