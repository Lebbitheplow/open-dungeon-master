// Issue 292: the lead puts a coordinated plan in order. In the Lead panel
// the picked characters become numbered steps (dragged onto a step to act
// with it, or moved with the buttons), and the plan above the composer shows
// every seat those steps. A change of order after a player is Ready takes
// the Ready back, tells that player where their character stands now, and
// holds Resolve now until they confirm; a reload keeps the order; and the
// resolution posts the lines step by step with a note naming the order.
import { request } from "playwright-core";
import { check, eventually, untilStill, upTo } from "../lib.mjs";

export default {
  name: "coordinate-order",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, ids, api, base, viewport } = t;
    const coordinate = (session, data) => session.post(`${base}/api/campaigns/${ids.quietId}/coordination`, { data });
    await coordinate(api, { action: "cancel" });
    const playerApi = await request.newContext();
    const tableView = async () => {
      const button = page.locator(`${root}.cine-bottombar button`).filter({ hasText: /^\s*Table\s*$/ }).locator("visible=true").first();
      if (await button.count()) {
        await t.tap(button);
      }
    };
    try {
      const signed = await playerApi.post(`${base}/api/auth/login`, { data: { username: ids.player, password: ids.password } });
      check(signed.ok(), `the player's sign-in answered ${signed.status()}`);
      await t.open(`/campaigns/${ids.quietId}`);
      const leadTab = page.locator(`${root}[data-tour="tab-lead"]`).locator("visible=true").first();
      await eventually(() => leadTab.count(), { timeoutMs: 20_000, label: "the Lead tab" });
      await t.tap(leadTab);
      const opener = page.locator(`${root}[data-coordinate-open]`).locator("visible=true").first();
      await eventually(() => opener.count(), { timeoutMs: 20_000, label: "Coordinate actions in the Lead panel" });

      // Ama, then Corin, put in order: Corin first.
      await t.tap(opener.locator("button[aria-pressed]").filter({ hasText: "Sister Ama" }));
      await t.tap(opener.locator("button[aria-pressed]").filter({ hasText: "Corin Vale" }));
      await t.tap(opener.locator('[role="switch"][aria-label="Set the order they act in"]'));
      const editor = opener.locator("[data-coordinate-order]");
      const item = (id) => editor.locator(`[data-sequence-item="${id}"]`);
      const stepOf = async (scope, id) =>
        scope.locator(`[data-sequence-step]`).filter({ has: page.locator(`[data-sequence-item="${id}"]`) }).getAttribute("data-sequence-step", { timeout: 5_000 });
      await eventually(() => item(ids.corin).count(), { label: "the order editor" });
      check((await stepOf(editor, ids.ama)) === "1" && (await stepOf(editor, ids.corin)) === "2", "the picks start in the order they were picked");
      if (viewport === "desktop") {
        // Dragged onto Ama's step, Corin acts with her; then a step of his own.
        if (t.syntheticDrag) {
          // A driver that cannot hold a native drag (Playwright in Electron)
          // fires the same drag events at the same elements.
          await page.evaluate(
            ([from, to]) => {
              const source = document.querySelector(from);
              const target = document.querySelector(to);
              const data = new DataTransfer();
              const fire = (node, type) => node.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: data }));
              fire(source, "dragstart");
              fire(target, "dragover");
              fire(target, "drop");
              fire(source, "dragend");
            },
            [`[data-coordinate-order] [data-sequence-item="${ids.corin}"]`, '[data-coordinate-order] [data-sequence-step="1"]'],
          );
        } else {
          // A native drag on a busy runner sometimes ends before the drop
          // target has seen it; a person drags again, and so does this.
          for (let attempt = 0; attempt < 3; attempt += 1) {
            await item(ids.corin).dragTo(editor.locator('[data-sequence-step="1"]'));
            await upTo(async () => (await stepOf(editor, ids.corin).catch(() => "")) === "1", 400);
            if ((await stepOf(editor, ids.corin).catch(() => "")) === "1") break;
          }
        }
        await eventually(async () => (await stepOf(editor, ids.corin)) === "1", { label: "Corin dropped into step 1" });
        await untilStill(page);
        await t.shot("together");
        await t.tap(item(ids.corin).locator("[data-sequence-split]"));
        await eventually(async () => (await stepOf(editor, ids.corin)) === "2", { label: "Corin on a step of his own" });
      }
      await t.tap(item(ids.corin).locator("[data-sequence-earlier]"));
      await eventually(async () => (await stepOf(editor, ids.corin)) === "1" && (await stepOf(editor, ids.ama)) === "2", { label: "Corin moved first" });
      await untilStill(page);
      await t.shot("lead-order");
      await t.tap(opener.locator("[data-coordinate-start]"));

      // Every seat reads the steps.
      await tableView();
      const panel = page.locator(`${root}[data-coordination]`).locator("visible=true").first();
      await eventually(() => panel.count(), { timeoutMs: 20_000, label: "the plan above the composer" });
      check((await panel.getAttribute("data-ordered")) !== null, "the plan is ordered");
      const planStep = async (id) =>
        panel.locator("[data-coordination-step]").filter({ has: page.locator(`[data-coordination-entry="${id}"]`) }).getAttribute("data-coordination-step", { timeout: 5_000 });
      check((await planStep(ids.corin)) === "1" && (await planStep(ids.ama)) === "2", "Corin's step comes first on the board");
      const state = await (await playerApi.get(`${base}/api/campaigns/${ids.quietId}`)).json();
      check(
        JSON.stringify(state.coordination.entries.map((entry) => [entry.characterId, entry.step])) === JSON.stringify([[ids.corin, 1], [ids.ama, 2]]),
        "the player's seat reads the same order",
      );

      // A reload keeps the order.
      await t.open(`/campaigns/${ids.quietId}`);
      await tableView();
      await eventually(() => panel.count(), { timeoutMs: 20_000, label: "the plan after a reload" });
      check((await planStep(ids.corin)) === "1" && (await planStep(ids.ama)) === "2", "the order is the same after a reload");
      await panel.scrollIntoViewIfNeeded();
      await untilStill(page);
      await t.shot("ordered-plan");

      // Ama is Ready; then the lead puts her alongside Corin, which is the
      // plan with no order: everyone at once.
      const entry = (id) => panel.locator(`[data-coordination-entry="${id}"]`);
      await entry(ids.ama).locator("textarea").fill("Once Corin has the rope taut, I cross with my shield raised.");
      await t.tap(entry(ids.ama).locator("[data-coordination-ready]"));
      await eventually(async () => (await entry(ids.ama).getAttribute("data-state")) === "ready", { label: "Ama ready" });
      await t.tap(panel.locator("[data-coordination-order]"));
      const reorder = panel.locator("[data-coordination-ordering]");
      await eventually(() => reorder.count(), { label: "the order editor on the plan" });
      await t.tap(reorder.locator(`[data-sequence-item="${ids.ama}"] [data-sequence-join]`));
      await t.tap(reorder.locator("[data-coordination-save-order]"));
      await eventually(async () => (await entry(ids.ama).getAttribute("data-order-changed")) !== null, { label: "Ama's Ready taken back" });
      check((await panel.getAttribute("data-ordered")) === null, "one shared step is the plan with no order");
      check((await entry(ids.ama).getAttribute("data-state")) === "drafting", "Ama is drafting again");
      const notice = entry(ids.ama).locator("[data-order-notice]");
      check(/everyone now acts at once/.test((await notice.textContent()) ?? ""), `Ama's player is told where she stands (${await notice.textContent()})`);
      check(await panel.locator("[data-coordination-resolve]").isDisabled(), "Resolve now waits for Ama's player");
      check((await panel.locator("[data-order-waiting]").count()) === 1, "the lead is told who it waits on");
      await t.shot("order-changed");

      // Ama confirms; the lead sets Corin first again, and Ama confirms that.
      await t.tap(entry(ids.ama).locator("[data-coordination-ready]"));
      await eventually(async () => (await entry(ids.ama).getAttribute("data-state")) === "ready", { label: "Ama ready again" });
      check((await entry(ids.ama).getAttribute("data-order-changed")) === null, "her Ready clears the question");
      await t.tap(panel.locator("[data-coordination-order]"));
      await eventually(() => reorder.count(), { label: "the order editor again" });
      check((await stepOf(reorder, ids.corin)) === "1" && (await stepOf(reorder, ids.ama)) === "2", "the editor starts from the plan's own order");
      await t.tap(reorder.locator("[data-coordination-save-order]"));
      await eventually(async () => (await entry(ids.ama).getAttribute("data-order-changed")) !== null, { label: "Ama asked again" });
      await eventually(async () => (await planStep(ids.corin)) === "1" && (await planStep(ids.ama)) === "2", { label: "Corin first again" });
      await t.tap(entry(ids.ama).locator("[data-coordination-ready]"));
      await eventually(async () => (await entry(ids.ama).getAttribute("data-state")) === "ready", { label: "Ama ready for the final order" });

      // Corin's player readies from their own seat: it resolves, step by step.
      const before = await (await api.get(`${base}/api/campaigns/${ids.quietId}/messages?limit=40`)).json();
      const ready = await coordinate(playerApi, {
        action: "plan",
        characterId: ids.corin,
        text: "I wrap the rope round the post and haul it taut.",
        state: "ready",
        orderSeen: JSON.stringify([[ids.corin], [ids.ama]]),
      });
      check(ready.ok(), `Corin's ready answered ${ready.status()}`);
      await eventually(() => panel.count().then((count) => count === 0), { label: "the plan leaving the screen once resolved" });
      const after = await (await api.get(`${base}/api/campaigns/${ids.quietId}/messages?limit=40`)).json();
      const seen = new Set((before.messages ?? []).map((message) => message.id));
      const fresh = (after.messages ?? []).filter((message) => !seen.has(message.id)).sort((a, b) => a.seq - b.seq);
      const corinAt = fresh.findIndex((message) => message.characterId === ids.corin);
      const amaAt = fresh.findIndex((message) => message.characterId === ids.ama);
      check(corinAt >= 0 && amaAt > corinAt, `Corin's step posted before Ama's (${fresh.map((message) => message.content).join(" | ")})`);
      check(fresh.some((message) => /The party acts in order: 1\. Corin Vale; 2\. Sister Ama\./.test(message.content)), "the note names the order");
      await untilStill(page);
      await t.shot("resolved");
    } finally {
      await coordinate(api, { action: "cancel" }).catch(() => {});
      await playerApi.dispose().catch(() => {});
    }
  },
};
