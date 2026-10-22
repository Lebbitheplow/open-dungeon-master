// Finding your way in a 1,000-entry world (audit WF-24, plan M6;
// docs/worldforge-large-worlds.md). The world is scripts/lib/large-world.mjs
// at 1,000 entries, brought in as a WorldForge file. In the workshop's wiki:
//   - the list draws only the rows in view, and each says where it stands
//     among all 1,000;
//   - search finds an entry by its name, by a word in the last paragraph of
//     a long article (the row shows the words around it) and by a custom
//     field's value (the row shows the field);
//   - by keyboard, Down from the search box enters the list, End reaches the
//     last entry (scrolled into view), Home the first, and Enter opens one;
//   - an entry deep in the world opens by its address after a reload, and
//     on a desktop its row shows selected in the list;
//   - the whole world's web shows its most linked entries and says so.
// Each step keeps to a budget with a wide margin for slower runners; the
// numbers it was set from are in the docs.
import { largeWorld } from "../../lib/large-world.mjs";
import { check, eventually } from "../lib.mjs";

const BUDGET = { firstUsableMs: 8_000, searchMs: 3_000, graphMs: 10_000 };

export default {
  name: "large-world",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, base, api, viewport } = t;
    await api.post(`${base}/api/profile/tours`, { data: { finished: [{ id: "workshop-world", version: 1, how: "ended" }] } });
    const { file, needles } = largeWorld(1_000);
    const made = await api.post(`${base}/api/workshops`, { data: { title: `A world of 1000 (${viewport})`, description: "" } });
    check(made.ok(), "a workshop for the check");
    const id = (await made.json()).workshop.id;
    const campaign = `${base}/api/campaigns/${id}`;
    try {
      const imported = await api.post(`${campaign}/world/import`, { data: { text: JSON.stringify(file), accept: true }, timeout: 300_000 });
      check(imported.ok(), `the 1,000-entry world came in (${imported.status()})`);
      const answer = await api.get(`${campaign}/world`);
      check(answer.ok(), "the world reads back");
      const entities = (await answer.json()).entities;
      check(entities.length === 1_000, `1,000 entries, not ${entities.length}`);
      const refOf = (name) => entities.find((entity) => entity.name === name).ref;

      const list = page.getByRole("listbox", { name: "Entries" }).locator("visible=true");
      const options = list.getByRole("option");
      const searchBox = page.getByRole("textbox", { name: "Find an entry" }).locator("visible=true");
      // Usable within budget: the first entry listed and the search box ready.
      await t.open(`/workshop/${id}?system=world&view=wiki`);
      await options.first().waitFor({ timeout: BUDGET.firstUsableMs });
      await searchBox.waitFor({ timeout: BUDGET.firstUsableMs });

      // Only the rows in view are drawn, each placed among all 1,000.
      const drawn = await options.count();
      check(drawn < 80, `${drawn} rows drawn for a list that shows about a dozen`);
      check((await options.first().getAttribute("aria-setsize")) === "1000", "the rows do not say how many entries there are");

      // Search: a name, a word deep in a body, a custom field's value.
      const find = async (query, holder, excerpt) => {
        const started = Date.now();
        await searchBox.fill(query);
        const row = options.filter({ hasText: holder }).first();
        await row.waitFor({ timeout: BUDGET.searchMs });
        const took = Date.now() - started;
        check(took <= BUDGET.searchMs, `searching for ${query} took ${took} ms`);
        if (excerpt) check(((await row.textContent()) ?? "").includes(excerpt), `the row for ${holder} does not say where it matched: ${await row.textContent()}`);
      };
      await find(needles.name.query, needles.name.holder);
      await find(needles.body.query, needles.body.holder, "obsidianwright guild kept the oldest key");
      await find(needles.field.query, needles.field.holder, "Rank: Quartermaster-Vexil");
      await t.shot("search-field");

      // By keyboard: into the list from the search box, to its end and back,
      // and Enter opens the entry reached.
      await searchBox.fill("");
      await eventually(async () => (await options.first().getAttribute("aria-setsize")) === "1000", { label: "the whole list back" });
      await searchBox.focus();
      await page.keyboard.press("ArrowDown");
      const focused = () => page.evaluate(() => ({ role: document.activeElement?.getAttribute("role"), at: document.activeElement?.getAttribute("aria-posinset"), name: document.activeElement?.querySelector("span span")?.textContent ?? "" }));
      await eventually(async () => (await focused()).at === "1", { label: "Down from the search box reaching the first entry" });
      await page.keyboard.press("End");
      await eventually(async () => (await focused()).at === "1000", { label: "End reaching the last entry" });
      const lastInView = await page.evaluate(() => {
        const row = document.activeElement?.getBoundingClientRect();
        const box = document.activeElement?.closest('[role="listbox"]')?.getBoundingClientRect();
        return Boolean(row && box && row.top >= box.top - 1 && row.bottom <= box.bottom + 1);
      });
      check(lastInView, "the last entry, reached by End, is not scrolled into view");
      await page.keyboard.press("Home");
      await eventually(async () => (await focused()).at === "1", { label: "Home reaching the first entry" });
      await page.keyboard.press("ArrowDown");
      await page.keyboard.press("ArrowDown");
      await eventually(async () => (await focused()).at === "3", { label: "two Downs reaching the third entry" });
      const third = (await focused()).name;
      await page.keyboard.press("Enter");
      await eventually(async () => (await t.url()).searchParams.get("entry") === refOf(third), { label: `Enter opening ${third}` });
      await page.getByRole("heading", { name: third, exact: true }).locator("visible=true").waitFor();

      // A deep entry by its address, after a reload.
      const deep = needles.body.holder;
      await t.open(`/workshop/${id}?system=world&view=wiki&entry=${encodeURIComponent(refOf(deep))}`);
      await t.reload();
      await page.getByRole("heading", { name: deep, exact: true }).locator("visible=true").waitFor({ timeout: BUDGET.firstUsableMs });
      if (viewport === "desktop") {
        const selected = list.locator('[role="option"][aria-selected="true"]');
        await selected.waitFor();
        check(((await selected.textContent()) ?? "").includes(deep), "the open entry is not the selected row");
        const inView = await selected.evaluate((row) => {
          const box = row.closest('[role="listbox"]').getBoundingClientRect();
          const own = row.getBoundingClientRect();
          return own.top >= box.top - 1 && own.bottom <= box.bottom + 1;
        });
        check(inView, "the entry opened by its address is not in view in the list");
      }
      await t.shot("deep-link");

      // The whole world's web: its most linked entries, and a line saying so.
      const graphStarted = Date.now();
      await t.open(`/workshop/${id}?system=world&view=web`);
      const svg = page.getByRole("img", { name: /of the world$/ }).locator("visible=true");
      await svg.waitFor({ timeout: BUDGET.graphMs });
      const graphMs = Date.now() - graphStarted;
      check(graphMs <= BUDGET.graphMs, `the web took ${graphMs} ms`);
      const nodes = await svg.locator("g.wf-node-body").count();
      check(nodes > 0 && nodes <= 300, `${nodes} entries in the whole world's web`);
      await page.getByTestId("web-most-linked").locator("visible=true").waitFor();
    } finally {
      await api.delete(`${base}/api/workshops/${id}`, { timeout: 300_000 }).catch(() => {});
    }
  },
};
