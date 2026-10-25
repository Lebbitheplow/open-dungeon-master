// PR 211: the painted picture is one canvas placed by hand, and a DOM node
// sits in one place. Opening the enlarged board moved it into the dialog;
// closing the dialog took it away, and the panel's board stood bare until
// something repainted. The canvas must be on whichever board is on screen,
// and back on the panel's after every close.
import { check, eventually, untilStill } from "../lib.mjs";

// The picture is the canvas usePaintedMap marks (the sky's particles are a
// canvas too). The enlarged view is a dialog; the panel's board is every
// "Board view" outside one (the fight stage frames its board with the same
// class the dialog uses, so the class alone does not tell them apart).
const DIALOG_CANVAS = '[role="dialog"] [aria-label^="Board view"] canvas[data-painted-map]';
const panelCanvases = (page, root) =>
  page.evaluate((prefix) => {
    const boards = [...document.querySelectorAll(`${prefix}[aria-label^="Board view"]`)];
    return boards
      .filter((board) => !board.closest('[role="dialog"]'))
      .reduce((n, board) => n + board.querySelectorAll("canvas[data-painted-map]").length, 0);
  }, root);

export default {
  name: "board-enlarged",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, ids } = t;
    await t.open(`/campaigns/${ids.campaignId}`);
    await eventually(() => panelCanvases(page, root), { timeoutMs: 30_000, label: "the painted board in the panel" });
    const enlarge = page.locator(`${root}[aria-label="Enlarge battle map"]`).locator("visible=true").first();
    if (!(await enlarge.count())) {
      // On a phone the board sits under the Battle tab of the bottom bar.
      const tab = page.locator(`${root}nav.cine-bottombar button`).filter({ hasText: /battle/i }).first();
      await t.tap(tab);
    }
    for (let round = 1; round <= 2; round += 1) {
      await t.tap(page.locator(`${root}[aria-label="Enlarge battle map"]`).locator("visible=true").first());
      await eventually(() => page.locator(DIALOG_CANVAS).count(), { label: `the painted board in the enlarged view (open ${round})` });
      check((await panelCanvases(page, root)) === 0, "while the enlarged view is open, the panel's board draws its plain cells (the one canvas is in the dialog)");
      // The view fades in; the picture is for the eye, the checks above are the proof.
      await untilStill(page);
      await t.shot(`enlarged-${round}`);
      await t.tap(page.locator(".cine-tabletop-close").first());
      await eventually(() => page.locator('[role="dialog"] [aria-label^="Board view"]').count().then((n) => n === 0), { label: `the enlarged view closing (${round})` });
      await eventually(() => panelCanvases(page, root), { label: `the painted board back on the panel after close ${round}` });
    }
    // Escape closes it too, and the panel still gets the picture back.
    await t.tap(page.locator(`${root}[aria-label="Enlarge battle map"]`).locator("visible=true").first());
    await eventually(() => page.locator(DIALOG_CANVAS).count(), { label: "the enlarged view (escape round)" });
    await page.keyboard.press("Escape");
    await eventually(() => panelCanvases(page, root), { label: "the painted board back on the panel after Escape" });
    await t.shot("after-close");
  },
};
