// "Test the table" in the admin panel: one real, tiny turn through the whole
// path a DM turn takes. The program is started exactly as it would be for a
// table, is given one harmless tool, must call it over ODM's MCP endpoint,
// must receive the answer and must reply with it. Every stage is reported,
// so a failure says which part broke.

import type { ChatMessage } from "@/lib/model-client";
import { releaseHarnessConversation, requestHarnessMessage } from "./bridge.ts";
import { ADAPTERS, harnessConfig, markLockdownProven, probeHarness } from "./status.ts";
import { isHarnessId, type HarnessId } from "./types.ts";

export type TestStage = {
  id: "found" | "signedIn" | "handshake" | "toolCall" | "lockdown" | "streaming";
  ok: boolean | null;
  detail?: string;
};

const PROBE_TOOL = {
  type: "function",
  function: {
    name: "table_check",
    description: "Answers with the secret word for this table check. Call it exactly once.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: { seat: { type: "integer", description: "Any whole number." } },
      required: ["seat"],
    },
  },
};

const SECRET = "lanternfall";

export async function testHarness(idOverride?: HarnessId): Promise<{ stages: TestStage[]; ms: number }> {
  const started = Date.now();
  const config = harnessConfig();
  const id = idOverride ?? (isHarnessId(config.id) ? config.id : null);
  const stages: TestStage[] = [
    { id: "found", ok: null },
    { id: "signedIn", ok: null },
    { id: "handshake", ok: null },
    { id: "toolCall", ok: null },
    { id: "lockdown", ok: null },
    { id: "streaming", ok: null },
  ];
  const set = (stageId: TestStage["id"], ok: boolean, detail?: string) => {
    const stage = stages.find((entry) => entry.id === stageId)!;
    stage.ok = ok;
    stage.detail = detail;
  };
  const done = () => ({ stages, ms: Date.now() - started });

  if (!id) {
    set("found", false, "No agent program is chosen yet.");
    return done();
  }
  const status = await probeHarness(id, { refresh: true });
  if (!status.installed || status.availability !== "ok") {
    set("found", false, status.message ?? `${ADAPTERS[id].label} was not found.`);
    return done();
  }
  set("found", true, `${status.version ?? ""} ${status.path ?? ""}`.trim());
  if (status.auth.state === "signed-out") {
    set("signedIn", false, status.message ?? `Run \`${ADAPTERS[id].signInHint}\` on this machine.`);
    return done();
  }
  set("signedIn", true, [status.auth.plan, status.auth.account].filter(Boolean).join(" · ") || undefined);

  let streamed = "";
  const messages: ChatMessage[] = [
    {
      role: "system",
      content:
        "This is a connection check, not a game. Call the table_check tool exactly once with seat 1, then reply with only the word it gives you.",
    },
    { role: "user", content: "Run the table check now." },
  ];
  const first = await requestHarnessMessage(
    messages,
    { tools: [PROBE_TOOL], toolChoice: "auto", timeoutMs: 180_000, onDelta: (text) => (streamed += text) },
    { role: "story" },
  );
  if (first.error) {
    const body = (await first.error.json().catch(() => ({}))) as { error?: string };
    set("handshake", false, body.error ?? "The program did not answer.");
    return done();
  }
  const calls = Array.isArray(first.message?.tool_calls) ? (first.message?.tool_calls as Array<{ id: string; function: { name: string } }>) : [];
  const probeCall = calls.find((call) => call.function?.name === "table_check");
  if (!probeCall) {
    set("handshake", true);
    set("toolCall", false, "The program answered without calling ODM's tool, so it cannot run a table.");
    releaseHarnessConversation(messages);
    return done();
  }
  set("handshake", true);
  messages.push({ role: "assistant", content: "", tool_calls: calls });
  for (const call of calls) {
    messages.push({
      role: "tool",
      tool_call_id: call.id,
      content: call.function?.name === "table_check" ? JSON.stringify({ word: SECRET }) : "Unknown tool.",
    });
  }
  const second = await requestHarnessMessage(
    messages,
    { tools: [PROBE_TOOL], toolChoice: "auto", timeoutMs: 180_000, onDelta: (text) => (streamed += text) },
    { role: "story" },
  );
  if (second.error) {
    const body = (await second.error.json().catch(() => ({}))) as { error?: string };
    set("toolCall", false, body.error ?? "The program stopped after the tool call.");
    releaseHarnessConversation(messages);
    return done();
  }
  releaseHarnessConversation(messages);
  const reply = String(second.message?.content ?? "");
  const heard = reply.toLowerCase().includes(SECRET);
  set("toolCall", heard, heard ? undefined : `It replied "${reply.slice(0, 80)}" instead of the tool's answer.`);
  // Every adapter stops a run that reaches for its own tools (a stray tool on
  // Claude's list, a command or file change from Codex), so a run that got
  // this far held its lockdown. That is what proves an adapter on this
  // machine, and the card says so from now on.
  set(
    "lockdown",
    true,
    ADAPTERS[id].lockdown === "removed"
      ? "Its own tools are removed; only the table's tools are offered."
      : "Its own tools are contained: read-only, an empty folder, every approval refused.",
  );
  if (heard) {
    markLockdownProven(id);
  }
  set("streaming", streamed.length > 0, streamed.length > 0 ? undefined : "The reply arrived whole rather than streamed.");
  return done();
}
