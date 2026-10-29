// A spotlight comes down once its player has answered, and a lead's
// direction is an answer. A 0.31.1 playtest's lead answered "Spend your
// remaining Hit Dice on your sheet" with directions, and the spotlight stayed
// above the composer over every turn after. The table is seeded with that
// spotlight on the lead's own character; the shots are the day and the night
// theme, before and after the direction.
import { check, eventually } from "../lib.mjs";

const PROMPT = "Spend your remaining Hit Dice on your sheet.";

export default {
  name: "spotlight-answer",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, ids, viewport } = t;
    await t.open(`/campaigns/${ids.spotlightTables[viewport]}`);
    const banner = page.locator(`${root}.session-banner`).filter({ hasText: PROMPT }).locator("visible=true");
    await eventually(() => banner.count(), { timeoutMs: 30_000, label: "the spotlight banner" });
    await banner.first().scrollIntoViewIfNeeded().catch(() => undefined);
    await t.shot("spotlight-up-night");
    await page.evaluate(() => (document.documentElement.dataset.theme = "light"));
    await page.waitForTimeout(1000);
    await t.shot("spotlight-up-day");
    await page.evaluate(() => (document.documentElement.dataset.theme = "dark"));

    // The browser run has no storyteller, so the direction is sent without
    // waking the GM: a failed turn's card is not what this is about.
    await page.route(/\/lead-note$/, (route) =>
      route.continue({ postData: JSON.stringify({ ...JSON.parse(route.request().postData() ?? "{}"), wake: false }) }),
    );
    await t.tap(page.locator(`${root}button.session-mode[data-mode="lead"]`).locator("visible=true").first());
    const box = page.locator(`${root}[data-tour="composer-input"] textarea`).locator("visible=true").first();
    await box.fill("Krag is done resting; he shoulders his pack and takes the road to the ford.");
    const sent = page.waitForResponse((response) => response.url().includes("/lead-note") && response.request().method() === "POST");
    await t.tap(page.locator(`${root}button[aria-label="Send"]`).locator("visible=true").first());
    const answer = await sent;
    check(answer.status() === 201, `the direction is posted (${answer.status()})`);
    await eventually(async () => (await banner.count()) === 0, { timeoutMs: 15_000, label: "the spotlight coming down" });
    // The mode pill's own move settles before the shot.
    await page.waitForTimeout(1000);
    await t.shot("spotlight-answered-night");
    await page.evaluate(() => (document.documentElement.dataset.theme = "light"));
    await page.waitForTimeout(1000);
    await t.shot("spotlight-answered-day");
    await page.evaluate(() => (document.documentElement.dataset.theme = "dark"));
  },
};
