// M5 item 1 of the WorldForge plan (audit WF-08): "Draft a world from this
// idea". From WorldForge's empty wiki the author drafts an outline from a
// line. A stand-in model on a local port answers (no real provider is
// called): two people, a place, a faction, a lore entry, one creature and
// one item, with links. The outline shows its counts and makes nothing.
// The author unticks one person and makes the rest: the creature's first
// stat block has damage the dice engine cannot roll, so the Bestiary
// refuses it and that row alone fails, says why, and offers Retry. Retry
// makes it once. The unticked person is never made. Then, with no text
// model, the Create chooser still offers making by hand and says where an
// admin switches drafting on.
import http from "node:http";
import { check, eventually, freePort } from "../lib.mjs";

function outlineModel(port, stamp) {
  let creatureCalls = 0;
  const outline = {
    premise: "The sea took the low kingdom. The tide-priests ration what dry land is left.",
    people: [
      { name: `Abbess Corra ${stamp}`, summary: "First of the tide-priests.", hiddenTruth: "She sells dry berths." },
      { name: `Tamsin Reed ${stamp}`, summary: "A bone-diver." },
    ],
    places: [{ name: `The Last Steeple ${stamp}`, summary: "A bell tower standing out of the water." }],
    factions: [{ name: `The Tide Priesthood ${stamp}`, summary: "They decide who may stand on dry stone." }],
    lore: [{ name: `The Drowning ${stamp}`, type: "Other", summary: "The night the sea came in." }],
    creatures: [{ name: `Silt Stalker ${stamp}`, summary: "A long-limbed hunter of the drowned streets.", basis: "", cr: 3 }],
    items: [{ name: `Tide Hook ${stamp}`, summary: "A bone gaff the divers fight with.", kind: "weapon" }],
    links: [
      { from: `Abbess Corra ${stamp}`, to: `The Tide Priesthood ${stamp}`, label: "member of" },
      { from: `Silt Stalker ${stamp}`, to: `The Last Steeple ${stamp}`, label: "guards" },
      { from: `Tamsin Reed ${stamp}`, to: `The Last Steeple ${stamp}`, label: "lives in" },
    ],
  };
  const creature = (good) => ({
    basis: "",
    size: "Large",
    type: "monstrosity",
    cr: 3,
    attacks: [{ name: "Claw", toHit: 5, damage: good ? "2d6+3" : "a great deal", type: "slashing" }],
    traits: [],
    desc: "A pale thing that wades the drowned streets at low tide.",
  });
  const item = { itemKind: "weapon", rarity: "uncommon", cost: "40 gp", desc: "A bone gaff.", weapon: { category: "martial", kind: "melee", damage: "1d8 piercing", properties: ["reach"] } };
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      if (!req.url?.endsWith("/chat/completions")) {
        res.writeHead(404).end();
        return;
      }
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      const system = String(body.messages?.[0]?.content ?? "");
      let content = "";
      if (system.includes("You sketch a tabletop world")) content = JSON.stringify(outline);
      else if (system.includes("You design one creature")) {
        creatureCalls += 1;
        content = JSON.stringify(creature(creatureCalls > 1));
      } else if (system.includes("You design one item")) content = JSON.stringify(item);
      else content = "Nothing.";
      if (body.stream) {
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content }, finish_reason: null }] })}\n\n`);
        res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n`);
        res.end("data: [DONE]\n\n");
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }] }));
    });
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve({ server, creatureCalls: () => creatureCalls })));
}

