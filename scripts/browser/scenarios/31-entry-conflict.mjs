// WF-02: an entry form saved after another author changed the same entry.
// The other author renames it and adds notes; this author, with the form
// already open, renames it too. The save is refused with the clash shown,
// the draft kept, and the other author's notes taken into the form. "Use
// theirs" takes their name; saving again keeps both changes.
import { check, eventually } from "../lib.mjs";

export default {
  name: "entry-conflict",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, base, root, api } = t;
    const made = await api.post(`${base}/api/workshops`, { data: { title: "Two authors", description: "" } });
    check(made.ok(), "a workshop for the check");
    const id = (await made.json()).workshop.id;
    try {
      const entry = await api.post(`${base}/api/campaigns/${id}/world/entities`, { data: { name: "The Lamplighter" } });
      check(entry.ok(), `an entry is made (${entry.status()})`);
      const ref = (await entry.json()).entity.ref;
      const url = `${base}/api/campaigns/${id}/world/entities/${encodeURIComponent(ref)}`;

      await t.open(`/workshop/${id}?system=world`);
      const row = page.locator(`${root}[role="listbox"][aria-label="Entries"] [role="option"]`, { hasText: "The Lamplighter" });
      await eventually(() => row.count(), { timeoutMs: 30_000, label: "the entry in the list" });
      await row.first().click();
      const edit = page.locator(`${root}[data-tour="world-edit"]`);
      await eventually(() => edit.count(), { timeoutMs: 15_000, label: "the Edit button" });
      await edit.first().click();
      const name = page.locator(`${root}form input[required]`).first();
      await eventually(() => name.count(), { timeoutMs: 15_000, label: "the entry form" });

      // The other author saves first, from their own editor.
      const theirs = await api.patch(url, { data: { name: "The Harbour Lamplighter", notes: "Theirs, kept.", base: { name: "The Lamplighter", notes: "" } } });
      check(theirs.ok(), `the other author's save lands (${theirs.status()})`);

      await name.fill("The Lamplighter of Gullhaven");
      await page.locator(`${root}form button[type="submit"]`).first().click();
      const notice = page.locator(`${root}[data-testid="entry-conflicts"]`);
      await eventually(() => notice.count(), { timeoutMs: 15_000, label: "the clash notice" });
      const said = await notice.innerText();
      check(/Name/.test(said) && /Harbour Lamplighter/.test(said), `the notice names the field and their value: ${JSON.stringify(said.slice(0, 160))}`);
      check((await name.inputValue()) === "The Lamplighter of Gullhaven", "the draft name is kept");
      const notes = page.locator(`${root}form textarea`).last();
      check((await notes.inputValue()) === "Theirs, kept.", "their other change is taken into the form");
      await t.shot("clash");

      await notice.getByRole("button", { name: "Use theirs" }).click();
      check((await name.inputValue()) === "The Harbour Lamplighter", "Use theirs takes their name");
      await page.locator(`${root}form button[type="submit"]`).first().click();
      await eventually(async () => (await page.locator(`${root}form input[required]`).count()) === 0, { timeoutMs: 15_000, label: "the editor closes after saving" });
      const now = await (await api.get(`${base}/api/campaigns/${id}/world`)).json();
      const saved = (now.entities ?? []).find((entity) => entity.ref === ref);
      check(saved?.name === "The Harbour Lamplighter" && saved?.entry?.notes === "Theirs, kept.", `both of their changes stand (${saved?.name}, ${saved?.entry?.notes})`);
    } finally {
      await api.delete(`${base}/api/workshops/${id}`);
    }
  },
};
