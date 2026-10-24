// Combat sides on the board (issue 503): a creature that changes sides in a
// fight changes colours where it stands. At the Turncoat Table, which the
// lead runs, two of the player's casters each hold an elemental by Conjure
// Elemental. Ending Ione's concentration turns her fire elemental on the
// party (SRD 5.1: it becomes hostile): its rim goes from the party's stone
// to the foes' red over 300 ms, a red side band fades in outside its health
// ring (which covers the rim), its name says "against the party", and one
// ring of the new colour pulses out. Under reduced motion Oswin's earth
// elemental turns the same way: the colours still change, the ring does not
// move. Night and day, desktop and phone, the website and the app's screens.
import { check, eventually, openPanelTab, sleep } from "../lib.mjs";

// BoardStage.tsx RING_BY_KIND: a character's rim and an enemy's.
const PARTY_RIM = "#78716c";
const FOE_RIM = "#dc2626";

export default {
  name: "turncoat-rim",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, api, base, ids, viewport } = t;
    const { id: campaignId, casters, elementals } = ids.turncoat[viewport];
    const [fire, earth] = elementals.map((elemental) => elemental.name);
    // The side the server gives a token: none while it fights on its kind's.
    const tokenSide = async (refId) => {
      const response = await api.get(`${base}/api/campaigns/${campaignId}/battle-map`);
      const body = response.ok() ? await response.json() : {};
      const token = (body.view?.tokens ?? []).find((entry) => entry.refId === refId);
      return token ? (token.side ?? "its kind's") : "off the board";
    };
    for (const elemental of elementals) {
      const side = await tokenSide(elemental.id);
      check(side === "its kind's", `${elemental.name} starts with the party (${side}): a world this scenario already ran on needs a fresh seed`);
    }

    await t.open(`/campaigns/${campaignId}`);
    await openPanelTab(t, "battle");
    const board = page.locator(`${root}.board-panel`).locator("visible=true").first();
    const frame = board.locator(".board-view").first();
    await eventually(() => frame.isVisible(), { timeoutMs: 30_000, label: "the DM's board" });
    const figureOf = (name) => frame.getByRole("img", { name: new RegExp(`^${name}`) }).first();
    const rimOf = (name) => figureOf(name).locator(".token-rim").first();
    const pulseOf = (name) => figureOf(name).locator("[data-side-flip]");
    const bandOf = (name) => figureOf(name).locator("[data-side-band]").first();
    const band = async (name) =>
      bandOf(name).evaluate((node) => ({
        opacity: getComputedStyle(node).opacity,
        stroke: node.querySelector(".side-band-ring")?.getAttribute("stroke") ?? null,
        easing: getComputedStyle(node).transitionDuration,
      }));
    // The page, and the board alone up close, where a rim is a few pixels.
    const shoot = async (name) => {
      await t.shot(name);
      await frame.screenshot({ path: t.shotPath(`${name}-board`) }).catch(() => {});
    };
    // The DM ends a caster's concentration (clear_condition "concentration",
    // the console's own door), which turns the elemental they held.
    const release = async (index) => {
      const response = await api.post(`${base}/api/campaigns/${campaignId}/dm/invoke`, {
        data: { name: "clear_condition", args: { characterId: casters[index], condition: "concentration" } },
      });
      check(response.ok(), `concentration ended (${response.status()}: ${(await response.text()).slice(0, 200)})`);
    };

    for (const name of [fire, earth]) {
      await eventually(() => figureOf(name).isVisible(), { timeoutMs: 20_000, label: `the ${name} on the board` });
      check((await rimOf(name).getAttribute("stroke")) === PARTY_RIM, `the ${name} wears the party's rim`);
      check((await rimOf(name).getAttribute("data-side")) === null, `the ${name} is on its kind's side`);
      check((await pulseOf(name).count()) === 0, `a board opened on the ${name} does not pulse`);
      const before = await band(name);
      check(before.opacity === "0", `no side band on the ${name} while it fights with the party (${JSON.stringify(before)})`);
    }
    const easing = await rimOf(fire).evaluate((node) => getComputedStyle(node).transitionDuration);
    check(/^0\.3s/.test(easing), `the rim's colour eases over 300 ms (${easing})`);
    // Closer, to see the rims: the elementals stand around the board's middle.
    const zoomIn = board.getByRole("button", { name: "Zoom in", exact: true }).first();
    for (let step = 0; step < 4 && (await zoomIn.count()); step += 1) {
      await t.tap(zoomIn);
      await sleep(350);
    }
    const view = await frame.boundingBox();
    for (const name of [fire, earth]) {
      const seen = await figureOf(name).boundingBox();
      const middle = seen ? { x: seen.x + seen.width / 2, y: seen.y + seen.height / 2 } : null;
      check(view && middle && middle.x > view.x && middle.y > view.y && middle.x < view.x + view.width && middle.y < view.y + view.height, `the ${name} is in view after zooming in`);
    }
    await shoot("party-rims");

    // The fire elemental turns, with motion: the red rim and one ring.
    await release(0);
    await eventually(async () => (await rimOf(fire).getAttribute("data-side")) === "foe", {
      timeoutMs: 15_000,
      label: "the fire elemental on the foes' side",
    });
    check((await rimOf(fire).getAttribute("stroke")) === FOE_RIM, "the fire elemental wears the foes' red");
    await eventually(async () => (await band(fire)).opacity === "1", { label: "the fire elemental's side band faded in" });
    const turned = await band(fire);
    check(turned.stroke === FOE_RIM && /^0\.3s/.test(turned.easing), `a red side band, eased over 300 ms (${JSON.stringify(turned)})`);
    check((await frame.getByRole("img", { name: new RegExp(`^${fire}.*against the party`) }).count()) === 1, "its name says it fights against the party");
    check((await pulseOf(fire).count()) === 1, "one ring for one change of sides");
    const ring = await pulseOf(fire).evaluate((node) => ({
      name: getComputedStyle(node).animationName,
      duration: getComputedStyle(node).animationDuration,
      stroke: node.getAttribute("stroke"),
    }));
    check(ring.name === "side-flip" && ring.duration === "0.3s" && ring.stroke === FOE_RIM, `a red ring pulses out over 300 ms (${JSON.stringify(ring)})`);
    check((await rimOf(earth).getAttribute("stroke")) === PARTY_RIM, "the earth elemental still stands with the party");
    check((await tokenSide(elementals[0].id)) === "foe", "the server has the fire elemental with the foes");
    await sleep(600);
    await shoot("fire-turned");
    // Legible by day too: the same board under the day theme.
    const theme = await page.evaluate(() => document.documentElement.dataset.theme ?? "");
    await page.evaluate(() => (document.documentElement.dataset.theme = "light"));
    await sleep(600);
    await shoot("fire-turned-day");
    await page.evaluate((mode) => (document.documentElement.dataset.theme = mode), theme);

    // The earth elemental turns under reduced motion: the colour changes,
    // the ring stays still and unseen.
    await page.emulateMedia({ reducedMotion: "reduce" });
    await release(1);
    await eventually(async () => (await rimOf(earth).getAttribute("data-side")) === "foe", {
      timeoutMs: 15_000,
      label: "the earth elemental on the foes' side",
    });
    check((await rimOf(earth).getAttribute("stroke")) === FOE_RIM, "the earth elemental wears the foes' red under reduced motion");
    await eventually(async () => (await band(earth)).opacity === "1", { label: "the earth elemental's side band under reduced motion" });
    const still = await pulseOf(earth).evaluate((node) => ({
      name: getComputedStyle(node).animationName,
      opacity: getComputedStyle(node).opacity,
      moving: node.getAnimations().length,
    }));
    check(still.name === "none" && still.opacity === "0" && still.moving === 0, `no ring moves under reduced motion (${JSON.stringify(still)})`);
    await sleep(400);
    await shoot("earth-turned-reduced");
    await page.emulateMedia({ reducedMotion: null });
  },
};
