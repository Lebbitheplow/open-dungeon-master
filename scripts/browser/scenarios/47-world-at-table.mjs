// WF-10: the campaign's world at the table. The lead of an AI campaign
// opens the World tab and finds this campaign's own entries, with no
// workshop file buttons; a player at the same table has no World tab and
// is refused the world's route; and once a person holds the DM seat, the
// World tab sits beside their console. The quiet table goes back to the AI
// whatever happens, since every viewport and later scenario shares it.
import { check, eventually, newContext, openPanelTab, settle, signIn, sleep } from "../lib.mjs";

export default {
  name: "world-at-table",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, ids, api, base, viewport } = t;
    const stamp = Date.now().toString(36);
    const name = `Saltmarsh Light ${stamp}`;
    const campaign = `${base}/api/campaigns/${ids.quietId}`;
    // The tools' first-visit tours open over whatever is about to be pressed.
    await api.post(`${base}/api/profile/tours`, { data: { finished: [{ id: "workshop-world", version: 1, how: "ended" }] } });
    const made = await api.post(`${campaign}/world/entities`, { data: { typeId: "t_location", name, text: "A lighthouse the smugglers steer by." } });
    check(made.ok(), `an entry in the quiet table's world (${made.status()})`);
    const ref = (await made.json()).entity.ref;
    const browser = page.context().browser();
    const playerContext = await newContext(browser, viewport, { app: false });
    try {
      // The lead of an AI campaign: the World tab, this campaign's entry.
      await t.open(`/campaigns/${ids.quietId}`);
      await openPanelTab(t, "world");
      const panel = page.locator(`${root}[data-world-at="table"]`).locator("visible=true").first();
      await eventually(() => panel.count(), { timeoutMs: 30_000, label: "the World tab's panel" });
      check(await page.locator(`${root}[data-testid="world-table-note"]`).locator("visible=true").first().isVisible(), "the panel says it is this campaign's world");
      check((await panel.getByRole("button", { name: /Open a WorldForge file/ }).count()) === 0, "no workshop file to open at the table");
      check((await panel.getByText(/Save as a WorldForge file/).count()) === 0, "no workshop file to save at the table");
      const option = panel.getByRole("option", { name: new RegExp(name) }).first();
      await eventually(() => option.count(), { timeoutMs: 20_000, label: "the entry in the wiki" });
      await option.scrollIntoViewIfNeeded();
      await t.tap(option);
      const heading = panel.locator('[data-tour="world-entry"] h3', { hasText: name }).first();
      await eventually(() => heading.isVisible(), { label: "the entry's page" });
      check(/smugglers steer by/.test(await panel.locator('[data-tour="world-entry"]').first().innerText()), "the entry's text");
      await t.shot("lead-world");

      // A player at the same table: no World tab anywhere, and the route
      // answers no.
      await signIn(playerContext, base, ids.player, ids.password);
      const playerPage = await playerContext.newPage();
      await playerPage.goto(`${base}/campaigns/${ids.quietId}`, { waitUntil: "networkidle", timeout: 120_000 });
      await sleep(1_500);
      await settle(playerPage);
      const partyTab = playerPage.locator('[data-tour="tab-party"]').locator("visible=true").first();
      const more = playerPage.locator('[data-tour="tab-more"]').locator("visible=true").first();
      await eventually(async () => (await partyTab.count()) > 0 || (await more.count()) > 0, { timeoutMs: 30_000, label: "the player's tabs" });
      check((await playerPage.locator('[data-tour="tab-world"]').count()) === 0, "the player has no World tab");
      if (await more.count()) {
        await (t.touch ? more.tap() : more.click());
        await sleep(400);
        check((await playerPage.locator('[data-more-tab="world"]').count()) === 0, "nor one under More");
        await playerPage.keyboard.press("Escape");
      }
      check((await playerPage.locator('[data-world-at="table"]').count()) === 0, "no world panel on the player's page");
      const refused = await playerContext.request.get(`${campaign}/world`);
      check(refused.status() === 403, `the player's world request answered ${refused.status()}`);
      check(!(await refused.text()).includes("smugglers"), "and said nothing of the world");

      // A person in the DM seat (the AI still narrates): the console and
      // the World tab, with the same entry.
      const steered = await api.patch(`${campaign}/settings`, { data: { dmMode: "steered" } });
      check(steered.ok(), `the lead took the DM seat (${steered.status()})`);
      await t.reload();
      await settle(page);
      await eventually(() => page.locator(`${root}[data-tour="tab-dm"]`).count(), { timeoutMs: 30_000, label: "the DM console's tab" });
      await openPanelTab(t, "world");
      const dmPanel = page.locator(`${root}[data-world-at="table"]`).locator("visible=true").first();
      await eventually(() => dmPanel.count(), { timeoutMs: 30_000, label: "the DM's World tab" });
      await eventually(() => dmPanel.locator('[data-tour="world-entry"] h3', { hasText: name }).first().isVisible().catch(() => false), {
        timeoutMs: 20_000,
        label: "the DM back on the entry they had open",
      });
      await t.shot("dm-world");
    } finally {
      await api.patch(`${campaign}/settings`, { data: { dmMode: "ai" } });
      await api.delete(`${campaign}/world/entities/${encodeURIComponent(ref)}`);
      await playerContext.close().catch(() => {});
    }
  },
};
