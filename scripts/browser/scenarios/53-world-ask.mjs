// M5 item 2 of the WorldForge plan (audit WF-15): WorldForge's Ask reads the
// world's passages the way search_lore does in play, and each answer shows
// the passages it cites. In a workshop with a long harbour article whose
// last paragraph holds the fact about the bell, a draft lore entry about
// lamp oil that the question does not name, and twenty more entries about
// the sea wall's lamps, the author asks two questions. A stand-in model
// cites the passage that holds what it states. The answer's citation opens
// its source: the entry (a link), where in the entry the passage is, its
// canon state and its words, and the screen says how many matches were
// left out for space. The entry link opens the entry.
import http from "node:http";
import { check, eventually, freePort } from "../lib.mjs";

const BELL = "The harbour bell was cast from the melted anchors of the first Saltcoat fleet, and it rings only for drowned wardens.";
const OIL = "Every lamp along the wall burns oil the Kelpwrights of Low Stair render from bladder kelp each autumn.";

// The stand-in: cites the numbered passage that holds what it states.
function citingModel(port) {
  const passageWith = (content, words) => {
    for (const block of content.split("\n\n")) {
      const number = /(?:^|\n)\[(\d+)\] /.exec(block);
      if (number && block.includes(words)) return number[1];
    }
    return "";
  };
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      if (!req.url?.endsWith("/chat/completions")) {
        res.writeHead(404).end();
        return;
      }
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      const sent = String(body.messages?.at(-1)?.content ?? "");
      const oil = passageWith(sent, "bladder kelp");
      const bell = passageWith(sent, "melted anchors");
      const content = sent.includes("# The question\nWhere does the oil")
        ? oil ? `The Kelpwrights of Low Stair render it from bladder kelp each autumn [${oil}].` : "The world does not say."
        : bell ? `It was cast from the melted anchors of the first Saltcoat fleet [${bell}].` : "The world does not say.";
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
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve(server)));
}

