// Issue 668: at the start of a new round the Hand read "Vesper Lark has
// already used their bonus action this turn; Cunning Action (Hide) needs
// one" while the bonus chip was lit. A Hand notice was cleared only when a
// card was picked or played, never when the turn moved on. A notice now
// holds only for the turn it was raised on: here the lead's fighter Dodges,
// a spent action card is pressed and says why, and once the GM ends the
// turn the notice is gone while the Hand stays on the table.
import { request } from "playwright-core";
import { check, eventually } from "../lib.mjs";

export default {
  name: "hand-notice",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, ids, base, viewport } = t;
    const table = ids.noticeTables[viewport];
    // The table is the player's to run: the GM's calls go out as them.
    const gm = await request.newContext();
    try {
      const signed = await gm.post(`${base}/api/auth/login`, { data: { username: ids.player, password: ids.password } });
      check(signed.ok(), `the player signed in (${signed.status()})`);
      const invoke = async (name, args) => {
        const response = await gm.post(`${base}/api/campaigns/${table.id}/dm/invoke`, { data: { name, args } });
        const body = await response.json().catch(() => ({}));
        check(response.ok(), `${name} was refused (${response.status()}): ${body.error ?? ""}`);
        return body;
      };
      await t.open(`/campaigns/${table.id}`);
      if (viewport === "phone") await t.tap(page.locator(`${root}nav.cine-bottombar`).getByRole("button", { name: "Table", exact: true }));
      const hand = page.locator(`${root}section[aria-label="Your hand"]`).locator("visible=true").first();
      await eventually(() => hand.isVisible(), { timeoutMs: 30_000, label: "the fighter's Hand" });

      await invoke("take_action", { characterId: table.hero, action: "dodge" });
      const spent = hand.locator('[aria-disabled="true"][aria-label*=", Action."]').first();
      await eventually(() => spent.count(), { timeoutMs: 15_000, label: "an action card spent by the Dodge" });
      await t.tap(spent);
      const notice = hand.locator('p[role="status"]');
      await eventually(async () => (await notice.isVisible()) && /action/i.test(await notice.innerText()), { timeoutMs: 10_000, label: "the spent card saying why" });
      await t.shot("hand-notice-raised");

      await invoke("end_turn", {});
      await eventually(async () => !(await notice.isVisible()), { timeoutMs: 15_000, label: "the notice gone once the turn moved on" });
      check(await hand.isVisible(), "the Hand stays on the table off the fighter's turn");
      await t.shot("hand-notice-gone");
    } finally {
      await gm.dispose().catch(() => {});
    }
  },
};
