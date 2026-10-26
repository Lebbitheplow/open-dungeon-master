// Whose turn the table is shown while the enemies before a player take
// theirs (table function audit 2026-10-26, T11). At a table a person runs,
// two goblins won initiative and one is kept off the board (the seed's Enemy
// Turn Table): the DM's board and the turn order name the enemy, not the
// hero up next. A player's board says the same, offers no End turn and names
// no hidden goblin. Handed on from the Enemy turns banner, the turn is the
// hero's on both screens. The player's own screen is a second browser
// session, so it runs on the server's pages only; the app checks the DM's.
import path from "node:path";
import { check, eventually, hydrated, newContext, openPanelTab, pageHarness, signIn } from "../lib.mjs";

// What the board says aloud of whose turn it is (BattleMapPanel's live line).
const spoken = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('[aria-live="polite"]')]
      .map((node) => node.textContent ?? "")
      .filter((text) => /turn\.|^Your turn/.test(text))
      .join(" | "),
  );
// The turn order's lit seats, by their full names (a seat shows a first
// name; its button says the whole of it).
const litSeats = (page, root) =>
  page.locator(`${root}.cine-ribbon-seat[data-current="true"] button`).evaluateAll((seats) => seats.map((seat) => seat.getAttribute("aria-label") ?? ""));
const ribbonNames = (page, root) =>
  page.locator(`${root}.cine-ribbon-seat button`).evaluateAll((seats) => seats.map((seat) => seat.getAttribute("aria-label") ?? "").join(" | "));

export default {
  name: "enemy-turns-shown",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, ids, base, viewport, app } = t;
    const table = ids.enemyTurns[viewport];
    await t.open(`/campaigns/${table.id}`);
    await eventually(() => page.locator(`${root}.cine-stage`).count(), { timeoutMs: 30_000, label: "the table's stage" });
    await openPanelTab(t, "battle");

    // ---- the DM's screen, while the goblins have the turn ----
    await eventually(async () => /the enemy's turn\./.test(await spoken(page)), { timeoutMs: 30_000, label: "the board saying it is the enemy's turn" });
    check(!(await spoken(page)).includes(`${table.heroName}'s turn`), `the DM's board names ${table.heroName} while the goblins act`);
    const lit = await litSeats(page, root);
    check(lit.length > 0 && !lit.some((seat) => seat.includes(table.heroName)), `the turn order lights ${lit.join(", ") || "nobody"}, not the goblins`);
    await t.shot("dm-enemy-turns");

    // ---- a player's screen, the same moment ----
    let player = null;
    let playerContext = null;
    if (!app) {
      playerContext = await newContext(page.context().browser(), viewport, { app: false });
      await signIn(playerContext, base, ids.player, ids.password);
      const playerPage = await playerContext.newPage();
      player = pageHarness({ page: playerPage, base, ids, app: false, viewport, outDir: path.dirname(t.shotPath("x")), tag: `${viewport}-enemy-turns-player`, api: playerContext.request });
      await playerPage.goto(`${base}/campaigns/${table.id}`, { waitUntil: "networkidle", timeout: 120_000 });
      await hydrated(playerPage);
      await openPanelTab(player, "battle");
      await eventually(async () => /the enemy's turn\./.test(await spoken(playerPage)), { timeoutMs: 30_000, label: "the player's board saying it is the enemy's turn" });
      check(!/Your turn/.test(await spoken(playerPage)), "the player's board says it is their turn while the goblins act");
      check((await playerPage.locator(".board-endturn").locator("visible=true").count()) === 0, "the player is offered End turn while the goblins act");
      const seats = await ribbonNames(playerPage, "");
      check(seats.length > 0 && !seats.includes(table.unseen), `the player's turn order names the hidden ${table.unseen}: ${seats}`);
      const playerLit = await litSeats(playerPage, "");
      check(playerLit.length > 0 && !playerLit.some((seat) => seat.includes(table.heroName)), `the player's turn order lights ${playerLit.join(", ") || "nobody"}`);
      await player.shot("waiting");
    }

    try {
      // ---- the DM hands the turn on from the Enemy turns banner, which a
      // phone shows on its Table view, then looks at the board again ----
      const tableView = page.locator(`${root}nav.cine-bottombar`).getByRole("button", { name: /^table$/i }).locator("visible=true").first();
      if (await tableView.count()) {
        await t.tap(tableView);
      }
      const handOn = page.getByRole("button", { name: /hand on the turn$/i }).locator("visible=true").first();
      await eventually(() => handOn.count(), { timeoutMs: 30_000, label: "a Hand on the turn button" });
      await t.tap(handOn);
      if (await tableView.count()) {
        await openPanelTab(t, "battle");
      }
      await eventually(async () => (await spoken(page)).includes(`${table.heroName}'s turn.`), { timeoutMs: 30_000, label: `the DM's board naming ${table.heroName}` });
      await eventually(async () => (await litSeats(page, root)).some((seat) => seat.includes(table.heroName)), { timeoutMs: 15_000, label: `the turn order lighting ${table.heroName}` });
      await t.shot("dm-handed-on");

      if (player) {
        await eventually(async () => /Your turn\./.test(await spoken(player.page)), { timeoutMs: 30_000, label: "the player's board saying it is their turn" });
        await eventually(() => player.page.locator(".board-endturn").locator("visible=true").count(), { timeoutMs: 15_000, label: "End turn offered to the player" });
        await player.shot("their-turn");
        check(player.fails.length === 0, `the player's page: ${player.fails.join("; ")}`);
      }
    } finally {
      await playerContext?.close();
    }
  },
};
