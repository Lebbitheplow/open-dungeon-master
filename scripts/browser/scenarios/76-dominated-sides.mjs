// Dominate on both sides (issue 503), seeded straight onto the rows, no save
// dice. At the Dominate Table, which the lead runs, the player's Sela holds
// an ogre by Dominate Monster and an enemy mage holds the player's Bran by
// Dominate Person. The ogre's token wears the party's stone band outside its
// health ring and Bran's the foes' red; the initiative rail, the DM's order,
// the monster hand, the enemy roster and the party cards say who fights for
// whom in words, and the ogre's cards aim at the foes and at Bran, never at
// Sela. When the charms end the bands fade and the words go. At the Held
// Table, which the player runs, a mage holds the lead's own Tamsin: the lead
// is told the DM plays her until the charm ends, and told when she is theirs
// again. Night and day, reduced motion, desktop and phone.
import { check, eventually, openPanelTab, signIn, sleep } from "../lib.mjs";

// BoardStage.tsx RING_BY_KIND: a character's rim and an enemy's.
const PARTY_RIM = "#78716c";
const FOE_RIM = "#dc2626";

export default {
  name: "dominated-sides",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, api, base, ids, viewport } = t;
    const table = ids.dominate[viewport];
    const { ogre, mage, sela, bran, tamsin } = table;
    const visible = (selector) => page.locator(`${root}${selector}`).locator("visible=true");
    const tokenSide = async (campaignId, refId) => {
      const response = await api.get(`${base}/api/campaigns/${campaignId}/battle-map`);
      const body = response.ok() ? await response.json() : {};
      const token = (body.view?.tokens ?? []).find((entry) => entry.refId === refId);
      return token ? (token.side ?? "its kind's") : "off the board";
    };
    const invoke = async (request, campaignId, name, args) => {
      const response = await request.post(`${base}/api/campaigns/${campaignId}/dm/invoke`, { data: { name, args } });
      check(response.ok(), `${name} answered ${response.status()}: ${(await response.text()).slice(0, 200)}`);
    };
    check((await tokenSide(table.id, ogre.id)) === "party", `the server has the dominated ${ogre.name} with the party: a world this scenario already ran on needs a fresh seed`);
    check((await tokenSide(table.id, bran.id)) === "foe", `the server has the dominated ${bran.name} with the foes`);

    // The board: a stone band on the ogre, a red one on Bran, none on Sela.
    await t.open(`/campaigns/${table.id}`);
    await openPanelTab(t, "battle");
    const board = page.locator(`${root}.board-panel`).locator("visible=true").first();
    const frame = board.locator(".board-view").first();
    await eventually(() => frame.isVisible(), { timeoutMs: 30_000, label: "the DM's board" });
    const figureOf = (name) => frame.getByRole("img", { name: new RegExp(`^${name}`) }).first();
    const band = (name) =>
      figureOf(name).locator("[data-side-band]").first().evaluate((node) => ({
        opacity: getComputedStyle(node).opacity,
        stroke: node.querySelector(".side-band-ring")?.getAttribute("stroke") ?? null,
        easing: getComputedStyle(node).transitionDuration,
      }));
    const rimSide = (name) => figureOf(name).locator(".token-rim").first().getAttribute("data-side");
    for (const name of [ogre.name, bran.name, sela.name]) {
      await eventually(() => figureOf(name).isVisible(), { timeoutMs: 20_000, label: `${name} on the board` });
    }
    const ogreBand = await band(ogre.name);
    check(ogreBand.opacity === "1" && ogreBand.stroke === PARTY_RIM && /^0\.3s/.test(ogreBand.easing), `the dominated ${ogre.name} wears the party's stone band (${JSON.stringify(ogreBand)})`);
    check((await rimSide(ogre.name)) === "party", `the ${ogre.name}'s rim is on the party's side`);
    check((await frame.getByRole("img", { name: new RegExp(`^${ogre.name}.*with the party`) }).count()) === 1, `the ${ogre.name}'s name says it fights with the party`);
    const branBand = await band(bran.name);
    check(branBand.opacity === "1" && branBand.stroke === FOE_RIM, `the dominated ${bran.name} wears the foes' red band (${JSON.stringify(branBand)})`);
    check((await frame.getByRole("img", { name: new RegExp(`^${bran.name}.*against the party`) }).count()) === 1, `${bran.name}'s name says he fights against the party`);
    check((await band(sela.name)).opacity === "0" && (await rimSide(sela.name)) === null, `${sela.name} fights on her kind's side, unmarked`);
    const zoomIn = board.getByRole("button", { name: "Zoom in", exact: true }).first();
    for (let step = 0; step < 4 && (await zoomIn.count()); step += 1) {
      await t.tap(zoomIn);
      await sleep(350);
    }
    await t.shot("board");
    await frame.screenshot({ path: t.shotPath("board-close") }).catch(() => {});
    // The ogre up close, where a band is a few pixels: the board zooms at
    // the pointer.
    const at = await figureOf(ogre.name).boundingBox();
    if (at) {
      await page.mouse.move(at.x + at.width / 2, at.y + at.height / 2);
      for (let step = 0; step < 3; step += 1) {
        await page.mouse.wheel(0, -400);
        await sleep(300);
      }
      const box = await figureOf(ogre.name).boundingBox();
      if (box) await page.screenshot({ path: t.shotPath("ogre-close"), clip: { x: Math.max(0, box.x - 40), y: Math.max(0, box.y - 40), width: box.width + 80, height: box.height + 80 } }).catch(() => {});
    }

    // The initiative rail says it in words and opens the DM's order, where
    // each row wears its side down its edge.
    const rail = board.getByRole("button", { name: /open (the|initiative) order/i }).first();
    const railName = (await rail.getAttribute("aria-label")) ?? "";
    check(railName.includes(`${ogre.name} fights with the party.`) && railName.includes(`${bran.name} fights against the party.`), `the rail's name says who fights for whom (${railName})`);
    const plates = board.locator('[data-tour="battle-initiative"]');
    check((await plates.locator('[data-side-badge="party"]').count()) === 1 && (await plates.locator('[data-side-badge="foe"]').count()) === 1, "one plate wears the party's band and one the foes'");
    await t.tap(rail);
    const dialog = visible('[role="dialog"]').first();
    await eventually(() => dialog.isVisible(), { label: "the initiative order" });
    const row = (side, name) => dialog.locator(`li[data-side="${side}"]`).filter({ hasText: name });
    await eventually(async () => (await row("party", ogre.name).count()) === 1, { label: `the ${ogre.name}'s row on the party's side` });
    check(/with the party/i.test((await row("party", ogre.name).textContent()) ?? ""), `the ${ogre.name}'s row says "with the party"`);
    check(/against the party/i.test((await row("foe", bran.name).textContent()) ?? ""), `${bran.name}'s row says "against the party"`);
    await sleep(400);
    await t.shot("order");
    await page.keyboard.press("Escape");
    await eventually(async () => !(await dialog.isVisible().catch(() => false)), { label: "the order closed" });

    // The monster hand: the ogre's chip says it fights with the party, and
    // its cards aim at the foes and at Bran, not at Sela.
    // Above the message box: on a phone, the Table tab's.
    const hand = visible(`section[aria-label="The monsters' hand"]`).first();
    const tableTab = page.locator(`${root}nav.cine-bottombar`).getByRole("button", { name: /^table$/i }).locator("visible=true").first();
    if (!(await hand.isVisible().catch(() => false)) && (await tableTab.count())) await t.tap(tableTab);
    await eventually(() => hand.isVisible(), { timeoutMs: 20_000, label: "the monsters' hand" });
    const show = hand.getByRole("button", { name: "Show the monsters' cards" });
    if (await show.count()) await t.tap(show.first());
    const ogreChip = hand.getByRole("group", { name: "Which monster" }).getByRole("button", { name: new RegExp(ogre.name) }).first();
    check((await ogreChip.locator('[data-side-badge="party"]').textContent()) === "With the party", `the ${ogre.name}'s chip says "With the party"`);
    check((await hand.getByRole("group", { name: "Which monster" }).getByRole("button", { name: new RegExp(mage.name) }).first().locator("[data-side-badge]").count()) === 0, `the ${mage.name} wears no side chip`);
    await t.tap(ogreChip);
    const cards = hand.getByRole("group", { name: `${ogre.name}'s cards` });
    await eventually(async () => (await cards.getByRole("button").count()) > 0, { label: `the ${ogre.name}'s cards` });
    await cards.getByRole("button").first().evaluate((node) => node.click());
    const targets = hand.getByRole("group", { name: "Targets" });
    await eventually(() => targets.isVisible(), { label: "the targets" });
    const aimed = (await targets.getByRole("button").allTextContents()).join(" | ");
    check(aimed.includes(mage.name) && aimed.includes(bran.name) && !aimed.includes(sela.name), `the ${ogre.name} aims at the foes and at ${bran.name}, not at ${sela.name} (${aimed})`);
    await sleep(600);
    await t.shot("hand");
    await page.keyboard.press("Escape");

    // The enemy roster above the party cards, and the cards.
    await openPanelTab(t, "party");
    const rosterBadge = visible('[data-side-badge="party"]').filter({ hasText: "With the party" });
    await eventually(async () => (await rosterBadge.count()) > 0, { label: "a side chip in the roster" });
    const card = (name) => visible(".party-card-heading").filter({ hasText: name }).first();
    await eventually(() => card(bran.name).isVisible(), { timeoutMs: 20_000, label: `${bran.name}'s card` });
    check((await card(bran.name).locator('[data-side-badge="foe"]').textContent()) === "Against the party", `${bran.name}'s card says "Against the party"`);
    check((await card(sela.name).locator("[data-side-badge]").count()) === 0, `${sela.name}'s card has no side chip`);
    const chipLook = await card(bran.name).locator('[data-side-badge="foe"]').evaluate((node) => ({
      name: getComputedStyle(node).animationName,
      duration: getComputedStyle(node).animationDuration,
      height: node.getBoundingClientRect().height,
    }));
    check(chipLook.name === "side-badge-in" && chipLook.duration === "0.3s", `the chip comes in over 300 ms (${JSON.stringify(chipLook)})`);
    await sleep(600);
    await t.shot("party");
    const theme = await page.evaluate(() => document.documentElement.dataset.theme ?? "");
    await page.evaluate(() => (document.documentElement.dataset.theme = "light"));
    await sleep(500);
    await t.shot("party-day");
    await page.evaluate((mode) => (document.documentElement.dataset.theme = mode), theme);

    // Reduced motion keeps the colour and the words, without the movement.
    await page.emulateMedia({ reducedMotion: "reduce" });
    const still = await card(bran.name).locator('[data-side-badge="foe"]').evaluate((node) => ({ name: getComputedStyle(node).animationName, color: getComputedStyle(node).backgroundColor }));
    check(still.name === "none" && still.color !== "rgba(0, 0, 0, 0)", `under reduced motion the chip stays, unmoving (${JSON.stringify(still)})`);

    // The charms end (the console's own door): Bran's chip goes, and on the
    // board the ogre's band fades.
    await invoke(api, table.id, "clear_condition", { characterId: bran.id, condition: "charmed" });
    await eventually(async () => (await card(bran.name).locator("[data-side-badge]").count()) === 0, { label: `${bran.name}'s chip gone with the charm` });
    await page.emulateMedia({ reducedMotion: null });
    await invoke(api, table.id, "clear_condition", { enemyId: ogre.id, condition: "charmed" });
    await openPanelTab(t, "battle");
    await eventually(async () => (await band(ogre.name)).opacity === "0", { label: `the ${ogre.name}'s band faded` });
    check((await rimSide(ogre.name)) === null, `the ${ogre.name} is a foe again`);
    await sleep(400);
    await t.shot("released");

    // The Held Table: the lead's own Tamsin is dominated, and told so.
    await t.open(`/campaigns/${table.heldId}`);
    await sleep(1_000);
    if (await tableTab.count()) await t.tap(tableTab);
    const held = visible('[data-side-notice="foe"]').first();
    await eventually(() => held.isVisible(), { timeoutMs: 20_000, label: "the dominated notice" });
    check((await held.textContent()) === `${tamsin.name} is dominated: the DM plays ${tamsin.name} until the charm ends.`, `the player is told (${await held.textContent()})`);
    check((await held.evaluate((node) => node.parentElement?.getAttribute("role"))) === "status", "the notice is a status a screen reader announces");
    await sleep(600);
    await t.shot("held");
    // The player runs that table: their own session ends the charm.
    const dmContext = await page.context().browser().newContext();
    try {
      await signIn(dmContext, base, ids.player, ids.password);
      await invoke(dmContext.request, table.heldId, "clear_condition", { characterId: tamsin.id, condition: "charmed" });
    } finally {
      await dmContext.close();
    }
    const freed = visible('[data-side-notice="party"]').first();
    await eventually(() => freed.isVisible(), { timeoutMs: 20_000, label: "the freed notice" });
    check((await freed.textContent()) === `${tamsin.name} is yours again.`, `the player is told the charm ended (${await freed.textContent()})`);
    check((await visible('[data-side-notice="foe"]').count()) === 0, "the dominated notice is gone");
    await t.shot("freed");
    await eventually(async () => (await visible('[data-side-notice="party"]').count()) === 0, { timeoutMs: 12_000, label: "the freed notice gone after a moment" });
  },
};
