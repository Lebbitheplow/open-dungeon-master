// A player whose hero has died at a table that plays one character each.
// They keep the table (the chronicle and the composer stay), a banner names
// the fallen hero and offers a new one at the level they reached, and the
// same three ways to a hero open under it. A ready-made hero taken through
// the confirm sheet seats at that level, the banner goes, and the GM is
// told whose place the newcomer takes (src/lib/characters/hero-door.ts).
// Before, every door refused "You already have a character in this
// campaign" and the player could only watch.
import { axeViolations, check, eventually, untilStill } from "../lib.mjs";

export default {
  name: "fallen-hero",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, ids, api, base, viewport } = t;
    const tableId = ids.fallenTables[viewport];
    await t.open(`/campaigns/${tableId}`);

    const banner = page.locator(`${root}[data-fallen-hero]`).locator("visible=true").first();
    await eventually(() => banner.count(), { timeoutMs: 30_000, label: "the fallen hero's banner" });
    const text = await banner.textContent();
    check(/Ilsa Marr has fallen/i.test(text), `the banner names the fallen hero: ${text}`);
    check(/level 4/.test(text), `the banner says the level a new hero joins at: ${text}`);
    // The table stays the player's: the story and the box to talk in.
    const composer = page.locator(`${root}textarea`).locator("visible=true").first();
    check((await composer.count()) > 0, "the composer stays for table talk");
    check(/Ilsa Marr has fallen/.test((await composer.getAttribute("placeholder")) ?? ""), "the composer says the fallen hero cannot act");
    // Settled first: a fresh shot catches the theme and the reveals mid-fade.
    await untilStill(page);
    await t.shot("fallen");
    // Readable and named in both themes.
    const night = await axeViolations(page, `${root}[data-fallen-hero]`);
    check(!night.length, `the banner passes axe at night (${night.map((violation) => violation.id).join(", ")})`);
    const theme = await page.evaluate(() => document.documentElement.dataset.theme ?? "");
    await page.evaluate(() => (document.documentElement.dataset.theme = "light"));
    // Settled first: a fresh shot catches the theme and the reveals mid-fade.
    await untilStill(page);
    await t.shot("fallen-day");
    const day = await axeViolations(page, `${root}[data-fallen-hero]`);
    check(!day.length, `the banner passes axe in the day theme (${day.map((violation) => violation.id).join(", ")})`);
    await page.evaluate((mode) => (document.documentElement.dataset.theme = mode), theme);

    const open = banner.getByRole("button", { name: "Bring in a new hero" });
    check((await open.getAttribute("aria-expanded")) === "false", "the routes start folded");
    await t.tap(open);
    const routes = page.locator(`${root}[data-fallen-hero] [data-hero-routes]`).locator("visible=true").first();
    await eventually(() => routes.count(), { label: "the three ways to a hero" });
    await t.tap(routes.locator('[data-hero-route="ready"]').first());
    const pick = routes.getByRole("button", { name: /Kara/ }).first();
    await eventually(() => pick.count(), { timeoutMs: 20_000, label: "the ready-made heroes" });
    await t.shot("routes");
    await t.tap(pick);

    const sheet = page.locator(`${root}[data-join-confirm]`).locator("visible=true").first();
    await eventually(async () => (await sheet.count()) && (await sheet.getAttribute("aria-busy")) === "false", { timeoutMs: 20_000, label: "the confirm sheet's check" });
    check(/\b4\b/.test(await sheet.textContent()), "the confirm sheet shows the hero at level 4");
    await t.tap(sheet.locator("[data-join-take]"));

    await eventually(() => banner.count().then((count) => count === 0), { timeoutMs: 20_000, label: "the banner leaving once the new hero is seated" });
    const seat = (await (await api.get(`${base}/api/campaigns/${tableId}/sheet`)).json()).sheet;
    check(/^Kara\b/.test(seat?.name ?? "") && seat.level === 4, `the new hero is seated at level 4: ${JSON.stringify({ name: seat?.name, level: seat?.level })}`);
    const state = await (await api.get(`${base}/api/campaigns/${tableId}`)).json();
    check(state.sheets.some((entry) => entry.name === "Ilsa Marr" && entry.deathSaves?.dead), "the fallen hero stays on the record");
    check(state.messages.some((message) => /take the place of Ilsa Marr, who fell/.test(message.content)), "the GM is told whose place the newcomer takes");
    await t.shot("seated");
  },
};
