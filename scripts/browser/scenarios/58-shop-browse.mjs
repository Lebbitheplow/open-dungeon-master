// Shops in play: the DM opened a smithy, and the chat says so in one line
// with a Browse wares button. Pressing it opens the Party tab's Market on
// that shop, with focus on the Market heading: beside the chat at a desk,
// and on a phone in place of the table, whose bar's Table cell brings the
// chat back. Under the shop the haggling rules read in plain words, beside
// Haggle a real menu button opens the other skills, and a haggle answers
// with what it did to this character's prices. A Play as switch to the
// lead's other character reads the shops again, at that character's prices.
import { check, eventually } from "../lib.mjs";

export default {
  name: "shop-browse",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, ids, api, base } = t;
    // Play as, through the route the Party panel calls, on the lead's own
    // session.
    const playAs = async (characterId) =>
      (await api.post(`${base}/api/campaigns/${ids.marketTableId}/sheet/switch`, { data: { characterId } })).ok();
    // Every viewport starts as Wren: an earlier one switches back, and this
    // keeps a failed one from leaving Tamsin in play.
    check(await playAs(ids.marketHeroId), "playing as Wren");
    await t.open(`/campaigns/${ids.marketTableId}`);
    const line = page.locator(`${root}.session-sysline`).filter({ hasText: `${ids.marketShop} is open.` }).locator("visible=true");
    await eventually(() => line.count(), { timeoutMs: 30_000, label: "the shop's line in the chat" });
    check((await line.count()) === 1, "one line for the one opening");
    const browse = line.first().getByRole("button", { name: "Browse wares" });
    check((await browse.count()) === 1, "the line carries a real Browse wares button");
    await t.shot("line");

    await t.tap(browse);
    const shop = page.locator(`${root}[data-shop-id][data-spotlight]`).locator("visible=true");
    await eventually(() => shop.count(), { timeoutMs: 30_000, label: "the Market on the shop" });
    check(((await shop.first().textContent()) ?? "").includes(ids.marketShop), "the Market brought that shop into view");
    // open_shop stocked it from the bundled SRD tables (the seed has no
    // content pack): priced goods, each with its Buy.
    const goods = shop.first().locator("li");
    await eventually(() => goods.count(), { label: "the forge's shelf" });
    const first = goods.first();
    check(/\d+\s*(pp|gp|ep|sp|cp)/.test((await first.textContent()) ?? ""), "the first line carries a price in coin");
    check((await first.getByRole("button", { name: "Buy" }).count()) === 1, "and a Buy button");
    await eventually(
      () => page.evaluate(() => document.activeElement?.classList.contains("section-head-title") && /market/i.test(document.activeElement.textContent ?? "")),
      { label: "focus on the Market heading" },
    );
    const market = page.locator(`${root}.session-subtab[data-on]`).filter({ hasText: "Market" }).locator("visible=true");
    check((await market.count()) === 1, "the Party tab's Market section is the one showing");
    await t.shot("market");

    // The haggling rules in plain words under the shop, then a haggle: a
    // village's DC is 15, and the result is the haggler's own. The world
    // is shared across viewports, so a later one finds the try used.
    const rules = shop.first().locator("[data-haggle-rules]");
    await eventually(() => rules.count(), { label: "the haggling line under the shop" });
    const haggle = shop.first().getByRole("button", { name: "Haggle", exact: true });
    if ((await haggle.count()) === 1) {
      const said = (await rules.first().textContent()) ?? "";
      check(said.includes("DC 15") && said.includes("fail by 5 or more") && said.includes("stay where they were"), `the rules read plainly: ${said}`);
      check(said.includes("not the whole party"), "and say the price is the haggler's own");
      // The other skills have a door of their own beside Haggle: a real
      // menu button, named, finger-sized on a phone, opened from the
      // keyboard, holding Intimidation and Deception (nobody has lied to
      // this keeper yet).
      const door = shop.first().getByRole("button", { name: "Haggle with another skill" });
      check((await door.count()) === 1, "a menu button beside Haggle for the other skills");
      check((await door.getAttribute("aria-haspopup")) === "menu", "and it says it opens a menu");
      if (t.touch) {
        const box = await door.boundingBox();
        check(box && box.width >= 40 && box.height >= 40, `the door is finger-sized on a phone (${box?.width}x${box?.height})`);
      }
      await door.focus();
      await page.keyboard.press("Enter");
      const menu = page.getByRole("menu").locator("visible=true");
      await eventually(() => menu.count(), { label: "the other skills' menu, opened from the keyboard" });
      const offered = (await menu.first().getByRole("menuitem").allTextContents()).join(" | ");
      check(/Intimidation/.test(offered) && /Deception/.test(offered), `Intimidation and Deception are offered: ${offered}`);
      await page.keyboard.press("Escape");
      await eventually(async () => (await menu.count()) === 0, { label: "the menu closed on Escape" });
      const answered = page.waitForResponse((response) => /\/shops\/[^/]+\/trade$/.test(new URL(response.url()).pathname) && response.request().method() === "POST");
      await t.tap(haggle);
      check((await answered).ok(), "the haggle went through");
      const status = page.locator(`${root}[role=status]`).filter({ hasText: /keeper|bad failure/ }).locator("visible=true");
      await eventually(() => status.count(), { label: "the haggle's outcome" });
      check(/talked the keeper down|holds firm|missed the DC by 5 or more/.test((await status.first().textContent()) ?? ""), "the outcome says what happened to the prices");
    }
    await eventually(async () => /You haggled here/.test((await rules.first().textContent()) ?? ""), { label: "the shop says this character has haggled" });
    check((await shop.first().getByRole("button", { name: "Haggle", exact: true }).count()) === 0, "one try per character");

    // Play as Tamsin: the Market reads the shops again, at her prices. She
    // pushed Brann too hard by Intimidation (the seed), two steps up from
    // the village's +10%: +50%, where Wren's one Persuasion try never lands.
    check(await playAs(ids.marketSecondId), "playing as Tamsin");
    await eventually(async () => /two steps higher/.test((await rules.first().textContent()) ?? ""), { label: "Tamsin's own haggle under the shop after the switch" });
    check(((await shop.first().textContent()) ?? "").includes("(prices +50%)"), "and her own prices on the shop");
    check(await playAs(ids.marketHeroId), "back to Wren");
    await eventually(async () => !/two steps higher/.test((await rules.first().textContent()) ?? ""), { label: "Wren's own prices again" });

    if (t.viewport === "phone") {
      // The panel took the table's place; the bar's Table cell is the way back.
      check((await line.count()) === 0, "the chat is behind the Market on a phone");
      const table = page.locator(`${root}nav.cine-bottombar button`).filter({ hasText: "Table" }).first();
      await t.tap(table);
      await eventually(() => line.count(), { label: "the chat back after Table" });
    } else {
      check((await line.count()) === 1, "the chat stays beside the Market at a desk");
    }
  },
};
