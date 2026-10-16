// WF-13: one account per entry, and every other text under its own name.
// A lore entry holding two different texts shows its body, says the other
// is kept, and the editor lets the author swap them or remove the other.
// A place with an article shows its arrival text beneath it, labelled, so
// an edit to either is seen.
import { check, eventually } from "../lib.mjs";

export default {
  name: "world-one-text",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, base, root, api } = t;
    const made = await api.post(`${base}/api/workshops`, { data: { title: "One text", description: "" } });
    check(made.ok(), "a workshop for the check");
    const id = (await made.json()).workshop.id;
    const entities = `${base}/api/campaigns/${id}/world/entities`;
    const fetchEntity = async (ref) => ((await (await api.get(`${base}/api/campaigns/${id}/world`)).json()).entities ?? []).find((entity) => entity.ref === ref);
    try {
      const lore = await (await api.post(entities, { data: { typeId: "t_other", name: "The Drowned Bell", text: "It rings at low tide." } })).json();
      const ref = lore.entity.ref;
      // Two texts, as an import before this change left them.
      const both = await api.patch(`${entities}/${encodeURIComponent(ref)}`, { data: { text: "It rings at low tide.", article: "It rang once, in the flood." } });
      check(both.ok(), "the older text is set beside the body");
      await api.post(entities, { data: { typeId: "t_location", name: "The Sluice Gate", text: "Iron and weed.", article: "A gate older than the town, opened twice a day." } });

      await t.open(`/workshop/${id}?system=world`);
      const row = (name) => page.locator(`${root}[role="listbox"][aria-label="Entries"] [role="option"]`, { hasText: name }).first();
      await eventually(() => row("The Drowned Bell").count(), { timeoutMs: 30_000, label: "the lore entry in the list" });
      await row("The Drowned Bell").click();
      const entry = page.locator(`${root}[data-tour="world-entry"]`);
      await eventually(async () => /It rings at low tide/.test(await entry.innerText()), { timeoutMs: 15_000, label: "the body shown as the account" });
      check(!/It rang once/.test(await entry.innerText()), "the older text is not shown in the body's place");
      check((await page.locator(`${root}[data-testid="world-older-text"]`).count()) === 1, "the page says an older text is kept");

      await page.locator(`${root}[data-tour="world-edit"]`).first().click();
      const older = page.locator(`${root}[data-testid="older-text"]`);
      await eventually(() => older.count(), { timeoutMs: 15_000, label: "the older text in the editor" });
      await t.shot("older");
      await older.getByRole("button", { name: "Use this one instead" }).click();
      await page.locator(`${root}form button[type="submit"]`).first().click();
      await eventually(async () => (await fetchEntity(ref))?.text === "It rang once, in the flood.", { timeoutMs: 15_000, label: "the older text saved as the body" });
      check((await fetchEntity(ref)).entry.article === "It rings at low tide.", "the body it replaced is kept beside it");

      await eventually(() => page.locator(`${root}[data-tour="world-edit"]`).count(), { timeoutMs: 15_000, label: "the editor closed" });
      await page.locator(`${root}[data-tour="world-edit"]`).first().click();
      await eventually(() => older.count(), { timeoutMs: 15_000, label: "the swapped text in the editor" });
      await older.getByRole("button", { name: "Remove it" }).click();
      await page.locator(`${root}form button[type="submit"]`).first().click();
      await eventually(async () => (await fetchEntity(ref))?.entry.article === "", { timeoutMs: 15_000, label: "the other text removed" });

      // On a phone the list hides while an entry is open.
      const back = page.locator(`${root}button[aria-label="Back to the list"]`).first();
      if (await back.isVisible()) await back.click();
      await eventually(() => row("The Sluice Gate").isVisible(), { timeoutMs: 15_000, label: "the place in the list" });
      await row("The Sluice Gate").click();
      const arrival = page.locator(`${root}[data-testid="world-arrival"]`);
      await eventually(() => arrival.count(), { timeoutMs: 15_000, label: "the arrival text under its own name" });
      check(/Iron and weed/.test(await arrival.innerText()), "the arrival text is shown");
      check(/A gate older than the town/.test(await entry.innerText()), "the article is the place's account");
    } finally {
      await api.delete(`${base}/api/workshops/${id}`);
    }
  },
};
