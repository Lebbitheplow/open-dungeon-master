// Issue #432, where a player meets it: the table's Fights row (how often
// fights come), under the AI storytelling group, with its plain-word hint
// and a finger-sized picker.
import { check, eventually, openPanelTab, openSettingsGroup, sleep } from "../lib.mjs";

export default {
  name: "fights-row",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, ids } = t;

    await t.open(`/campaigns/${ids.campaignId}`);
    await openPanelTab(t, "settings");
    await openSettingsGroup(t, "ai");
    const row = page.locator(`${root}[data-settings-row="combat-pace"]`).locator("visible=true").first();
    await eventually(() => row.count(), { timeoutMs: 30_000, label: "the Fights row" });
    await row.scrollIntoViewIfNeeded();
    await sleep(500);
    const words = (await row.textContent()) ?? "";
    check(/Fights/.test(words), `the row is labelled Fights (${words.slice(0, 80)})`);
    const picker = row.locator(`[aria-label="How often fights come"]`).first();
    check((await picker.count()) > 0, "the picker is named for screen readers");
    const box = await picker.boundingBox();
    check(box && box.height >= (t.touch ? 40 : 30), `the picker is finger-sized on a phone (${box?.height}px)`);
    const hint = (await page.locator(`${root}[data-settings-row="combat-pace"] ~ *, ${root}[data-settings-row="combat-pace"]`).allTextContents()).join(" ");
    check(/fight|scene/i.test(hint), "a plain hint says what the pace does");
    await t.shot("fights-row");
  },
};
