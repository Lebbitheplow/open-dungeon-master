// Shops in play: the DM opened a smithy, and the chat says so in one line
// with a Browse wares button. Pressing it opens the Party tab's Market on
// that shop, with focus on the Market heading: beside the chat at a desk,
// and on a phone in place of the table, whose bar's Table cell brings the
// chat back.
import { check, eventually } from "../lib.mjs";

export default {
  name: "shop-browse",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, ids } = t;
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
