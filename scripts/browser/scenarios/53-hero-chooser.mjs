// The hero chooser and the confirm sheet before a seat (backlog F5, F6): the
// join page lists the lead's heroes, the ready-made ones and Build new on
// one screen, a pick opens the confirm sheet with the table's check, Cancel
// seats nobody, and Take the seat seats the hero and goes back to the lobby.
// Help me build (backlog F1), between the ready-made heroes and Build new,
// opens the quiz; the hero it builds goes through the same confirm sheet.
// Each seat and the hero it saved are removed again, so the lobby stays
// without a hero for the other scenarios and the next viewport.
import { check, eventually } from "../lib.mjs";

const visible = (page, root, text) =>
  page.locator(`${root}button`).filter({ hasText: text }).locator("visible=true");

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
    for (const section of ["library", "help", "build"]) {
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
    const leave = async (hero) => {
      const removed = await api.delete(`${base}/api/campaigns/${ids.lobbyId}/sheet`);
      check(removed.ok(), "the seat is given up again");
      if (hero.libraryCharacterId) {
        await api.delete(`${base}/api/characters/${hero.libraryCharacterId}`);
      }
    };
    await leave(seated);

    // Help me build: the quiz, its hero at the table's level, the confirm
    // sheet, the seat.
    await t.open(`/campaigns/${ids.lobbyId}/character`);
    await eventually(() => chooser.count(), { timeoutMs: 30_000, label: "the hero chooser again" });
    const order = await chooser.evaluate((node) =>
      ["[data-tour=\"pregen-picker\"]", "[data-chooser-section=\"help\"]", "[data-chooser-section=\"build\"]"].map((selector) => {
        const found = node.querySelector(selector);
        return found ? [...node.querySelectorAll("*")].indexOf(found) : -1;
      }),
    );
    check(order.every((at) => at >= 0) && order[0] < order[1] && order[1] < order[2], `Help me build sits between the ready-made heroes and Build new (${order})`);
    await chooser.locator('[data-chooser-section="help"]').scrollIntoViewIfNeeded();
    await t.shot("help-me-build-door");
    await t.tap(chooser.locator('[data-chooser-section="help"]'));
    const quiz = page.locator(`${root}[data-quick-quiz]`).locator("visible=true").first();
    await eventually(async () => (await quiz.count()) && /Question 1 of 4/.test(await quiz.innerText()), { timeoutMs: 30_000, label: "the quiz on its first question" });
    for (const answer of [/Keep everyone alive/, /^Magic$/, /^Faith$/, /^Knows the lore$/]) {
      const option = visible(page, root, answer);
      await eventually(() => option.count(), { timeoutMs: 10_000, label: `the answer ${answer}` });
      await t.tap(option.first());
    }
    await eventually(async () => (await page.locator(`${root}[data-quick-seed]`).locator("visible=true").count()) === 2, { timeoutMs: 10_000, label: "two suggested heroes" });
    await t.tap(visible(page, root, /^Build this one$/).first());
    await eventually(() => page.locator(`${root}[data-quick-readback]`).locator("visible=true").count(), { timeoutMs: 20_000, label: "the read-back" });
    await t.shot("help-me-build-filled");

    // Joining opens the confirm sheet: the check is awaited from before the
    // click, so an answer that came first is not waited on to the timeout.
    const checked = page.waitForResponse((response) => response.url().endsWith(`/api/campaigns/${ids.lobbyId}/sheet/preview`) && response.request().method() === "POST");
    await t.tap(visible(page, root, /^Join the party$/).first());
    await checked;
    await eventually(async () => (await sheet.count()) && (await sheet.getAttribute("aria-busy")) === "false", { timeoutMs: 20_000, label: "the built hero's check" });
    const builtText = (await sheet.innerText()).replace(/\s+/g, " ");
    check(/Plays at its own level, 1/.test(builtText), `the sheet shows the hero at the table's level (${builtText.slice(0, 160)})`);
    check((await sheet.locator('[data-join-rules="pass"]').count()) === 1, "the built hero passes the table's rules");
    check((await seat()) === null, "nothing is seated before Take the seat");
    await t.shot("confirm-built");
    const joined = page.waitForResponse((response) => response.url().endsWith(`/api/campaigns/${ids.lobbyId}/sheet`) && response.request().method() === "POST");
    await t.tap(sheet.locator("[data-join-take]"));
    check((await joined).status() === 201, "the built hero takes the seat");
    const built = await eventually(seat, { timeoutMs: 20_000, label: "the built hero is seated" });
    check(built.level === 1, `the built hero plays at the table's level (${built.level})`);
    await eventually(async () => !/\/character/.test((await t.url()).pathname), { timeoutMs: 20_000, label: "back to the lobby after the build" });
    await leave(built);
  },
};