export default {
  name: "world-outline",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, base, root, api } = t;
    const stamp = Date.now().toString(36);
    await api.post(`${base}/api/profile/tours`, { data: { finished: ["hub", "world"].map((tool) => ({ id: `workshop-${tool}`, version: 1, how: "ended" })) } });
    const made = await api.post(`${base}/api/workshops`, { data: { title: `Drowned kingdom ${stamp}`, description: "" } });
    check(made.ok(), "a workshop for the check");
    const id = (await made.json()).workshop.id;
    const campaign = `${base}/api/campaigns/${id}`;
    const port = await freePort();
    const model = await outlineModel(port, stamp);
    const names = async () => (await (await api.get(`${campaign}/world`)).json()).entities.map((entity) => entity.name);
    const monsters = async () => (await (await api.get(`${campaign}/dm/bestiary`)).json()).monsters.filter((monster) => monster.draft.name.includes(stamp));
    try {
      const pointed = await api.patch(`${campaign}/story-settings`, { data: { textProvider: "custom", customBaseUrl: `http://127.0.0.1:${port}/v1`, customModel: "outline-stand-in" } });
      check(pointed.ok(), `pointing the workshop at the stand-in answered ${pointed.status()}`);

      // The app shell reads the host's capabilities once, at sign-in, so the
      // stand-in never reaches it and the Outline view stays gated there. The
      // view is the same compiled page; the no-AI half runs in both.
      if (!t.app) {
        // The server has no model, so the World hides Outline; this page is
        // told it has one, and the workshop's own settings point at the stand-in.
        await page.route(/\/api\/capabilities(\?|$)/, async (route) => {
          const response = await route.fetch();
          const body = await response.json();
          body.story = { ...body.story, configured: true };
          await route.fulfill({ response, json: body });
        });
        await t.open(`/workshop/${id}?system=world`);
        const start = page.locator(`${root}[data-testid="world-empty-outline"]`);
        await eventually(() => start.isVisible(), { timeoutMs: 30_000, label: "Draft a world in the empty wiki" });
        await start.click();
        await eventually(async () => (await t.url()).searchParams.get("view") === "outline", { label: "the Outline view" });
        const idea = page.getByRole("textbox", { name: "Your idea for the world" }).locator("visible=true");
        await idea.fill("A drowned kingdom where the tide-priests ration dry land.");
        await page.getByRole("button", { name: "Draft an outline" }).click();

        // The outline, counted, and nothing made.
        const counts = page.locator(`${root}[data-testid="outline-counts"]`);
        await eventually(() => counts.isVisible(), { timeoutMs: 30_000, label: "the outline's counts" });
        const countText = (await counts.innerText()).replace(/\s+/g, " ");
        check(countText.includes("2 people · 1 place · 1 faction · 1 lore entry · 1 creature · 1 item") && countText.includes("Nothing is made yet"), `the outline counts what it proposes: ${countText}`);
        check((await names()).length === 0, "the outline wrote an entry before anything was ticked");
        check((await monsters()).length === 0, "the outline wrote a monster before anything was ticked");
        await t.shot("outline-review");
        if (t.viewport === "phone") {
          const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
          check(overflow <= 1, `the outline scrolls sideways on a phone by ${overflow}px`);
        }

        // Untick one person; make the rest.
        await page.getByRole("checkbox", { name: `Make Tamsin Reed ${stamp}` }).uncheck();
        const make = page.locator(`${root}[data-testid="outline-make"]`);
        check((await make.innerText()).includes("(6)"), `the button counts what it will make: ${await make.innerText()}`);
        await make.click();
        const progress = page.locator(`${root}[data-testid="outline-progress"]`);
        await eventually(async () => /Made 5 of 6\. One was not made/.test(await progress.innerText()), { timeoutMs: 60_000, label: "the partial result" });
        const failed = page.locator(`${root}[data-testid="outline-task"][data-state="failed"]`);
        check((await failed.count()) === 1, "one row failed");
        const failedText = await failed.innerText();
        check(failedText.includes("The Bestiary refused") && failedText.includes("is not a dice expression"), `the failed row says why: ${failedText}`);
        check((await monsters()).length === 0, "a refused stat block was stored");
        const after = await names();
        check(!after.includes(`Tamsin Reed ${stamp}`), "the unticked person was made");
        check(after.includes(`Abbess Corra ${stamp}`) && after.includes(`Tide Hook ${stamp}`), `the ticked rows were made: ${after.join(", ")}`);
        const outlineText = await page.locator(`${root}[data-testid="world-outline"]`).innerText();
        check(/waiting for an end that was not made: Silt Stalker \S+ guards The Last Steeple \S+\./.test(outlineText), `the creature's link is named as waiting: ${outlineText}`);
        check(/one end was not ticked: Tamsin Reed \S+ lives in The Last Steeple \S+\./.test(outlineText), "the unticked person's link is named as left out");
        await t.shot("outline-partial");

        // Retry the one failed asset.
        await page.getByRole("button", { name: `Retry Silt Stalker ${stamp}` }).click();
        await eventually(async () => /Made all 6\./.test(await progress.innerText()), { timeoutMs: 60_000, label: "the retried creature" });
        const stored = await monsters();
        check(stored.length === 1 && stored[0].draft.name === `Silt Stalker ${stamp}`, `the retry made the creature once: ${stored.map((monster) => monster.draft.name).join(", ")}`);
        check(model.creatureCalls() === 2, `the creature was asked for ${model.creatureCalls()} times, not twice`);
        const madeRow = page.locator(`${root}[data-testid="outline-task"]`, { hasText: `Silt Stalker ${stamp}` });
        check((await madeRow.innerText()).includes("in Bestiary"), "the made creature says where it lives");
        check(await madeRow.getByRole("button", { name: "Edit stats" }).isVisible(), "the made creature offers its stat block");
        await t.shot("outline-done");
        await page.unroute(/\/api\/capabilities(\?|$)/);
      }

      // No text model: Create still offers making by hand, and says how to switch drafting on.
      await t.open(`/workshop/${id}`);
      const hub = page.locator(`${root}[data-testid="create-open"]`).first();
      await eventually(() => hub.isVisible(), { timeoutMs: 30_000, label: "Create on the hub" });
      await hub.click();
      const chooser = page.getByRole("dialog");
      const noAi = chooser.locator('[data-testid="create-no-ai"]');
      await eventually(() => noAi.isVisible(), { timeoutMs: 15_000, label: "the chooser's no-AI note" });
      check((await noAi.innerText()).includes("Admin > Text model defaults"), "the chooser does not say where drafting is switched on");
      await chooser.locator('[data-testid="create-choice-outline"]').click();
      const draftStep = chooser.locator('[data-testid="create-step"]', { hasText: "Draft a world from an idea" });
      check(await draftStep.isDisabled(), "Draft a world is offered with no model");
      check((await draftStep.innerText()).includes("Admin > Text model defaults"), "the step does not say how to enable it");
      check(await chooser.locator('[data-testid="create-step"]', { hasText: "Start with one entry" }).isEnabled(), "making an entry by hand is not offered");
      await t.shot("create-no-ai");
    } finally {
      await page.unroute(/\/api\/capabilities(\?|$)/).catch(() => {});
      // The monster and the item are the user's, not the workshop's.
      for (const monster of await monsters().catch(() => [])) await api.delete(`${campaign}/dm/bestiary/${monster.id}`).catch(() => {});
      const items = (await (await api.get(`${base}/api/homebrew?kind=item`)).json().catch(() => ({ entries: [] }))).entries ?? [];
      for (const item of items.filter((entry) => entry.name.includes(stamp))) await api.delete(`${base}/api/homebrew/${item.id}`).catch(() => {});
      await api.delete(`${base}/api/workshops/${id}`).catch(() => {});
      model.server.close();
    }
  },
};
