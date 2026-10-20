// The market editor's shelf line: a line picked from the catalog keeps the
// row it is (srdName) when it is renamed into the table's language, and the
// editor says so ("Listed as Longsword") with a button that sells it as no
// listed item. Checked in the markup the editor renders; what a save keeps
// is test-shops' (addStock) and test-whole-names' (the stock line schema).
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-dialog-inline.mjs", import.meta.url);
const { createElement } = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");
const { MarketShopEditor } = await import("../src/app/campaigns/[campaignId]/MarketShopEditor.tsx");

const render = (stock) =>
  renderToStaticMarkup(
    createElement(MarketShopEditor, {
      campaignId: "c",
      shop: { id: "s", name: "Bottega di Marla", kind: "weaponsmith", size: "village", locationId: "", keeperNpcId: "", buys: true, restockDays: 7, markup: 1, stock },
      places: [],
      keepers: [],
      onSaved() {},
      onCancel() {},
    }),
  );
const line = (itemName, srdName) => ({ itemName, qty: 1, priceCp: 1500, note: "", ...(srdName ? { srdName } : {}) });

// A renamed line names its row, and can be made no listed item.
{
  const html = render([line("Spada lunga", "Longsword")]);
  assert.match(html, /Listed as Longsword/);
  assert.match(html, /aria-label="Sell Spada lunga as no listed item"/);
  console.log("ok: a renamed catalog line shows the row it is listed as, with a button to drop it");
}

// A line whose name is its row, or a "+N" of it, or one written by hand,
// shows nothing more.
{
  const html = render([line("Longsword", "Longsword"), line("+1 longsword", "Longsword"), line("Corda")]);
  assert.doesNotMatch(html, /Listed as/);
  assert.doesNotMatch(html, /as no listed item/);
  console.log("ok: a line named as its row, or written by hand, shows no tag");
}
