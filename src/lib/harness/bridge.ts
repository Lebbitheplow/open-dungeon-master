// The bridge between the DM loop and an agent program.
//
// The DM loop (src/lib/dm/turn.ts) was written for a chat model: it sends the
// conversation and its tools, gets back text and tool calls, runs the calls
// through the rules engine itself, appends the results and asks again. An
// agent program runs its own loop instead, calling tools as it goes and
// waiting for each answer. The bridge lets the program BE the model inside
// the existing loop, so it is held to exactly the same rules:
//
//   1. requestDmMessage (provider "harness") starts the program with ODM's
//      MCP endpoint as its only tool source, and waits.
//   2. The program calls a tool. The MCP route hands the call here, and it
//      is held open.
//   3. The held calls are returned to the DM loop as ordinary tool_calls.
//      The loop runs them with every cap, guard and parked roll it applies
//      to the built-in storyteller, and appends the results.
//   4. The loop asks again. The bridge answers the held calls with those
//      results, and the program carries on.
//   5. The program's final text comes back as the reply with no tool calls,
//      and the loop finalizes the turn as it always has.
//
// So nothing the program does reaches the game except through the loop's own
// tool handling, and there is no second copy of the rules to drift.

import { randomBytes, createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ChatMessage, ChatRequestOptions, UpstreamResult } from "@/lib/model-client";
import { buildChildEnv, leaksServerSecret } from "./child-env.ts";
import { childPath } from "./discover.ts";
import { renderCompletion, renderFollowUp, renderTurn, toMcpTools, toolNames } from "./render.ts";
import { adapterFor, harnessConfig, resolveHarnessBinary } from "./status.ts";
import { harnessOfferFor } from "./policy.ts";
import { getCampaignById } from "@/lib/db/campaigns";
import type { HarnessErrorKind, HarnessEvent, HarnessSession, McpToolDefinition } from "./types.ts";
import { isHarnessId } from "./types.ts";

// A burst of parallel calls from one model reply arrives as separate HTTP
// requests a few milliseconds apart; they are gathered into one round, as a
// chat model would have returned them in one message.
const ROUND_GATHER_MS = 180;
// A DM turn's session is closed by the loop itself (releaseHarnessConversation);
// anything else it started gets this long between calls before it is reaped.
const IDLE_MS_TURN = 10 * 60_000;
const IDLE_MS_OTHER = 90_000;
const MAX_LIFETIME_MS = 20 * 60_000;

export const NARRATE_NOW =
  "No more tools are available this turn. Stop calling tools and write the narration for the players now.";
const TURN_OVER = "This turn has ended. Stop calling tools.";

type PendingCall = {
  id: string;
  name: string;
  args: string;
  answer: (text: string, isError: boolean) => void;
};

type Waiter = {
  resolve: (result: UpstreamResult) => void;
  onDelta?: (text: string) => void;
  timer: ReturnType<typeof setTimeout>;
};

export type BridgeCallResult = { text: string; isError: boolean };

export class BridgeSession {
  readonly tokenHash: string;
  readonly campaignId: string | null;
  readonly catalogue: McpToolDefinition[];
  readonly isTurn: boolean;
  allowed: Set<string>;
  narrateOnly = false;
  seen: readonly unknown[] = [];
  private queue: PendingCall[] = [];
  private inflight = new Map<string, PendingCall>();
  private text = "";
  private waiter: Waiter | null = null;
  private stored: UpstreamResult | null = null;
  private gatherTimer: ReturnType<typeof setTimeout> | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private lifeTimer: ReturnType<typeof setTimeout>;
  private program: HarnessSession | null = null;
  private finished = false;
  closed = false;
  private callCounter = 0;
  lastUsage: { inputTokens?: number; outputTokens?: number; costUsd?: number } | undefined;
  // The tool list the program reported when it started, for the admin test.
  readyTools: string[] | null = null;

