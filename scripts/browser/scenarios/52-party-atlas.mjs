// The party's Atlas: the lead of the quiet table opens the World tab's Atlas
// on a map with three pins (one hidden from the party, one with a secret in
// its notes) and presses Show to the party. The review lists what players
// will see and what stays hidden; once shown, a player's Map tab shows the
// map with its two visible pins and nothing of the hidden one or the notes.
// Hide from the party takes it off the player's Map tab. The quiet table's
// maps and pins are put back as they were.
import { check, eventually, newContext, openPanelTab, settle, signIn, sleep } from "../lib.mjs";

export default {
  name: "party-atlas",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, ids, api, base, viewport } = t;
    const stamp = Date.now().toString(36);
    const mapName = `The tide roads ${stamp}`;
    const secret = `The ferryman keeps the pact ${stamp}`;
    const campaign = `${base}/api/campaigns/${ids.quietId}`;
    await api.post(`${base}/api/profile/tours`, { data: { finished: [{ id: "workshop-world", version: 1, how: "ended" }] } });
    const before = (await (await api.get(`${campaign}/world`)).json()).doc;
    const mapId = `m_${stamp}`;
    const seeded = await api.patch(`${campaign}/world`, {
      data: {
        maps: [{ id: mapId, name: mapName, image: "", parentPinId: "", regions: [] }, ...before.maps],
        pins: [
          ...before.pins,
          { id: `p1_${stamp}`, mapId, x: 0.2, y: 0.3, name: `Saltgate ${stamp}`, ref: "", linkedMapId: "", notes: secret },
          { id: `p2_${stamp}`, mapId, x: 0.6, y: 0.4, name: `Ferry ${stamp}`, ref: "", linkedMapId: "", notes: "" },
          { id: `p3_${stamp}`, mapId, x: 0.8, y: 0.7, name: `Pact stone ${stamp}`, ref: "", linkedMapId: "", notes: "", hidden: true },
        ],
      },
    });
    check(seeded.ok(), `an Atlas map with three pins (${seeded.status()})`);
    const browser = page.context().browser();
    const playerContext = await newContext(browser, viewport, { app: false });
    try {
      await t.open(`/campaigns/${ids.quietId}`);
      await openPanelTab(t, "world");
      const panel = page.locator(`${root}[data-world-at="table"]`).locator("visible=true").first();
      await eventually(() => panel.count(), { timeoutMs: 30_000, label: "the World tab" });
      await t.tap(panel.locator('[data-tour="world-view-atlas"]').first());
      const listed = panel.getByRole("complementary", { name: "Maps" }).getByRole("button", { name: new RegExp(mapName) }).first();
      await eventually(() => listed.count(), { timeoutMs: 20_000, label: "the map in the list" });
      await t.tap(listed);
      await t.tap(panel.locator('[data-testid="atlas-party-show"]'));
      const review = panel.locator('[data-testid="atlas-party-review"]');
      await eventually(() => review.isVisible(), { label: "the show-to-party review" });
      const listedText = await review.locator('[data-testid="atlas-party-seen"]').innerText();
      check(listedText.includes(`Saltgate ${stamp}`) && listedText.includes(`Ferry ${stamp}`), "the review lists the two pins players will see");
      check(!listedText.includes("Pact stone"), "and not the hidden one");
      check(/Staying hidden: 1 pin/.test(await review.innerText()), "it says what stays hidden");
      await t.shot("party-review");
      await t.tap(review.locator('[data-testid="atlas-party-apply"]'));
      await eventually(() => panel.locator('[data-testid="atlas-party-shown"]').isVisible().catch(() => false), { label: "the map marked as shown to the party" });

      // The player's Map tab.
      await signIn(playerContext, base, ids.player, ids.password);
      const playerPage = await playerContext.newPage();
      await playerPage.goto(`${base}/campaigns/${ids.quietId}`, { waitUntil: "networkidle", timeout: 120_000 });
      await sleep(1_500);
      await settle(playerPage);
      const mapTab = playerPage.locator('[data-tour="tab-map"]').locator("visible=true").first();
      await eventually(() => mapTab.count(), { timeoutMs: 30_000, label: "the player's Map tab" });
      await (t.touch ? mapTab.tap() : mapTab.click());
      const atlas = playerPage.locator('[data-testid="party-atlas"]').locator("visible=true").first();
      await eventually(() => atlas.isVisible().catch(() => false), { timeoutMs: 30_000, label: "the party's Atlas in the player's Map tab" });
      await atlas.scrollIntoViewIfNeeded();
      const seen = await atlas.innerText();
      check(seen.includes(mapName) && seen.includes(`Saltgate ${stamp}`) && seen.includes(`Ferry ${stamp}`), "the player sees the map and its two visible pins");
      check(!seen.includes("Pact stone"), "never the hidden pin");
      const wire = JSON.stringify(await (await playerContext.request.get(`${campaign}/world/atlas/party`)).json());
      check(!wire.includes(secret) && !wire.includes("Pact stone"), "the notes and the hidden pin never reach the player's browser");

      // Hidden again: off the player's Map tab.
      await t.tap(panel.locator('[data-testid="atlas-party-hide"]'));
      await eventually(() => panel.locator('[data-testid="atlas-party-show"]').isVisible().catch(() => false), { label: "the map offered to show again" });
      await eventually(async () => !(await playerPage.locator('[data-testid="party-atlas"]').locator("visible=true").count()), { timeoutMs: 20_000, label: "the map gone from the player's Map tab without a reload" });
    } finally {
      await api.patch(`${campaign}/world`, { data: { maps: before.maps, pins: before.pins } });
      await playerContext.close().catch(() => {});
    }
  },
};
