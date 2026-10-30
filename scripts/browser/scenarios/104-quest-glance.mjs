// Issue 581: the quest card at the top of the panel stayed on a quest the
// party had finished, for good. It reads the quest log now: it shows the
// oldest open quest and its next step, the next quest takes its place when
// that one is done, the card goes when none is left, and a tap opens the
// Story tab on its Quests (it opened whichever section was last up). A
// GM-only quest never shows on it.
import { axeViolations, check, eventually, openPanelTab, untilStill } from "../lib.mjs";

const scenario = {
  name: "quest-glance",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, ids, base, api, viewport } = t;
    const table = ids.questTables[viewport];
    const settle = async (questId) => {
      const response = await api.patch(`${base}/api/campaigns/${table.id}/quests/${questId}`, { data: { status: "done" } });
      check(response.ok(), `the quest was marked done (${response.status()})`);
    };
    await t.open(`/campaigns/${table.id}`);
    // A phone shows the panel, and the card over it, from its tab.
    await openPanelTab(t, "story");
    const card = page.locator(`${root}[data-tour="quest-glance"]`).locator("visible=true").first();
    await eventually(() => card.count(), { timeoutMs: 30_000, label: "the quest card" });
    const text = async () => ((await card.textContent()) ?? "").replace(/\s+/g, " ");
    check(/Light for Brackenford/.test(await text()), `the oldest open quest (${await text()})`);
    check(/Restore the Crimson Waystone's protection/.test(await text()), "with its next step, not the one ticked");
    check(!/Abbot/.test(await text()), "never a GM-only quest");
    const found = await axeViolations(page, `${root}[data-tour="quest-glance"]`);
    check(!found.length, `axe on the card: ${found.map((entry) => entry.id).join(", ")}`);
    await t.shot("card");
    await page.evaluate(() => (document.documentElement.dataset.theme = "light"));
    await untilStill(page);
    await t.shot("card-day");
    await page.evaluate(() => (document.documentElement.dataset.theme = "dark"));

    // The tap opens the Quests, whatever section was up.
    await t.tap(card);
    const log = page.getByText("Quest log", { exact: true }).locator("visible=true").first();
    await eventually(() => log.count(), { timeoutMs: 15_000, label: "the Quests section after the tap" });
    await t.shot("quests");

    // Finished, the next quest takes its place; with none left the card goes.
    await settle(table.light);
    await eventually(async () => /The Ferryman's Toll/.test(await text()), { timeoutMs: 20_000, label: "the next quest on the card" });
    await untilStill(page);
    await t.shot("next");
    await settle(table.ferry);
    await eventually(() => card.count().then((count) => count === 0), { timeoutMs: 20_000, label: "the card gone once every quest is done" });
    await t.shot("done");
  },
};

export default scenario;
