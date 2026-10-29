// The builder's first step while its option lists are still on their way:
// it says they are loading, and never that the content pack is missing. A
// 0.31.1 playtest saw "Content pack not installed" flash on every open of a
// server that had the pack. The lists are held back here until the shots are
// taken, so the moment that used to flash stays on screen.
import { check, eventually } from "../lib.mjs";

const LOADING = "Loading the races, classes and backgrounds this server offers";
const MISSING = /Content pack not installed|basic rules set/;

export default {
  name: "builder-pack-loading",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, base } = t;
    let release;
    const held = new Promise((resolve) => (release = resolve));
    const lists = /\/api\/content\/(races|classes|backgrounds)\?/;
    await page.route((url) => lists.test(url.href), async (route) => {
      await held;
      await route.continue().catch(() => undefined);
    });
    try {
      if (t.app) {
        void t.open("/characters/new").catch(() => undefined);
      } else {
        await page.goto(`${base}/characters/new`, { waitUntil: "domcontentloaded", timeout: 120_000 });
      }
      const loading = page.locator(`${root}[role="status"]`).filter({ hasText: LOADING }).locator("visible=true");
      await eventually(() => loading.count(), { timeoutMs: 60_000, label: "the loading line" });
      check(!MISSING.test((await page.locator(`${root}main, ${root}body`).first().innerText()) ?? ""), "no missing-pack notice while the lists load");
      await loading.first().scrollIntoViewIfNeeded().catch(() => undefined);
      await t.shot("loading-night");
      await page.evaluate(() => (document.documentElement.dataset.theme = "light"));
      await page.waitForTimeout(1000);
      await t.shot("loading-day");
      await page.evaluate(() => (document.documentElement.dataset.theme = "dark"));
    } finally {
      release();
    }
    // The lists answer and the line goes; the seeded server has the pack, so
    // no missing-pack notice follows it either.
    const loading = page.locator(`${root}[role="status"]`).filter({ hasText: LOADING });
    await eventually(async () => (await loading.count()) === 0, { timeoutMs: 30_000, label: "the loading line going" });
    await page.unrouteAll({ behavior: "ignoreErrors" });
    await page.waitForTimeout(1000);
    await t.shot("loaded-night");
  },
};
