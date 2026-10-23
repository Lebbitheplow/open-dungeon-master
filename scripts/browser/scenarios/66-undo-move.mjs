// Undo move (src/lib/battlemap/move-undo.ts): on the lead's turn a walk of
// one square takes Tavi there, and "Undo move" beside End turn takes the walk
// back, the figure returning and the movement with it; Ctrl+Z does the same
// while the board has the keyboard. The button pops in, is named for screen
// readers, and leaves once nothing is left to take back. Tavi ends on the
// square he started on, so the scenarios after this one find him there.
import { axeViolations, check, eventually, openPanelTab, sleep } from "../lib.mjs";

const STEPS = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];

export default {
  name: "undo-move",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, ids, api, base, viewport } = t;
    const mapUrl = `${base}/api/campaigns/${ids.campaignId}/battle-map`;
    const board = async () => {
      const data = await (await api.get(mapUrl)).json();
      return data.view ?? data;
    };
    const tavi = async () => {
      const view = await board();
      const token = view.tokens.find((entry) => entry.id === view.myTokenId);
      return { x: token?.x, y: token?.y, undo: view.undoMove ?? null, left: view.budgetLeft };
    };
    const start = await tavi();
    check(start.undo === null, "nothing to take back before a move");

    // One lit square from wherever an earlier scenario left Tavi, five feet
    // away and still beside the goblin, so nothing answers the walk.
    const view = await board();
    const goblin = view.tokens.find((entry) => entry.kind === "enemy");
    const cost = new Map(view.reachable.map((cell, index) => [cell, view.reachableCost?.[index] ?? 1]));
    const candidates = STEPS.map(([dx, dy]) => ({ x: start.x + dx, y: start.y + dy })).filter(
      (square) =>
        cost.get(square.y * view.width + square.x) === 1 &&
        (!goblin || Math.max(Math.abs(square.x - goblin.x), Math.abs(square.y - goblin.y)) === 1),
    );
    check(candidates.length > 0, `a lit square beside Tavi (${start.x},${start.y}) that keeps him beside the goblin`);

    await t.open(`/campaigns/${ids.campaignId}`);
    if (viewport === "phone") {
      await openPanelTab(t, "battle");
    }
    const tileAt = (square) => page.locator(`${root}[data-tile-x="${square.x}"][data-tile-y="${square.y}"]`).locator("visible=true").first();
    await eventually(() => tileAt(candidates[0]).count(), { timeoutMs: 30_000, label: "the board's squares" });
    // The first of them a finger can reach: not under the initiative rail or
    // the turn's pips at the board's edges.
    let target = null;
    for (const square of candidates) {
      const open = await tileAt(square).evaluate((node) => {
        const box = node.getBoundingClientRect();
        const top = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
        return top === node;
      }).catch(() => false);
      if (open) {
        target = square;
        break;
      }
    }
    check(Boolean(target), "one of those squares is on top where a finger lands");
    const tile = tileAt(target);
    const undo = page.getByRole("button", { name: /^undo move/i }).locator("visible=true").first();
    check((await undo.count()) === 0, "no Undo move before the walk");

    // A touch screen's first tap previews the route and the second commits it
    // (BattleMapGrid.tsx); a board that asks for the second tap everywhere
    // gets it too.
    const arrived = async () => {
      const now = await tavi();
      return now.x === target.x && now.y === target.y;
    };
    const walk = async () => {
      await t.tap(tile);
      await sleep(600);
      if (!(await arrived())) {
        await t.tap(tile);
      }
      await eventually(arrived, { label: `Tavi walking to (${target.x},${target.y})` });
    };
    await walk();
    await eventually(() => undo.count(), { label: "Undo move offered" });
    check((await undo.getAttribute("aria-label")) === "Undo move, 5 feet", `the button says how far (${await undo.getAttribute("aria-label")})`);
    const animation = await undo.evaluate((node) => getComputedStyle(node).animationName);
    check(/pop-in/.test(animation), `the button pops in (${animation})`);
    const box = await undo.boundingBox();
    check(Boolean(box && box.height >= (viewport === "phone" ? 39.5 : 26)), `a finger's height on a phone (${box?.height})`);
    const violations = await axeViolations(page, `${root}.board-endturn`);
    const serious = violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical");
    check(!serious.length, `axe finds nothing serious beside End turn (${serious.map((violation) => violation.id).join(", ")})`);
    await t.shot("offered");
    // The board keeps its night chrome in the day theme; checked there too.
    const theme = await page.evaluate(() => document.documentElement.dataset.theme ?? "");
    await page.evaluate(() => (document.documentElement.dataset.theme = "light"));
    await sleep(600);
    const day = await axeViolations(page, `${root}.board-endturn`);
    check(day.length === 0, `Undo move passes axe in the day theme: ${JSON.stringify(day).slice(0, 400)}`);
    await t.shot("offered-day");
    await page.evaluate((mode) => (document.documentElement.dataset.theme = mode), theme);

    const home = async () => {
      const now = await tavi();
      return now.x === start.x && now.y === start.y && now.left === start.left;
    };
    await t.tap(undo);
    await eventually(home, { label: `Tavi back at (${start.x},${start.y}) with his movement` });
    await eventually(async () => (await undo.count()) === 0, { label: "Undo move gone with nothing to take back" });
    await eventually(() => page.locator(`${root}.move-note`).filter({ hasText: /^Back where you stood: 5 feet of movement returned\.$/ }).count(), {
      label: "the note saying the walk went back",
    });
    await t.shot("taken-back");

    if (viewport === "desktop") {
      await walk();
      await eventually(() => undo.count(), { label: "Undo move offered again" });
      await page.locator(`${root}.board-view`).first().focus();
      await page.keyboard.press("Control+z");
      await eventually(home, { label: "Ctrl+Z taking the walk back" });
    }
    await sleep(300);
    const end = await tavi();
    check(end.x === start.x && end.y === start.y && end.undo === null, `Tavi ends where he began (${end.x},${end.y})`);
  },
};
