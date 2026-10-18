// Public types of the harness context: an agent program the admin already
// has (Claude Code, Codex, opencode, Grok Build) standing in for the story
// model. Pure, no imports, so scripts/test-harness-*.mjs can load it.

export type HarnessId = "claude" | "codex" | "opencode" | "grok";

export const HARNESS_IDS: readonly HarnessId[] = ["claude", "codex", "opencode", "grok"];

export function isHarnessId(value: unknown): value is HarnessId {
  return typeof value === "string" && (HARNESS_IDS as readonly string[]).includes(value);
}

// No run of a program lives longer than this: the bridge closes every
// session and every completion by then (src/lib/harness/bridge.ts). opencode
// keeps its sessions in a store of its own, and one older than this cannot
// belong to a live run (src/lib/harness/adapters/opencode.ts).
export const HARNESS_MAX_RUN_MS = 20 * 60_000;

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
  // Offers a paid Fast tier on this connection (issue 255).
  fast?: boolean;
  // Its vendor has deprecated it (the model catalog, src/lib/model-registry).
  deprecated?: boolean;
  // The full model id an alias resolves to today, where the program reports
  // it (Claude Code's "opus" stands for whichever Opus model it currently
  // runs): what the catalog is asked about it.
  catalogId?: string;
  // The efforts this model offers, as the program lists them (Claude Code's
  // effort levels, Codex's reasoning efforts, opencode's variants); one it
  // lacks runs at the model's own default. An empty list means it has none,
  // and no list at all that the program does not say.
  efforts?: HarnessEffort[];
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
  // The efforts of the model the program runs when none is chosen, where it
  // says which that is: the Effort picker's choices for a blank model.
  defaultEfforts?: HarnessEffort[];
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

// The efforts the admin can choose (HarnessConfig.effort, "" being the
// program's own default), as the programs name them, lightest first; a
// program's own extra levels are not offered.
export const HARNESS_EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;

export type HarnessEffort = (typeof HARNESS_EFFORTS)[number];

export function isHarnessEffort(value: unknown): value is HarnessEffort {
  return typeof value === "string" && (HARNESS_EFFORTS as readonly string[]).includes(value);
}

export type HarnessConfig = {
  id: HarnessId | "";
  binaryPath: string;
  model: string;
  utilityModel: string;
  effort: "" | HarnessEffort;
  // The bookkeeping model's effort (summaries, compaction, the reader,
  // Ask). Blank = the story's effort, as it was before there were two.
  utilityEffort: "" | HarnessEffort;
  speed: "" | "fast";
  utilitySpeed: "" | "fast";
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
  // The program began a tool call, ODM's or one of its own: what it wrote
  // before was not the narration (src/lib/harness/bridge.ts keeps it only as
  // a draft, for a turn that writes nothing after).
  | { type: "tool_round" }
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
  // The Fast tier, for this run only, and which role it serves (the admin
  // panel shows what it actually ran at). Absent = the program's default.
  speed?: { role: "story" | "utility" };
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
  // The same for Windows PowerShell, where the vendor has one: a curl piped
  // to bash is no use there.
  installHintWindows?: string;
  signInHint: string;
  lockdown: Lockdown;
  // Whether the program has its own image tool.
  paints: boolean;
  // Whether the older transcript may join the system prompt in whole chunks
  // (src/lib/harness/render.ts renderTurn): only a program that reads its
  // system prompt from a file and caches it in blocks gains by it, and only
  // such a program can take one that long. Off, the whole transcript goes in
  // the opening message, as before.
  settledTranscript?: boolean;
  probe(binary: string, env: Record<string, string>): Promise<Omit<HarnessStatus, "id" | "label" | "availability" | "checkedAt" | "path" | "installHint" | "signInHint" | "lockdown" | "lockdownProven" | "nativeImages"> & { lockdownProven?: boolean }>;
  start(options: HarnessStartOptions): Promise<HarnessSession>;
};
