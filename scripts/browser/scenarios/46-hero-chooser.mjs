// The hero chooser and the confirm sheet before a seat (backlog F5, F6): the
// join page lists the lead's heroes, the ready-made ones and Build new on
// one screen, a pick opens the confirm sheet with the table's check, Cancel
// seats nobody, and Take the seat seats the hero and goes back to the lobby.
// The seat and the hero it saved are removed again, so the lobby stays
// without a hero for the other scenarios and the next viewport.
import { check, eventually } from "../lib.mjs";

export default {
  name: "hero-chooser",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, ids, api, base } = t;
    const seat = async () => (await (await api.get(`${base}/api/campaigns/${ids.lobbyId}/sheet`)).json()).sheet ?? null;
    check((await seat()) === null, "the lobby starts with no hero for the lead");

    await t.open(`/campaigns/${ids.lobbyId}/character`);
    const chooser = page.locator(`${root}[data-hero-chooser]`).locator("visible=true").first();
    await eventually(() => chooser.count(), { timeoutMs: 30_000, label: "the hero chooser" });
    await eventually(() => chooser.locator('[data-chooser-section="starters"], [data-tour="pregen-picker"]').count(), { label: "the ready-made heroes" });
    for (const section of ["library", "build"]) {
      check((await chooser.locator(`[data-chooser-section="${section}"]`).count()) === 1, `the ${section} section is on the chooser`);
    }

    // A library hero: the sheet opens with the check, and Cancel seats nobody.
    await t.tap(chooser.locator(`[data-hero-pick="${ids.library}"]`));
    const sheet = page.locator(`${root}[data-join-confirm]`).locator("visible=true").first();
    await eventually(async () => (await sheet.count()) && (await sheet.getAttribute("aria-busy")) === "false", { timeoutMs: 20_000, label: "the confirm sheet's check" });
    const text = (await sheet.innerText()).replace(/\s+/g, " ");
    check(/level 1 here, down from 3/i.test(text), `the sheet says the hero plays at the table's level (${text.slice(0, 160)})`);
    check((await sheet.locator('[data-join-rules="pass"]').count()) === 1, "the table's rules check passes");
    await t.shot("confirm-library");
    await t.tap(page.locator(`${root}button`).filter({ hasText: /^Cancel$/ }).locator("visible=true").first());
    await eventually(async () => (await page.locator(`${root}[data-join-confirm]`).count()) === 0, { label: "the sheet closes" });
    check((await seat()) === null, "Cancel seated nobody");

    // A ready-made hero, taken: the seat is there and the page is the lobby.
    const starter = chooser.locator('[data-tour="pregen-picker"] button').first();
    await t.tap(starter);
    await eventually(async () => (await sheet.count()) && (await sheet.getAttribute("aria-busy")) === "false", { timeoutMs: 20_000, label: "the starter's check" });
    await t.tap(sheet.locator("[data-join-take]"));
    const seated = await eventually(seat, { timeoutMs: 20_000, label: "the starter takes the seat" });
    await eventually(async () => !/\/character/.test((await t.url()).pathname), { timeoutMs: 20_000, label: "back to the lobby" });

    // Leave the lobby as it was found.
    const removed = await api.delete(`${base}/api/campaigns/${ids.lobbyId}/sheet`);
    check(removed.ok(), "the seat is given up again");
    if (seated.libraryCharacterId) {
      await api.delete(`${base}/api/characters/${seated.libraryCharacterId}`);
    }
  },
};
