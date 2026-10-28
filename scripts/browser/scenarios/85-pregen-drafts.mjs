// AI-drafted pregens (src/lib/dm/pregen-draft.ts). A workshop with an
// adventure and no pregens: on a server with no model, Draft pregens is off
// and says why. Pointed at a stand-in model, the DM drafts four, one for each
// seat of the workshop's party (four at level 3, the default), with no count
// to pick: they land on the roster marked Drafted by the AI DM at the party's
// level, none of them offered to players,
// and the class the builder does not offer (a gunslinger) is said to have
// fallen back. A second press that the stand-in answers with prose instead
// of heroes says nothing was drafted, and the roster keeps its four. The
// drafts and the workshop are removed again for the next viewport.
import http from "node:http";
import { check, eventually, freePort } from "../lib.mjs";

const HEROES = [
  { name: "Brannoc Vell", concept: "A gate warden", class: "Fighter", race: "Human", background: "Soldier", role: "tank", backstory: "Brannoc held the Sunken Keep's gate for ten years. When Mother Ysolde vanished he swore to bring her home." },
  { name: "Thessa Ironbraid", concept: "A shrine healer", class: "Cleric", race: "Hill Dwarf", background: "Acolyte", role: "healer", backstory: "Thessa tends the shrine below the keep. Mother Ysolde taught her the old rites." },
  { name: "Ilyra Moonwhisper", concept: "A scholar of drowned things", class: "Wizard", race: "High Elf", background: "Sage", role: "support", backstory: "Ilyra came to read the keep's flooded library. She believes the drowned bell rings for her." },
  { name: "Kestrel Dunmore", concept: "A sharpshooter for hire", class: "Gunslinger", race: "Wood Elf", background: "Bounty Hunter", role: "dps", backstory: "Kestrel tracks bounties along the marsh roads. A writ for the keep's thief brought her here." },
];

// The stand-in: four heroes as JSON, or prose when told to misbehave.
function draftingModel(port) {
  const state = { bad: false, asked: 0 };
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      if (!req.url?.endsWith("/chat/completions")) {
        res.writeHead(404).end();
        return;
      }
      state.asked += 1;
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      const content = state.bad ? "Here are four fine heroes: a fighter, a cleric, a wizard and a rogue." : JSON.stringify({ heroes: HEROES });
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
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve({ state, close: () => server.close() })));
}

