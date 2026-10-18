// What the narrator-seam suite shares on top of enforce-world.mjs: the
// engine reached as the AI reaches it (actor kind "ai", on an AI turn), and a
// whole DM turn run against a scripted fake model, so the turn loop's own
// rules (the order it runs a reply's calls in, the correction call it keeps
// in reserve, the prose it withholds) can be read from stored state without
// a real model.
//
// Import enforce-world.mjs first (it points the database at the scratch
// directory), then:
//
//   const ai = await aiEngine(world);
//   await ai.invoke("update_sheet", { characterId, level: 6, reason: "x" });
//
//   const model = await fakeModel();
//   await model.pointAt(world);
//   model.script([reply({ calls: [call("pc_attack", {...})] }), reply({ text: "..." })]);
//   const turn = await model.turn(world, "I swing at the goblin.");
//   await settleQueue(world.campaignId);   // after a route that queues work
//   model.close();
//
// failure(status, message) in a script fails that call with an HTTP error
// instead of answering it: model.script([reply({ calls }), failure(500)])
// is a backend that falls over partway through a turn.
//
// The claims reader (src/lib/dm/claims.ts) is answered apart from the
// script: each of its calls takes the next entry of model.claims([...]) (a
// list of claims, as the reader would reply), or none once those run out, so
// a scripted turn's replies are never spent on it. A new script also forgets
// the readings the server kept (src/lib/dm/claims.ts answers a passage it has
// read before from memory), so every passage a script holds is read.
import http from "node:http";
import { answerReader, isReaderRequest } from "./claims-reader.mjs";

// The AI's door into the engine: an AI turn and actor kind "ai", the way a
// delegated turn or an AI share of an assisted session reaches it.
export async function aiEngine(world) {
  const { createDmTurn, getDmTurn } = await import("../../src/lib/db/dm-turns.ts");
  const { invokeEngine } = await import("../../src/lib/dm/invoke.ts");
  let turn = createDmTurn(world.campaignId, []);
  return {
    turn: () => getDmTurn(turn.id),
    fresh: () => {
      turn = createDmTurn(world.campaignId, []);
      return turn;
    },
    invoke: (name, args = {}) =>
      invokeEngine(world.campaign(), { kind: "ai", turnId: turn.id }, { name, args }),
  };
}

let callSeq = 0;

// One tool call as the model sends it.
export function call(name, args = {}) {
  callSeq += 1;
  return { id: `call_${name}_${callSeq}`, name, args };
}

// One model reply: prose, tool calls, or both.
export function reply({ text = "", calls = [] } = {}) {
  return { text, calls };
}

// A call the backend fails instead of answering, as a server that falls over
// mid-turn does: an HTTP error with an OpenAI-style error body. The message
// reaches model-client's refusal heuristics at any status
// (src/lib/model-client.ts): one that mentions tools or functions, names an
// unsupported parameter, or asks for another route is retried by the client
// and spends the next scripted entry, as a real backend's refusal would. The
// default message matches none of them, so the turn sees the error.
export function failure(status = 500, message = "The backend fell over.") {
  return { text: "", calls: [], fail: { status, message } };
}

