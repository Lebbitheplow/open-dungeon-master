// Issue 240: each viewer puts the Party panel's cards in their own order.
// Arrange, move a card with the arrows and by dragging its handle, see the
// order kept across a reload (it is saved on the membership), and reset it.
// Nothing here opens a sheet or changes the table for anyone else.
import { check, eventually, sleep } from "../lib.mjs";

export default {
  name: "party-order",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, ids, api, base } = t;
    // Viewports share one seeded world: start from the table's own order,
    // whatever an earlier run left on the lead's membership.
    const cleared = await api.patch(`${base}/api/campaigns/${ids.campaignId}/members/me`, { data: { partyOrder: [] } });
    check(cleared.ok(), `clearing the lead's saved order answered ${cleared.status()}`);
    await t.open(`/campaigns/${ids.campaignId}`);
    const cards = () => page.locator(`${root}[data-party-card]`).locator("visible=true");
    const shown = async () => {
      const list = await cards().evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-party-card")));
      return list;
    };
    // A desktop opens on the roster; a phone tabs the panel away behind its
    // bottom bar (the Party tab, or Battle while the board is staged), and
    // the party rail opens it where there is one.
    const openParty = async () => {
      await eventually(() => page.locator(`${root}.cine-stage`).count(), { timeoutMs: 30_000, label: "the table's stage" });
      await sleep(1_500);
      for (const selector of [`${root}[data-tour="tab-party"]`, `${root}[data-tour="tab-battle"]`, `${root}.cine-party button`]) {
        if ((await cards().count()) >= 2) break;
        const door = page.locator(selector).locator("visible=true").first();
        if (await door.count()) {
          await t.tap(door);
          await sleep(800);
        }
      }
      await eventually(async () => (await cards().count()) >= 2, { timeoutMs: 30_000, label: "two party cards" });
    };
    await openParty();
    const start = await shown();
    check(start[0] === ids.tavi && start[1] === ids.bree, `the table's own order first: Tavi then Bree (${start.join(", ")})`);

    const arrange = page.getByRole("button", { name: /^arrange$/i }).locator("visible=true").first();
    await eventually(() => arrange.count(), { label: "the Arrange button" });
    await t.tap(arrange);
    const handles = page.locator(`${root}.party-grip`).locator("visible=true");
    await eventually(async () => (await handles.count()) >= 2, { label: "a handle on every card" });
    await t.shot("arranging");

    // The arrow: Tavi goes down, Bree is first.
    await t.tap(page.getByRole("button", { name: /^move tavi lockwhisper down$/i }).locator("visible=true").first());
    await eventually(async () => (await shown())[0] === ids.bree, { label: "Bree first after the arrow" });
    check((await shown())[1] === ids.tavi, "Tavi second after the arrow");
    const settled = page.locator(`${root}[data-party-card][data-moved]`);
    await eventually(() => settled.count(), { timeoutMs: 2_000, label: "the moved card settling with motion" });

    // Saved on the membership, as the lead's own.
    await eventually(async () => {
      const response = await api.get(`${base}/api/campaigns/${ids.campaignId}`);
      const data = await response.json();
      const mine = (data.members ?? []).find((member) => member.username === ids.lead);
      return mine && mine.partyOrder?.[0] === ids.bree && mine.partyOrder?.[1] === ids.tavi;
    }, { label: "the order saved on the lead's membership" });

    // Dragging the handle: Tavi's grip up over Bree's card, let go above its
    // middle: Tavi is first again.
    const taviGrip = page.locator(`${root}[data-party-card="${ids.tavi}"] .party-grip`).locator("visible=true").first();
    const breeCard = page.locator(`${root}[data-party-card="${ids.bree}"]`).locator("visible=true").first();
    const grip = await taviGrip.boundingBox();
    const target = await breeCard.boundingBox();
    check(Boolean(grip && target), "the grip and the other card are on screen");
    // On a slow runner a redraw mid-drag can swallow the moves that draw the
    // line. So the pointer keeps nudging while the test looks, and a drag
    // that never took is let go over Tavi's own card (which moves nothing)
    // and made again, up to three times.
    const dropLine = page.locator(`${root}[data-party-card="${ids.bree}"][data-drop="before"]`);
    let lineShown = false;
    for (let attempt = 0; attempt < 3 && !lineShown; attempt += 1) {
      await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
      await page.mouse.down();
      await page.mouse.move(grip.x + grip.width / 2, target.y + 8, { steps: 6 });
      for (let look = 0; look < 15 && !lineShown; look += 1) {
        await sleep(100);
        await page.mouse.move(grip.x + grip.width / 2, target.y + 8 + (look % 2), { steps: 1 });
        lineShown = (await dropLine.count()) === 1;
      }
      if (!lineShown) {
        await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2, { steps: 4 });
        await page.mouse.up();
      }
    }
    check(lineShown, "the drop line shows above Bree while dragging");
    await page.mouse.move(grip.x + grip.width / 2, target.y + 6, { steps: 2 });
    await page.mouse.up();
    await eventually(async () => (await shown())[0] === ids.tavi, { label: "Tavi first after the drag" });
    check((await page.locator(`${root}[data-party-card][data-drop]`).count()) === 0, "no drop line once let go");

    // The order survives a reload: it came from the membership, not the tab.
    await t.tap(page.getByRole("button", { name: /^move tavi lockwhisper down$/i }).locator("visible=true").first());
    await eventually(async () => (await shown())[0] === ids.bree, { label: "Bree first before the reload" });
    await t.open(`/campaigns/${ids.campaignId}`);
    await openParty();
    const kept = await shown();
    check(kept[0] === ids.bree && kept[1] === ids.tavi, `the order kept across a reload (${kept.join(", ")})`);
    check((await page.locator(`${root}.party-grip`).count()) === 0, "arranging is off again after a reload; the cards are plain");

    // Reset: back to the table's own order, for every run after this one.
    await t.tap(page.getByRole("button", { name: /^arrange$/i }).locator("visible=true").first());
    const reset = page.getByRole("button", { name: /^reset order$/i }).locator("visible=true").first();
    await eventually(() => reset.count(), { label: "the Reset order button once an order is the viewer's own" });
    await t.tap(reset);
    await eventually(async () => (await shown())[0] === ids.tavi, { label: "the table's order back after the reset" });
    await eventually(() => reset.count().then((count) => count === 0), { label: "nothing left to reset" });
    await t.tap(page.getByRole("button", { name: /^done$/i }).locator("visible=true").first());
    await eventually(() => page.locator(`${root}.party-grip`).count().then((count) => count === 0), { label: "the handles gone on Done" });
    await t.shot("reset");
  },
};
