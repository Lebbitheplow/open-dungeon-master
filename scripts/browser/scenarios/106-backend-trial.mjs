// A backend that passed Test backend's three quick checks still failed
// once a campaign began (models served through an OpenAI-compatible host,
// 2026-10-30). The test now plays one campaign-shaped turn after them
// (src/lib/backend-trial.ts) and shows it as two more lines: a model that
// plays the turn passes, and one whose streamed tool call arrives broken
// fails on that line with what went wrong, before anyone starts a campaign.
//
// The storyteller is a fake OpenAI-compatible server this scenario starts;
// the model's name says how it behaves.
import http from "node:http";
import { check, eventually, freePort } from "../lib.mjs";

const ARGS = '{"characterId":"pc-ash","kind":"skill_check","skill":"sleight_of_hand","difficulty":"moderate"}';

function fakeModel(port) {
  const sse = (res, events) => {
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    for (const event of events) res.write(`data: ${JSON.stringify(event)}\n\n`);
    res.end("data: [DONE]\n\n");
  };
  const text = (...parts) => [...parts.map((content) => ({ choices: [{ delta: { content } }] })), { choices: [{ delta: {}, finish_reason: "stop" }] }];
  const call = (pieces, repeat) => [
    { choices: [{ delta: { tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "request_roll", arguments: "" } }] } }] },
    ...pieces.map((arguments_) => ({
      choices: [{ delta: { tool_calls: [{ index: 0, function: { ...(repeat ? { name: "request_roll" } : {}), arguments: arguments_ } }] } }],
    })),
    { choices: [{ delta: {}, finish_reason: "tool_calls" }] },
  ];
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    if (req.url?.endsWith("/models")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ data: [{ id: "plays-well" }, { id: "broken-stream" }] }));
      return;
    }
    if (!req.url?.endsWith("/chat/completions")) {
      res.writeHead(404).end();
      return;
    }
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    const broken = body.model === "broken-stream";
    // scripts/lib/provider-capability-probe.mjs's own prompts.
    const quick = body.messages?.some((message) => message.content === "Reply briefly in Russian." || String(message.content).includes("probe_echo"));
    const answered = body.messages?.some((message) => message.role === "tool");
    // The quick checks, answered the same by both models.
    if (quick) {
      if (body.stream) return sse(res, text("Привет!"));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          choices: [
            {
              message: answered
                ? { role: "assistant", content: "Готово." }
                : { role: "assistant", content: "", tool_calls: [{ id: "p1", type: "function", function: { name: "probe_echo", arguments: '{"word":"куб","n":7}' } }] },
            },
          ],
        }),
      );
      return;
    }
    // The test turn: a streamed call in fragments, then streamed narration.
    // The broken host repeats the name in every fragment.
    if (!answered) return sse(res, broken ? call([ARGS, ARGS], true) : call([ARGS.slice(0, 30), ARGS.slice(30)], false));
    return sse(res, text("The tumblers give ", "one by one, and the gate swings open."));
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve({ close: () => server.close() })));
}

export default {
  name: "backend-trial",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, api, base } = t;
    const port = await freePort();
    const model = await fakeModel(port);
    const before = await (await api.get(`${base}/api/admin/settings`)).json().catch(() => ({}));
    const found = { provider: before?.text?.provider ?? "", customBaseUrl: before?.text?.customBaseUrl ?? "", customModel: before?.text?.customModel ?? "" };
    const point = async (customModel) => {
      const saved = await api.patch(`${base}/api/admin/settings`, {
        data: { text: { provider: "custom", customBaseUrl: `http://127.0.0.1:${port}/v1`, customModel } },
      });
      check(saved.ok(), `pointing the story backend at ${customModel} answered ${saved.status()}`);
    };
    const testOnce = async (label) => {
      // Leave first: in the app, opening the page already shown keeps its
      // form, which still holds the model saved before this one.
      await t.open("/");
      await t.open("/admin");
      const storyBlock = page.locator(`${root}#admin-text`).first();
      const button = storyBlock.getByRole("button", { name: "Test backend" }).locator("visible=true").first();
      await eventually(() => button.count(), { timeoutMs: 30_000, label: "Test backend" });
      await button.scrollIntoViewIfNeeded();
      await t.tap(button);
      await eventually(async () => /Streams its narration after the tool result|cannot run the storyteller loop/.test(await storyBlock.innerText()), {
        timeoutMs: 60_000,
        label,
      });
      return storyBlock;
    };
    try {
      await point("plays-well");
      const passed = await testOnce("the test turn's result for a model that plays it");
      const shown = (await passed.innerText()).replace(/\s+/g, " ");
      check(/Calls a tool under the storyteller's full prompt Called request_roll\./.test(shown), "the tool line says which tool it called");
      check(/plays-well can run the storyteller loop/.test(shown), "a model that plays the turn passes");
      await passed.getByText("Streams its narration after the tool result").scrollIntoViewIfNeeded();
      await t.shot("passed");

      await point("broken-stream");
      const failed = await testOnce("the test turn's result for a broken stream");
      const said = (await failed.innerText()).replace(/\s+/g, " ");
      check(/Makes structured tool calls/.test(said), "the quick checks still show");
      check(/request_rollrequest_roll, which is not one of the tools it was offered/.test(said), "the failed line says what came back");
      check(/Not tried: the tool call before it failed/.test(said), "the narration says it was not tried");
      check(/broken-stream cannot run the storyteller loop/.test(said), "the model is refused before any campaign");
      await failed.getByText("Calls a tool under the storyteller's full prompt").scrollIntoViewIfNeeded();
      await t.shot("failed");
      // The same lines in the day theme, chosen as a player chooses it
      // (src/lib/theme-mode.ts) and put back after.
      await page.evaluate(() => window.localStorage.setItem("odm.theme", "light"));
      const day = await testOnce("the test turn's result in the day theme");
      await day.getByText("Calls a tool under the storyteller's full prompt").scrollIntoViewIfNeeded();
      await t.shot("failed-day");
      await page.evaluate(() => window.localStorage.removeItem("odm.theme"));
    } finally {
      await api.patch(`${base}/api/admin/settings`, { data: { text: found } }).catch(() => undefined);
      model.close();
    }
  },
};
