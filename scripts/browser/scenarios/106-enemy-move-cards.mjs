// An enemy's Dash, Disengage and Dodge as Monster Hand cards (issue #621).
// At the Enemy Moves Table, which the lead runs, one goblin stands on an
// open board with its action unspent. Its hand holds Dash, Disengage and
// Dodge beside its attacks and Flee, each a finger's height on a phone and
// named for a screen reader; the roster chip says how far it may walk.
// Playing Dash spends its action: the chip reads "60 ft left · Dashed" and
// the attack cards say why they cannot be played. Answered as a host from
// before the feature (no `features.enemyActions`), the hand holds no move
// cards and the table still works. That pass runs on the website only: the
// app keeps one page and its capabilities for 30 seconds.
import { axeViolations, check, eventually, untilStill } from "../lib.mjs";

export default {
  name: "enemy-move-cards",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, ids, viewport } = t;
    const table = ids.enemyMoves[viewport];
    const visible = (selector) => page.locator(`${root}${selector}`).locator("visible=true");

    // The monsters' hand sits above the message box: on a phone, the Table tab's.
    const openHand = async () => {
      const hand = visible(`section[aria-label="The monsters' hand"]`).first();
      const tableTab = page.locator(`${root}nav.cine-bottombar`).getByRole("button", { name: /^table$/i }).locator("visible=true").first();
      await eventually(async () => (await hand.isVisible().catch(() => false)) || (await tableTab.count()) > 0, { timeoutMs: 30_000, label: "the table" });
      if (!(await hand.isVisible().catch(() => false)) && (await tableTab.count())) await t.tap(tableTab);
      await eventually(() => hand.isVisible(), { timeoutMs: 20_000, label: "the monsters' hand" });
      const show = hand.getByRole("button", { name: "Show the monsters' cards" });
      if (await show.count()) await t.tap(show.first());
      return hand;
    };
    const chipOf = (hand) => hand.getByRole("group", { name: "Which monster" }).getByRole("button", { name: new RegExp(table.goblinName) }).first();
    const cardsOf = (hand) => hand.getByRole("group", { name: `${table.goblinName}'s cards` });
    const card = (hand, name) => cardsOf(hand).getByRole("button", { name: new RegExp(`^${name},`) }).first();

    await t.open(`/campaigns/${table.id}`);
    const hand = await openHand();
    await t.tap(chipOf(hand));
    await eventually(async () => (await cardsOf(hand).getByRole("button").count()) > 0, { label: `the ${table.goblinName}'s cards` });

    // A world this scenario already ran on (the website's pass before the
    // app's) has the goblin's Dash spent: its cards are checked, not played.
    await eventually(async () => / ft left/.test((await chipOf(hand).textContent()) ?? ""), { label: "the roster chip saying how far the goblin may walk" });
    const fresh = !/Dashed/.test((await chipOf(hand).textContent()) ?? "");

    // Its cards: the move cards beside its attacks and Flee.
    for (const name of ["Dash", "Disengage", "Dodge"]) {
      await eventually(() => card(hand, name).count(), { label: `a ${name} card` });
      if (fresh) {
        check(!/\. /.test((await card(hand, name).getAttribute("aria-label")) ?? ""), `the ${name} card is playable while the goblin's action is unspent`);
      }
      if (viewport === "phone") {
        const box = await card(hand, name).boundingBox();
        check(Boolean(box && box.height >= 39.5), `the ${name} card is a finger's height on a phone (${box?.height})`);
      }
    }
    check((await card(hand, "Flee").count()) === 1, "Flee is still in the hand");
    check(!fresh || /30 ft left/.test((await chipOf(hand).textContent()) ?? ""), "the roster chip says 30 ft left before the Dash");
    const serious = (list) => list.filter((violation) => violation.impact === "serious" || violation.impact === "critical");
    const night = serious(await axeViolations(page, `${root}section[aria-label="The monsters' hand"]`));
    check(!night.length, `axe finds nothing serious in the monsters' hand (${night.map((violation) => violation.id).join(", ")})`);
    await untilStill(page);
    await t.shot("move-cards");

    // Dash: its action spent, its movement doubled, its attacks refused.
    if (fresh) {
      await t.tap(card(hand, "Dash"));
      const play = hand.getByRole("button", { name: "Play Dash" });
      await eventually(() => play.count(), { label: "the Play Dash button" });
      check(/takes the Dash action/.test((await hand.textContent()) ?? ""), "the aim bar says the goblin takes the Dash action");
      await t.tap(play);
    }
    await eventually(async () => /60 ft left · Dashed/.test((await chipOf(hand).textContent()) ?? ""), { timeoutMs: 20_000, label: "the roster chip saying 60 ft left · Dashed" });
    await eventually(async () => /already|Dash action/.test((await card(hand, "Dash").getAttribute("aria-label")) ?? ""), { label: "the Dash card saying the action is spent" });
    const attack = cardsOf(hand).getByRole("button").first();
    check(/\. /.test((await attack.getAttribute("aria-label")) ?? ""), "the attack card says why it cannot be played after the Dash");
    await untilStill(page);
    await t.shot("dashed");
    const theme = await page.evaluate(() => document.documentElement.dataset.theme ?? "");
    await page.evaluate(() => (document.documentElement.dataset.theme = "light"));
    await untilStill(page);
    const day = serious(await axeViolations(page, `${root}section[aria-label="The monsters' hand"]`));
    check(!day.length, `the monsters' hand passes axe in the day theme (${day.map((violation) => violation.id).join(", ")})`);
    await t.shot("dashed-day");
    await page.evaluate((mode) => (document.documentElement.dataset.theme = mode), theme);

    // An older host: no move cards, the rest of the hand as before.
    if (t.app) return;
    await page.route("**/api/capabilities**", async (route) => {
      const response = await route.fetch();
      const body = await response.json().catch(() => ({}));
      if (body.features) delete body.features.enemyActions;
      await route.fulfill({ response, json: body });
    });
    await t.open(`/campaigns/${table.id}`);
    const older = await openHand();
    await t.tap(chipOf(older));
    await eventually(async () => (await cardsOf(older).getByRole("button").count()) > 0, { label: `the ${table.goblinName}'s cards on an older host` });
    await eventually(() => card(older, "Flee").count(), { label: "Flee on an older host" });
    for (const name of ["Dash", "Disengage", "Dodge"]) {
      check((await card(older, name).count()) === 0, `an older host's hand offers ${name}`);
    }
    await untilStill(page);
    await t.shot("older-host");
    await page.unroute("**/api/capabilities**");
  },
};
