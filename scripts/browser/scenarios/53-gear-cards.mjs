// Issue #424: gear in a fight. The seed lays a handaxe beside Tavi: the board
// draws it with a ring while it is within reach, and the Hand deals the
// gear cards (Pick up with the item to choose, Drop, Stow) priced as the
// engine charges them. Nothing is played: a played card wakes the DM.
import { check, eventually, untilStill } from "../lib.mjs";

const cardNames = (locator) => locator.evaluateAll((cards) => cards.map((card) => (card.getAttribute("aria-label") ?? "").split(",")[0].trim()));

// Every card dealt, the fan's, the ones inside its groups (issue 528: the
// gear cards fold under Items) and the ones behind More, by name.
async function dealt(t) {
  const { page, root } = t;
  const fan = await cardNames(page.locator(`${root}.hand-fan button.hand-card:not(.hand-group-card)`));
  const groups = await page.locator(`${root}button.hand-group-card`).evaluateAll((cards) => cards.map((card) => card.dataset.groupId));
  for (const id of groups) {
    await t.tap(page.locator(`${root}button.hand-group-card[data-group-id="${id}"]`).first());
    const back = page.locator(`${root}.hand-back`).locator("visible=true");
    await eventually(() => back.count(), { label: `the ${id} group open` });
    fan.push(...(await cardNames(page.locator(`${root}.hand-fan button.hand-card`))));
    await t.tap(back.first());
    await eventually(async () => (await back.count()) === 0, { label: "the main hand again" });
  }
  const more = page.locator(`${root}button.hand-more`).locator("visible=true");
  if (!(await more.count())) return fan;
  await t.tap(more.first());
  await eventually(() => page.locator("li.hand-more-row").locator("visible=true").count(), { label: "the cards behind More" });
  await untilStill(page);
  const behind = await page.locator("li.hand-more-row .font-display").evaluateAll((names) => names.map((name) => name.textContent?.trim() ?? ""));
  return [...fan, ...behind];
}

export default {
  name: "gear-cards",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, ids, viewport } = t;
    await t.open(`/campaigns/${ids.campaignId}`);

    if (viewport === "desktop") {
      const drop = page.locator(`${root}.board-drop`).first();
      await eventually(() => drop.count(), { timeoutMs: 30_000, label: "the dropped handaxe on the board" });
      const title = await drop.locator("title").first().textContent().catch(() => "");
      check(/Handaxe/.test(title ?? ""), `the drop is named on the board (title "${title}")`);
      check((await page.locator(`${root}.board-drop-reach`).count()) > 0, "the drop beside Tavi shows the reach ring");
      await t.shot("board-drop");
      // Up close, on the enlarged board: the item's icon and its reach ring.
      const enlarge = page.locator(`${root}[aria-label="Enlarge battle map"]`).locator("visible=true").first();
      if (await enlarge.count()) {
        await t.tap(enlarge);
        const big = page.locator('[role="dialog"] .board-drop').first();
        await eventually(() => big.count(), { label: "the drop on the enlarged board" });
        await untilStill(page);
        const at = await big.boundingBox();
        if (at) {
          const pad = 140;
          await page.screenshot({
            path: t.shotPath("board-drop-close"),
            clip: { x: Math.max(0, at.x - pad), y: Math.max(0, at.y - pad), width: at.width + pad * 2, height: at.height + pad * 2 },
          });
        }
        await page.keyboard.press("Escape");
        await eventually(async () => (await big.count()) === 0, { label: "the enlarged board closing" });
      }
    } else {
      // The phone's Table tab holds the Hand.
      const tab = page.locator(`${root}button, ${root}[role="tab"]`).filter({ hasText: /^\s*table\s*$/i }).locator("visible=true");
      if (await tab.count()) await t.tap(tab.first());
    }

    await eventually(() => page.locator(`${root}.hand-card`).count(), { timeoutMs: 30_000, label: "the Hand's cards" });
    const names = await dealt(t);
    for (const name of ["Pick up", "Drop", "Stow a weapon"]) {
      check(names.includes(name), `${name} is dealt (${names.join(", ")})`);
    }
    // The More sheet is open when the card sits behind it; otherwise it is
    // in the fan, or inside Items.
    const behind = page.locator("li.hand-more-row button").filter({ hasText: "Pick up" }).locator("visible=true");
    const items = page.locator(`${root}button.hand-group-card[data-group-id="group:items"]`).locator("visible=true");
    if (!(await behind.count()) && (await items.count())) {
      await t.tap(items.first());
      await eventually(() => page.locator(`${root}.hand-back`).locator("visible=true").count(), { label: "Items open" });
    }
    const card = (await behind.count())
      ? behind.first()
      : page.locator(`${root}button.hand-card[aria-label^="Pick up,"]`).locator("visible=true").first();
    await t.tap(card);
    const pills = page.locator(`[role="radiogroup"][aria-label="Item"] [role="radio"]`).locator("visible=true");
    await eventually(() => pills.count(), { label: "the Item pick on the aim bar" });
    // The aim bar grows in; its pills are measured at their full size.
    await untilStill(page);
    const first = pills.first();
    check(/Handaxe/.test((await first.textContent()) ?? ""), "the pick offers the handaxe within reach");
    check((await first.getAttribute("aria-checked")) === "true", "the only item is picked already");
    const box = await first.boundingBox();
    check(box && box.height >= 32, `the item pill is a usable target (${box?.height}px)`);
    const said = await page.evaluate(() => document.body.textContent ?? "");
    check(said.includes("I pick up the Handaxe."), "the sentence the card sends reads plainly");
    await t.shot("pick-up");
    await page.keyboard.press("Escape");
  },
};
