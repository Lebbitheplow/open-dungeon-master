// Issues #433 and #434, where a player meets them: the level-up dialog's
// multiclass list leads with the setting's own classes, folds the rest under
// Other settings, and can be searched.
import { check, eventually, openPanelTab, sleep } from "../lib.mjs";

export default {
  name: "level-up-classes",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, ids, viewport } = t;

    await t.open(`/campaigns/${ids.levelTableId}`);
    // The party card offers the level; a phone keeps the party on its own tab.
    if (viewport === "phone") await openPanelTab(t, "party").catch(() => {});
    const search = page.locator(`input[aria-label="Search classes"]`).locator("visible=true").first();
    // The level-up moment plays first; the party card's button opens the
    // dialog if the moment has already gone.
    await eventually(async () => {
      if (await search.count()) return true;
      const button = page.locator(`${root}button`).filter({ hasText: /Level up to 4/ }).locator("visible=true");
      if (await button.count()) await t.tap(button.first()).catch(() => {});
      return false;
    }, { timeoutMs: 45_000, label: "the level-up dialog's class search" });
    await search.scrollIntoViewIfNeeded();
    await sleep(600);
    const dialogText = (await page.locator('[role="dialog"]').last().textContent()) ?? "";
    check(/Recommended for this setting/.test(dialogText), "the setting's own classes lead the list");
    const other = page.locator(`button[aria-expanded]`).filter({ hasText: /^\s*Other settings \(\d+\)/ }).locator("visible=true").first();
    check((await other.count()) > 0, "the other settings' classes fold away");
    check((await other.getAttribute("aria-expanded")) === "false", "folded by default");
    await t.shot("level-up-classes");
    await search.fill("wiz");
    await sleep(500);
    // The list the search filters sits right under it.
    const list = search.locator("xpath=ancestor::label[1]/following-sibling::div[1]");
    const shown = await list.locator("button[aria-pressed]").allTextContents();
    check(shown.some((text) => /Wizard/.test(text)) && shown.length <= 3, `searching narrows the list (${shown.join(" | ").slice(0, 120)})`);
    await t.shot("level-up-search");
    await page.keyboard.press("Escape");
    await sleep(600);
  },
};