  readonly cwd: string;
  private readonly onClose: (session: BridgeSession) => void;

  constructor(
    tokenHash: string,
    cwd: string,
    options: { campaignId: string | null; catalogue: McpToolDefinition[]; allowed: Set<string>; isTurn: boolean },
    onClose: (session: BridgeSession) => void,
  ) {
    this.cwd = cwd;
    this.onClose = onClose;
    this.tokenHash = tokenHash;
    this.campaignId = options.campaignId;
    this.catalogue = options.catalogue;
    this.allowed = options.allowed;
    this.isTurn = options.isTurn;
    this.lifeTimer = setTimeout(() => this.close(), MAX_LIFETIME_MS);
    this.lifeTimer.unref?.();
  }

  attach(program: HarnessSession) {
    this.program = program;
  }

  send(text: string) {
    this.finished = false;
    this.program?.send(text);
  }

  get idle(): boolean {
    return this.finished && !this.inflight.size && !this.queue.length;
  }

  // Everything the program reports, other than tool calls.
  onEvent = (event: HarnessEvent) => {
    if (this.closed) {
      return;
    }
    if (event.type === "ready") {
      this.readyTools = event.tools;
      return;
    }
    if (event.type === "delta") {
      this.text += event.text;
      this.waiter?.onDelta?.(event.text);
      return;
    }
    if (event.type === "turn_end") {
      this.finished = true;
      this.lastUsage = event.usage;
      const content = (this.text.trim() ? this.text : event.text).trim();
      this.text = "";
      // Calls still queued when the program says it is done can only be
      // strays; they are answered and dropped.
      for (const call of this.queue.splice(0)) {
        call.answer(TURN_OVER, true);
      }
      this.deliver({ message: { content } });
      return;
    }
    if (event.type === "rate_limit") {
      recordRateLimit(event);
      return;
    }
    if (event.type === "error") {
      this.deliver({ error: harnessError(event.message, event.kind) });
      this.close();
      return;
    }
    if (event.type === "exit") {
      if (!this.closed) {
        this.deliver({ error: harnessError("The agent program stopped before it finished the turn.", "crash") });
        this.close();
      }
    }
  };

  // A tool call from the program, by way of the MCP route.
  call(name: string, args: Record<string, unknown>, callId?: string): Promise<BridgeCallResult> {
    if (this.closed) {
      return Promise.resolve({ text: TURN_OVER, isError: true });
    }
    if (this.narrateOnly) {
      return Promise.resolve({ text: NARRATE_NOW, isError: true });
    }
    if (!this.allowed.has(name)) {
      return Promise.resolve({
        text: `${name} is not available at this point in the game. Use another tool or narrate.`,
        isError: true,
      });
    }
    this.callCounter += 1;
    const id = callId && /^[\w-]{1,80}$/.test(callId) ? callId : `harness_${this.callCounter}`;
    return new Promise<BridgeCallResult>((resolve) => {
      this.queue.push({
        id,
        name,
        args: JSON.stringify(args ?? {}),
        answer: (text, isError) => resolve({ text, isError }),
      });
      this.scheduleGather();
    });
  }

  private scheduleGather() {
    if (this.gatherTimer) {
      clearTimeout(this.gatherTimer);
    }
    this.gatherTimer = setTimeout(() => this.flushRound(), ROUND_GATHER_MS);
  }

  private flushRound() {
    this.gatherTimer = null;
    if (!this.waiter || !this.queue.length) {
      return;
    }
    const round = this.queue.splice(0);
    for (const call of round) {
      this.inflight.set(call.id, call);
    }
    const content = this.text.trim();
    this.text = "";
    this.deliver({
      message: {
        content,
        tool_calls: round.map((call) => ({
          id: call.id,
          type: "function",
          function: { name: call.name, arguments: call.args },
        })),
      },
    });
  }

