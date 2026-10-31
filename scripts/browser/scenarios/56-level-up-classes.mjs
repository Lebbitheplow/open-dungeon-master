// Issues #433 and #434, where a player meets them: the level-up dialog's
// multiclass list leads with the setting's own classes, folds the rest under
// Other settings, and can be searched.
//
// Issue #570 (CLS-21): a bard reaching 10th level finds Magical Secrets' two
// spells from any class as their own group in the spell step, named for the
// feature, searched and picked like the bard's own list, reached by keyboard
// and a finger's width on a phone. The level is not taken, so both
// viewports open the same bard.
import { check, eventually, openPanelTab, untilStill } from "../lib.mjs";

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
    await untilStill(page);
    const dialogText = (await page.locator('[role="dialog"]').last().textContent()) ?? "";
    check(/Recommended for this setting/.test(dialogText), "the setting's own classes lead the list");
    const other = page.locator(`button[aria-expanded]`).filter({ hasText: /^\s*Other settings \(\d+\)/ }).locator("visible=true").first();
    check((await other.count()) > 0, "the other settings' classes fold away");
    check((await other.getAttribute("aria-expanded")) === "false", "folded by default");
    await t.shot("level-up-classes");
    await search.fill("wiz");
    // The list the search filters sits right under it.
    const list = search.locator("xpath=ancestor::label[1]/following-sibling::div[1]");
    const shown = await eventually(
      async () => {
        const texts = await list.locator("button[aria-pressed]").allTextContents();
        return texts.length <= 3 ? texts : null;
      },
      { label: "the search narrowing the list" },
    );
    check(shown.some((text) => /Wizard/.test(text)) && shown.length <= 3, `searching narrows the list (${shown.join(" | ").slice(0, 120)})`);
    await t.shot("level-up-search");
    await page.keyboard.press("Escape");
    await eventually(async () => (await search.count()) === 0, { label: "the level-up dialog closing" });

    await magicalSecrets(t);
  },
};

async function magicalSecrets(t) {
  const { page, root, ids, viewport } = t;
  await t.open(`/campaigns/${ids.secretsTableId}`);
  if (viewport === "phone") await openPanelTab(t, "party").catch(() => {});
  const dialog = page.locator('[role="dialog"]').last();
  const group = page.locator('[data-any-list-group="Magical Secrets"]').locator("visible=true").first();
  // The dialog opens on its first step; Next walks it to the spells.
  await eventually(
    async () => {
      if (await group.count()) return true;
      const next = dialog.locator("button").filter({ hasText: /^\s*Next\s*$/ }).locator("visible=true");
      if (await next.count()) {
        await t.tap(next.first()).catch(() => {});
        return false;
      }
      const button = page.locator(`${root}button`).filter({ hasText: /Level up to 10/ }).locator("visible=true");
      if (await button.count()) await t.tap(button.first()).catch(() => {});
      return false;
    },
    { timeoutMs: 60_000, label: "the spell step's Magical Secrets group" },
  );
  await group.scrollIntoViewIfNeeded();
  await untilStill(page);
  const heading = ((await group.locator("h3").textContent()) ?? "").trim();
  check(heading === "Magical Secrets: 2 spells from any class", `the group is named for the feature and its number (${heading})`);
  const stepText = (await dialog.textContent()) ?? "";
  check(!/Spells known: choose/.test(stepText), "the bard's own list keeps no new spell beside Magical Secrets' two at 10th");
  check(/Cantrips: choose 1/.test(stepText), "the bard's new cantrip at 10th is still asked for");

  // Fireball is on no bard list: the group's search finds it, the bard's does not.
  const find = group.locator('input[aria-label="Find a spell for Magical Secrets"]');
  check((await find.count()) === 1, "the group's search is named for the feature");
  await find.fill("Fireball");
  const tile = group.locator('li[data-spell="Fireball"] button[aria-pressed]').first();
  await eventually(async () => (await tile.count()) > 0, { label: "Fireball in the group's list" });
  const own = dialog.locator('input[aria-label="Find a bard spell"]');
  check((await own.count()) === 1, "the bard's own search is named apart from the group's");
  await own.fill("Fireball");
  await untilStill(page);
  const ownHasFireball = await dialog.locator('li[data-spell="Fireball"]').evaluateAll(
    (items, groupNode) => items.some((item) => !groupNode.contains(item)),
    await group.elementHandle(),
  );
  check(!ownHasFireball, "Fireball is offered in the bard's own list");

  // A finger's width on a phone, as the bard's own tiles are.
  const box = await group.locator('li[data-spell="Fireball"]').first().boundingBox();
  check(box !== null && box.height >= 40, `the group's tile is a finger's width (${box?.height ?? "no box"}px)`);

  // By keyboard: from the group's search, Tab reaches its tiles.
  await find.focus();
  await page.keyboard.press("Tab");
  const inGroup = await group.evaluate((node) => node.contains(document.activeElement) && document.activeElement?.tagName === "BUTTON");
  check(inGroup, "Tab from the group's search does not reach its tiles");

  await t.tap(tile);
  await eventually(async () => (await tile.getAttribute("aria-pressed")) === "true", { label: "Fireball chosen" });
  const counter = ((await group.locator(".spellbook > div").first().textContent()) ?? "").replace(/\s+/g, " ");
  check(/From any class 1\/2/.test(counter), `the group counts its own picks (${counter.trim()})`);
  check(/Fireball \(Magical Secrets\)/.test((await dialog.textContent()) ?? ""), "the picks to learn name Magical Secrets");

  // The level is not taken: the other viewport opens the same bard.
  await page.keyboard.press("Escape");
  await eventually(async () => (await group.count()) === 0, { label: "the level-up dialog closing" });
}
