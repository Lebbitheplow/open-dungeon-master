// A player's walk takes two taps: the first on a lit square aims it (the
// ruler holds the path and the hint asks for the second), the second on the
// same square makes it. A stray click while the camera is being moved used
// to be a step taken (Discord, 2026-10-20). Escape drops the aim.
//
// The last scenario on purpose: it walks Tavi one square for real.
import { check, eventually, sleep } from "../lib.mjs";

const AIMED = "Tap the same tile again to move there";

export default {
  name: "board-move-confirm",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, ids } = t;
    await t.open(`/campaigns/${ids.campaignId}`);
    const board = () => page.locator(`${root}[aria-label^="Board view"]`).locator("visible=true").first();
    if (!(await board().count())) {
      // On a phone the board sits under the Battle tab of the bottom bar.
      await t.tap(page.locator(`${root}nav.cine-bottombar button`).filter({ hasText: /battle/i }).first());
      await sleep(800);
    }
    const lit = () => board().locator('rect[fill="#f59e0b"][data-tile-x]');
    await eventually(() => lit().count(), { timeoutMs: 30_000, label: "the squares Tavi can reach" });
    const where = () =>
      page.evaluate(async (campaignId) => {
        const { view } = await (await fetch(`/api/campaigns/${campaignId}/battle-map`)).json();
        const mine = view.tokens.find((token) => token.id === view.myTokenId);
        return `${mine.x},${mine.y}`;
      }, ids.campaignId);
    const start = await where();
    const square = lit().first();
    const to = `${await square.getAttribute("data-tile-x")},${await square.getAttribute("data-tile-y")}`;
    const hint = () => page.getByText(AIMED).locator("visible=true").count();

    // One tap aims and moves nothing; Escape drops the aim.
    await t.tap(square);
    await eventually(hint, { label: "the hint asking for the second tap" });
    await sleep(600);
    check((await where()) === start, `one tap on ${to} moved nothing (Tavi still on ${start})`);
    await t.shot("aimed");
    await page.keyboard.press("Escape");
    await eventually(async () => (await hint()) === 0, { label: "Escape dropping the aim" });

    // Tap, tap: the walk is made.
    await t.tap(square);
    await eventually(hint, { label: "the aim again" });
    await t.tap(square);
    await eventually(async () => (await where()) === to, { label: `Tavi on ${to} after the second tap` });
    check((await hint()) === 0, "the hint is gone once the walk is made");
    await t.shot("walked");
  },
};