  private deliver(result: UpstreamResult) {
    const waiter = this.waiter;
    if (!waiter) {
      // Nobody is asking right now; the next request gets it.
      if (!this.stored || result.error) {
        this.stored = result;
      }
      return;
    }
    this.waiter = null;
    clearTimeout(waiter.timer);
    this.armIdle();
    waiter.resolve(result);
  }

  private armIdle() {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
    }
    this.idleTimer = setTimeout(() => this.close(), this.isTurn ? IDLE_MS_TURN : IDLE_MS_OTHER);
    this.idleTimer.unref?.();
  }

  // The loop asks again. New messages since the last ask carry the results
  // of the held calls, and possibly a nudge or correction for the program.
  next(messages: readonly ChatMessage[], options: ChatRequestOptions, timeoutMs: number): Promise<UpstreamResult> {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    const fresh = messages.slice(this.seen.length);
    this.seen = [...messages];
    if (options.tools !== undefined) {
      this.allowed = toolNames(options.tools);
    }
    this.narrateOnly = options.toolChoice === "none" || !options.tools?.length;

    return new Promise<UpstreamResult>((resolve) => {
      const timer = setTimeout(() => {
        if (this.waiter?.resolve === resolve) {
          this.waiter = null;
          resolve({ error: harnessError("The agent program took too long to answer.", "timeout") });
          this.close();
        }
      }, timeoutMs);
      timer.unref?.();
      this.waiter = { resolve, onDelta: options.onDelta, timer };

      // Answer the held calls from the results the loop appended.
      for (const message of fresh) {
        if (message.role === "tool" && message.tool_call_id && this.inflight.has(message.tool_call_id)) {
          const call = this.inflight.get(message.tool_call_id)!;
          this.inflight.delete(message.tool_call_id);
          call.answer(typeof message.content === "string" ? message.content : JSON.stringify(message.content), false);
        }
      }
      // A call the loop chose not to run (over a cap, deduplicated) still
      // needs an answer or the program waits forever.
      for (const call of this.inflight.values()) {
        call.answer("The engine did not run this call. Continue without it.", true);
      }
      this.inflight.clear();
      if (this.narrateOnly) {
        for (const call of this.queue.splice(0)) {
          call.answer(NARRATE_NOW, true);
        }
      }

      if (this.stored) {
        const stored = this.stored;
        this.stored = null;
        this.deliver(stored);
        return;
      }

      const followUp = renderFollowUp(fresh as never[]);
      if (this.finished) {
        if (followUp) {
          this.send(this.narrateOnly ? `${followUp}\n\n${NARRATE_NOW}` : followUp);
        } else {
          // Asked again with nothing new: the last answer stands.
          this.deliver({ message: { content: "" } });
        }
        return;
      }
      if (this.queue.length) {
        this.scheduleGather();
      }
    });
  }

  close() {
    if (this.closed) {
      return;
    }
    this.closed = true;
    for (const timer of [this.gatherTimer, this.idleTimer, this.lifeTimer]) {
      if (timer) {
        clearTimeout(timer);
      }
    }
    for (const call of [...this.queue.splice(0), ...this.inflight.values()]) {
      call.answer(TURN_OVER, true);
    }
    this.inflight.clear();
    if (this.waiter) {
      const waiter = this.waiter;
      this.waiter = null;
      clearTimeout(waiter.timer);
      waiter.resolve({ error: harnessError("The agent program's session ended.", "crash") });
    }
    try {
      this.program?.close();
    } catch {
      // Already gone.
    }
    removeRunDir(this.cwd);
    this.onClose(this);
  }
}

// The run folder is the program's working directory. On Windows it cannot
// be removed while the program is still going down, and a throw from here
// must never carry a concurrency slot away with it (issue 16: two leaked
// slots and every later summary waited out the whole timeout).
function removeRunDir(cwd: string) {
  try {
    rmSync(cwd, { recursive: true, force: true });
  } catch {
    // Best effort; it is a temp folder.
  }
}

