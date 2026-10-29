// "Hopes for this story" on the player's own sheet in play. On the Command
// Table the lead opens Kell's sheet, writes what they hope the story holds,
// saves it and reads it back, and the table has it on Kell's sheet. The
// field and its buttons are named, pass axe, and are a finger's height on a
// phone. (The builder's own field is walked by 32-builder-a11y.) Answered as
// a host from before the field (no `features`), the sheet has no hopes to
// lose: it asks for none. That pass runs on the website only, where every
// open is a fresh page; the app keeps one page and its capabilities for 30
// seconds.
import { axeViolations, check, eventually } from "../lib.mjs";

export default {
  name: "story-hopes",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, ids, api, base, viewport } = t;
    await t.open(`/campaigns/${ids.commandTableId}`);
    const card = page.locator(`${root}button[title="View full character sheet"]`).filter({ hasText: "Kell Brand" }).locator("visible=true").first();
    for (const selector of [`${root}[data-tour="tab-party"]`, `${root}.cine-party button`]) {
      if (await card.count()) break;
      const door = page.locator(selector).locator("visible=true").first();
      if (await door.count()) {
        await t.tap(door);
        await eventually(() => card.count(), { timeoutMs: 800 }).catch(() => 0);
      }
    }
    await eventually(() => card.count(), { timeoutMs: 30_000, label: "Kell's party card" });
    await t.tap(card);
    const sheet = page.locator(`${root}[role="dialog"]`).filter({ hasText: "Hopes for this story" }).first();
    await eventually(() => sheet.count(), { timeoutMs: 20_000, label: "Kell's sheet with Hopes for this story" });
    // Viewports share one world: the second finds the first one's hopes.
    const write = sheet.getByRole("button", { name: /^(Write your hopes|Change hopes)$/ });
    await write.scrollIntoViewIfNeeded();
    await t.shot("hopes");
    await t.tap(write);
    const box = sheet.getByRole("textbox", { name: "Hopes for this story" });
    await eventually(() => box.count(), { label: "the hopes field" });
    const text = `Kell and Pip become as close as brothers, and Kell finds the road home (${viewport}).`;
    await box.fill(text);
    const save = sheet.getByRole("button", { name: "Save hopes" });
    if (viewport === "phone") {
      for (const [label, button] of [["Save hopes", save], ["Cancel", sheet.getByRole("button", { name: "Cancel" })]]) {
        const measured = await button.boundingBox();
        check(Boolean(measured && measured.height >= 39.5), `${label} is a finger's height on a phone (${measured?.height})`);
      }
    }
    const serious = (await axeViolations(page, `${root}[role="dialog"]`)).filter((violation) => violation.impact === "serious" || violation.impact === "critical");
    check(!serious.length, `axe finds nothing serious on the sheet while the hopes are edited (${serious.map((violation) => violation.id).join(", ")})`);
    await t.shot("hopes-editing");
    await t.tap(save);
    await eventually(async () => (await box.count()) === 0 && ((await sheet.textContent()) ?? "").includes(text), { label: "the hopes read back on the sheet" });
    await t.shot("hopes-saved");
    const table = await (await api.get(`${base}/api/campaigns/${ids.commandTableId}`)).json();
    const kell = (table.sheets ?? []).find((entry) => entry.name === "Kell Brand");
    check(kell?.hopes === text, `the hopes were saved (${kell?.hopes})`);

    if (t.app) return;
    await page.route("**/api/capabilities**", async (route) => {
      const response = await route.fetch();
      const body = await response.json().catch(() => ({}));
      delete body.features;
      await route.fulfill({ response, json: body });
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
    await eventually(() => card.count(), { timeoutMs: 30_000, label: "Kell's party card on an older host" });
    await t.tap(card);
    const older = page.locator(`${root}[role="dialog"]`).filter({ hasText: "Features and traits" }).first();
    await eventually(() => older.count(), { timeoutMs: 20_000, label: "Kell's sheet on an older host" });
    check(((await older.textContent()) ?? "").includes("Hopes for this story") === false, "an older host's sheet asks for no hopes");
  },
};
