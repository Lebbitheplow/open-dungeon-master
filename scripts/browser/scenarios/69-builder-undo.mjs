// Undo for build experiments (backlog F12) on a stored build: changing a
// Champion fighter to a wizard clears the class's picks and offers "Put it
// back" on the class step, said in a polite live region while focus stays on
// the card that was chosen. The button is reached by keyboard, and pressing
// it returns the fighter with its subclass and fighting style; another
// change offered again ends when the player leaves the step.
import { check, eventually, sleep } from "../lib.mjs";

export default {
  name: "builder-undo",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, ids } = t;
    const found = [];
    const active = `${root}section[data-active]`;
    await t.open(`/characters/${ids.library}/edit`);
    const classRow = page.locator(`${active} [data-summary-edit="calling"]`).locator("visible=true");
    await eventually(() => classRow.count(), { timeoutMs: 30_000, label: "the summary's class row" });
    await t.tap(classRow.first());
    const card = (name) => page.locator(`${active} .creator-card[aria-label^="${name}"]`).locator("visible=true").first();
    await card("Fighter").waitFor({ state: "visible", timeout: 30_000 });
    if ((await card("Fighter").getAttribute("aria-pressed")) !== "true") found.push("the stored fighter is not the chosen card");

    const bar = page.locator(`${active} [data-build-undo]`);
    const said = page.locator(`${root}[data-build-undo-said]`);
    if (await bar.count()) found.push("an undo shows before any change");

    await t.tap(card("Wizard"));
    await eventually(() => bar.isVisible(), { timeoutMs: 8_000, label: "the Put it back bar" });
    const text = (await bar.textContent())?.trim() ?? "";
    if (!/Changed class from Fighter to Wizard/.test(text)) found.push(`the bar says "${text}"`);
    const spoken = (await said.textContent())?.trim() ?? "";
    if (!spoken.startsWith("Changed class from Fighter to Wizard")) found.push(`the live region says "${spoken}"`);
    if ((await said.getAttribute("role")) !== "status") found.push("the live region is not a status");
    const focusInBar = await bar.evaluate((node) => node.contains(document.activeElement));
    if (focusInBar) found.push("the bar took focus when it appeared");

    // The button is a tab stop at the top of the step: Shift+Tab reaches it
    // from wherever the class grid left focus.
    let reached = false;
    for (let step = 0; step < 30 && !reached; step += 1) {
      await page.keyboard.press("Shift+Tab");
      reached = await bar.evaluate((node) => node.querySelector("button") === document.activeElement);
    }
    if (!reached) found.push("Shift+Tab never reached Put it back");
    await t.shot("offered");
    if (reached) {
      await page.keyboard.press("Enter");
    } else {
      await t.tap(bar.locator("button").first());
    }
    await eventually(async () => (await bar.count()) === 0, { timeoutMs: 8_000, label: "the bar going" });
    await eventually(async () => (await card("Fighter").getAttribute("aria-pressed")) === "true", { timeoutMs: 8_000, label: "the fighter back" });
    const subclass = page.locator(`${active} [data-builder-target="subclass"] button[aria-haspopup="listbox"]`).locator("visible=true").first();
    const subclassText = (await subclass.textContent().catch(() => ""))?.trim() ?? "";
    if (!/Champion/.test(subclassText)) found.push(`the subclass reads "${subclassText}" after Put it back`);
    const back = (await said.textContent())?.trim() ?? "";
    if (back !== "Put back Fighter and its picks.") found.push(`after Put it back the live region says "${back}"`);
    const lost = await page.evaluate(() => document.activeElement === document.body);
    if (lost) found.push("focus fell to the page after Put it back");

    // Offered again, then the step is left: the undo goes.
    await t.tap(card("Rogue"));
    await eventually(() => bar.isVisible(), { timeoutMs: 8_000, label: "the bar for a second change" });
    await t.tap(page.locator(`${root}button[aria-label^="Back to step 2"]`).locator("visible=true").first());
    await sleep(700);
    const ahead = page.locator(`${root}button[aria-label^="Go to step 3:"]`).locator("visible=true");
    await eventually(async () => (await ahead.count()) && ahead.first().isEnabled(), { timeoutMs: 15_000, label: "the step 3 diamond" });
    await t.tap(ahead.first());
    await sleep(700);
    await card("Rogue").waitFor({ state: "visible", timeout: 15_000 });
    if (await page.locator(`${root}[data-build-undo]`).count()) found.push("the undo outlived leaving the step");

    if (found.length) await t.shot("problems");
    check(found.length === 0, `the builder's undo:\n  ${found.join("\n  ")}`);
  },
};