// --- registry -------------------------------------------------------------

type BridgeState = {
  byToken: Map<string, BridgeSession>;
  byConversation: WeakMap<object, BridgeSession>;
  turnSlots: number;
  otherSlots: number;
  slotWaiters: Array<{ kind: "turn" | "other"; go: () => void }>;
  rateLimit?: { utilization: number; resetsAt?: number; window?: string; at: number };
};

declare global {
  var __odmHarnessBridge: BridgeState | undefined;
}

function state(): BridgeState {
  if (!globalThis.__odmHarnessBridge) {
    globalThis.__odmHarnessBridge = {
      byToken: new Map(),
      byConversation: new WeakMap(),
      turnSlots: 0,
      otherSlots: 0,
      slotWaiters: [],
    };
  }
  return globalThis.__odmHarnessBridge;
}

function recordRateLimit(event: Extract<HarnessEvent, { type: "rate_limit" }>) {
  state().rateLimit = { utilization: event.utilization, resetsAt: event.resetsAt, window: event.window, at: Date.now() };
}

export function harnessRateLimit() {
  return state().rateLimit ?? null;
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function bridgeSessionForToken(token: string): BridgeSession | null {
  const session = state().byToken.get(hashToken(token));
  return session && !session.closed ? session : null;
}

export function activeBridgeSessions(): number {
  return [...state().byToken.values()].filter((session) => !session.closed).length;
}

// Turns and their helpers draw from separate pools, so a tool handler that
// itself asks the model a question (a settlement generator, a lore check)
// can never deadlock waiting on the slot its own turn is holding.
async function acquireSlot(kind: "turn" | "other", limit: number, timeoutMs: number): Promise<boolean> {
  const s = state();
  const inUse = () => (kind === "turn" ? s.turnSlots : s.otherSlots);
  if (inUse() < limit) {
    if (kind === "turn") s.turnSlots += 1;
    else s.otherSlots += 1;
    return true;
  }
  return new Promise<boolean>((resolve) => {
    const entry = {
      kind,
      go: () => {
        clearTimeout(timer);
        if (kind === "turn") s.turnSlots += 1;
        else s.otherSlots += 1;
        resolve(true);
      },
    };
    const timer = setTimeout(() => {
      s.slotWaiters = s.slotWaiters.filter((waiter) => waiter !== entry);
      resolve(false);
    }, timeoutMs);
    s.slotWaiters.push(entry);
  });
}

function releaseSlot(kind: "turn" | "other") {
  const s = state();
  if (kind === "turn") s.turnSlots = Math.max(0, s.turnSlots - 1);
  else s.otherSlots = Math.max(0, s.otherSlots - 1);
  const index = s.slotWaiters.findIndex((waiter) => waiter.kind === kind);
  if (index >= 0) {
    const [waiter] = s.slotWaiters.splice(index, 1);
    waiter.go();
  }
}

// The loop calls this when a turn is over (finished, parked for dice or
// failed), so the program is stopped at once rather than on the idle timer.
export function releaseHarnessConversation(conversation: object) {
  state().byConversation.get(conversation)?.close();
}

// A later ask continues a live session when its messages begin with exactly
// the messages that session has already seen: the same array grown in place
// (the DM loop) or a copy with more appended (Ask's second hop).
function findSession(messages: readonly ChatMessage[]): BridgeSession | null {
  const s = state();
  const direct = s.byConversation.get(messages as object);
  if (direct && !direct.closed) {
    return direct;
  }
  for (const session of s.byToken.values()) {
    if (session.closed || !session.seen.length || session.seen.length > messages.length) {
      continue;
    }
    if (session.seen.every((message, index) => message === messages[index])) {
      return session;
    }
  }
  return null;
}

export function harnessMcpUrl(): string {
  const explicit = (process.env.HARNESS_MCP_URL ?? "").trim();
  if (explicit) {
    return explicit;
  }
  return `http://127.0.0.1:${process.env.PORT || "3005"}/api/mcp`;
}

export function harnessError(message: string, kind: HarnessErrorKind = "crash"): Response {
  const friendly: Record<HarnessErrorKind, string> = {
    "signed-out": "The server's agent program is signed out. The admin can sign it in again on this machine.",
    limit: "The server's agent program has reached its plan's usage limit. The turn can be retried once the limit resets.",
    lockdown: "The server's agent program could not be locked down, so the turn was refused.",
    missing: "The server's agent program is not installed or could not be found.",
    crash: "",
    timeout: "",
  };
  const text = friendly[kind] ? `${friendly[kind]} (${message})` : message;
  return Response.json({ error: text, harnessError: kind }, { status: kind === "timeout" ? 504 : 502 });
}

export type HarnessRequestContext = {
  // "story" narrates; "utility" does bookkeeping on the cheaper model.
  role: "story" | "utility";
  campaignId?: string;
  // Every tool this kind of call could offer, for the program's tool list.
  // A program reads its tool list once, when it starts, so a tool that
  // becomes available mid-turn (combat starting) must already be on it; the
  // bridge still refuses any call that is not offered at that moment.
  catalogue?: readonly unknown[];
  // A DM turn, released by the loop when it ends.
  turn?: boolean;
};

// The model call, for provider "harness".
export async function requestHarnessMessage(
  messages: ChatMessage[],
  options: ChatRequestOptions,
  context: HarnessRequestContext,
): Promise<UpstreamResult> {
  const config = harnessConfig();
  if (!isHarnessId(config.id)) {
    return { error: harnessError("No agent program is chosen in the admin panel.", "missing") };
  }
  const timeoutMs = options.timeoutMs ?? config.turnTimeoutSec * 1_000;
  // The admin decides which campaigns may spend the plan; a campaign that
  // chose the agent before the rule changed is refused here, not silently
  // served.
  if (context.campaignId) {
    const campaign = getCampaignById(context.campaignId);
    const offer = campaign ? harnessOfferFor(campaign) : null;
    if (offer && !offer.offered) {
      return { error: harnessError(offer.reason ?? "The server's agent is not available to this campaign.", "missing") };
    }
  }

  const live = findSession(messages);
  if (live) {
    state().byConversation.set(messages as object, live);
    return live.next(messages, options, timeoutMs);
  }
  if (!options.tools?.length || options.toolChoice === "none") {
    return completeWithHarness(messages, options, context, timeoutMs);
  }
  return startSession(messages, options, context, timeoutMs);
}

async function prepareRun(context: HarnessRequestContext) {
  const config = harnessConfig();
  if (!isHarnessId(config.id)) {
    return { error: harnessError("No agent program is chosen in the admin panel.", "missing") } as const;
  }
  const binary = await resolveHarnessBinary(config.id, config);
  if (!binary) {
    return { error: harnessError(`${config.id} was not found on this machine.`, "missing") } as const;
  }
  const cwd = mkdtempSync(path.join(os.tmpdir(), "odm-harness-"));
  const env = buildChildEnv(process.env, config.id, await childPath(binary), { HOME: os.homedir() });
  const leak = leaksServerSecret(env, process.env);
  if (leak) {
    removeRunDir(cwd);
    return { error: harnessError(`Refused to start: ${leak} would have reached the program.`, "lockdown") } as const;
  }
  const model =
    context.role === "utility" ? config.utilityModel || config.model : config.model;
  return { config, binary, cwd, env, model, adapter: adapterFor(config.id) } as const;
}

async function startSession(
  messages: ChatMessage[],
  options: ChatRequestOptions,
  context: HarnessRequestContext,
  timeoutMs: number,
): Promise<UpstreamResult> {
  const prepared = await prepareRun(context);
  if ("error" in prepared) {
    return prepared;
  }
  const { config, binary, cwd, env, model, adapter } = prepared;
  const kind = context.turn ? "turn" : "other";
  if (!(await acquireSlot(kind, config.maxConcurrent, timeoutMs))) {
    removeRunDir(cwd);
    return { error: harnessError("Every agent slot is busy with other tables; try again in a moment.", "timeout") };
  }
  const token = randomBytes(32).toString("base64url");
  const catalogue = toMcpTools([...(context.catalogue ?? []), ...(options.tools ?? [])]);
  const session = new BridgeSession(
    hashToken(token),
    cwd,
    {
      campaignId: context.campaignId ?? null,
      catalogue,
      allowed: toolNames(options.tools),
      isTurn: Boolean(context.turn),
    },
    (closed) => {
      state().byToken.delete(closed.tokenHash);
      releaseSlot(kind);
    },
  );
  state().byToken.set(session.tokenHash, session);
  state().byConversation.set(messages as object, session);
  session.seen = [...messages];

  const rendered = renderTurn(messages);
  const result = session.next(messages, options, timeoutMs);
  try {
    const program = await adapter.start({
      binary,
      system: rendered.system,
      model,
      effort: config.effort,
      mcp: { url: harnessMcpUrl(), token },
      cwd,
      env,
      onEvent: session.onEvent,
    });
    session.attach(program);
    session.send(rendered.prompt);
  } catch (error) {
    session.onEvent({
      type: "error",
      kind: "crash",
      message: error instanceof Error ? error.message : "The agent program could not start.",
    });
  }
  return result;
}

// One question, one answer, no tools of any kind: summaries, compaction, the
// narration guard's rewrite, Ask without a search.
async function completeWithHarness(
  messages: ChatMessage[],
  options: ChatRequestOptions,
  context: HarnessRequestContext,
  timeoutMs: number,
): Promise<UpstreamResult> {
  const prepared = await prepareRun(context);
  if ("error" in prepared) {
    return prepared;
  }
  const { config, binary, cwd, env, model, adapter } = prepared;
  if (!(await acquireSlot("other", config.maxConcurrent, timeoutMs))) {
    removeRunDir(cwd);
    return { error: harnessError("Every agent slot is busy; try again in a moment.", "timeout") };
  }
  const rendered = renderCompletion(messages);
  let program: HarnessSession | null = null;
  let text = "";
  let outcome: UpstreamResult;
  try {
    outcome = await new Promise<UpstreamResult>((resolve) => {
    let settled = false;
    const settle = (result: UpstreamResult) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve(result);
      }
    };
    const timer = setTimeout(
      () => settle({ error: harnessError("The agent program took too long to answer.", "timeout") }),
      timeoutMs,
    );
    adapter
      .start({
        binary,
        system: rendered.system,
        model,
        effort: config.effort,
        mcp: null,
        cwd,
        env,
        onEvent: (event) => {
          if (event.type === "delta") {
            text += event.text;
            options.onDelta?.(event.text);
          } else if (event.type === "turn_end") {
            settle({ message: { content: (text.trim() ? text : event.text).trim() } });
          } else if (event.type === "rate_limit") {
            recordRateLimit(event);
          } else if (event.type === "error") {
            settle({ error: harnessError(event.message, event.kind) });
          } else if (event.type === "exit") {
            settle({ error: harnessError("The agent program stopped before it answered.", "crash") });
          }
        },
      })
      .then((started) => {
        program = started;
        if (settled) {
          started.close();
          return;
        }
        started.send(rendered.prompt);
      })
      .catch((error) =>
        settle({
          error: harnessError(error instanceof Error ? error.message : "The agent program could not start.", "crash"),
        }),
      );
    });
  } finally {
    // The slot is released whatever happened above, or the pool shrinks by
    // one for the rest of the server's life.
    try {
      (program as HarnessSession | null)?.close();
    } catch {
      // Already gone.
    }
    removeRunDir(cwd);
    releaseSlot("other");
  }
  return outcome;
}
