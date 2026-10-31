// Issue 668: the "Previously" recap that opens a session was posted as a
// system line and took its faint italic style, lighter than the narration,
// so it was easy to miss. It is a card now, under a "Previously" heading,
// upright and as bright as the story, by night and by day, clean under axe.
import { axeViolations, check, eventually, untilStill } from "../lib.mjs";

async function inTheme(page, theme) {
  await page.evaluate((value) => (document.documentElement.dataset.theme = value), theme);
  await untilStill(page);
}

export default {
  name: "recap-card",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, ids, viewport } = t;
    await t.open(`/campaigns/${ids.recapTables[viewport]}`);
    const card = page.locator(`${root}section[aria-label="Previously"]`).locator("visible=true").last();
    await eventually(() => card.count(), { timeoutMs: 30_000, label: "the recap card" });
    await card.scrollIntoViewIfNeeded();
    // textContent, not innerText: the heading is uppercased by CSS, and
    // innerText reads it as the screen shows it ("PREVIOUSLY").
    const words = (await card.textContent()) ?? "";
    check(/Previously/.test(words), `headed Previously: ${words}`);
    check(/followed her lantern's tracks/.test(words), `it carries the recap: ${words}`);
    check(!/Previously: You reached/.test(words), "the prefix is the heading, not printed twice");
    const text = card.locator(".session-recap-text");
    for (const theme of ["dark", "light"]) {
      await inTheme(page, theme);
      const style = await text.evaluate((element) => {
        const computed = getComputedStyle(element);
        return { fontStyle: computed.fontStyle, color: computed.color };
      });
      check(style.fontStyle === "normal", `the recap is upright by ${theme === "dark" ? "night" : "day"} (${style.fontStyle})`);
      const found = await axeViolations(page, `${root}section[aria-label="Previously"]`);
      check(!found.length, `axe on the recap by ${theme === "dark" ? "night" : "day"}: ${found.map((entry) => `${entry.id}: ${entry.help}`).join("; ").slice(0, 400)}`);
      await t.shot(`recap-card-${theme}`);
    }
    await inTheme(page, "dark");
    if (viewport === "phone") {
      const width = await card.evaluate((element) => element.getBoundingClientRect().width);
      const viewportWidth = await page.evaluate(() => window.innerWidth);
      check(width <= viewportWidth, `the card fits a phone (${width} of ${viewportWidth})`);
    }
  },
};
