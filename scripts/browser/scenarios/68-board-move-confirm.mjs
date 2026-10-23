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
    // A lit square on screen: the camera crops the map to its frame, and in
    // the app's narrower board the first lit squares can lie outside it,
    // under the panel's header, where no one can tap them.
    const inView = async () => {
      const count = await lit().count();
      for (let index = 0; index < count; index += 1) {
        const candidate = lit().nth(index);
        const box = await candidate.boundingBox();
        if (!box) continue;
        const onTop = await candidate.evaluate(
          (node, [x, y]) => document.elementFromPoint(x, y) === node,
          [box.x + box.width / 2, box.y + box.height / 2],
        );
        if (onTop) return `${await candidate.getAttribute("data-tile-x")},${await candidate.getAttribute("data-tile-y")}`;
      }
      return null;
    };
    const to = await eventually(inView, { timeoutMs: 10_000, label: "a lit square in view" });
    const [toX, toY] = to.split(",");
    const square = board().locator(`rect[data-tile-x="${toX}"][data-tile-y="${toY}"]`).first();
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
