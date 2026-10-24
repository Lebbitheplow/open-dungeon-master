// Issue 503 Phase 7: "Pacts may approach me" is each player's own switch on
// their own character's Bonds row, beside "Open to advances", off until they
// turn it on. It shows only where a pact could approach anyone (a table
// that lets companions leave, another player to betray, a lasting companion
// to do the asking). A real switch named for the character, a finger's size
// on a phone, worked by keyboard with a visible focus ring, clean under axe
// by night and by day.
import { axeViolations, check, eventually, openPanelTab, sleep } from "../lib.mjs";

async function axeClean(page, selector, where) {
  const found = await axeViolations(page, selector);
  check(!found.length, `axe on ${where}: ${found.map((entry) => `${entry.id}: ${entry.help}`).join("; ").slice(0, 600)}`);
}

async function inTheme(page, theme) {
  await page.evaluate((value) => (document.documentElement.dataset.theme = value), theme);
  await sleep(300);
}

export default {
  name: "pact-consent",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, ids, viewport } = t;
    const table = ids.pacts.consent[viewport];
    await t.open(`/campaigns/${table.id}`);
    await openPanelTab(t, "party");
    const bondsTab = page.locator(`${root}[data-pill-group] button`).filter({ hasText: /^\s*Bonds\s*$/ }).locator("visible=true").first();
    await eventually(() => bondsTab.count(), { label: "the Bonds sub-tab" });
    await t.tap(bondsTab);

    const block = page.locator(`${root}[data-pacts-switch="${table.kael}"]`).locator("visible=true").first();
    await eventually(() => block.count(), { timeoutMs: 20_000, label: "Kael's pacts switch" });
    const toggle = block.getByRole("switch", { name: /pacts may approach me, for kael ashvale/i });
    check(await toggle.count(), "a real switch, named for the character");
    check((await toggle.getAttribute("aria-checked")) === "false", "off until the player turns it on");
    if (t.touch) {
      const target = await block.locator("label").first().boundingBox();
      check(target && target.height >= 40, `the switch's row is a finger's size on a phone (${target?.height})`);
    }
    await axeClean(page, `${root}[data-pacts-switch="${table.kael}"]`, "the pacts switch at night");
    await t.shot("pacts-switch");
    await inTheme(page, "light");
    await axeClean(page, `${root}[data-pacts-switch="${table.kael}"]`, "the pacts switch by day");
    await t.shot("pacts-switch-day");
    await inTheme(page, "dark");

    // By keyboard: focus shows its ring, Space turns it on, the server's
    // answer comes back on the sheet, and Space turns it off again.
    await toggle.focus();
    await page.keyboard.press("Space");
    await eventually(async () => (await toggle.getAttribute("aria-checked")) === "true", { label: "switched on by keyboard" });
    const ring = await toggle.evaluate((element) => {
      const style = getComputedStyle(element);
      return { focused: element.matches(":focus-visible"), outline: `${style.outlineStyle} ${style.outlineWidth}`, shadow: style.boxShadow };
    });
    check(ring.focused && (ring.outline !== "none 0px" || ring.shadow !== "none"), `a visible focus ring (${JSON.stringify(ring)})`);
    await t.shot("pacts-switch-on");
    await page.keyboard.press("Space");
    await eventually(async () => (await toggle.getAttribute("aria-checked")) === "false", { label: "switched back off" });
    check((await page.locator(`${root}[data-pacts-switch]`).locator("visible=true").count()) === 1, "only on the player's own character");
  },
};