export default {
  name: "pregen-drafts",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, base, api } = t;
    const stamp = Date.now().toString(36);
    const port = await freePort();
    const model = await draftingModel(port);
    const made = await api.post(`${base}/api/workshops`, {
      data: { title: `The Sunken Keep ${stamp}`, description: "A keep half drowned in the marsh, where the abbess Mother Ysolde has gone missing." },
    });
    check(made.ok(), `a workshop for the check (${made.status()})`);
    const id = (await made.json()).workshop.id;
    const roster = async () => (await (await api.get(`${base}/api/workshops/${id}/pregens`)).json()).pregens ?? [];
    try {
      // No model on this server: the action is off, with the reason.
      await t.open(`/workshop/${id}?system=party`);
      const card = page.locator(`${root}[data-pregen-draft]`).locator("visible=true").first();
      await eventually(() => card.count(), { timeoutMs: 30_000, label: "the Draft pregens card" });
      const reason = card.locator("[data-pregen-draft-reason]");
      await eventually(() => reason.count(), { timeoutMs: 20_000, label: "the reason Draft pregens is off" });
      check(/No AI GM is set up/.test(await reason.innerText()), `the reason says why (${await reason.innerText()})`);
      const go = card.locator("[data-pregen-draft-go]");
      check(await go.isDisabled(), "Draft pregens is pressable with no AI DM");
      await card.scrollIntoViewIfNeeded();
      await t.shot("no-ai");

      // The workshop's own story settings point at the stand-in.
      const pointed = await api.patch(`${base}/api/campaigns/${id}/story-settings`, {
        data: { textProvider: "custom", customBaseUrl: `http://127.0.0.1:${port}/v1`, customModel: "drafting-test-model" },
      });
      check(pointed.ok(), `pointing the workshop at the stand-in answered ${pointed.status()}`);
      // Away and back, as a DM who set up a model elsewhere comes back: the
      // apps keep the Party screen mounted behind the next one, and the card
      // asks again when it is shown.
      await t.open("/workshop");
      await t.open(`/workshop/${id}?system=party`);
      await eventually(() => card.count(), { timeoutMs: 30_000, label: "the card again" });
      await eventually(async () => !(await go.isDisabled()), { timeoutMs: 20_000, label: "Draft pregens on" });
      check((await reason.count()) === 0, "a reason still shows with an AI DM set up");
      const size = await go.boundingBox();
      check(size && size.height >= 40, `Draft pregens is at least 40px tall (${size?.height})`);
      check(/Draft 4 pregens/i.test(await go.innerText()), `the button says how many it drafts (${await go.innerText()})`);
      check((await card.locator("select, [role='combobox'], [role='listbox']").count()) === 0, "the card still asks how many to draft");

      const drafted = page.waitForResponse(
        (response) => response.url().endsWith(`/api/workshops/${id}/pregens/draft`) && response.request().method() === "POST",
        { timeout: 60_000 },
      );
      await t.tap(go);
      check((await drafted).status() === 201, "the draft is stored");
      const done = card.locator("[data-pregen-draft-done]");
      await eventually(() => done.count(), { timeoutMs: 20_000, label: "the draft's read-back" });
      const said = (await done.innerText()).replace(/\s+/g, " ");
      check(/Drafted 4 pregens at level 3/.test(said), `the read-back counts the drafts (${said.slice(0, 160)})`);
      check(/Gunslinger is not a class the builder offers/.test(said), `the fallback is said (${said.slice(0, 400)})`);

      const marks = page.locator(`${root}[data-pregen-drafted]`).locator("visible=true");
      await eventually(async () => (await marks.count()) === 4, { timeoutMs: 20_000, label: "four drafts marked on the roster" });
      const ticks = page.locator(`${root}[data-pregen-offer] input[type="checkbox"]`).locator("visible=true");
      check((await ticks.count()) === 4, `the drafts have their Offer to players ticks (${await ticks.count()})`);
      for (let at = 0; at < 4; at += 1) {
        check(!(await ticks.nth(at).isChecked()), "a draft came offered to players");
      }
      const stored = await roster();
      check(stored.length === 4 && stored.every((entry) => entry.drafted && !entry.offered && entry.level === 3), "the roster holds four unoffered drafts at the party's level");
      await marks.first().scrollIntoViewIfNeeded();
      await t.shot("drafted");
      if (t.viewport === "phone") {
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        check(overflow <= 1, `the Party tool scrolls sideways on a phone by ${overflow}px`);
      }

      // A reply that is not heroes drafts nothing, and says so.
      model.state.bad = true;
      const failed = page.waitForResponse(
        (response) => response.url().endsWith(`/api/workshops/${id}/pregens/draft`) && response.request().method() === "POST",
        { timeout: 60_000 },
      );
      await t.tap(go);
      check((await failed).status() === 502, "a reply of prose was stored");
      // That 502 is the answer asked for here, not a fault behind the
      // scenes: struck from the health check, it alone.
      const expected = t.fails.findIndex((line) => line === `status 502 /api/workshops/${id}/pregens/draft`);
      check(expected >= 0, "the refused draft was not seen behind the scenes");
      t.fails.splice(expected, 1);
      const error = card.locator("[data-pregen-draft-error]");
      await eventually(() => error.count(), { timeoutMs: 20_000, label: "the failure said" });
      check(/nothing was drafted/i.test(await error.innerText()), `the failure says nothing was drafted (${await error.innerText()})`);
      check((await roster()).length === 4, "a failed draft changed the roster");
      await error.scrollIntoViewIfNeeded();
      await t.shot("malformed");
    } finally {
      for (const entry of await roster().catch(() => [])) {
        await api.delete(`${base}/api/characters/${entry.id}`).catch(() => {});
      }
      await api.delete(`${base}/api/workshops/${id}`).catch(() => {});
      model.close();
    }
  },
};
