// Every roll table in a campaign keeps a name of its own
// (docs/workshop-creator-import-audit-2026-10-22.md, its follow-up), on
// desktop and phone, on the website and in the app's own screens:
//
//   - a second table given a taken name arrives numbered, "Gems (2)", since
//     a row that says "@table: Gems" only ever rolls the first;
//   - renaming a table onto a name another one holds is refused in the
//     editor, with the reason, and nothing is saved;
//   - renaming a table to a free name carries the rows that roll on it.
import { check, eventually } from "../lib.mjs";

export default {
  name: "table-names",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, base, root, api } = t;
    const stamp = `${t.viewport}${t.app ? "a" : "w"}${Date.now().toString(36).slice(-4)}`;
    const made = await api.post(`${base}/api/workshops`, { data: { title: `Tables ${stamp}`, description: "" } });
    check(made.ok(), "a workshop for the check");
    const workshopId = (await made.json()).workshop.id;
    const tablesUrl = `${base}/api/campaigns/${workshopId}/dm/roll-tables`;
    const tables = async () => (await (await api.get(tablesUrl)).json()).tables ?? [];
    try {
      check((await api.post(tablesUrl, { data: { name: "Gems", text: "1. Ruby" } })).ok(), "the first Gems");
      const second = await (await api.post(tablesUrl, { data: { name: "Gems", text: "1. Opal" } })).json();
      check(second.table?.name === "Gems (2)", `a second Gems arrives numbered (${second.table?.name})`);
      check((await api.post(tablesUrl, { data: { name: "Loot", text: "1. @table: Gems" } })).ok(), "a table that rolls on Gems");

      await t.open(`/workshop/${workshopId}?system=tables`);
      const row = (name) => page.locator(root ? root.trim() : "body").first().getByRole("button", { name }).locator("visible=true").first();
      const sheet = page.getByRole("dialog").last();
      const nameField = sheet.getByLabel("Table name");
      const save = sheet.getByRole("button", { name: "Save table" });

      // ---- onto a taken name: refused, with the reason ----
      await eventually(() => row(/^Gems \(2\)/).isVisible(), { timeoutMs: 30_000, label: "the numbered table" });
      await t.tap(row(/^Gems \(2\)/));
      await eventually(() => nameField.isVisible(), { timeoutMs: 10_000, label: "the table editor" });
      await nameField.fill("gems");
      await t.tap(save);
      const refusal = sheet.getByRole("alert").filter({ hasText: /Another table here is already called gems/ });
      await eventually(() => refusal.isVisible(), { timeoutMs: 10_000, label: "the refusal in the editor" });
      await t.shot("rename-refused");
      check(await sheet.isVisible(), "the editor stays open with the name to change");
      check((await tables()).filter((table) => table.name.toLowerCase() === "gems").length === 1, "nothing was saved");
      await page.keyboard.press("Escape");
      await eventually(async () => !(await nameField.isVisible()), { timeoutMs: 10_000, label: "the editor closed" });

      // ---- to a free name: the rows that rolled on it follow ----
      await t.tap(row(/^Gems(?! \()/));
      await eventually(async () => (await nameField.inputValue().catch(() => "")) === "Gems", { timeoutMs: 10_000, label: "Gems in the editor" });
      await nameField.fill("Rubies");
      await t.tap(save);
      await eventually(async () => !(await nameField.isVisible()), { timeoutMs: 10_000, label: "the rename saved" });
      await eventually(() => row(/^Rubies/).isVisible(), { timeoutMs: 10_000, label: "Rubies in the list" });
      const loot = (await tables()).find((table) => table.name === "Loot");
      check(loot?.entries?.[0]?.ref?.name === "Rubies", `Loot rolls on Rubies now (${JSON.stringify(loot?.entries?.[0])})`);
    } finally {
      await api.delete(`${base}/api/workshops/${workshopId}`).catch(() => {});
    }
  },
};