// A route queues its DM jobs and returns; this waits for the campaign's
// queue to run dry, as a reload of the page would find it.
export async function settleQueue(campaignId, ms = 30_000) {
  const { dmQueueDepth } = await import("../../src/lib/dm/queue.ts");
  const until = Date.now() + ms;
  while (dmQueueDepth(campaignId) > 0) {
    if (Date.now() > until) {
      throw new Error(`the DM queue for ${campaignId} never ran dry`);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

// A fake OpenAI-compatible server. Each /chat/completions request takes the
// next scripted reply (a plain narration once the script runs out) and every
// request body is kept, so a test can read what the turn loop sent.
export async function fakeModel() {
  let script = [];
  let served = 0;
  const requests = [];
  let readerScript = [];
  const readerRequests = [];
  const fallback = reply({ text: "The moment settles, and the table waits on the next move." });

  function sse(res, entry) {
    // A held reply (held() below) answers once the test lets it go, so the
    // turn is still running while the test acts.
    if (entry.held) {
      entry.held.then(() => sse(res, { ...entry, held: null }));
      return;
    }
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    const deltas = [];
    if (entry.text) {
      deltas.push({ content: entry.text });
    }
    if (entry.calls.length) {
      deltas.push({
        tool_calls: entry.calls.map((toolCall, index) => ({
          index,
          id: toolCall.id,
          type: "function",
          function: { name: toolCall.name, arguments: JSON.stringify(toolCall.args) },
        })),
      });
    }
    for (const delta of deltas) {
      res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`);
    }
    res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n`);
    res.end("data: [DONE]\n\n");
  }

  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      if (!req.url.endsWith("/chat/completions")) {
        res.writeHead(404).end();
        return;
      }
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (isReaderRequest(body)) {
        readerRequests.push(body);
        answerReader(res, readerScript.shift() ?? []);
        return;
      }
      requests.push(body);
      const entry = script[served] ?? fallback;
      served += 1;
      if (entry.fail) {
        res.writeHead(entry.fail.status, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { message: entry.fail.message, type: "server_error" } }));
        return;
      }
      if (body.stream) {
        sse(res, entry);
        return;
      }
      // A call made without streaming (the guard's rewrite) takes one JSON
      // completion.
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          choices: [
            {
              index: 0,
              finish_reason: "stop",
              message: {
                role: "assistant",
                content: entry.text,
                ...(entry.calls.length
                  ? {
                      tool_calls: entry.calls.map((toolCall) => ({
                        id: toolCall.id,
                        type: "function",
                        function: { name: toolCall.name, arguments: JSON.stringify(toolCall.args) },
                      })),
                    }
                  : {}),
              },
            },
          ],
        }),
      );
    });
  });
  // Node closes an idle keep-alive socket after five seconds; a test that
  // sets up a fight between two requests can take that long, and a request
  // written onto the socket as it closes fails before any reply. The
  // backend fetch retries that once, and this server never closes idle
  // sockets, so the suites do not depend on the timing either way.
  server.keepAliveTimeout = 0;
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
  // A context window stated up front, so no request goes to probe one.
  process.env.OPENAI_COMPAT_CONTEXT = process.env.OPENAI_COMPAT_CONTEXT ?? "65536";

  const campaigns = await import("../../src/lib/db/campaigns.ts");
  const { getDatabase } = await import("../../src/lib/db/core.ts");
  const messages = await import("../../src/lib/db/messages.ts");
  const { startDmTurn } = await import("../../src/lib/dm/turn.ts");

  return {
    requests,
    readerRequests,
    // What the claims reader answers, one list of claims per reader call.
    claims: (entries) => {
      readerScript = [...entries];
      readerRequests.length = 0;
      globalThis.__odmReaderReplies?.clear();
    },
    served: () => served,
    script: (entries) => {
      script = entries;
      served = 0;
      requests.length = 0;
      globalThis.__odmReaderReplies?.clear();
    },
    // The world's campaign talks to this server, with no pictures to draw.
    pointAt: (world) => {
      // Only an admin's campaign runs on a backend address of its own
      // (src/lib/db/settings.ts), so this world's owner is one. Pointing the
      // server's own backend here instead would send every other world's
      // turns to the script too.
      getDatabase().prepare(`UPDATE users SET is_admin = 1 WHERE id = ?`).run(world.owner.id);
      campaigns.updateStorySettings(world.campaignId, {
        textProvider: "custom",
        customBaseUrl: baseUrl,
        customModel: "fake",
        imageGenerationEnabled: false,
        autoImages: false,
      });
    },
    // A player's line, then one whole DM turn. Returns the DM's message as
    // stored, or null when the turn wrote none.
    turn: async (world, line, characterId, userId = world.owner.id, extra = {}) => {
      const seq = campaigns.allocateSeq(world.campaignId);
      messages.insertCampaignMessage({
        campaignId: world.campaignId,
        seq,
        authorType: "player",
        userId,
        characterId,
        content: line,
        ...extra,
      });
      await startDmTurn(world.campaignId);
      const dm = messages.listRecentMessages(world.campaignId, 40).filter((entry) => entry.authorType === "dm");
      const last = dm[dm.length - 1];
      return last && last.seq > seq ? last : null;
    },
    // The tool results a request carried, keyed by the call id they answer,
    // in the order the conversation holds them.
    results: (request) =>
      request.messages
        .filter((message) => message.role === "tool")
        .map((message) => ({ id: message.tool_call_id, result: JSON.parse(message.content) })),
    close: () => server.close(),
  };
}

// A reply the fake model holds back until release() is called: the DM turn
// waits on it mid-stream, the way a slow model keeps a table waiting, while
// the test posts what players send in the meantime.
export function held(entry) {
  let release = () => {};
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  return { entry: { ...entry, held: gate }, release };
}
