// Test backend (POST /api/admin/backend-probe) plays its campaign-shaped test
// turn (src/lib/backend-trial.ts) for the storyteller only. A utility model
// never plays a turn: its calls (summaries, Ask, lore checks) carry no game
// tools, so the turn would spend its tokens and could mark a helper that
// does its own work well as one that "cannot run the storyteller loop".
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, vi } from "vitest";
import { removeTempDir } from "./lib/remove-temp-dir.mjs";

vi.mock("@/lib/admin-api", () => ({
  requireAdmin: async () => ({ isAdmin: true }),
  isErrorResponse: (value) => value instanceof Response,
}));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "odm-backend-trial-route-"));
process.env.SQLITE_DB_PATH = path.join(dir, "test.sqlite");
process.env.DB_ENCRYPTION_KEY = randomBytes(32).toString("hex");

const { POST } = await import("../src/app/api/admin/backend-probe/route.ts");

const sse = (events) =>
  new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("") + "data: [DONE]\n\n", {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
const ARGS = '{"characterId":"pc-ash","kind":"skill_check","skill":"sleight_of_hand","difficulty":"moderate"}';

// One OpenAI-compatible host: the quick checks' own prompts, then the turn.
const turnCalls = [];
globalThis.fetch = async (url, init) => {
  if (!String(url).endsWith("/chat/completions")) return new Response("Not Found", { status: 404 });
  const body = JSON.parse(init.body);
  const answered = body.messages.some((message) => message.role === "tool");
  if (body.tools?.[0]?.function?.name === "probe_echo") {
    return Response.json({
      choices: [
        {
          message: answered
            ? { role: "assistant", content: "Готово." }
            : { role: "assistant", content: "", tool_calls: [{ id: "p1", type: "function", function: { name: "probe_echo", arguments: '{"word":"куб","n":7}' } }] },
        },
      ],
    });
  }
  if (body.messages[0]?.content === "Reply briefly in Russian.") {
    return sse([{ choices: [{ delta: { content: "Привет!" } }] }, { choices: [{ delta: {}, finish_reason: "stop" }] }]);
  }
  turnCalls.push(body);
  if (!answered) {
    return sse([
      { choices: [{ delta: { tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "request_roll", arguments: ARGS } }] } }] },
      { choices: [{ delta: {}, finish_reason: "tool_calls" }] },
    ]);
  }
  return sse([{ choices: [{ delta: { content: "The gate swings open." } }] }, { choices: [{ delta: {}, finish_reason: "stop" }] }]);
};

const probe = (which) =>
  POST(
    new Request("http://localhost/api/admin/backend-probe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ which, provider: "custom", baseUrl: "https://route.test/v1", model: "route-model", apiKey: "k" }),
    }),
  );

test("Test backend plays the test turn for the storyteller only", async () => {
  try {
    const story = await (await probe("story")).json();
    assert.equal(story.ok, true, JSON.stringify(story));
    assert.equal(story.trial?.ok, true, "the storyteller plays the test turn");
    assert.ok(story.window, "and is told its window");
    assert.equal(turnCalls.length, 2, "the tool call and the narration");

    turnCalls.length = 0;
    const utility = await (await probe("utility")).json();
    assert.equal(utility.ok, true, JSON.stringify(utility));
    assert.equal(utility.trial, undefined, "a utility model is not sent a storyteller's turn");
    assert.equal(turnCalls.length, 0, "and nothing of it is spent");
  } finally {
    removeTempDir(dir);
  }
});
