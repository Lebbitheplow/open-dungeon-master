// Issue 569's way back: a companion painted wrong kept that face all
// campaign, with only an upload to change it. On the Command Table (the lead
// plays Kell alone with an AI storyteller; Pip is a companion the GM wrote
// in), Pip's card offers the lead "Paint a portrait" beside the upload where
// the server can paint. The capabilities are answered as an image backend for
// this, and the button is never pressed: a press would put a real render on
// this machine's GPU. The button is named, passes axe by night and by day,
// and is a finger's height on a phone. Answered as a host from before the
// route (no `features`), the card offers no such button and the table still
// works: an older host keeps the app's screens without it. That pass runs on
// the website only, where every open is a fresh page; the app keeps one page
// and its capabilities for 30 seconds.
import { axeViolations, check, eventually, untilStill } from "../lib.mjs";

export default {
  name: "companion-paint",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, ids, viewport } = t;
    await page.route("**/api/capabilities**", async (route) => {
      const response = await route.fetch();
      const body = await response.json().catch(() => ({}));
      await route.fulfill({ response, json: { ...body, images: { ...(body.images ?? {}), configured: true } } });
    });

    // The app keeps one page from scenario to scenario, and the capabilities
    // an earlier one fetched are kept for 30 seconds
    // (src/lib/use-capabilities.ts): past that, the card's panel asks again
    // when it opens, and the answer above is the one it reads.
    if (t.app) await new Promise((resolve) => setTimeout(resolve, 31_000));
    await t.open(`/campaigns/${ids.commandTableId}`);
    const card = page.locator(`${root}[data-party-card="${ids.pip}"]`).locator("visible=true").first();
    for (const selector of [`${root}[data-tour="tab-party"]`, `${root}.cine-party button`]) {
      if (await card.count()) break;
      const door = page.locator(selector).locator("visible=true").first();
      if (await door.count()) {
        await t.tap(door);
        await eventually(() => card.count(), { timeoutMs: 800 }).catch(() => 0);
      }
    }
    await eventually(() => card.count(), { timeoutMs: 30_000, label: "Pip's party card" });
    await untilStill(page);

    const paint = card.getByRole("button", { name: /^Paint a (new )?portrait$/ });
    await eventually(() => paint.count(), { label: "Paint a portrait on Pip's card" });
    check(/new face from their sheet/.test((await paint.getAttribute("title")) ?? ""), "its hint says what it does");
    if (viewport === "phone") {
      const box = await paint.boundingBox();
      check(Boolean(box && box.height >= 39.5), `a finger's height on a phone (${box?.height})`);
    }
    await paint.scrollIntoViewIfNeeded();
    const serious = (list) => list.filter((violation) => violation.impact === "serious" || violation.impact === "critical");
    const night = serious(await axeViolations(page, `${root}[data-party-card="${ids.pip}"]`));
    check(!night.length, `axe finds nothing serious on Pip's card (${night.map((violation) => violation.id).join(", ")})`);
    await t.shot("paint");
    const theme = await page.evaluate(() => document.documentElement.dataset.theme ?? "");
    await page.evaluate(() => (document.documentElement.dataset.theme = "light"));
    await untilStill(page);
    const day = serious(await axeViolations(page, `${root}[data-party-card="${ids.pip}"]`));
    check(!day.length, `Pip's card passes axe in the day theme (${day.map((violation) => violation.id).join(", ")})`);
    await t.shot("paint-day");
    await page.evaluate((mode) => (document.documentElement.dataset.theme = mode), theme);

    if (t.app) return;
    await page.unroute("**/api/capabilities**");
    await page.route("**/api/capabilities**", async (route) => {
      const response = await route.fetch();
      const body = await response.json().catch(() => ({}));
      delete body.features;
      await route.fulfill({ response, json: { ...body, images: { ...(body.images ?? {}), configured: true } } });
    });
    await t.open(`/campaigns/${ids.commandTableId}`);
    for (const selector of [`${root}[data-tour="tab-party"]`, `${root}.cine-party button`]) {
      if (await card.count()) break;
      const door = page.locator(selector).locator("visible=true").first();
      if (await door.count()) {
        await t.tap(door);
        await eventually(() => card.count(), { timeoutMs: 800 }).catch(() => 0);
      }
    }
    await eventually(() => card.count(), { timeoutMs: 30_000, label: "Pip's party card on an older host" });
    await eventually(() => card.getByRole("button", { name: /^(Add|Change) portrait$/ }).count(), { label: "the upload still offered" });
    await untilStill(page);
    check((await card.getByRole("button", { name: /^Paint a (new )?portrait$/ }).count()) === 0, "an older host's card offers no Paint a portrait");
  },
};