export default {
  name: "world-ask",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, base, api } = t;
    const stamp = Date.now().toString(36);
    await api.post(`${base}/api/profile/tours`, { data: { finished: [{ id: "workshop-world", version: 1, how: "ended" }] } });
    // The server has no model, so the World hides Ask; this page is told it
    // has one, and the workshop's own settings point at the stand-in.
    await page.route(/\/api\/capabilities(\?|$)/, async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      body.story = { ...body.story, configured: true };
      await route.fulfill({ response, json: body });
    });
    const port = await freePort();
    const model = await citingModel(port);
    const made = await api.post(`${base}/api/workshops`, { data: { title: `Harbour lore ${stamp}`, description: "" } });
    check(made.ok(), "a workshop for the check");
    const id = (await made.json()).workshop.id;
    const campaign = `${base}/api/campaigns/${id}`;
    try {
      const pointed = await api.patch(`${campaign}/story-settings`, { data: { textProvider: "custom", customBaseUrl: `http://127.0.0.1:${port}/v1`, customModel: "citing-test-model" } });
      check(pointed.ok(), `pointing the workshop at the stand-in answered ${pointed.status()}`);
      const types = (await (await api.get(`${campaign}/world`)).json()).doc.types;
      const typeOf = (shelf) => types.find((type) => type.shelf === shelf).id;
      const entry = async (data) => {
        const response = await api.post(`${campaign}/world/entities`, { data });
        check(response.ok(), `the entry ${data.name} was made (${response.status()})`);
        return (await response.json()).entity;
      };
      const harbour = await entry({ typeId: typeOf("location"), name: `Gullhaven ${stamp}`, text: "A fishing town behind a sea wall." });
      const article = [
        ...Array.from({ length: 50 }, (_, at) => `On the ${at + 1}th quay of the harbour the nets and the tar crowd the stones, and the townsfolk trade gossip about the weather and the catch while the boats come in on the evening tide.`),
        BELL,
      ].join("\n\n");
      const long = await api.patch(`${campaign}/world/entities/${encodeURIComponent(harbour.ref)}`, { data: { article } });
      check(long.ok(), `the long article was saved (${long.status()})`);
      const compact = await entry({ typeId: typeOf("lore"), name: `The Kelpwright Compact ${stamp}`, text: `An old bargain with the kelp gatherers.\n\n${OIL}` });
      const drafted = await api.patch(`${campaign}/world/entities/${encodeURIComponent(compact.ref)}`, { data: { canon: "draft" } });
      check(drafted.ok(), `the lamp-oil entry was marked draft (${drafted.status()})`);
      for (let at = 1; at <= 20; at += 1) {
        await entry({ typeId: typeOf("lore"), name: `Wall Lore ${at} ${stamp}`, text: `The sea wall's ${at}th tower keeps its lamps trimmed at dusk.\n\nStorms come over the sea wall in the ${at}th month, and the lamps on the wall are lit early.` });
      }

      // The app shell reads the host's capabilities once, when it signs in,
      // so the stand-in model above never reaches it and the Ask tab stays
      // gated. The view is the same compiled page; the website run covers it.
      if (t.app) return;
      await t.open(`/workshop/${id}?system=world&view=ask`);
      const input = page.getByRole("textbox", { name: "A question about the world" }).locator("visible=true");
      await input.waitFor({ timeout: 30_000 });
      const askButton = page.locator("form").filter({ has: input }).getByRole("button", { name: "Ask" });

      // A topic question that names no entry: the draft lamp-oil passage is its source.
      await input.fill("Where does the oil for the lamps on the sea wall come from?");
      await askButton.click();
      const card = page.locator("li.panel").filter({ hasText: "Where does the oil" }).first();
      const citeButtons = card.getByRole("button", { name: /^Source \d+$/ });
      await eventually(async () => (await citeButtons.count()) === 1, { timeoutMs: 30_000, label: "the answer's one citation" });
      const sources = card.getByRole("region", { name: "Sources" });
      const source = sources.locator("ol > li").first();
      check((await sources.locator(":scope > ol > li").count()) === 1, "the sources are the one passage the answer cites");
      const sourceText = (await source.textContent()) ?? "";
      check(sourceText.includes(`The Kelpwright Compact ${stamp}`), `the source names its entry: ${sourceText}`);
      check(sourceText.includes("render from bladder kelp each autumn"), "the source's words support the answer");
      check(/draft/i.test(sourceText), "the source says it is a draft");
      check(/article, passage 2 of 2/.test(sourceText), "the source says where in the entry it is");
      check(/more matching passages were left out for space, from /.test((await card.textContent()) ?? ""), "the screen says matches were left out");
      await citeButtons.first().click();
      await eventually(async () => source.evaluate((element) => element === document.activeElement), { label: "the citation focusing its source" });
      await t.shot("topic-source");
      if (t.viewport === "phone") {
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        check(overflow <= 1, `the Ask view scrolls sideways on a phone by ${overflow}px`);
      }

      // A fact at the end of a long article.
      await input.fill("What was the harbour bell cast from?");
      await askButton.click();
      const bellCard = page.locator("li.panel").filter({ hasText: "What was the harbour bell" }).first();
      await bellCard.getByRole("button", { name: /^Source \d+$/ }).first().waitFor({ timeout: 30_000 });
      const bellSource = bellCard.getByRole("region", { name: "Sources" }).locator(":scope > ol > li").first();
      const bellText = (await bellSource.textContent()) ?? "";
      check(bellText.includes("melted anchors of the first Saltcoat fleet"), `the long article's last passage is the source: ${bellText}`);
      check(/article, passage 51 of 51/.test(bellText), `the source is the article's last passage: ${bellText}`);

      // The source's entry link opens the entry.
      await bellSource.getByRole("button", { name: `Gullhaven ${stamp}` }).click();
      await eventually(async () => (await t.url()).searchParams.get("entry") === harbour.ref, { label: "the entry opening from its source" });
    } finally {
      await page.unroute(/\/api\/capabilities(\?|$)/).catch(() => {});
      await api.delete(`${base}/api/workshops/${id}`).catch(() => {});
      model.close();
    }
  },
};
