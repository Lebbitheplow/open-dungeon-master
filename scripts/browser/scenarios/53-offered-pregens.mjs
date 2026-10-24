// A DM's own pregens shared with the table, and the owed choices picked on
// the confirm sheet. The player runs Offer Table, made from their workshop,
// which holds two pregens: one ticked "Offer to players", one not
// (src/lib/db/pregen-offers.ts). The lead joins it as a player: the hero
// chooser lists the ticked pregen only, the confirm sheet shows it at the
// table's level 4 with its owed subclass and improvement to pick
// (OwedPicksFields.tsx), the subclass is picked, the improvement is left
// for later, and the seat is a copy with the Champion. The seat and the copy
// are removed again, which frees the pregen for the next viewport.
import { request } from "playwright-core";
import { check, eventually } from "../lib.mjs";

export default {
  name: "offered-pregens",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, ids, api, base } = t;
    const tableId = ids.offerTableId;
    const seat = async () => (await (await api.get(`${base}/api/campaigns/${tableId}/sheet`)).json()).sheet ?? null;
    check((await seat()) === null, "the lead starts Offer Table without a hero");

    // The DM's tick is the workshop's own route; ticking it again is a no-op.
    const dmApi = await request.newContext();
    try {
      const signed = await dmApi.post(`${base}/api/auth/login`, { data: { username: ids.player, password: ids.password } });
      check(signed.ok(), `the DM's sign-in answered ${signed.status()}`);
      const ticked = await dmApi.patch(`${base}/api/workshops/${ids.offerWorkshopId}/pregens`, {
        data: { characterId: ids.offeredPregen, offered: true },
      });
      check(ticked.ok(), `the DM's tick answered ${ticked.status()}`);
      const roster = (await ticked.json()).pregens;
      check(roster.find((entry) => entry.id === ids.hiddenPregen)?.offered === false, "the second pregen stays unticked");
    } finally {
      await dmApi.dispose();
    }

    await t.open(`/campaigns/${tableId}/character`);
    const chooser = page.locator(`${root}[data-hero-chooser]`).locator("visible=true").first();
    await eventually(() => chooser.count(), { timeoutMs: 30_000, label: "the hero chooser" });
    const section = chooser.locator('[data-chooser-section="offered"]');
    await eventually(() => section.count(), { timeoutMs: 20_000, label: "the DM's offered pregens" });
    check((await section.locator(`[data-offered-pick="${ids.offeredPregen}"]`).count()) === 1, "the ticked pregen is offered");
    check((await chooser.locator(`[data-offered-pick="${ids.hiddenPregen}"]`).count()) === 0, "the unticked pregen is listed");
    await section.scrollIntoViewIfNeeded();
    await t.shot("offered-section");

    await t.tap(section.locator(`[data-offered-pick="${ids.offeredPregen}"]`));
    const sheet = page.locator(`${root}[data-join-confirm]`).locator("visible=true").first();
    await eventually(async () => (await sheet.count()) && (await sheet.getAttribute("aria-busy")) === "false", { timeoutMs: 20_000, label: "the confirm sheet's check" });
    const text = (await sheet.innerText()).replace(/\s+/g, " ");
    check(/from level 1 to 4/i.test(text), `the sheet says the pregen goes up to the table's level (${text.slice(0, 200)})`);
    const pickers = sheet.locator("[data-owed-pickers]");
    check((await pickers.count()) === 1, "the owed choices are offered to pick");
    check((await sheet.locator("[data-owed-asi]").count()) === 1, "the owed improvement has its picker");
    await t.shot("owed-pickers");

    // The subclass is picked; the check is awaited from before the tap.
    const checked = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/api/campaigns/${tableId}/sheet/preview`) &&
        response.request().method() === "POST" &&
        /"picks"/.test(response.request().postData() ?? ""),
      { timeout: 20_000 },
    );
    const champion = sheet.locator('[data-owed-subclass="fighter"] button').filter({ hasText: /^Champion$/ }).first();
    await champion.scrollIntoViewIfNeeded();
    await t.tap(champion);
    await checked;
    await eventually(async () => (await champion.getAttribute("aria-pressed")) === "true", { label: "the Champion picked" });
    await eventually(async () => (await sheet.locator('[data-join-rules="pass"]').count()) === 1, { timeoutMs: 20_000, label: "the picks pass the table's rules" });
    const picked = (await sheet.innerText()).replace(/\s+/g, " ");
    check(/with these picks/.test(picked), `the check says it judged the picks (${picked.slice(-300)})`);
    check(/Left for the first level-up: .*Ability Score Improvement/.test(picked), `the improvement left is said to stay owed (${picked.slice(-300)})`);
    await t.shot("subclass-picked");

    const joined = page.waitForResponse(
      (response) => response.url().endsWith(`/api/campaigns/${tableId}/sheet/offered`) && response.request().method() === "POST",
      { timeout: 20_000 },
    );
    await t.tap(sheet.locator("[data-join-take]"));
    check((await joined).status() === 201, "the offered pregen takes the seat");
    const hero = await eventually(seat, { timeoutMs: 20_000, label: "the copy is seated" });
    check(hero.level === 4, `the copy plays at the table's level (${hero.level})`);
    check(hero.subclass === "Champion", `the picked subclass is on the seat (${hero.subclass})`);
    check(hero.name === ids.offeredPregenName, `the copy is the pregen (${hero.name})`);
    await eventually(async () => !/\/character/.test((await t.url()).pathname), { timeoutMs: 20_000, label: "back to the lobby" });

    // The chooser now says it is the lead's own here.
    const listed = (await (await api.get(`${base}/api/campaigns/${tableId}/pregens`)).json()).pregens;
    check(listed.find((entry) => entry.id === ids.offeredPregen)?.taken === "mine", "the pregen shows as the lead's");

    // Leave the table as it was found: the seat and the library copy go,
    // and with the seat the claim.
    const removed = await api.delete(`${base}/api/campaigns/${tableId}/sheet`);
    check(removed.ok(), "the seat is given up again");
    if (hero.libraryCharacterId) {
      await api.delete(`${base}/api/characters/${hero.libraryCharacterId}`);
    }
    const freed = (await (await api.get(`${base}/api/campaigns/${tableId}/pregens`)).json()).pregens;
    check(freed.find((entry) => entry.id === ids.offeredPregen)?.taken === null, "giving the seat up frees the pregen");
  },
};
