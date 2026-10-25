// Issue 231: Customize Hand. A card the player moves to More stays there
// after a reload (the layout is the sheet's, saved on the server), and Back
// to automatic gives the engine its own split again.
import { check, eventually, untilStill } from "../lib.mjs";

async function openArrange(t) {
  const { page, root } = t;
  const button = page.locator(`${root}button[aria-label="Customize your hand"]`).locator("visible=true");
  // A phone may open on the turn's board, which has no Hand: the Table tab does.
  if (!(await eventually(() => button.count(), { timeoutMs: 5_000 }).catch(() => 0))) {
    const tab = page.locator(`${root}button, ${root}[role="tab"]`).filter({ hasText: /^\s*table\s*$/i }).locator("visible=true");
    if (await tab.count()) await t.tap(tab.first());
  }
  await eventually(() => button.count(), { timeoutMs: 30_000, label: "the Customize your hand button" });
  await t.tap(button.first());
  await eventually(() => page.locator(`${root}.hand-arrange-row`).locator("visible=true").count(), { label: "the arrange rows" });
  await untilStill(page);
}

// The rows, each with its card's name and where it sits (data-place; the
// badge's words are uppercased by CSS).
const rows = (page, root) =>
  page.locator(`${root}li.hand-arrange-row`).evaluateAll((items) =>
    items.map((item) => ({ name: item.querySelector(".font-display")?.textContent?.trim() ?? "", place: item.dataset.place })),
  );
const placeOf = async (page, root, name) => (await rows(page, root)).find((entry) => entry.name === name)?.place;

export default {
  name: "customize-hand",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, ids } = t;
    await t.open(`/campaigns/${ids.campaignId}`);
    await openArrange(t);
    await t.shot("arrange");
    const before = await rows(page, root);
    const seated = before.find((row) => row.place === "hand" && row.name);
    check(Boolean(seated), `a card sits in the Hand to move (${before.length} rows)`);
    const name = seated.name;
    const row = page.locator(`${root}li.hand-arrange-row[data-place="hand"]`).filter({ hasText: name }).first();
    // The move is saved behind the screen's back (useHandLayout shows it at
    // once), so the reload below waits for the save itself.
    const saved = page.waitForResponse((response) => response.url().includes("/sheet/hand") && response.request().method() === "PUT");
    await t.tap(row.locator(".hand-arrange-move").first());
    // The card lands in More with its own motion, not a jump.
    const landing = await page
      .locator(`${root}li.hand-arrange-row[data-moved="true"]`)
      .first()
      .evaluate((moved) => moved.getAnimations().length)
      .catch(() => 0);
    check(landing > 0, `${name} animates as it moves`);
    await eventually(async () => (await placeOf(page, root, name)) === "more", { label: `${name} moving to More` });
    await t.tap(page.locator(`${root}.hand-arrange-done`).locator("visible=true").first());
    await saved;

    // A reload keeps it in More: the layout lives on the sheet.
    await t.open(`/campaigns/${ids.campaignId}`);
    await openArrange(t);
    check((await placeOf(page, root, name)) === "more", `${name} is still in More after a reload`);
    await t.shot("kept");

    // Back to automatic: the engine's own split, the card back in the Hand.
    const reset = page.locator(`${root}button`).filter({ hasText: /^\s*Back to automatic\s*$/i }).locator("visible=true");
    await t.tap(reset.first());
    await eventually(async () => (await placeOf(page, root, name)) === "hand", {
      label: `${name} back in the Hand after Back to automatic`,
    });
    await t.tap(page.locator(`${root}.hand-arrange-done`).locator("visible=true").first());
  },
};
