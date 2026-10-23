// A prep import that fails is said, where the person asked for it
// (docs/workshop-creator-import-audit-2026-10-22.md F03), on desktop and
// phone, on the website and in the app's own screens. The server's
// failures are made here by intercepting its answers:
//
//   - in a campaign's import picker, a preview that cannot be had holds the
//     button and offers to check again, and a refused import is shown as an
//     error, not in the green of a success;
//   - in the campaign creator, a campaign made whose chosen prep did not
//     come in stays on the review, says what failed with a way into the
//     campaign as it is, and Try again sends only the import: one campaign
//     is made, not two.
import { check, eventually, sleep } from "../lib.mjs";

export default {
  name: "prep-import-failure",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, base, root, api } = t;
    const stamp = `${t.viewport}${t.app ? "a" : "w"}${Date.now().toString(36).slice(-4)}`;
    const sourceTitle = `Failing prep ${stamp}`;
    const source = await api.post(`${base}/api/workshops`, { data: { title: sourceTitle, description: "" } });
    check(source.ok(), "a workshop to bring in");
    const sourceId = (await source.json()).workshop.id;
    const lore = await api.post(`${base}/api/campaigns/${sourceId}/lore`, { data: { category: "history", title: "The old mill", body: "It burned." } });
    check(lore.ok(), `the workshop holds prep (${lore.status()})`);
    const table = await api.post(`${base}/api/campaigns`, { data: { title: `Import target ${stamp}`, gameSettings: { ttsEnabled: false } } });
    check(table.ok(), "a campaign to bring it into");
    const tableId = (await table.json()).campaign.id;
    const createdTitle = `Creator failure ${stamp}`;
    try {
      // ---- the import picker of a campaign ----
      // Every URL this scenario answers with a 500 itself.
      const intercepted = [];
      await page.route(new RegExp(`/api/campaigns/${tableId}/import\\?`), (route) => {
        intercepted.push(new URL(route.request().url()).pathname);
        return route.fulfill({ status: 500, json: { error: "Preview broke." } });
      });
      await t.open(`/campaigns/${tableId}`);
      const startFrom = page.getByRole("button", { name: "Start from" }).locator("visible=true").first();
      await eventually(() => startFrom.count(), { timeoutMs: 30_000, label: "the import picker" });
      await startFrom.scrollIntoViewIfNeeded();
      await t.tap(startFrom);
      await t.tap(page.getByRole("menuitemradio", { name: sourceTitle }).locator("visible=true").first());
      const bring = page.getByRole("button", { name: /Bring it in/ }).locator("visible=true").first();
      const checkAgain = page.getByRole("button", { name: "Check again" }).locator("visible=true").first();
      await eventually(() => checkAgain.count(), { timeoutMs: 15_000, label: "the failed preview said, with Check again" });
      check(await bring.isDisabled(), "Bring it in waits for a preview");
      const size = await checkAgain.boundingBox();
      check(size && size.height >= 40, `Check again is a 40px target (${size?.height}px)`);
      await page.unroute(new RegExp(`/api/campaigns/${tableId}/import\\?`));
      await t.tap(checkAgain);
      await eventually(() => bring.isEnabled(), { timeoutMs: 15_000, label: "Bring it in once the preview answers" });

      await page.route(new RegExp(`/api/campaigns/${tableId}/import$`), (route) =>
        route.request().method() === "POST" ? route.fulfill({ status: 400, json: { error: "That source is not yours to copy." } }) : route.fallback(),
      );
      await t.tap(bring);
      const refused = page.getByRole("alert").filter({ hasText: "That source is not yours to copy." }).locator("visible=true").first();
      await eventually(() => refused.count(), { timeoutMs: 15_000, label: "the refusal, as an error" });
      const colour = await refused.evaluate((node) => getComputedStyle(node).color);
      check(!/rgb\(52, 211, 153\)/.test(colour), `the refusal is not drawn in the success green (${colour})`);
      await sleep(600);
      await t.shot("picker-refused");
      await page.unroute(new RegExp(`/api/campaigns/${tableId}/import$`));

      // ---- the campaign creator ----
      const campaignPosts = [];
      page.on("request", (request) => {
        if (request.method() === "POST" && /\/api\/campaigns$/.test(new URL(request.url()).pathname)) campaignPosts.push(request.url());
      });
      await page.route(/\/api\/campaigns\/[^/]+\/import$/, (route) => {
        if (route.request().method() !== "POST") return route.fallback();
        intercepted.push(new URL(route.request().url()).pathname);
        return route.fulfill({ status: 500, json: { error: "The import broke." } });
      });
      await t.open("/");
      const tile = page.locator(`${root}[data-tour="tile-new-campaign"], [data-tour="tile-new-campaign"]`).locator("visible=true").first();
      await eventually(() => tile.count(), { timeoutMs: 30_000, label: "the New campaign tile" });
      await t.tap(tile);
      const dialog = page.getByRole("dialog").filter({ has: page.locator(".cc-shell, .wizard-continue") }).first();
      await eventually(() => dialog.locator("button.wizard-continue").count(), { timeoutMs: 30_000, label: "the creator" });
      await dialog.locator('input[maxlength="80"]').fill(createdTitle);
      const prep = dialog.locator('[data-group="prep"] .cc-group-toggle');
      await prep.scrollIntoViewIfNeeded();
      await t.tap(prep);
      const creatorStart = dialog.getByRole("button", { name: "Start from" }).locator("visible=true").first();
      await eventually(() => creatorStart.count(), { timeoutMs: 15_000, label: "Start from in the creator" });
      await t.tap(creatorStart);
      await t.tap(page.getByRole("menuitemradio", { name: sourceTitle }).locator("visible=true").first());
      await t.tap(dialog.locator('button[aria-label^="Go to step 3"]'));
      await eventually(async () => /Here is what you made/.test((await dialog.locator("section[data-active]").textContent()) ?? ""), { label: "the review" });
      await t.tap(dialog.locator("button.wizard-continue"));

      const followUp = dialog.getByRole("alert").filter({ hasText: /did not come in/ }).first();
      await eventually(() => followUp.count(), { timeoutMs: 20_000, label: "the review says the prep did not come in" });
      check(/The import broke\./.test((await followUp.textContent()) ?? ""), "the failure is in the server's words");
      check(/Try again/.test((await dialog.locator("button.wizard-continue").textContent()) ?? ""), "the button now says Try again");
      const open = followUp.getByRole("button", { name: /Open the campaign as it is/ });
      const openSize = await open.boundingBox();
      check(openSize && openSize.height >= 40, `Open the campaign as it is is a 40px target (${openSize?.height}px)`);
      await sleep(900);
      await t.shot("creator-follow-up");

      // Try again sends only the import, which now goes through.
      await page.unroute(/\/api\/campaigns\/[^/]+\/import$/);
      await t.tap(dialog.locator("button.wizard-continue"));
      await eventually(async () => (await dialog.count()) === 0 || !(await dialog.isVisible()), { timeoutMs: 20_000, label: "the creator closing into the campaign" });
      check(campaignPosts.length === 1, `one campaign was made, not ${campaignPosts.length}`);
      const list = await (await api.get(`${base}/api/campaigns`)).json();
      const made = (list.campaigns ?? []).filter((entry) => entry.title === createdTitle);
      check(made.length === 1, `one campaign by that title (${made.length})`);
      if (made[0]) {
        const brought = await (await api.get(`${base}/api/campaigns/${made[0].id}/lore`)).json().catch(() => ({}));
        const titles = (brought.entries ?? brought.lore ?? []).map((entry) => entry.title);
        check(titles.includes("The old mill"), `the prep came in on Try again (${titles.join(", ")})`);
        await api.delete(`${base}/api/campaigns/${made[0].id}`).catch(() => {});
      }
      // The 500s above were this scenario's own answers, not the server's.
      const ours = new RegExp(`/api/campaigns/(${tableId}|[^/?]+)/import(\\?|$)`);
      for (let index = t.fails.length - 1; index >= 0; index -= 1) {
        if (ours.test(t.fails[index]) && intercepted.some((url) => t.fails[index].includes(url))) t.fails.splice(index, 1);
      }
    } finally {
      await page.unrouteAll({ behavior: "ignoreErrors" }).catch(() => {});
      await api.delete(`${base}/api/campaigns/${tableId}`).catch(() => {});
      await api.delete(`${base}/api/workshops/${sourceId}`).catch(() => {});
    }
  },
};
