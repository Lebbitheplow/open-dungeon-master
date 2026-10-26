// Correct a sheet, left empty as its hint says (table function audit
// 2026-10-26, T09). The DM picks the hero and Conditions in the console's
// Party tab, leaves Becomes empty and presses Run: the conditions clear and
// no "Say what conditions becomes" comes back. The seed's Enemy Turn Table,
// whose hero is given a condition first.
import { check, eventually, openPanelTab, untilStill } from "../lib.mjs";

export default {
  name: "correct-sheet-clear",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, ids, api, base, viewport } = t;
    const table = ids.enemyTurns[viewport];
    const campaign = `${base}/api/campaigns/${table.id}`;
    const poisoned = await api.post(`${campaign}/dm/invoke`, { data: { name: "set_condition", args: { characterId: table.hero, condition: "poisoned" } } });
    check(poisoned.ok(), `poisoning the hero answered ${poisoned.status()}`);
    const conditions = async () => {
      const snapshot = await (await api.get(campaign)).json();
      return snapshot.sheets.find((sheet) => sheet.id === table.hero)?.conditions ?? null;
    };
    check((await conditions())?.includes("poisoned"), "the hero is poisoned before the correction");

    await t.open(`/campaigns/${table.id}`);
    await eventually(() => page.locator(`${root}.cine-stage`).count(), { timeoutMs: 30_000, label: "the table's stage" });
    await openPanelTab(t, "dm");
    const tabs = page.locator(`${root}[data-tour="dm-console-tabs"] button`).filter({ hasText: /^party$/i }).locator("visible=true").first();
    await eventually(() => tabs.count(), { timeoutMs: 30_000, label: "the console's Party tab" });
    await t.tap(tabs);
    const open = page.getByRole("button", { name: /^Correct a sheet/ }).locator("visible=true").first();
    await eventually(() => open.count(), { label: "Correct a sheet" });
    await t.tap(open);
    await untilStill(page);

    // The kit's Select: a menu button named by its label, rows as radio items.
    const pick = async (label, option) => {
      const button = page.getByRole("button", { name: label, exact: true }).locator("visible=true").first();
      await eventually(() => button.count(), { label: `the ${label} picker` });
      await t.tap(button);
      const row = page.getByRole("menuitemradio", { name: option }).locator("visible=true").first();
      await eventually(() => row.count(), { label: `${option} under ${label}` });
      await t.tap(row);
    };
    await pick("Character", table.heroName);
    await pick("Field", "Conditions");
    const becomes = page.getByLabel("Becomes", { exact: true }).locator("visible=true").first();
    if (await becomes.count()) {
      check((await becomes.inputValue()) === "", "Becomes starts empty");
    }
    await t.shot("form");
    const ran = page.waitForResponse((response) => response.url().endsWith("/dm/invoke") && response.request().method() === "POST", { timeout: 30_000 });
    ran.catch(() => {});
    await t.tap(page.getByRole("button", { name: /^\s*Run\s*$/ }).locator("visible=true").first());
    const answer = await ran;
    check(answer.ok(), `Run answered ${answer.status()}: ${await answer.text()}`);
    check((await page.getByText("Say what conditions becomes", { exact: false }).count()) === 0, "the form still asks what conditions becomes");
    await eventually(async () => (await conditions())?.length === 0, { label: "the hero's conditions cleared" });
    await t.shot("cleared");
  },
};
