// WF-06: a WorldForge file that would not come in whole is named before
// anything is written. The fixture carries a script dressed as a picture,
// so it loses that picture: the panel lists the loss, the workshop stays
// empty, and "Bring it in anyway" brings the rest in.
import fs from "node:fs";
import { check, eventually } from "../lib.mjs";

const FIXTURE = new URL("../../fixtures/worldforge-saltmarch.json", import.meta.url);

export default {
  name: "world-file-losses",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, base, root, api } = t;
    const made = await api.post(`${base}/api/workshops`, { data: { title: "Losses named first", description: "" } });
    check(made.ok(), "a workshop for the check");
    const id = (await made.json()).workshop.id;
    const count = async () => ((await (await api.get(`${base}/api/campaigns/${id}/world`)).json()).entities ?? []).length;
    try {
      await t.open(`/workshop/${id}?system=world`);
      const input = page.locator(`${root}input[type="file"][accept*="json"]`).first();
      await eventually(() => input.count(), { timeoutMs: 30_000, label: "the WorldForge file input" });
      await input.setInputFiles({ name: "saltmarch.json", mimeType: "application/json", buffer: fs.readFileSync(FIXTURE) });
      const held = page.locator(`${root}[data-testid="world-import-losses"]`);
      await eventually(() => held.count(), { timeoutMs: 20_000, label: "the list of losses" });
      const said = await held.innerText();
      check(/Mira Fenn: its picture is not a PNG/.test(said), `the loss is named: ${JSON.stringify(said.slice(0, 200))}`);
      check((await count()) === 0, "nothing was written before the author agreed");
      await t.shot("held");
      await held.getByRole("button", { name: "Bring it in anyway" }).click();
      await eventually(async () => (await count()) > 0, { timeoutMs: 20_000, label: "the world brought in" });
      const report = page.locator(`${root}[role="status"]`, { hasText: "Brought in" });
      await eventually(() => report.count(), { timeoutMs: 15_000, label: "the import report" });
      check(/Not in whole/.test(await report.first().innerText()), "the report repeats what did not come in whole");
    } finally {
      await api.delete(`${base}/api/workshops/${id}`);
    }
  },
};
