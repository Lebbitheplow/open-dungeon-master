// Issue 254: outside a fight, the lead opens a coordinated plan from the
// Lead panel; every seat sees it above the composer. The lead stages Ama's
// part and marks it Ready while the plan waits on Corin; a typed action for
// Ama is refused into the plan meanwhile. When Corin's player is ready the
// plan resolves on its own: both parts are posted as the characters' own
// actions with one table note, and the panel goes away for everyone.
import { request } from "playwright-core";
import { check, eventually, untilStill } from "../lib.mjs";

export default {
  name: "coordinate-actions",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, ids, api, base } = t;
    const coordinate = (session, data) => session.post(`${base}/api/campaigns/${ids.quietId}/coordination`, { data });
    // Viewports share one seeded world: no plan left open by an earlier run.
    await coordinate(api, { action: "cancel" });
    const playerApi = await request.newContext();
    try {
      const signed = await playerApi.post(`${base}/api/auth/login`, { data: { username: ids.player, password: ids.password } });
      check(signed.ok(), `the player's sign-in answered ${signed.status()}`);
      await t.open(`/campaigns/${ids.quietId}`);
      const panel = page.locator(`${root}[data-coordination]`).locator("visible=true").first();

      // Open it from the Lead panel: a rail tab on a desktop, a tab in the
      // bottom bar on a phone.
      const leadTab = page.locator(`${root}[data-tour="tab-lead"]`).locator("visible=true").first();
      await eventually(() => leadTab.count(), { timeoutMs: 20_000, label: "the Lead tab" });
      await t.tap(leadTab);
      const start = page.locator(`${root}[data-coordinate-start]`).locator("visible=true").first();
      await eventually(() => start.count(), { timeoutMs: 20_000, label: "Coordinate actions in the Lead panel" });
      await page.locator(`${root}[data-coordinate-open] input`).locator("visible=true").first().fill("At the rope bridge");
      await t.shot("lead-panel");
      await t.tap(start);
      // The opener gives way to a line saying where the plan is.
      const pointer = page.locator(`${root}[data-coordinating-note]`).locator("visible=true").first();
      await eventually(() => pointer.count(), { label: "the Lead panel saying where the plan is" });
      check((await page.locator(`${root}[data-coordinate-start]`).count()) === 0, "no second plan can be opened over the first");
      // A phone shows one view at a time: the plan is on the Table view.
      const tableView = page.locator(`${root}.cine-bottombar button`).filter({ hasText: /^\s*Table\s*$/ }).locator("visible=true").first();
      if (await tableView.count()) {
        await t.tap(tableView);
      }
      await eventually(() => panel.count(), { timeoutMs: 20_000, label: "the plan above the composer" });
      const entry = (id) => panel.locator(`[data-coordination-entry="${id}"]`);
      check((await entry(ids.ama).getAttribute("data-state")) === "waiting", "Ama's part waits to be written");
      check((await entry(ids.corin).getAttribute("data-state")) === "waiting", "Corin's part waits on its player");
      check(/At the rope bridge/.test(await panel.innerText()), "the plan says the moment it is about");

      // A typed action for Ama goes into the plan instead.
      const refused = await api.post(`${base}/api/campaigns/${ids.quietId}/actions`, {
        data: { kind: "do", characterId: ids.ama, content: "I step onto the bridge." },
      });
      check(refused.status() === 409, `a typed move while coordinating answered ${refused.status()}`);
      check((await refused.json()).coordinating === true, "the refusal says the party is coordinating");

      // The lead's own part: written, Ready, still waiting on Corin.
      await entry(ids.ama).locator("textarea").fill("While Corin holds the rope steady, I cross first with my shield raised.");
      await t.tap(entry(ids.ama).locator("[data-coordination-ready]"));
      await eventually(async () => (await entry(ids.ama).getAttribute("data-state")) === "ready", { label: "Ama ready" });
      check(/waiting on 1/.test(await panel.innerText()), "the plan waits on one player");
      await t.shot("ama-ready");

      // The player's part, from the player's own session: the plan
      // resolves on its own and leaves every screen.
      const before = await (await api.get(`${base}/api/campaigns/${ids.quietId}/messages?limit=40`)).json();
      const ready = await coordinate(playerApi, {
        action: "plan",
        characterId: ids.corin,
        text: "I brace the rope at this end and call out if it starts to give.",
        state: "ready",
      });
      check(ready.ok(), `Corin's ready answered ${ready.status()}`);
      await eventually(() => panel.count().then((count) => count === 0), { label: "the plan leaving the screen once resolved" });
      const after = await (await api.get(`${base}/api/campaigns/${ids.quietId}/messages?limit=40`)).json();
      const seen = new Set((before.messages ?? []).map((message) => message.id));
      const fresh = (after.messages ?? []).filter((message) => !seen.has(message.id));
      const lines = fresh.map((message) => `${message.authorType}:${message.characterId ?? ""}:${message.content}`);
      check(fresh.some((message) => message.characterId === ids.ama && /cross first/.test(message.content)), `Ama's part posted as her action (${lines.join(" | ")})`);
      check(fresh.some((message) => message.characterId === ids.corin && /brace the rope/.test(message.content)), "Corin's part posted as his action");
      check(fresh.filter((message) => /The party acts together/.test(message.content)).length === 1, "one table note for the plan");
      const state = await (await api.get(`${base}/api/campaigns/${ids.quietId}`)).json();
      check(state.coordination === null, "no plan is left open");
      await untilStill(page);
      await t.shot("resolved");
    } finally {
      await playerApi.dispose().catch(() => {});
    }
  },
};
