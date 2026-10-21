// PR #438, Wait for the table: its one control is the Pacing picker under
// Players and permissions, for a table the AI narrates with more than one
// seat (the campaign creator does not ask). Waiting is the default, at five
// minutes; "Answers the first post" turns it off, a length turns it back on
// with that length, and an info button says what waiting does.
import { axeViolations, check, eventually } from "../lib.mjs";

export default {
  name: "table-pacing",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, ids, api, base } = t;
    const campaignUrl = `${base}/api/campaigns/${ids.lobbyId}`;
    const read = async () => (await (await api.get(campaignUrl)).json()).campaign.gameSettings;
    // Viewports share one seeded world: start from the default either way.
    await api.patch(`${campaignUrl}/settings`, { data: { waitForTable: true, waitForTableSeconds: 300 } });

    await t.open(`/campaigns/${ids.lobbyId}`);
    const panel = page.locator(`${root}[data-table-settings="edit"]`).locator("visible=true").first();
    await eventually(() => panel.count(), { timeoutMs: 30_000, label: "the lobby's table settings" });
    const players = panel.locator('[data-group="players"]');
    await t.tap(players.locator(".cc-group-toggle"));
    await eventually(async () => (await players.getAttribute("data-open")) !== null, { label: "Players and permissions open" });

    const picker = players.locator('button[aria-label="When the AI DM answers"]');
    await eventually(() => picker.count(), { label: "the pacing picker" });
    check(/Waits for everyone, up to 5 min/.test((await picker.textContent()) ?? ""), "it starts at the default, waiting up to five minutes");
    check((await players.getByRole("button", { name: "What does waiting for everyone do?" }).count()) === 1, "an info button explains it");
    const violations = await axeViolations(page, `${root}[data-group="players"]`);
    const serious = violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical");
    check(!serious.length, `axe finds nothing serious in Players and permissions (${serious.map((violation) => violation.id).join(", ")})`);
    await players.scrollIntoViewIfNeeded();
    await t.shot("default");

    await t.tap(picker);
    await t.tap(page.getByRole("menuitemradio", { name: "Waits for everyone, up to 2 min" }).locator("visible=true").first());
    await eventually(async () => {
      const settings = await read();
      return settings.waitForTable === true && settings.waitForTableSeconds === 120;
    }, { label: "two minutes saved, with the wait on" });
    await eventually(async () => /up to 2 min/.test((await picker.textContent()) ?? ""), { label: "the picker shows the choice" });
    await t.shot("two-minutes");

    await t.tap(picker);
    await t.tap(page.getByRole("menuitemradio", { name: "Answers the first post" }).locator("visible=true").first());
    await eventually(async () => (await read()).waitForTable === false, { label: "the first choice turns it off" });
    await api.patch(`${campaignUrl}/settings`, { data: { waitForTable: true, waitForTableSeconds: 300 } });
  },
};
