// Issue 580: after hours of play the Bonds panel listed nobody the party
// travelled with, because a bond opened only when a roll or a moment named
// one character. Here the GM's console brings a companion into the party and
// gives a prepared patron her attitude as the party meets her: each shows
// under both characters at once. Then the patron is killed: every bond with
// her says "died", not only the one the console named. Night and day, clean
// under axe.
import { axeViolations, check, eventually, openPanelTab, untilStill } from "../lib.mjs";

const scenario = {
  name: "party-bonds",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, ids, base, api, viewport } = t;
    const table = ids.bondTables[viewport];
    const call = async (name, args) => {
      const response = await api.post(`${base}/api/campaigns/${table.id}/dm/invoke`, { data: { name, args } });
      const body = await response.json().catch(() => ({}));
      check(response.ok() && body.ok !== false, `${name} ran (${response.status()}): ${JSON.stringify(body).slice(0, 200)}`);
      return body;
    };
    await t.open(`/campaigns/${table.id}`);
    await openPanelTab(t, "party");
    const bondsTab = page.locator(`${root}[data-pill-group] button`).filter({ hasText: /^\s*Bonds\s*$/ }).locator("visible=true").first();
    await eventually(() => bondsTab.count(), { timeoutMs: 30_000, label: "the Bonds sub-tab" });
    await t.tap(bondsTab);
    const rows = (name) => page.locator(`${root}[data-bond-row="${name}"]`).locator("visible=true");

    await call("add_companion", { name: "Seren Dawnmere", class: "paladin", gender: "Female", personality: "Stern and devout.", kind: "party" });
    await eventually(() => rows("Seren Dawnmere").count().then((count) => count === 2), { timeoutMs: 20_000, label: "the companion under both characters" });
    await call("set_npc", { name: "Mira Vell", attitude: "friendly" });
    await eventually(() => rows("Mira Vell").count().then((count) => count === 2), { timeoutMs: 20_000, label: "the patron under both characters once met" });
    await untilStill(page);
    const found = await axeViolations(page, `${root}[data-bond-row="Mira Vell"]`);
    check(!found.length, `axe on a bond row: ${found.map((entry) => entry.id).join(", ")}`);
    await t.shot("met");

    await call("relationship_end", { characterId: table.kael, subject: "Mira Vell", reason: "death" });
    await eventually(
      async () => {
        const texts = await rows("Mira Vell").allTextContents();
        return texts.length === 2 && texts.every((text) => /\bdied\b/.test(text));
      },
      { timeoutMs: 20_000, label: "every bond with the dead saying died" },
    );
    await untilStill(page);
    await t.shot("died");
    await page.evaluate(() => (document.documentElement.dataset.theme = "light"));
    await untilStill(page);
    await t.shot("died-day");
    await page.evaluate(() => (document.documentElement.dataset.theme = "dark"));
  },
};

export default scenario;
