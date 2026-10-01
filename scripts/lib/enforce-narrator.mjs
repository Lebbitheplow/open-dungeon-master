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
//   model.close();
import http from "node:http";

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

// A fake OpenAI-compatible server. Each /chat/completions request takes the
// next scripted reply (a plain narration once the script runs out) and every
// request body is kept, so a test can read what the turn loop sent.
export async function fakeModel() {
  let script = [];
  let served = 0;
  const requests = [];
  const fallback = reply({ text: "The moment settles, and the table waits on the next move." });

  function sse(res, entry) {
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
      requests.push(body);
      const entry = script[served] ?? fallback;
      served += 1;
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
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
  // A context window stated up front, so no request goes to probe one.
  process.env.OPENAI_COMPAT_CONTEXT = process.env.OPENAI_COMPAT_CONTEXT ?? "65536";

  const campaigns = await import("../../src/lib/db/campaigns.ts");
  const messages = await import("../../src/lib/db/messages.ts");
  const { startDmTurn } = await import("../../src/lib/dm/turn.ts");

  return {
    requests,
    served: () => served,
    script: (entries) => {
      script = entries;
      served = 0;
      requests.length = 0;
    },
    // The world's campaign talks to this server, with no pictures to draw.
    pointAt: (world) => {
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
